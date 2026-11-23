package persistence

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/example/monorepo/storage/internal/application"
	"github.com/example/monorepo/storage/internal/domain"
	"github.com/example/monorepo/storage/internal/infrastructure/persistence/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestSelectAssetBlobsForUpdateQuery(t *testing.T) {
	if os.Getenv("STORAGE_POSTGRES_INTEGRATION") != "1" {
		t.Skip("set STORAGE_POSTGRES_INTEGRATION=1 to run PostgreSQL integration tests")
	}

	repository, err := Connect(context.Background(), storageTestDatabaseURL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(repository.Close)

	tx, err := repository.pool.BeginTx(context.Background(), pgx.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	if _, err := sqlc.New(tx).LockAssetBlobs(context.Background(), uuid.NewString()); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareClaimRequiresCallerRevisionAuthorization(t *testing.T) {
	if os.Getenv("STORAGE_POSTGRES_INTEGRATION") != "1" {
		t.Skip("set STORAGE_POSTGRES_INTEGRATION=1 to run PostgreSQL integration tests")
	}
	ctx := context.Background()
	repository, err := Connect(ctx, storageTestDatabaseURL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(repository.Close)

	now := time.Now().UTC().Truncate(time.Microsecond)
	assetID, revisionID, blobID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	storageKey := "blobs/claim-authorization/" + blobID
	tx, err := repository.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `INSERT INTO blobs (id,sha256,size_bytes,storage_key,state,created_at)
		VALUES ($1,$2,4,$3,'active',$4)`, blobID,
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", storageKey, now)
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO assets (id,state,blocking_claim_count,state_version,created_at,updated_at)
			VALUES ($1,'active',1,1,$2,$2)`, assetID, now)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO asset_revisions (id,asset_id,blob_id,revision_number,filename,media_type,size_bytes,sha256,created_at)
			VALUES ($1,$2,$3,1,'notes.md','text/markdown',4,$4,$5)`, revisionID, assetID, blobID,
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", now)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE assets SET current_revision_id=$2 WHERE id=$1`, assetID, revisionID)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO asset_claims
				(id,owner_service,owner_type,owner_id,slot,asset_id,revision_id,kind,status,generation,expires_at,created_at,updated_at)
			VALUES ($1,'service-a','upload_session',$2,'uploaded-bytes',$3,$4,'lease','active',1,$5,$6,$6)`,
			uuid.NewString(), uuid.NewString(), assetID, revisionID, now.Add(time.Hour), now)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup := context.Background()
		_, _ = repository.pool.Exec(cleanup, `DELETE FROM asset_claims WHERE asset_id=$1`, assetID)
		_, _ = repository.pool.Exec(cleanup, `UPDATE assets SET current_revision_id=NULL WHERE id=$1`, assetID)
		_, _ = repository.pool.Exec(cleanup, `DELETE FROM asset_revisions WHERE asset_id=$1`, assetID)
		_, _ = repository.pool.Exec(cleanup, `DELETE FROM assets WHERE id=$1`, assetID)
		_, _ = repository.pool.Exec(cleanup, `DELETE FROM blobs WHERE id=$1`, blobID)
	})

	_, err = repository.PrepareClaim(ctx, application.PrepareClaimInput{
		OwnerService: "service-b", OwnerType: "document", OwnerID: uuid.NewString(), Slot: "source",
		AssetID: assetID, RevisionID: revisionID, Kind: domain.ClaimStrong, Generation: 1,
	}, uuid.NewString(), now)
	if !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("unauthorized claim preparation error = %v, want not found", err)
	}

	claim, err := repository.PrepareClaim(ctx, application.PrepareClaimInput{
		OwnerService: "service-a", OwnerType: "document", OwnerID: uuid.NewString(), Slot: "source",
		AssetID: assetID, RevisionID: revisionID, Kind: domain.ClaimStrong, Generation: 1,
	}, uuid.NewString(), now)
	if err != nil {
		t.Fatalf("authorized claim preparation: %v", err)
	}
	if claim.OwnerService != "service-a" || claim.RevisionID != revisionID || claim.Status != "pending" {
		t.Fatalf("prepared claim = %#v", claim)
	}
}

func TestReleaseMissingClaimIsConverged(t *testing.T) {
	if os.Getenv("STORAGE_POSTGRES_INTEGRATION") != "1" {
		t.Skip("set STORAGE_POSTGRES_INTEGRATION=1 to run PostgreSQL integration tests")
	}
	ctx := context.Background()
	repository, err := Connect(ctx, storageTestDatabaseURL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(repository.Close)

	input := application.ClaimMutationInput{
		OwnerService: "service-a", OwnerType: "document", OwnerID: uuid.NewString(), Slot: "source", Generation: 1,
	}
	claim, err := repository.ReleaseClaim(ctx, input, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if claim.Status != "released" || claim.OwnerService != input.OwnerService || claim.Generation != input.Generation {
		t.Fatalf("released claim = %#v", claim)
	}
}

func TestReleaseFenceRejectsLatePrepareAndAdvancesExistingClaim(t *testing.T) {
	if os.Getenv("STORAGE_POSTGRES_INTEGRATION") != "1" {
		t.Skip("set STORAGE_POSTGRES_INTEGRATION=1 to run PostgreSQL integration tests")
	}
	ctx := context.Background()
	repository, err := Connect(ctx, storageTestDatabaseURL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(repository.Close)

	now := time.Now().UTC().Truncate(time.Microsecond)
	assetID, revisionID, blobID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	ownerID := "release-fence-" + uuid.NewString()
	tx, err := repository.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `INSERT INTO blobs (id,sha256,size_bytes,storage_key,state,created_at)
		VALUES ($1,$2,4,$3,'active',$4)`, blobID,
		"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "blobs/release-fence/"+blobID, now)
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO assets (id,state,blocking_claim_count,state_version,created_at,updated_at)
			VALUES ($1,'active',1,1,$2,$2)`, assetID, now)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO asset_revisions (id,asset_id,blob_id,revision_number,filename,media_type,size_bytes,sha256,created_at)
			VALUES ($1,$2,$3,1,'fence.md','text/markdown',4,$4,$5)`, revisionID, assetID, blobID,
			"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", now)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE assets SET current_revision_id=$2 WHERE id=$1`, assetID, revisionID)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO asset_claims
				(id,owner_service,owner_type,owner_id,slot,asset_id,revision_id,kind,status,generation,expires_at,created_at,updated_at)
			VALUES ($1,'service-a','upload_session',$2,'uploaded-bytes',$3,$4,'lease','active',1,$5,$6,$6)`,
			uuid.NewString(), uuid.NewString(), assetID, revisionID, now.Add(time.Hour), now)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup := context.Background()
		_, _ = repository.pool.Exec(cleanup, `DELETE FROM claim_release_fences WHERE owner_service='service-a' AND owner_type='document' AND owner_id=$1`, ownerID)
		_, _ = repository.pool.Exec(cleanup, `DELETE FROM asset_claims WHERE asset_id=$1`, assetID)
		_, _ = repository.pool.Exec(cleanup, `UPDATE assets SET current_revision_id=NULL WHERE id=$1`, assetID)
		_, _ = repository.pool.Exec(cleanup, `DELETE FROM asset_revisions WHERE asset_id=$1`, assetID)
		_, _ = repository.pool.Exec(cleanup, `DELETE FROM assets WHERE id=$1`, assetID)
		_, _ = repository.pool.Exec(cleanup, `DELETE FROM blobs WHERE id=$1`, blobID)
	})

	mutation := application.ClaimMutationInput{
		OwnerService: "service-a", OwnerType: "document", OwnerID: ownerID, Slot: "source", Generation: 1,
	}
	if _, err = repository.ReleaseClaim(ctx, mutation, now); err != nil {
		t.Fatalf("release missing claim: %v", err)
	}
	prepare := application.PrepareClaimInput{
		OwnerService: mutation.OwnerService, OwnerType: mutation.OwnerType, OwnerID: mutation.OwnerID, Slot: mutation.Slot,
		AssetID: assetID, RevisionID: revisionID, Kind: domain.ClaimStrong, Generation: mutation.Generation,
	}
	if _, err = repository.PrepareClaim(ctx, prepare, uuid.NewString(), now); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("late PrepareClaim error = %v, want conflict", err)
	}

	prepare.Generation = 2
	claim, err := repository.PrepareClaim(ctx, prepare, uuid.NewString(), now)
	if err != nil {
		t.Fatalf("prepare newer generation: %v", err)
	}
	if _, err = repository.ActivateClaim(ctx, application.ClaimMutationInput{
		OwnerService: mutation.OwnerService, OwnerType: mutation.OwnerType, OwnerID: mutation.OwnerID, Slot: mutation.Slot, Generation: 2,
	}, now); err != nil {
		t.Fatalf("activate newer generation: %v", err)
	}
	if claim.Generation != 2 {
		t.Fatalf("prepared generation = %d, want 2", claim.Generation)
	}

	mutation.Generation = 3
	claim, err = repository.ReleaseClaim(ctx, mutation, now)
	if err != nil {
		t.Fatalf("release newer than existing claim: %v", err)
	}
	if claim.Status != "released" || claim.Generation != 3 {
		t.Fatalf("released claim = %#v, want generation 3", claim)
	}
	prepare.Generation = 3
	if _, err = repository.PrepareClaim(ctx, prepare, uuid.NewString(), now); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("PrepareClaim at release fence error = %v, want conflict", err)
	}
}

func TestRevisionAppendTransaction(t *testing.T) {
	if os.Getenv("STORAGE_POSTGRES_INTEGRATION") != "1" {
		t.Skip("set STORAGE_POSTGRES_INTEGRATION=1 to run PostgreSQL integration tests")
	}
	ctx := context.Background()
	repository, err := Connect(ctx, storageTestDatabaseURL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(repository.Close)

	now := time.Now().UTC().Truncate(time.Microsecond)
	assetID, baseRevisionID, baseBlobID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	ownerID := "append-test-" + uuid.NewString()
	tx, err := repository.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `INSERT INTO blobs (id,sha256,size_bytes,storage_key,state,created_at)
		VALUES ($1,$2,4,$3,'active',$4)`, baseBlobID,
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "blobs/append-test/"+baseBlobID, now)
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO assets (id,state,blocking_claim_count,state_version,created_at,updated_at)
			VALUES ($1,'active',1,1,$2,$2)`, assetID, now)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO asset_revisions (id,asset_id,blob_id,revision_number,filename,media_type,size_bytes,sha256,created_at)
			VALUES ($1,$2,$3,1,'notes.md','text/markdown',4,$4,$5)`, baseRevisionID, assetID, baseBlobID,
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", now)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE assets SET current_revision_id=$2 WHERE id=$1`, assetID, baseRevisionID)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO asset_claims (id,owner_service,owner_type,owner_id,slot,asset_id,revision_id,kind,status,generation,created_at,updated_at)
			VALUES ($1,'chat','conversation_file',$2,'source',$3,$4,'strong','active',3,$5,$5)`,
			uuid.NewString(), ownerID, assetID, baseRevisionID, now)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup := context.Background()
		_, _ = repository.pool.Exec(cleanup, `DELETE FROM upload_sessions WHERE target_asset_id=$1 OR asset_id=$1`, assetID)
		_, _ = repository.pool.Exec(cleanup, `DELETE FROM asset_claims WHERE asset_id=$1`, assetID)
		_, _ = repository.pool.Exec(cleanup, `UPDATE assets SET current_revision_id=NULL WHERE id=$1`, assetID)
		_, _ = repository.pool.Exec(cleanup, `DELETE FROM asset_revisions WHERE asset_id=$1`, assetID)
		_, _ = repository.pool.Exec(cleanup, `DELETE FROM assets WHERE id=$1`, assetID)
		_, _ = repository.pool.Exec(cleanup, `DELETE FROM blobs WHERE id=$1 OR storage_key=$2`, baseBlobID, "blobs/append-test/new")
	})

	appendInput := application.AppendRevisionInput{
		CallerService: "chat", IdempotencyKey: uuid.NewString(),
		AssetID: assetID, BaseRevisionID: baseRevisionID, Filename: "notes.md", MediaType: "text/markdown",
		OwnerType: "conversation_file", OwnerID: ownerID, Slot: "source", Generation: 3,
	}
	started, err := repository.BeginRevisionAppend(ctx, appendInput, uuid.NewString(), now.Add(time.Hour), now)
	if err != nil {
		t.Fatal(err)
	}
	// A crashed worker leaves uploading behind. An expired attempt must be
	// fenced and replaced without losing the idempotency key or its cleanup row.
	if _, err = repository.pool.Exec(ctx, `UPDATE upload_sessions SET expires_at=$2 WHERE id=$1`, started.UploadID, now.Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	recovered, err := repository.BeginRevisionAppend(ctx, appendInput, uuid.NewString(), now.Add(time.Hour), now)
	if err != nil {
		t.Fatalf("recover expired append: %v", err)
	}
	if recovered.UploadID == started.UploadID {
		t.Fatal("recovery reused the crashed worker's staging identity")
	}
	var retiredState string
	if err = repository.pool.QueryRow(ctx, `SELECT state FROM upload_sessions WHERE id=$1`, started.UploadID).Scan(&retiredState); err != nil || retiredState != "aborted" {
		t.Fatalf("retired attempt state = %s, error = %v", retiredState, err)
	}
	_, err = repository.CompleteRevisionAppend(ctx, application.CompleteRevisionAppendInput{
		CompleteUploadInput: application.CompleteUploadInput{
			UploadID: started.UploadID, AssetID: assetID, Now: now,
		},
		BaseRevisionID: baseRevisionID, OwnerService: "chat", OwnerType: "conversation_file", OwnerID: ownerID,
		Slot: "source", Generation: 3,
	})
	if !errors.Is(err, application.ErrConflict) {
		t.Fatalf("late retired worker completion = %v, want conflict", err)
	}
	started = recovered
	newRevisionID, newBlobID := uuid.NewString(), uuid.NewString()
	result, err := repository.CompleteRevisionAppend(ctx, application.CompleteRevisionAppendInput{
		CompleteUploadInput: application.CompleteUploadInput{
			UploadID: started.UploadID, AssetID: assetID, RevisionID: newRevisionID, BlobID: newBlobID,
			StorageKey: "blobs/append-test/new", SHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			UploadClaimID: uuid.NewString(), UploadLeaseOwnerService: "chat", Filename: "notes.md", MediaType: "text/markdown",
			SizeBytes: 4, Now: now.Add(time.Second),
			UploadLeaseExpiresAt: now.Add(time.Hour),
		},
		BaseRevisionID: baseRevisionID, OwnerService: "chat", OwnerType: "conversation_file", OwnerID: ownerID,
		Slot: "source", Generation: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Asset.ID != assetID || result.Revision.AssetID != assetID || result.Revision.RevisionNumber != 2 {
		t.Fatalf("unexpected append result: %#v %#v", result.Asset, result.Revision)
	}

	wrongGeneration := appendInput
	wrongGeneration.IdempotencyKey = uuid.NewString()
	wrongGeneration.Generation = 4
	if _, err = repository.BeginRevisionAppend(ctx, wrongGeneration, uuid.NewString(), now.Add(time.Hour), now); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("wrong generation error = %v, want conflict", err)
	}
	if _, err = repository.pool.Exec(ctx, `UPDATE assets SET state='deleting' WHERE id=$1`, assetID); err != nil {
		t.Fatal(err)
	}
	deleting := appendInput
	deleting.IdempotencyKey = uuid.NewString()
	if _, err = repository.BeginRevisionAppend(ctx, deleting, uuid.NewString(), now.Add(time.Hour), now); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("deleting asset error = %v, want conflict", err)
	}
}

func storageTestDatabaseURL() string {
	if value := os.Getenv("STORAGE_TEST_DATABASE_URL"); value != "" {
		return value
	}
	return "postgres://storage:storage@localhost:5432/storage?sslmode=disable"
}
