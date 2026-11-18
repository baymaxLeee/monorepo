package transaction

import (
	"context"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type transactionKey struct{ store *Store }

type Store struct {
	pool      *pgxpool.Pool
	committed *sqlc.Queries
	flush     func(context.Context) error
}

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool, committed: sqlc.New(pool)} }
func (s *Store) InTransaction(ctx context.Context) bool {
	_, ok := ctx.Value(transactionKey{s}).(pgx.Tx)
	return ok
}
func (s *Store) DB(ctx context.Context) sqlc.DBTX {
	if tx, ok := ctx.Value(transactionKey{s}).(pgx.Tx); ok {
		return tx
	}
	return s.pool
}
func (s *Store) Queries(ctx context.Context) *sqlc.Queries {
	if tx, ok := ctx.Value(transactionKey{s}).(pgx.Tx); ok {
		return s.committed.WithTx(tx)
	}
	return s.committed
}
func (s *Store) CommittedQueries() *sqlc.Queries { return s.committed }

// SetProjectionFlush wires the journal before the server and workers start.
func (s *Store) SetProjectionFlush(flush func(context.Context) error) { s.flush = flush }

func (s *Store) WithinTransaction(ctx context.Context, run func(context.Context) error) error {
	return s.WithTxOptions(ctx, pgx.TxOptions{}, run)
}

func (s *Store) WithTxOptions(ctx context.Context, options pgx.TxOptions, run func(context.Context) error) error {
	key := transactionKey{s}
	if parent, ok := ctx.Value(key).(pgx.Tx); ok {
		return pgx.BeginFunc(ctx, parent, func(tx pgx.Tx) error { return run(context.WithValue(ctx, key, tx)) })
	}
	return pgx.BeginTxFunc(ctx, s.pool, options, func(tx pgx.Tx) error {
		ctx = context.WithValue(ctx, key, tx)
		capture := s.flush != nil && options.AccessMode != pgx.ReadOnly
		if capture {
			if err := s.Queries(ctx).BeginCanvasProjectionCapture(ctx); err != nil {
				return err
			}
		}
		if err := run(ctx); err != nil {
			return err
		}
		if capture {
			return s.flush(ctx)
		}
		return nil
	})
}
