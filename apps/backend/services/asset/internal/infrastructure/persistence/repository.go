package persistence

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/monorepo/asset/internal/application"
	"github.com/example/monorepo/asset/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct{ pool *pgxpool.Pool }

func Connect(ctx context.Context, databaseURL string) (*Repository, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Repository{pool: pool}, nil
}

func (r *Repository) Close()                         { r.pool.Close() }
func (r *Repository) Ping(ctx context.Context) error { return r.pool.Ping(ctx) }

func (r *Repository) BeginUpload(ctx context.Context, input application.CreateUploadInput, id string, expiresAt, now time.Time) (application.BeginUploadResult, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return application.BeginUploadResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var insertedID string
	err = tx.QueryRow(ctx, `INSERT INTO upload_sessions
        (id,tenant_id,workspace_id,user_id,caller_service,idempotency_key,category,filename,declared_media_type,state,expires_at,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8,$9,'uploading',$10,$11,$11)
        ON CONFLICT DO NOTHING RETURNING id`,
		id, input.TenantID, input.WorkspaceID, input.UserID, input.CallerService, input.IdempotencyKey,
		input.Category, input.Filename, input.MediaType, expiresAt, now).Scan(&insertedID)
	if err == nil {
		if err = tx.Commit(ctx); err != nil {
			return application.BeginUploadResult{}, err
		}
		return application.BeginUploadResult{UploadID: insertedID}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) || input.IdempotencyKey == "" {
		return application.BeginUploadResult{}, classify(err)
	}

	var uploadID, userID, category, filename, mediaType, state, assetID, revisionID string
	err = tx.QueryRow(ctx, `SELECT id,user_id,category,filename,declared_media_type,state,COALESCE(asset_id::text,''),COALESCE(revision_id::text,'')
        FROM upload_sessions
        WHERE tenant_id=$1 AND workspace_id=$2 AND caller_service=$3 AND idempotency_key=$4
        FOR UPDATE`, input.TenantID, input.WorkspaceID, input.CallerService, input.IdempotencyKey).
		Scan(&uploadID, &userID, &category, &filename, &mediaType, &state, &assetID, &revisionID)
	if err != nil {
		return application.BeginUploadResult{}, classify(err)
	}
	if userID != input.UserID || category != input.Category || filename != input.Filename || mediaType != input.MediaType {
		return application.BeginUploadResult{}, application.ErrConflict
	}
	switch state {
	case "completed":
		if assetID == "" || revisionID == "" {
			return application.BeginUploadResult{}, application.ErrConflict
		}
		if err = tx.Commit(ctx); err != nil {
			return application.BeginUploadResult{}, err
		}
		return application.BeginUploadResult{UploadID: uploadID, AssetID: assetID, RevisionID: revisionID, Completed: true}, nil
	case "failed":
		if _, err = tx.Exec(ctx, `UPDATE upload_sessions
            SET state='uploading',error_code=NULL,expires_at=$2,updated_at=$3 WHERE id=$1`, uploadID, expiresAt, now); err != nil {
			return application.BeginUploadResult{}, err
		}
		if err = tx.Commit(ctx); err != nil {
			return application.BeginUploadResult{}, err
		}
		return application.BeginUploadResult{UploadID: uploadID}, nil
	default:
		return application.BeginUploadResult{}, application.ErrConflict
	}
}

func (r *Repository) FailUpload(ctx context.Context, id, code string, now time.Time) error {
	_, err := r.pool.Exec(ctx, `UPDATE upload_sessions SET state='failed', error_code=$2, updated_at=$3 WHERE id=$1 AND state='uploading'`, id, code, now)
	return err
}

