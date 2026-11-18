package persistence

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/monorepo/storage/internal/application"
	"github.com/example/monorepo/storage/internal/domain"
	"github.com/example/monorepo/storage/internal/infrastructure/persistence/sqlc"
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
	insertedID, err = sqlc.New(tx).InsertUpload(ctx, sqlc.InsertUploadParams{
		ID:                id,
		TenantID:          input.TenantID,
		WorkspaceID:       input.WorkspaceID,
		UserID:            input.UserID,
		CallerService:     input.CallerService,
		IdempotencyKey:    input.IdempotencyKey,
		Category:          input.Category,
		Filename:          input.Filename,
		DeclaredMediaType: input.MediaType,
		ExpiresAt:         expiresAt,
		CreatedAt:         now,
	})
	if err == nil {
		if err = tx.Commit(ctx); err != nil {
			return application.BeginUploadResult{}, err
		}
		return application.BeginUploadResult{UploadID: insertedID}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) || input.IdempotencyKey == "" {
		return application.BeginUploadResult{}, classify(err)
	}

	existing, err := sqlc.New(tx).LockExistingUpload(ctx, sqlc.LockExistingUploadParams{
		TenantID:       input.TenantID,
		WorkspaceID:    input.WorkspaceID,
		CallerService:  input.CallerService,
		IdempotencyKey: &input.IdempotencyKey,
	})
	if err != nil {
		return application.BeginUploadResult{}, classify(err)
	}
	if existing.UserID != input.UserID || existing.Category != input.Category || existing.Filename != input.Filename || existing.DeclaredMediaType != input.MediaType {
		return application.BeginUploadResult{}, application.ErrConflict
	}
	switch existing.State {
	case "completed":
		if existing.AssetID == "" || existing.RevisionID == "" {
			return application.BeginUploadResult{}, application.ErrConflict
		}
		if err = tx.Commit(ctx); err != nil {
			return application.BeginUploadResult{}, err
		}
		return application.BeginUploadResult{UploadID: existing.ID, AssetID: existing.AssetID, RevisionID: existing.RevisionID, Completed: true}, nil
	case "failed":
		if err = sqlc.New(tx).RestartUpload(ctx, sqlc.RestartUploadParams{
			ID:        existing.ID,
			ExpiresAt: expiresAt,
			UpdatedAt: now,
		}); err != nil {
			return application.BeginUploadResult{}, err
		}
		if err = tx.Commit(ctx); err != nil {
			return application.BeginUploadResult{}, err
		}
		return application.BeginUploadResult{UploadID: existing.ID}, nil
	default:
		return application.BeginUploadResult{}, application.ErrConflict
	}
}

