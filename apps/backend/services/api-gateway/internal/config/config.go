package config

import (
	"os"

	"github.com/joho/godotenv"
)

// Config holds runtime settings loaded from environment / .env.
type Config struct {
	Port            string
	AdminServiceURL string
	DatabaseURL     string
	RedisURL        string
}

// Load reads .env (if present) and environment variables.
func Load() Config {
	_ = godotenv.Load()

	return Config{
		Port:            envOr("PORT", "8000"),
		AdminServiceURL: envOr("ADMIN_SERVICE_URL", "http://localhost:8001"),
		DatabaseURL:     envOr("DATABASE_URL", "postgres://dev:dev@localhost:5432/gateway?sslmode=disable"),
		RedisURL:        envOr("REDIS_URL", "redis://localhost:6379/1"),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
