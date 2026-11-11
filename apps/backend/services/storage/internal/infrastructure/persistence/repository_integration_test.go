package persistence

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/example/monorepo/storage/internal/application"
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

	rows, err := tx.Query(context.Background(), selectAssetBlobsForUpdateSQL, uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		t.Fatal(err)
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
	_, err = tx.Exec(ctx, `INSERT INTO blobs (id,tenant_id,sha256,size_bytes,storage_key,state,created_at)
        VALUES ($1,'tenant',$2,4,$3,'active',$4)`, baseBlobID,
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "blobs/append-test/"+baseBlobID, now)
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO assets (id,tenant_id,workspace_id,category,state,blocking_claim_count,state_version,created_by,created_at,updated_at)
            VALUES ($1,'tenant','workspace','conversation-file','active',1,1,'user',$2,$2)`, assetID, now)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO asset_revisions (id,asset_id,blob_id,revision_number,filename,media_type,size_bytes,sha256,created_by,created_at)
            VALUES ($1,$2,$3,1,'notes.md','text/markdown',4,$4,'user',$5)`, baseRevisionID, assetID, baseBlobID,
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", now)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE assets SET current_revision_id=$2 WHERE id=$1`, assetID, baseRevisionID)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO asset_claims (id,tenant_id,workspace_id,owner_service,owner_type,owner_id,slot,asset_id,revision_id,kind,status,generation,created_at,updated_at)
            VALUES ($1,'tenant','workspace','chat','conversation_file',$2,'source',$3,$4,'strong','active',3,$5,$5)`,
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
		TenantID: "tenant", WorkspaceID: "workspace", UserID: "user", CallerService: "chat", IdempotencyKey: uuid.NewString(),
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
			UploadID: started.UploadID, AssetID: assetID, TenantID: "tenant", WorkspaceID: "workspace", Now: now,
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
			UploadClaimID: uuid.NewString(), Filename: "notes.md", MediaType: "text/markdown", TenantID: "tenant",
			WorkspaceID: "workspace", UserID: "user", SizeBytes: 4, Now: now.Add(time.Second),
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
	return "postgres://asset:asset@localhost:5432/asset?sslmode=disable"
}