func (r *Repository) CompleteUpload(ctx context.Context, input application.CompleteUploadInput) (application.CompleteUploadResult, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return application.CompleteUploadResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var state string
	if err = tx.QueryRow(ctx, `SELECT state FROM upload_sessions WHERE id=$1 FOR UPDATE`, input.UploadID).Scan(&state); err != nil {
		return application.CompleteUploadResult{}, classify(err)
	}
	if state != "uploading" {
		return application.CompleteUploadResult{}, application.ErrConflict
	}

	blobID := input.BlobID
	canonicalStorageKey := input.StorageKey
	err = tx.QueryRow(ctx, `INSERT INTO blobs
        (id,tenant_id,sha256,size_bytes,storage_key,state,created_at)
        VALUES ($1,$2,$3,$4,$5,'active',$6)
        ON CONFLICT (tenant_id,sha256,size_bytes) WHERE state='active'
        DO UPDATE SET state=blobs.state
        RETURNING id,storage_key`,
		input.BlobID, input.TenantID, input.SHA256, input.SizeBytes, input.StorageKey, input.Now).Scan(&blobID, &canonicalStorageKey)
	if err != nil {
		return application.CompleteUploadResult{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO assets
        (id,tenant_id,workspace_id,category,state,blocking_claim_count,state_version,created_by,created_at,updated_at)
		VALUES ($1,$2,$3,$4,'active',1,1,$5,$6,$6)`, input.AssetID, input.TenantID, input.WorkspaceID, input.Category, input.UserID, input.Now); err != nil {
		return application.CompleteUploadResult{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO asset_revisions
        (id,asset_id,blob_id,revision_number,filename,media_type,size_bytes,sha256,created_by,created_at)
        VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9)`, input.RevisionID, input.AssetID, blobID, input.Filename, input.MediaType, input.SizeBytes, input.SHA256, input.UserID, input.Now); err != nil {
		return application.CompleteUploadResult{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE assets SET current_revision_id=$2 WHERE id=$1`, input.AssetID, input.RevisionID); err != nil {
		return application.CompleteUploadResult{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO asset_claims
		(id,tenant_id,workspace_id,owner_service,owner_type,owner_id,slot,asset_id,revision_id,kind,status,generation,expires_at,created_at,updated_at)
		VALUES ($1,$2,$3,'asset','upload_session',$4,'uploaded-bytes',$5,$6,'lease','active',1,$7,$8,$8)`,
		input.UploadClaimID, input.TenantID, input.WorkspaceID, input.UploadID, input.AssetID, input.RevisionID, input.UploadLeaseExpiresAt, input.Now); err != nil {
		return application.CompleteUploadResult{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE upload_sessions SET state='completed',asset_id=$2,revision_id=$3,updated_at=$4 WHERE id=$1`, input.UploadID, input.AssetID, input.RevisionID, input.Now); err != nil {
		return application.CompleteUploadResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return application.CompleteUploadResult{}, err
	}

	asset := domain.Asset{ID: input.AssetID, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, Category: input.Category, CurrentRevisionID: input.RevisionID, State: "active", BlockingClaimCount: 1, StateVersion: 1, CreatedBy: input.UserID, CreatedAt: input.Now, UpdatedAt: input.Now}
	revision := domain.Revision{ID: input.RevisionID, AssetID: input.AssetID, BlobID: blobID, RevisionNumber: 1, Filename: input.Filename, MediaType: input.MediaType, SizeBytes: input.SizeBytes, SHA256: input.SHA256, CreatedBy: input.UserID, CreatedAt: input.Now}
	result := application.CompleteUploadResult{Asset: asset, Revision: revision}
	if canonicalStorageKey != input.StorageKey {
		result.UnusedStorageKey = input.StorageKey
	}
	return result, nil
}

func (r *Repository) GetRevision(ctx context.Context, tenantID, workspaceID, assetID, revisionID string) (domain.Asset, domain.Revision, string, error) {
	var asset domain.Asset
	var revision domain.Revision
	var storageKey string
	err := r.pool.QueryRow(ctx, `SELECT a.id,a.tenant_id,a.workspace_id,a.category,a.state,a.current_revision_id,a.blocking_claim_count,a.state_version,a.created_by,a.created_at,a.updated_at,
        r.id,r.blob_id,r.revision_number,r.filename,r.media_type,r.size_bytes,r.sha256,r.created_by,r.created_at,b.storage_key
        FROM assets a JOIN asset_revisions r ON r.asset_id=a.id JOIN blobs b ON b.id=r.blob_id
        WHERE a.id=$1 AND r.id=$2 AND a.tenant_id=$3 AND a.workspace_id=$4 AND a.state IN ('active','candidate') AND b.state='active'`,
		assetID, revisionID, tenantID, workspaceID).Scan(&asset.ID, &asset.TenantID, &asset.WorkspaceID, &asset.Category, &asset.State, &asset.CurrentRevisionID, &asset.BlockingClaimCount, &asset.StateVersion, &asset.CreatedBy, &asset.CreatedAt, &asset.UpdatedAt, &revision.ID, &revision.BlobID, &revision.RevisionNumber, &revision.Filename, &revision.MediaType, &revision.SizeBytes, &revision.SHA256, &revision.CreatedBy, &revision.CreatedAt, &storageKey)
	if err != nil {
		return domain.Asset{}, domain.Revision{}, "", classify(err)
	}
	revision.AssetID = asset.ID
	return asset, revision, storageKey, nil
}

func claimBlocks(kind domain.ClaimKind, status string) bool {
	return kind.Blocking() && (status == "pending" || status == "active")
}

func (r *Repository) PrepareClaim(ctx context.Context, input application.PrepareClaimInput, id string, now time.Time) (domain.Claim, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.Claim{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// A stable DB lock closes the no-row race before the unique Claim exists.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended(concat_ws(E'\x1f',$1::text,$2::text,$3::text,$4::text,$5::text,$6::text),0))`, input.TenantID, input.WorkspaceID, input.OwnerService, input.OwnerType, input.OwnerID, input.Slot); err != nil {
		return domain.Claim{}, err
	}

	var existing domain.Claim
	var existingKind string
	err = tx.QueryRow(ctx, `SELECT id,asset_id,COALESCE(revision_id::text,''),kind,status,generation,expires_at FROM asset_claims
        WHERE tenant_id=$1 AND workspace_id=$2 AND owner_service=$3 AND owner_type=$4 AND owner_id=$5 AND slot=$6 FOR UPDATE`,
		input.TenantID, input.WorkspaceID, input.OwnerService, input.OwnerType, input.OwnerID, input.Slot).Scan(&existing.ID, &existing.AssetID, &existing.RevisionID, &existingKind, &existing.Status, &existing.Generation, &existing.ExpiresAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return domain.Claim{}, err
	}
	hasExisting := err == nil
	if hasExisting {
		existing.Kind = domain.ClaimKind(existingKind)
		if existing.Generation > input.Generation {
			return domain.Claim{}, application.ErrConflict
		}
		if existing.Generation == input.Generation {
			if existing.AssetID != input.AssetID || existing.RevisionID != input.RevisionID || existing.Kind != input.Kind {
				return domain.Claim{}, application.ErrConflict
			}
			return commitClaim(ctx, tx, enrichClaim(existing, input))
		}
		id = existing.ID
	}

	oldAssetID := ""
	if hasExisting {
		oldAssetID = existing.AssetID
	}
	rows, err := tx.Query(ctx, `SELECT id::text,state FROM assets
        WHERE (id=$1 OR id=NULLIF($2,'')::uuid) AND tenant_id=$3 AND workspace_id=$4
        ORDER BY id FOR UPDATE`, input.AssetID, oldAssetID, input.TenantID, input.WorkspaceID)
	if err != nil {
		return domain.Claim{}, err
	}
	states := map[string]string{}
	for rows.Next() {
		var assetID, state string
		if err = rows.Scan(&assetID, &state); err != nil {
			rows.Close()
			return domain.Claim{}, err
		}
		states[assetID] = state
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return domain.Claim{}, err
	}
	targetState, found := states[input.AssetID]
	if !found {
		return domain.Claim{}, application.ErrNotFound
	}
	if targetState == "deleted" || targetState == "deleting" || targetState == "quarantined" {
		return domain.Claim{}, application.ErrConflict
	}
	if input.RevisionID != "" {
		var exists bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM asset_revisions WHERE id=$1 AND asset_id=$2)`, input.RevisionID, input.AssetID).Scan(&exists); err != nil {
			return domain.Claim{}, err
		}
		if !exists {
			return domain.Claim{}, application.ErrInvalidInput
		}
	}

	_, err = tx.Exec(ctx, `INSERT INTO asset_claims
        (id,tenant_id,workspace_id,owner_service,owner_type,owner_id,slot,asset_id,revision_id,kind,status,generation,expires_at,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,'')::uuid,$10,'pending',$11,$12,$13,$13)
        ON CONFLICT (tenant_id,workspace_id,owner_service,owner_type,owner_id,slot) DO UPDATE SET
          asset_id=EXCLUDED.asset_id,revision_id=EXCLUDED.revision_id,kind=EXCLUDED.kind,status='pending',generation=EXCLUDED.generation,expires_at=EXCLUDED.expires_at,updated_at=EXCLUDED.updated_at,released_at=NULL`,
		id, input.TenantID, input.WorkspaceID, input.OwnerService, input.OwnerType, input.OwnerID, input.Slot, input.AssetID, input.RevisionID, string(input.Kind), input.Generation, input.ExpiresAt, now)
	if err != nil {
		return domain.Claim{}, err
	}

	oldBlocking := hasExisting && claimBlocks(existing.Kind, existing.Status)
	newBlocking := input.Kind.Blocking()
	if oldBlocking && existing.AssetID != input.AssetID {
		if _, err = tx.Exec(ctx, `UPDATE assets SET blocking_claim_count=blocking_claim_count-1,state_version=state_version+1,updated_at=$2 WHERE id=$1`, existing.AssetID, now); err != nil {
			return domain.Claim{}, err
		}
	}
	delta := int64(0)
	if existing.AssetID == input.AssetID && oldBlocking {
		delta--
	}
	if newBlocking {
		delta++
	}
	if delta != 0 || newBlocking {
		_, err = tx.Exec(ctx, `UPDATE assets SET blocking_claim_count=blocking_claim_count+$2,
          state=CASE WHEN $3 THEN 'active' ELSE state END,candidate_at=CASE WHEN $3 THEN NULL ELSE candidate_at END,
          delete_after=CASE WHEN $3 THEN NULL ELSE delete_after END,state_version=state_version+1,updated_at=$4 WHERE id=$1`, input.AssetID, delta, newBlocking, now)
		if err != nil {
			return domain.Claim{}, err
		}
	}
	claim := enrichClaim(domain.Claim{ID: id, AssetID: input.AssetID, RevisionID: input.RevisionID, Kind: input.Kind, Status: "pending", Generation: input.Generation, ExpiresAt: input.ExpiresAt}, input)
	return commitClaim(ctx, tx, claim)
}

func enrichClaim(claim domain.Claim, input application.PrepareClaimInput) domain.Claim {
	claim.TenantID = input.TenantID
	claim.WorkspaceID = input.WorkspaceID
	claim.OwnerService = input.OwnerService
	claim.OwnerType = input.OwnerType
	claim.OwnerID = input.OwnerID
	claim.Slot = input.Slot
	return claim
}

func commitClaim(ctx context.Context, tx pgx.Tx, claim domain.Claim) (domain.Claim, error) {
	if err := tx.Commit(ctx); err != nil {
		return domain.Claim{}, err
	}
	return claim, nil
}

func (r *Repository) ActivateClaim(ctx context.Context, input application.ClaimMutationInput, now time.Time) (domain.Claim, error) {
	return r.mutateClaim(ctx, input, now, "active")
}

func (r *Repository) ReleaseClaim(ctx context.Context, input application.ClaimMutationInput, now time.Time) (domain.Claim, error) {
	return r.mutateClaim(ctx, input, now, "released")
}

func (r *Repository) mutateClaim(ctx context.Context, input application.ClaimMutationInput, now time.Time, target string) (domain.Claim, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.Claim{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var claim domain.Claim
	var kind string
	err = tx.QueryRow(ctx, `SELECT id,tenant_id,workspace_id,owner_service,owner_type,owner_id,slot,asset_id,COALESCE(revision_id::text,''),kind,status,generation,expires_at FROM asset_claims
      WHERE tenant_id=$1 AND workspace_id=$2 AND owner_service=$3 AND owner_type=$4 AND owner_id=$5 AND slot=$6 FOR UPDATE`, input.TenantID, input.WorkspaceID, input.OwnerService, input.OwnerType, input.OwnerID, input.Slot).Scan(&claim.ID, &claim.TenantID, &claim.WorkspaceID, &claim.OwnerService, &claim.OwnerType, &claim.OwnerID, &claim.Slot, &claim.AssetID, &claim.RevisionID, &kind, &claim.Status, &claim.Generation, &claim.ExpiresAt)
	if err != nil {
		return domain.Claim{}, classify(err)
	}
	claim.Kind = domain.ClaimKind(kind)
	if claim.Generation != input.Generation {
		return domain.Claim{}, application.ErrConflict
	}
	if claim.Status == target {
		return commitClaim(ctx, tx, claim)
	}
	if target == "active" && claim.Status != "pending" {
		return domain.Claim{}, application.ErrConflict
	}
	if target == "released" && claim.Status != "pending" && claim.Status != "active" {
		return domain.Claim{}, application.ErrConflict
	}
	delta := int64(0)
	if target == "released" && claimBlocks(claim.Kind, claim.Status) {
		delta = -1
	}
	if _, err = tx.Exec(ctx, `UPDATE asset_claims SET status=$2::varchar,updated_at=$3::timestamptz,released_at=CASE WHEN $2::text='released' THEN $3::timestamptz ELSE NULL::timestamptz END WHERE id=$1`, claim.ID, target, now); err != nil {
		return domain.Claim{}, err
	}
	if delta != 0 {
		if _, err = tx.Exec(ctx, `UPDATE assets SET blocking_claim_count=blocking_claim_count+$2,state_version=state_version+1,updated_at=$3 WHERE id=$1`, claim.AssetID, delta, now); err != nil {
			return domain.Claim{}, err
		}
	}
	claim.Status = target
	return commitClaim(ctx, tx, claim)
}

func (r *Repository) ExpireLeases(ctx context.Context, now time.Time, limit int) (int, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := tx.Query(ctx, `SELECT id,asset_id FROM asset_claims WHERE kind='lease' AND status IN ('pending','active') AND expires_at <= $1 ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT $2`, now, limit)
	if err != nil {
		return 0, err
	}
	type pair struct{ id, asset string }
	var pairs []pair
	for rows.Next() {
		var p pair
		if err = rows.Scan(&p.id, &p.asset); err != nil {
			rows.Close()
			return 0, err
		}
		pairs = append(pairs, p)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return 0, err
	}
	for _, p := range pairs {
		if _, err = tx.Exec(ctx, `UPDATE asset_claims SET status='released',released_at=$2,updated_at=$2 WHERE id=$1`, p.id, now); err != nil {
			return 0, err
		}
		if _, err = tx.Exec(ctx, `UPDATE assets SET blocking_claim_count=blocking_claim_count-1,state_version=state_version+1,updated_at=$2 WHERE id=$1`, p.asset, now); err != nil {
			return 0, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(pairs), nil
}

func (r *Repository) ReconcileBlockingClaimCounts(ctx context.Context, now time.Time, limit int) (int, error) {
	result, err := r.pool.Exec(ctx, `WITH drifted AS (
      SELECT a.id, (SELECT count(*)::bigint FROM asset_claims c WHERE c.asset_id=a.id
        AND c.status IN ('pending','active') AND c.kind IN ('strong','snapshot','lease')) AS actual_count
      FROM assets a
      WHERE a.state NOT IN ('deleted','quarantined')
      AND a.blocking_claim_count <> (SELECT count(*)::bigint FROM asset_claims c WHERE c.asset_id=a.id
        AND c.status IN ('pending','active') AND c.kind IN ('strong','snapshot','lease'))
      ORDER BY a.id FOR UPDATE OF a SKIP LOCKED LIMIT $1
    ) UPDATE assets a SET
      blocking_claim_count=d.actual_count,
      state=CASE WHEN d.actual_count > 0 AND a.state='candidate' THEN 'active' ELSE a.state END,
      candidate_at=CASE WHEN d.actual_count > 0 AND a.state='candidate' THEN NULL ELSE a.candidate_at END,
      delete_after=CASE WHEN d.actual_count > 0 AND a.state='candidate' THEN NULL ELSE a.delete_after END,
      state_version=a.state_version+1,updated_at=$2
      FROM drifted d WHERE a.id=d.id`, limit, now)
	if err != nil {
		return 0, err
	}
	return int(result.RowsAffected()), nil
}

func (r *Repository) ClaimExpiredUploads(ctx context.Context, now, leaseUntil time.Time, limit int) ([]application.ExpiredUpload, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := tx.Query(ctx, `SELECT id FROM upload_sessions
      WHERE state IN ('uploading','failed','aborted') AND expires_at <= $1
      ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	var uploads []application.ExpiredUpload
	for rows.Next() {
		var upload application.ExpiredUpload
		if err = rows.Scan(&upload.ID); err != nil {
			rows.Close()
			return nil, err
		}
		uploads = append(uploads, upload)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return nil, err
	}
	for _, upload := range uploads {
		if _, err = tx.Exec(ctx, `UPDATE upload_sessions SET state='aborted',
          error_code=COALESCE(error_code,'upload_expired'),expires_at=$2,updated_at=$1 WHERE id=$3`,
			now, leaseUntil, upload.ID); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return uploads, nil
}

func (r *Repository) CompleteUploadCleanup(ctx context.Context, upload application.ExpiredUpload) error {
	result, err := r.pool.Exec(ctx, `DELETE FROM upload_sessions WHERE id=$1 AND state='aborted'`, upload.ID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return application.ErrConflict
	}
	return nil
}

func (r *Repository) MarkCandidates(ctx context.Context, cutoff, now, deleteAfter time.Time, limit int) (int, error) {
	result, err := r.pool.Exec(ctx, `WITH candidates AS (
      SELECT a.id FROM assets a WHERE a.state='active' AND a.blocking_claim_count=0 AND a.updated_at <= $1
      AND NOT EXISTS (SELECT 1 FROM asset_claims c WHERE c.asset_id=a.id AND c.status IN ('pending','active') AND c.kind IN ('strong','snapshot','lease'))
      ORDER BY a.updated_at,a.id FOR UPDATE SKIP LOCKED LIMIT $2
    ) UPDATE assets a SET state='candidate',candidate_at=$3,delete_after=$4,state_version=state_version+1,updated_at=$3
      FROM candidates c WHERE a.id=c.id`, cutoff, limit, now, deleteAfter)
	if err != nil {
		return 0, err
	}
	return int(result.RowsAffected()), nil
}

func (r *Repository) ClaimDeletions(ctx context.Context, now, leaseUntil time.Time, limit int) ([]application.DeletionCandidate, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := tx.Query(ctx, `SELECT a.id,a.tenant_id,a.state_version FROM assets a
      WHERE ((a.state='candidate' AND a.delete_after <= $1) OR (a.state='deleting' AND a.delete_after <= $1))
      AND NOT EXISTS (SELECT 1 FROM asset_claims c WHERE c.asset_id=a.id AND c.status IN ('pending','active') AND c.kind IN ('strong','snapshot','lease'))
      ORDER BY a.delete_after,a.id FOR UPDATE SKIP LOCKED LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	var candidates []application.DeletionCandidate
	for rows.Next() {
		var candidate application.DeletionCandidate
		if err = rows.Scan(&candidate.AssetID, &candidate.TenantID, &candidate.StateVersion); err != nil {
			rows.Close()
			return nil, err
		}
		candidates = append(candidates, candidate)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return nil, err
	}

	for i := range candidates {
		candidate := &candidates[i]
		tag, updateErr := tx.Exec(ctx, `UPDATE assets SET state='deleting',delete_after=$2,state_version=state_version+1,updated_at=$1
        WHERE id=$3 AND state_version=$4 AND state IN ('candidate','deleting')`, now, leaseUntil, candidate.AssetID, candidate.StateVersion)
		if updateErr != nil {
			return nil, updateErr
		}
		if tag.RowsAffected() != 1 {
			return nil, application.ErrConflict
		}
		candidate.StateVersion++

		blobRows, blobErr := tx.Query(ctx, `SELECT DISTINCT b.id,b.storage_key,b.state,COALESCE(b.deletion_owner_asset_id::text,'')
        FROM asset_revisions r JOIN blobs b ON b.id=r.blob_id WHERE r.asset_id=$1 ORDER BY b.id FOR UPDATE`, candidate.AssetID)
		if blobErr != nil {
			return nil, blobErr
		}
		type blobState struct{ id, key, state, owner string }
		var blobs []blobState
		for blobRows.Next() {
			var blob blobState
			if err = blobRows.Scan(&blob.id, &blob.key, &blob.state, &blob.owner); err != nil {
				blobRows.Close()
				return nil, err
			}
			blobs = append(blobs, blob)
		}
		blobRows.Close()
		if err = blobRows.Err(); err != nil {
			return nil, err
		}
		for _, blob := range blobs {
			if blob.state == "deleting" && blob.owner == candidate.AssetID {
				candidate.Blobs = append(candidate.Blobs, application.DeletionBlob{ID: blob.id, StorageKey: blob.key})
				continue
			}
			if blob.state != "active" {
				continue
			}
			var hasReadableReference bool
			if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM asset_revisions r JOIN assets a ON a.id=r.asset_id
          WHERE r.blob_id=$1 AND a.state NOT IN ('deleting','deleted'))`, blob.id).Scan(&hasReadableReference); err != nil {
				return nil, err
			}
			if hasReadableReference {
				continue
			}
			tag, err = tx.Exec(ctx, `UPDATE blobs SET state='deleting',deleting_at=$2,deletion_owner_asset_id=$1,state_version=state_version+1 WHERE id=$3 AND state='active'`, candidate.AssetID, now, blob.id)
			if err != nil {
				return nil, err
			}
			if tag.RowsAffected() == 1 {
				candidate.Blobs = append(candidate.Blobs, application.DeletionBlob{ID: blob.id, StorageKey: blob.key})
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return candidates, nil
}

func (r *Repository) CompleteDeletion(ctx context.Context, candidate application.DeletionCandidate, now time.Time) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx, `UPDATE assets SET state='deleted',state_version=state_version+1,updated_at=$3,last_error_code=NULL
      WHERE id=$1 AND state_version=$2 AND state='deleting'
      AND NOT EXISTS (SELECT 1 FROM asset_claims WHERE asset_id=$1 AND status IN ('pending','active') AND kind IN ('strong','snapshot','lease'))`, candidate.AssetID, candidate.StateVersion, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return application.ErrConflict
	}
	for _, blob := range candidate.Blobs {
		if _, err = tx.Exec(ctx, `UPDATE blobs SET state='deleted',deleted_at=$3,deletion_owner_asset_id=NULL,state_version=state_version+1
        WHERE id=$1 AND deletion_owner_asset_id=$2 AND state='deleting'`, blob.ID, candidate.AssetID, now); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (r *Repository) RetryDeletion(ctx context.Context, candidate application.DeletionCandidate, now time.Time, code string) error {
	// The row itself is the durable job. A bounded exponential delay avoids a
	// separate queue whose transaction could drift from lifecycle state.
	tag, err := r.pool.Exec(ctx, `UPDATE assets SET state='deleting',
      delete_after=$3 + make_interval(secs => LEAST(3600, (power(2, LEAST(deletion_attempts, 10)) * 15)::int)),
      deletion_attempts=deletion_attempts+1,last_error_code=$4,state_version=state_version+1,updated_at=$3
      WHERE id=$1 AND state_version=$2 AND state='deleting'`, candidate.AssetID, candidate.StateVersion, now, code)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("retry deletion: %w", application.ErrConflict)
	}
	return nil
}

func classify(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return application.ErrNotFound
	}
	return err
}
