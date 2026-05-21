package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/redis/go-redis/v9"
)

// Store holds shared infrastructure connections.
type Store struct {
	MySQL *sql.DB
	Redis *redis.Client
}

// Connect opens MySQL and Redis using the given URLs.
func Connect(ctx context.Context, databaseURL, redisURL string) (*Store, error) {
	db, err := sql.Open("mysql", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open mysql: %w", err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)

	rOpts, err := redis.ParseURL(redisURL)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	rdb := redis.NewClient(rOpts)

	s := &Store{MySQL: db, Redis: rdb}
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

// Ping checks MySQL and Redis connectivity.
func (s *Store) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	if err := s.MySQL.PingContext(ctx); err != nil {
		return fmt.Errorf("mysql ping: %w", err)
	}
	if err := s.Redis.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis ping: %w", err)
	}
	return nil
}

// Close releases all connections.
func (s *Store) Close() {
	if s.MySQL != nil {
		_ = s.MySQL.Close()
	}
	if s.Redis != nil {
		_ = s.Redis.Close()
	}
}
