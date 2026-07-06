package store

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type Store struct {
	Redis *redis.Client
}

func Connect(ctx context.Context, redisURL string) (*Store, error) {
	rOpts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	rdb := redis.NewClient(rOpts)

	s := &Store{Redis: rdb}
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

func (s *Store) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	if err := s.Redis.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis ping: %w", err)
	}
	return nil
}

func (s *Store) Close() {
	if s.Redis != nil {
		_ = s.Redis.Close()
	}
}
