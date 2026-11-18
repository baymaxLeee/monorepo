package repositories

import (
	"context"
	"errors"
	"time"

	"github.com/example/monorepo/iam/internal/application"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound        = application.ErrStoreNotFound
	ErrConflict        = application.ErrStoreConflict
	ErrNotActiveMember = application.ErrStoreNotActiveMember
	ErrInvariant       = application.ErrStoreInvariant
)

type Store struct {
	pool *pgxpool.Pool
	tx   pgx.Tx
	q    *sqlc.Queries
}

func Connect(ctx context.Context, databaseURL string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 8
	cfg.MaxConnLifetime = 5 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	store := &Store{pool: pool, q: sqlc.New(pool)}
	if err = store.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return store, nil
}
func (s *Store) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if s.tx != nil {
		return s.tx.Conn().Ping(ctx)
	}
	return s.pool.Ping(ctx)
}
func (s *Store) Close() { s.pool.Close() }
func (s *Store) inTx(ctx context.Context, fn func(*Store) error) error {
	var db interface {
		Begin(context.Context) (pgx.Tx, error)
	} = s.pool
	if s.tx != nil {
		db = s.tx
	}
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error { return fn(&Store{pool: s.pool, tx: tx, q: s.q.WithTx(tx)}) })
}
func (s *Store) Transaction(ctx context.Context, fn func(application.Store) error) error {
	return s.inTx(ctx, func(tx *Store) error { return fn(tx) })
}
func missing(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
func transition(count int64, err error) error {
	if err == nil && count == 0 {
		return ErrConflict
	}
	return err
}
