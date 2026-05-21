package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Store holds shared infrastructure connections.
type Store struct {
	Postgres *pgxpool.Pool
	Redis    *redis.Client
}

// Connect opens Postgres and Redis using the given URLs.
func Connect(ctx context.Context, databaseURL, redisURL string) (*Store, error) {
	pgCfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	pgCfg.MaxConns = 4

	pool, err := pgxpool.NewWithConfig(ctx, pgCfg)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}

	rOpts, err := redis.ParseURL(redisURL)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	rdb := redis.NewClient(rOpts)

	s := &Store{Postgres: pool, Redis: rdb}
	if err := s.Ping(ctx); err != nil {
		s.Close()
		return nil, err
	}

	if err := rdb.Set(ctx, "gateway:boot", "ok", 0).Err(); err != nil {
		s.Close()
		return nil, fmt.Errorf("redis set boot key: %w", err)
	}

	return s, nil
}

// Ping checks Postgres and Redis connectivity.
func (s *Store) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	if err := s.Postgres.Ping(ctx); err != nil {
		return fmt.Errorf("postgres ping: %w", err)
	}
	if err := s.Redis.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis ping: %w", err)
	}
	return nil
}

// Close releases all connections.
func (s *Store) Close() {
	if s.Postgres != nil {
		s.Postgres.Close()
	}
	if s.Redis != nil {
		_ = s.Redis.Close()
	}
}
