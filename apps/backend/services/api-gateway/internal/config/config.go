package config

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

// Config holds runtime settings loaded from environment / .env.
type Config struct {
	Port               string
	AdminServiceURL    string
	IdentityServiceURL string
	DatabaseURL        string
	RedisURL           string
}

// Load reads .env (if present) and environment variables.
func Load() Config {
	_ = godotenv.Load()

	mysqlHost := envOr("MYSQL_HOST", "localhost")
	mysqlPort := envOr("MYSQL_PORT", "3306")
	mysqlUser := envOr("MYSQL_USER", "dev")
	mysqlPassword := envOr("MYSQL_PASSWORD", "dev")
	mysqlDatabase := envOr("MYSQL_DATABASE", "gateway")

	redisHost := envOr("REDIS_HOST", "localhost")
	redisPort := envOr("REDIS_PORT", "6379")
	redisDB := envOr("REDIS_DB", "1")

	return Config{
		Port:               envOr("PORT", "8000"),
		AdminServiceURL:    envOr("ADMIN_SERVICE_URL", "http://localhost:8001"),
		IdentityServiceURL: envOr("IDENTITY_SERVICE_URL", "http://localhost:8002"),
		DatabaseURL: fmt.Sprintf(
			"%s:%s@tcp(%s:%s)/%s?parseTime=true",
			mysqlUser, mysqlPassword, mysqlHost, mysqlPort, mysqlDatabase,
		),
		RedisURL: fmt.Sprintf("redis://%s:%s/%s", redisHost, redisPort, redisDB),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
