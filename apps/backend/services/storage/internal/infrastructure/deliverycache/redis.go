package deliverycache

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

type Redis struct{ client *redis.Client }

func New(rawURL string) (*Redis, error) {
	options, err := redis.ParseURL(rawURL)
	if err != nil {
		return nil, err
	}
	options.DialTimeout = time.Second
	options.ReadTimeout = time.Second
	options.WriteTimeout = time.Second
	options.MaxRetries = -1
	options.ContextTimeoutEnabled = true
	return &Redis{client: redis.NewClient(options)}, nil
}
func (cache *Redis) Close() error { return cache.client.Close() }
func (cache *Redis) Get(ctx context.Context, key string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	result, err := cache.client.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	return result, err
}
func (cache *Redis) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	return cache.client.Set(ctx, key, value, ttl).Err()
}
