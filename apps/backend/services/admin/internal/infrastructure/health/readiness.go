package health

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Readiness struct {
	Postgres *pgxpool.Pool
	Redis    *redis.Client
}

func (r Readiness) Check(ctx context.Context) map[string]error {
	return map[string]error{
		"postgres": r.Postgres.Ping(ctx),
		"redis":    r.Redis.Ping(ctx).Err(),
	}
}