func (r *Repository) BeginRevisionAppend(ctx context.Context, input application.AppendRevisionInput, id string, expiresAt, now time.Time) (application.BeginUploadResult, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return application.BeginUploadResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var insertedID string
	insertedID, err = sqlc.New(tx).InsertAppendUpload(ctx, sqlc.InsertAppendUploadParams{
		ID:                id,
		TenantID:          input.TenantID,
		WorkspaceID:       input.WorkspaceID,
		UserID:            input.UserID,
		CallerService:     input.CallerService,
		IdempotencyKey:    &input.IdempotencyKey,
		Filename:          input.Filename,
		DeclaredMediaType: input.MediaType,
		ExpiresAt:         expiresAt,
		CreatedAt:         now,
		TargetAssetID:     &input.AssetID,
		BaseRevisionID:    &input.BaseRevisionID,
		ClaimOwnerType:    &input.OwnerType,
		ClaimOwnerID:      &input.OwnerID,
		ClaimSlot:         &input.Slot,
		ClaimGeneration:   &input.Generation,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return application.BeginUploadResult{}, classify(err)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		existing, readErr := sqlc.New(tx).LockExistingAppend(ctx, sqlc.LockExistingAppendParams{
			TenantID:       input.TenantID,
			WorkspaceID:    input.WorkspaceID,
			CallerService:  input.CallerService,
			IdempotencyKey: &input.IdempotencyKey,
		})
		if readErr != nil {
			return application.BeginUploadResult{}, classify(readErr)
		}
		if existing.UserID != input.UserID || existing.Filename != input.Filename || existing.DeclaredMediaType != input.MediaType ||
			existing.TargetAssetID != input.AssetID || existing.BaseRevisionID != input.BaseRevisionID || existing.ClaimOwnerType != input.OwnerType ||
			existing.ClaimOwnerID != input.OwnerID || existing.ClaimSlot != input.Slot || existing.ClaimGeneration != input.Generation {
			return application.BeginUploadResult{}, application.ErrConflict
		}
		if existing.State == "completed" {
			if existing.AssetID == "" || existing.RevisionID == "" {
				return application.BeginUploadResult{}, application.ErrConflict
			}
			if err = tx.Commit(ctx); err != nil {
				return application.BeginUploadResult{}, err
			}
			return application.BeginUploadResult{UploadID: existing.ID, AssetID: existing.AssetID, RevisionID: existing.RevisionID, Completed: true}, nil
		}
		if existing.State != "failed" && !(existing.State == "uploading" && !existing.ExpiresAt.After(now)) {
			return application.BeginUploadResult{}, application.ErrConflict
		}
		insertedID = existing.ID
	}

	if err = authorizeRevisionAppend(ctx, tx, input.TenantID, input.WorkspaceID, input.CallerService,
		input.AssetID, input.BaseRevisionID, input.OwnerType, input.OwnerID, input.Slot, input.Generation); err != nil {
		return application.BeginUploadResult{}, err
	}
	if insertedID != id {
		// Retire the old attempt instead of reusing its staging name. A late
		// worker can neither commit nor fail the replacement upload.
		if err = sqlc.New(tx).RetireUpload(ctx, sqlc.RetireUploadParams{
			ID:        insertedID,
			ExpiresAt: now,
		}); err != nil {
			return application.BeginUploadResult{}, err
		}
		if err = sqlc.New(tx).ReplaceAppendUpload(ctx, sqlc.ReplaceAppendUploadParams{
			PreviousUploadID: insertedID,
			UploadID:         id,
			IdempotencyKey:   input.IdempotencyKey,
			ExpiresAt:        expiresAt,
			UpdatedAt:        now,
		}); err != nil {
			return application.BeginUploadResult{}, err
		}
		insertedID = id
	}
	if err = tx.Commit(ctx); err != nil {
		return application.BeginUploadResult{}, err
	}
	return application.BeginUploadResult{UploadID: insertedID}, nil
}

func authorizeRevisionAppend(ctx context.Context, tx pgx.Tx, tenantID, workspaceID, ownerService, assetID, baseRevisionID, ownerType, ownerID, slot string, generation int64) error {
	result, err := sqlc.New(tx).CheckAppendAuthorization(ctx, sqlc.CheckAppendAuthorizationParams{
		TenantID:       tenantID,
		WorkspaceID:    workspaceID,
		AssetID:        assetID,
		BaseRevisionID: baseRevisionID,
		OwnerService:   ownerService,
		OwnerType:      ownerType,
		OwnerID:        ownerID,
		Slot:           slot,
		Generation:     generation,
	})
	if err != nil {
		return classify(err)
	}
	if result.State == "deleting" || result.State == "deleted" || result.State == "quarantined" {
		return application.ErrConflict
	}
	if !result.BaseExists {
		return application.ErrInvalidInput
	}
	if !result.ClaimExists {
		return application.ErrConflict
	}
	return nil
}

func (r *Repository) CreateUploadSession(
	ctx context.Context,
	input application.CreateUploadSessionInput,
	id string,
	expiresAt, now time.Time,
) (application.UploadSession, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return application.UploadSession{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var insertedID string
	insertedID, err = sqlc.New(tx).InsertPendingUpload(ctx, sqlc.InsertPendingUploadParams{
		ID:                id,
		TenantID:          input.TenantID,
		WorkspaceID:       input.WorkspaceID,
		UserID:            input.UserID,
		CallerService:     input.CallerService,
		IdempotencyKey:    &input.IdempotencyKey,
		Category:          input.Category,
		Filename:          input.Filename,
		DeclaredMediaType: input.MediaType,
		DeclaredSizeBytes: &input.SizeBytes,
		ExpiresAt:         expiresAt,
		CreatedAt:         now,
	})
	if err == nil {
		if err = tx.Commit(ctx); err != nil {
			return application.UploadSession{}, err
		}
		return application.UploadSession{
			ID: insertedID, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, UserID: input.UserID,
			CallerService: input.CallerService, IdempotencyKey: input.IdempotencyKey, Category: input.Category,
			Filename: input.Filename, MediaType: input.MediaType, SizeBytes: input.SizeBytes, State: "pending", ExpiresAt: expiresAt,
		}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return application.UploadSession{}, classify(err)
	}

	session, err := uploadFromLockScopedUpload(sqlc.New(tx).LockScopedUpload(ctx, sqlc.LockScopedUploadParams{
		TenantID:       input.TenantID,
		WorkspaceID:    input.WorkspaceID,
		CallerService:  input.CallerService,
		IdempotencyKey: &input.IdempotencyKey,
	}))
	if err != nil {
		return application.UploadSession{}, classify(err)
	}
	if session.UserID != input.UserID || session.Category != input.Category || session.Filename != input.Filename ||
		session.MediaType != input.MediaType || session.SizeBytes != input.SizeBytes {
		return application.UploadSession{}, application.ErrConflict
	}
	if err = tx.Commit(ctx); err != nil {
		return application.UploadSession{}, err
	}
	return session, nil
}

func (r *Repository) ClaimUploadSession(ctx context.Context, id string, now time.Time) (application.UploadSession, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return application.UploadSession{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	session, err := uploadFromLockUpload(sqlc.New(tx).LockUpload(ctx, id))
	if err != nil {
		return application.UploadSession{}, classify(err)
	}
	if !session.ExpiresAt.After(now) {
		if session.State != "completed" {
			_ = sqlc.New(tx).AbortExpiredUpload(ctx, sqlc.AbortExpiredUploadParams{
				ID:        id,
				UpdatedAt: now,
			})
			_ = tx.Commit(ctx)
		}
		return application.UploadSession{}, application.ErrConflict
	}
	if session.State == "completed" {
		if err = tx.Commit(ctx); err != nil {
			return application.UploadSession{}, err
		}
		return session, nil
	}
	if session.State != "pending" && session.State != "failed" {
		return application.UploadSession{}, application.ErrConflict
	}
	if err = sqlc.New(tx).StartUpload(ctx, sqlc.StartUploadParams{
		ID:        id,
		UpdatedAt: now,
	}); err != nil {
		return application.UploadSession{}, err
	}
	session.State = "uploading"
	if err = tx.Commit(ctx); err != nil {
		return application.UploadSession{}, err
	}
	return session, nil
}

func (r *Repository) GetUploadSession(
	ctx context.Context,
	callerService, tenantID, workspaceID, id string,
) (application.UploadSession, error) {
	session, err := uploadFromRow(sqlc.New(r.pool).GetUpload(ctx, sqlc.GetUploadParams{
		ID:            id,
		CallerService: callerService,
		TenantID:      tenantID,
		WorkspaceID:   workspaceID,
	}))
	if err != nil {
		return application.UploadSession{}, classify(err)
	}
	return session, nil
}

func uploadFromRow(row sqlc.GetUploadRow, err error) (application.UploadSession, error) {
	if err != nil {
		return application.UploadSession{}, err
	}
	return application.UploadSession{ID: row.ID, TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, UserID: row.UserID, CallerService: row.CallerService, IdempotencyKey: row.IdempotencyKey, Category: row.Category, Filename: row.Filename, MediaType: row.DeclaredMediaType, SizeBytes: row.SizeBytes, State: row.State, AssetID: row.AssetID, RevisionID: row.RevisionID, ExpiresAt: row.ExpiresAt}, nil
}
func uploadFromLockUpload(row sqlc.LockUploadRow, err error) (application.UploadSession, error) {
	return uploadFromRow(sqlc.GetUploadRow(row), err)
}
func uploadFromLockScopedUpload(row sqlc.LockScopedUploadRow, err error) (application.UploadSession, error) {
	return uploadFromRow(sqlc.GetUploadRow(row), err)
}
func (r *Repository) FailUpload(ctx context.Context, id, code string, now time.Time) error {
	err := sqlc.New(r.pool).FailUpload(ctx, sqlc.FailUploadParams{
		ID:        id,
		ErrorCode: &code,
		UpdatedAt: now,
	})
	return err
}

func (r *Repository) CompleteUpload(ctx context.Context, input application.CompleteUploadInput) (application.CompleteUploadResult, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return application.CompleteUploadResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var state string
	if state, err = sqlc.New(tx).LockUploadState(ctx, input.UploadID); err != nil {
		return application.CompleteUploadResult{}, classify(err)
	}
	if state != "uploading" {
		return application.CompleteUploadResult{}, application.ErrConflict
	}

	blob, err := sqlc.New(tx).UpsertBlob(ctx, sqlc.UpsertBlobParams{
		ID:         input.BlobID,
		TenantID:   input.TenantID,
		Sha256:     input.SHA256,
		SizeBytes:  input.SizeBytes,
		StorageKey: input.StorageKey,
		CreatedAt:  input.Now,
	})
	if err != nil {
		return application.CompleteUploadResult{}, err
	}
	if err = sqlc.New(tx).CreateAsset(ctx, sqlc.CreateAssetParams{
		ID:          input.AssetID,
		TenantID:    input.TenantID,
		WorkspaceID: input.WorkspaceID,
		Category:    input.Category,
		CreatedBy:   input.UserID,
		CreatedAt:   input.Now,
	}); err != nil {
		return application.CompleteUploadResult{}, err
	}
	if err = sqlc.New(tx).CreateFirstRevision(ctx, sqlc.CreateFirstRevisionParams{
		ID:        input.RevisionID,
		AssetID:   input.AssetID,
		BlobID:    blob.ID,
		Filename:  input.Filename,
		MediaType: input.MediaType,
		SizeBytes: input.SizeBytes,
		Sha256:    input.SHA256,
		CreatedBy: input.UserID,
		CreatedAt: input.Now,
	}); err != nil {
		return application.CompleteUploadResult{}, err
	}
	if err = sqlc.New(tx).SetCurrentRevision(ctx, sqlc.SetCurrentRevisionParams{
		ID:                input.AssetID,
		CurrentRevisionID: &input.RevisionID,
	}); err != nil {
		return application.CompleteUploadResult{}, err
	}
	if err = sqlc.New(tx).CreateUploadLease(ctx, sqlc.CreateUploadLeaseParams{
		ID:          input.UploadClaimID,
		TenantID:    input.TenantID,
		WorkspaceID: input.WorkspaceID,
		OwnerID:     input.UploadID,
		AssetID:     input.AssetID,
		RevisionID:  &input.RevisionID,
		ExpiresAt:   &input.UploadLeaseExpiresAt,
		CreatedAt:   input.Now,
	}); err != nil {
		return application.CompleteUploadResult{}, err
	}
	if err = sqlc.New(tx).CompleteUpload(ctx, sqlc.CompleteUploadParams{
		ID:         input.UploadID,
		AssetID:    &input.AssetID,
		RevisionID: &input.RevisionID,
		UpdatedAt:  input.Now,
	}); err != nil {
		return application.CompleteUploadResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return application.CompleteUploadResult{}, err
	}

	asset := domain.Asset{ID: input.AssetID, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, Category: input.Category, CurrentRevisionID: input.RevisionID, State: "active", BlockingClaimCount: 1, StateVersion: 1, CreatedBy: input.UserID, CreatedAt: input.Now, UpdatedAt: input.Now}
	revision := domain.Revision{ID: input.RevisionID, AssetID: input.AssetID, BlobID: blob.ID, RevisionNumber: 1, Filename: input.Filename, MediaType: input.MediaType, SizeBytes: input.SizeBytes, SHA256: input.SHA256, CreatedBy: input.UserID, CreatedAt: input.Now}
	result := application.CompleteUploadResult{Asset: asset, Revision: revision}
	if blob.StorageKey != input.StorageKey {
		result.UnusedStorageKey = input.StorageKey
	}
	return result, nil
}

func (r *Repository) CompleteRevisionAppend(ctx context.Context, input application.CompleteRevisionAppendInput) (application.CompleteUploadResult, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return application.CompleteUploadResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	lockedAsset, err := sqlc.New(tx).LockAsset(ctx, sqlc.LockAssetParams{
		ID:          input.AssetID,
		TenantID:    input.TenantID,
		WorkspaceID: input.WorkspaceID,
	})
	if err != nil {
		return application.CompleteUploadResult{}, classify(err)
	}
	asset := domain.Asset{
		ID: lockedAsset.ID, TenantID: lockedAsset.TenantID, WorkspaceID: lockedAsset.WorkspaceID,
		Category: lockedAsset.Category, State: lockedAsset.State, CurrentRevisionID: lockedAsset.CurrentRevisionID,
		BlockingClaimCount: lockedAsset.BlockingClaimCount, StateVersion: lockedAsset.StateVersion,
		CreatedBy: lockedAsset.CreatedBy, CreatedAt: lockedAsset.CreatedAt, UpdatedAt: lockedAsset.UpdatedAt,
	}
	if asset.State == "deleting" || asset.State == "deleted" || asset.State == "quarantined" {
		return application.CompleteUploadResult{}, application.ErrConflict
	}

	upload, err := sqlc.New(tx).LockAppendUpload(ctx, input.UploadID)
	if err != nil {
		return application.CompleteUploadResult{}, classify(err)
	}
	if upload.State != "uploading" || upload.TargetAssetID != input.AssetID || upload.BaseRevisionID != input.BaseRevisionID ||
		upload.ClaimOwnerType != input.OwnerType || upload.ClaimOwnerID != input.OwnerID || upload.ClaimSlot != input.Slot || upload.ClaimGeneration != input.Generation {
		return application.CompleteUploadResult{}, application.ErrConflict
	}
	if err = authorizeRevisionAppend(ctx, tx, input.TenantID, input.WorkspaceID, input.OwnerService,
		input.AssetID, input.BaseRevisionID, input.OwnerType, input.OwnerID, input.Slot, input.Generation); err != nil {
		return application.CompleteUploadResult{}, err
	}

	blob, err := sqlc.New(tx).UpsertBlob(ctx, sqlc.UpsertBlobParams{
		ID:         input.BlobID,
		TenantID:   input.TenantID,
		Sha256:     input.SHA256,
		SizeBytes:  input.SizeBytes,
		StorageKey: input.StorageKey,
		CreatedAt:  input.Now,
	})
	if err != nil {
		return application.CompleteUploadResult{}, err
	}
	var revisionNumber int64
	if revisionNumber, err = sqlc.New(tx).NextRevisionNumber(ctx, input.AssetID); err != nil {
		return application.CompleteUploadResult{}, err
	}
	if err = sqlc.New(tx).AppendRevision(ctx, sqlc.AppendRevisionParams{
		ID:             input.RevisionID,
		AssetID:        input.AssetID,
		BlobID:         blob.ID,
		RevisionNumber: revisionNumber,
		Filename:       input.Filename,
		MediaType:      input.MediaType,
		SizeBytes:      input.SizeBytes,
		Sha256:         input.SHA256,
		CreatedBy:      input.UserID,
		CreatedAt:      input.Now,
	}); err != nil {
		return application.CompleteUploadResult{}, err
	}
	if err = sqlc.New(tx).CreateUploadLease(ctx, sqlc.CreateUploadLeaseParams{
		ID:          input.UploadClaimID,
		TenantID:    input.TenantID,
		WorkspaceID: input.WorkspaceID,
		OwnerID:     input.UploadID,
		AssetID:     input.AssetID,
		RevisionID:  &input.RevisionID,
		ExpiresAt:   &input.UploadLeaseExpiresAt,
		CreatedAt:   input.Now,
	}); err != nil {
		return application.CompleteUploadResult{}, err
	}
	advanced, err := sqlc.New(tx).AdvanceRevision(ctx, sqlc.AdvanceRevisionParams{
		ID:                input.AssetID,
		CurrentRevisionID: &input.RevisionID,
		UpdatedAt:         input.Now,
	})
	if err != nil {
		return application.CompleteUploadResult{}, err
	}
	asset.State = advanced.State
	asset.BlockingClaimCount = advanced.BlockingClaimCount
	asset.StateVersion = advanced.StateVersion
	asset.UpdatedAt = advanced.UpdatedAt
	asset.CurrentRevisionID = input.RevisionID
	if err = sqlc.New(tx).CompleteAppendUpload(ctx, sqlc.CompleteAppendUploadParams{
		ID:         input.UploadID,
		AssetID:    &input.AssetID,
		RevisionID: &input.RevisionID,
		UpdatedAt:  input.Now,
		ExpiresAt:  input.UploadLeaseExpiresAt,
	}); err != nil {
		return application.CompleteUploadResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return application.CompleteUploadResult{}, err
	}

	revision := domain.Revision{ID: input.RevisionID, AssetID: input.AssetID, BlobID: blob.ID, RevisionNumber: revisionNumber,
		Filename: input.Filename, MediaType: input.MediaType, SizeBytes: input.SizeBytes, SHA256: input.SHA256,
		CreatedBy: input.UserID, CreatedAt: input.Now}
	result := application.CompleteUploadResult{Asset: asset, Revision: revision}
	if blob.StorageKey != input.StorageKey {
		result.UnusedStorageKey = input.StorageKey
	}
	return result, nil
}

func (r *Repository) GetRevision(ctx context.Context, tenantID, workspaceID, assetID, revisionID string) (domain.Asset, domain.Revision, string, error) {
	row, err := sqlc.New(r.pool).GetRevision(ctx, sqlc.GetRevisionParams{
		AssetID:     assetID,
		RevisionID:  revisionID,
		TenantID:    tenantID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return domain.Asset{}, domain.Revision{}, "", classify(err)
	}
	asset := domain.Asset{
		ID: row.ID, TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, Category: row.Category,
		State: row.State, CurrentRevisionID: row.CurrentRevisionID, BlockingClaimCount: row.BlockingClaimCount,
		StateVersion: row.StateVersion, CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
	revision := domain.Revision{
		ID: row.RevisionID, AssetID: row.ID, BlobID: row.BlobID, RevisionNumber: row.RevisionNumber,
		Filename: row.Filename, MediaType: row.MediaType, SizeBytes: row.SizeBytes, SHA256: row.Sha256,
		CreatedBy: row.RevisionCreator, CreatedAt: row.RevisionCreatedAt,
	}
	return asset, revision, row.StorageKey, nil
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
	if err = sqlc.New(tx).LockClaimSlot(ctx, sqlc.LockClaimSlotParams{
		TenantID:     input.TenantID,
		WorkspaceID:  input.WorkspaceID,
		OwnerService: input.OwnerService,
		OwnerType:    input.OwnerType,
		OwnerID:      input.OwnerID,
		Slot:         input.Slot,
	}); err != nil {
		return domain.Claim{}, err
	}

	row, err := sqlc.New(tx).LockExistingClaim(ctx, sqlc.LockExistingClaimParams{
		TenantID:     input.TenantID,
		WorkspaceID:  input.WorkspaceID,
		OwnerService: input.OwnerService,
		OwnerType:    input.OwnerType,
		OwnerID:      input.OwnerID,
		Slot:         input.Slot,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return domain.Claim{}, err
	}
	hasExisting := err == nil
	existing := domain.Claim{}
	if hasExisting {
		existing = domain.Claim{
			ID: row.ID, AssetID: row.AssetID, RevisionID: row.RevisionID, Kind: domain.ClaimKind(row.Kind),
			Status: row.Status, Generation: row.Generation, ExpiresAt: row.ExpiresAt,
		}
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
	rows, err := sqlc.New(tx).LockClaimAssets(ctx, sqlc.LockClaimAssetsParams{
		AssetID:         input.AssetID,
		PreviousAssetID: oldAssetID,
		TenantID:        input.TenantID,
		WorkspaceID:     input.WorkspaceID,
	})
	if err != nil {
		return domain.Claim{}, err
	}
	states := map[string]string{}
	for _, row := range rows {
		states[row.ID] = row.State
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
		if exists, err = sqlc.New(tx).RevisionExists(ctx, sqlc.RevisionExistsParams{
			ID:      input.RevisionID,
			AssetID: input.AssetID,
		}); err != nil {
			return domain.Claim{}, err
		}
		if !exists {
			return domain.Claim{}, application.ErrInvalidInput
		}
	}

	err = sqlc.New(tx).UpsertClaim(ctx, sqlc.UpsertClaimParams{
		ID:           id,
		TenantID:     input.TenantID,
		WorkspaceID:  input.WorkspaceID,
		OwnerService: input.OwnerService,
		OwnerType:    input.OwnerType,
		OwnerID:      input.OwnerID,
		Slot:         input.Slot,
		AssetID:      input.AssetID,
		RevisionID:   input.RevisionID,
		Kind:         string(input.Kind),
		Generation:   input.Generation,
		ExpiresAt:    input.ExpiresAt,
		CreatedAt:    now,
	})
	if err != nil {
		return domain.Claim{}, err
	}

	oldBlocking := hasExisting && claimBlocks(existing.Kind, existing.Status)
	newBlocking := input.Kind.Blocking()
	if oldBlocking && existing.AssetID != input.AssetID {
		if err = sqlc.New(tx).DecrementBlockingClaims(ctx, sqlc.DecrementBlockingClaimsParams{
			ID:        existing.AssetID,
			UpdatedAt: now,
		}); err != nil {
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
		err = sqlc.New(tx).ApplyClaimDelta(ctx, sqlc.ApplyClaimDeltaParams{
			ID:            input.AssetID,
			BlockingDelta: delta,
			Reactivate:    newBlocking,
			UpdatedAt:     now,
		})
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
	row, err := sqlc.New(tx).LockClaim(ctx, sqlc.LockClaimParams{
		TenantID:     input.TenantID,
		WorkspaceID:  input.WorkspaceID,
		OwnerService: input.OwnerService,
		OwnerType:    input.OwnerType,
		OwnerID:      input.OwnerID,
		Slot:         input.Slot,
	})
	if err != nil {
		return domain.Claim{}, classify(err)
	}
	claim := domain.Claim{
		ID: row.ID, TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, OwnerService: row.OwnerService,
		OwnerType: row.OwnerType, OwnerID: row.OwnerID, Slot: row.Slot, AssetID: row.AssetID,
		RevisionID: row.RevisionID, Kind: domain.ClaimKind(row.Kind), Status: row.Status,
		Generation: row.Generation, ExpiresAt: row.ExpiresAt,
	}
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
	if err = sqlc.New(tx).SetClaimStatus(ctx, sqlc.SetClaimStatusParams{
		ID:        claim.ID,
		Status:    target,
		UpdatedAt: now,
	}); err != nil {
		return domain.Claim{}, err
	}
	if delta != 0 {
		if err = sqlc.New(tx).UpdateClaimCount(ctx, sqlc.UpdateClaimCountParams{
			ID:            claim.AssetID,
			BlockingDelta: delta,
			UpdatedAt:     now,
		}); err != nil {
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
	rows, err := sqlc.New(tx).LockExpiredLeases(ctx, sqlc.LockExpiredLeasesParams{
		ExpiresAt: &now,
		BatchSize: int32(limit),
	})
	if err != nil {
		return 0, err
	}
	for _, p := range rows {
		if err = sqlc.New(tx).ReleaseExpiredLease(ctx, sqlc.ReleaseExpiredLeaseParams{
			ID:         p.ID,
			ReleasedAt: &now,
		}); err != nil {
			return 0, err
		}
		if err = sqlc.New(tx).DecrementBlockingClaims(ctx, sqlc.DecrementBlockingClaimsParams{
			ID:        p.AssetID,
			UpdatedAt: now,
		}); err != nil {
			return 0, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(rows), nil
}

func (r *Repository) ReconcileBlockingClaimCounts(ctx context.Context, now time.Time, limit int) (int, error) {
	result, err := sqlc.New(r.pool).ReconcileClaimCounts(ctx, sqlc.ReconcileClaimCountsParams{
		BatchSize: int32(limit),
		UpdatedAt: now,
	})
	if err != nil {
		return 0, err
	}
	return int(result), nil
}

func (r *Repository) ClaimExpiredUploads(ctx context.Context, now, leaseUntil time.Time, limit int) ([]application.ExpiredUpload, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := sqlc.New(tx).LockExpiredUploads(ctx, sqlc.LockExpiredUploadsParams{
		ExpiresAt: now,
		BatchSize: int32(limit),
	})
	if err != nil {
		return nil, err
	}
	var uploads []application.ExpiredUpload
	for _, id := range rows {
		uploads = append(uploads, application.ExpiredUpload{ID: id})
	}
	for _, upload := range uploads {
		if err = sqlc.New(tx).LeaseUploadCleanup(ctx, sqlc.LeaseUploadCleanupParams{
			UpdatedAt: now,
			ExpiresAt: leaseUntil,
			ID:        upload.ID,
		}); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return uploads, nil
}

func (r *Repository) CompleteUploadCleanup(ctx context.Context, upload application.ExpiredUpload) error {
	result, err := sqlc.New(r.pool).DeleteAbortedUpload(ctx, upload.ID)
	if err != nil {
		return err
	}
	if result != 1 {
		return application.ErrConflict
	}
	return nil
}

func (r *Repository) MarkCandidates(ctx context.Context, cutoff, now, deleteAfter time.Time, limit int) (int, error) {
	result, err := sqlc.New(r.pool).MarkCandidates(ctx, sqlc.MarkCandidatesParams{
		UpdatedAt:   cutoff,
		BatchSize:   int32(limit),
		CandidateAt: &now,
		DeleteAfter: &deleteAfter,
	})
	if err != nil {
		return 0, err
	}
	return int(result), nil
}

func (r *Repository) ClaimDeletions(ctx context.Context, now, leaseUntil time.Time, limit int) ([]application.DeletionCandidate, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := sqlc.New(tx).LockDeletionCandidates(ctx, sqlc.LockDeletionCandidatesParams{
		DeleteAfter: &now,
		BatchSize:   int32(limit),
	})
	if err != nil {
		return nil, err
	}
	var candidates []application.DeletionCandidate
	for _, row := range rows {
		candidates = append(candidates, application.DeletionCandidate{AssetID: row.ID, TenantID: row.TenantID, StateVersion: row.StateVersion})
	}
	for i := range candidates {
		candidate := &candidates[i]
		tag, updateErr := sqlc.New(tx).StartDeletion(ctx, sqlc.StartDeletionParams{
			UpdatedAt:    now,
			DeleteAfter:  &leaseUntil,
			ID:           candidate.AssetID,
			StateVersion: candidate.StateVersion,
		})
		if updateErr != nil {
			return nil, updateErr
		}
		if tag != 1 {
			return nil, application.ErrConflict
		}
		candidate.StateVersion++

		blobRows, blobErr := sqlc.New(tx).LockAssetBlobs(ctx, candidate.AssetID)
		if blobErr != nil {
			return nil, blobErr
		}
		for _, blob := range blobRows {
			if blob.State == "deleting" && blob.DeletionOwnerAssetID == candidate.AssetID {
				candidate.Blobs = append(candidate.Blobs, application.DeletionBlob{ID: blob.ID, StorageKey: blob.StorageKey})
				continue
			}
			if blob.State != "active" {
				continue
			}
			var hasReadableReference bool
			if hasReadableReference, err = sqlc.New(tx).HasReadableReference(ctx, blob.ID); err != nil {
				return nil, err
			}
			if hasReadableReference {
				continue
			}
			tag, err = sqlc.New(tx).StartBlobDeletion(ctx, sqlc.StartBlobDeletionParams{
				DeletionOwnerAssetID: &candidate.AssetID,
				DeletingAt:           &now,
				ID:                   blob.ID,
			})
			if err != nil {
				return nil, err
			}
			if tag == 1 {
				candidate.Blobs = append(candidate.Blobs, application.DeletionBlob{ID: blob.ID, StorageKey: blob.StorageKey})
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
	tag, err := sqlc.New(tx).CompleteDeletion(ctx, sqlc.CompleteDeletionParams{
		ID:           candidate.AssetID,
		StateVersion: candidate.StateVersion,
		UpdatedAt:    now,
	})
	if err != nil {
		return err
	}
	if tag != 1 {
		return application.ErrConflict
	}
	for _, blob := range candidate.Blobs {
		if err = sqlc.New(tx).CompleteBlobDeletion(ctx, sqlc.CompleteBlobDeletionParams{
			ID:                   blob.ID,
			DeletionOwnerAssetID: &candidate.AssetID,
			DeletedAt:            &now,
		}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (r *Repository) RetryDeletion(ctx context.Context, candidate application.DeletionCandidate, now time.Time, code string) error {
	// The row itself is the durable job. A bounded exponential delay avoids a
	// separate queue whose transaction could drift from lifecycle state.
	tag, err := sqlc.New(r.pool).RetryDeletion(ctx, sqlc.RetryDeletionParams{
		ID:            candidate.AssetID,
		StateVersion:  candidate.StateVersion,
		UpdatedAt:     now,
		LastErrorCode: &code,
	})
	if err != nil {
		return err
	}
	if tag != 1 {
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
