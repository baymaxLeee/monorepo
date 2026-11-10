package persistence

import (
	"context"
	"os"
	"testing"

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
	defer repository.Close()

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

func storageTestDatabaseURL() string {
	if value := os.Getenv("STORAGE_TEST_DATABASE_URL"); value != "" {
		return value
	}
	return "postgres://asset:asset@localhost:5432/asset?sslmode=disable"
}
