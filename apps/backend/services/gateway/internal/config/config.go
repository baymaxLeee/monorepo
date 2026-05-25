package config

import (
	"fmt"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

// Config holds runtime settings loaded from environment / .env.
type Config struct {
	Port                     string
	AdminServiceURL          string
	IAMServiceURL            string
	TelemetryServiceURL      string
	AllowedOrigins           []string
	DatabaseURL              string
	RedisURL                 string
	AccessTokenSecret        string
	OptionalAuthPathPrefixes []string
	// PublicPathPrefixes are paths that bypass the identity-propagation
	// middleware (login/register/refresh, health checks).
	PublicPathPrefixes []string
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
		Port:                envOr("PORT", "8000"),
		AdminServiceURL:     envOr("ADMIN_SERVICE_URL", "http://localhost:8001"),
		IAMServiceURL:       envOr("IAM_SERVICE_URL", "http://localhost:8002"),
		TelemetryServiceURL: envOr("TELEMETRY_SERVICE_URL", "http://localhost:8008"),
		AllowedOrigins:      csvOr("ALLOWED_FRONTEND_ORIGINS", []string{"http://localhost:3000", "http://localhost:3001"}),
		DatabaseURL: fmt.Sprintf(
			"%s:%s@tcp(%s:%s)/%s?parseTime=true",
			mysqlUser, mysqlPassword, mysqlHost, mysqlPort, mysqlDatabase,
		),
		RedisURL:          fmt.Sprintf("redis://%s:%s/%s", redisHost, redisPort, redisDB),
		AccessTokenSecret: envOr("ACCESS_TOKEN_SECRET", "dev-only-change-me"),
		PublicPathPrefixes: csvOr("PUBLIC_PATH_PREFIXES", []string{
			"/",
			"/healthz",
			"/api/iam-server/account-availability",
			"/api/iam-server/login",
			"/api/iam-server/register",
			"/api/iam-server/refresh",
			"/api/iam-server/logout",
		}),
		OptionalAuthPathPrefixes: csvOr("OPTIONAL_AUTH_PATH_PREFIXES", []string{
			"/api/telemetry-server/rum",
		}),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func csvOr(key string, fallback []string) []string {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	var values []string
	for _, part := range strings.Split(raw, ",") {
		value := strings.TrimSpace(part)
		if value != "" {
			values = append(values, value)
		}
	}
	if len(values) == 0 {
		return fallback
	}
	return values
}
