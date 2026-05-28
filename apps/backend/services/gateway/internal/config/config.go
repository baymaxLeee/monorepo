package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Environment names.
//
// `single-vps` is a special public-internet demo profile: same-origin behind
// nginx, plain HTTP, IP-only URL. It skips production CORS/secret strictness
// because the SPA and the API share an origin so the browser never even sends
// preflights — but it still runs against real MySQL/Redis.
const (
	EnvDevelopment = "development"
	EnvStaging     = "staging"
	EnvSingleVPS   = "single-vps"
	EnvProduction  = "production"
)

const (
	devAccessTokenSecret = "dev-only-change-me"
	devMysqlPassword     = "dev"
)

// Config holds runtime settings loaded from environment / .env.
type Config struct {
	Environment              string
	Port                     string
	AdminServiceURL          string
	ChatServiceURL           string
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
	// MaxRequestBodyBytes caps incoming request bodies to defend against
	// resource exhaustion. Defaults to 1 MiB.
	MaxRequestBodyBytes int64
	// HTTP timeouts. Set generously above expected p99 to avoid cutting
	// legitimate slow downstream calls, but small enough that hung clients
	// don't pile up goroutines.
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
}

// IsProduction reports whether the service applies production policy.
func (c Config) IsProduction() bool { return c.Environment == EnvProduction }

// IsSingleVPS reports the special single-box public-demo profile.
func (c Config) IsSingleVPS() bool { return c.Environment == EnvSingleVPS }

// Load reads .env (if present) and environment variables, validating
// production-required fields.
func Load() (Config, error) {
	_ = godotenv.Load()

	mysqlHost := envOr("MYSQL_HOST", "localhost")
	mysqlPort := envOr("MYSQL_PORT", "3306")
	mysqlUser := envOr("MYSQL_USER", "dev")
	mysqlPassword := envOr("MYSQL_PASSWORD", devMysqlPassword)
	mysqlDatabase := envOr("MYSQL_DATABASE", "gateway")

	redisHost := envOr("REDIS_HOST", "localhost")
	redisPort := envOr("REDIS_PORT", "6379")
	redisDB := envOr("REDIS_DB", "1")

	cfg := Config{
		Environment:         envOr("ENVIRONMENT", EnvDevelopment),
		Port:                envOr("PORT", "8000"),
		AdminServiceURL:     envOr("ADMIN_SERVICE_URL", "http://localhost:8001"),
		ChatServiceURL:      envOr("CHAT_SERVICE_URL", "http://localhost:8009"),
		IAMServiceURL:       envOr("IAM_SERVICE_URL", "http://localhost:8002"),
		TelemetryServiceURL: envOr("TELEMETRY_SERVICE_URL", "http://localhost:8008"),
		AllowedOrigins:      csvOr("ALLOWED_FRONTEND_ORIGINS", []string{"http://localhost:3000", "http://localhost:3001"}),
		DatabaseURL: fmt.Sprintf(
			"%s:%s@tcp(%s:%s)/%s?parseTime=true",
			mysqlUser, mysqlPassword, mysqlHost, mysqlPort, mysqlDatabase,
		),
		RedisURL:          fmt.Sprintf("redis://%s:%s/%s", redisHost, redisPort, redisDB),
		AccessTokenSecret: envOr("ACCESS_TOKEN_SECRET", devAccessTokenSecret),
		PublicPathPrefixes: csvOr("PUBLIC_PATH_PREFIXES", []string{
			"/",
			"/healthz",
			"/livez",
			"/readyz",
			"/api/iam-server/account-availability",
			"/api/iam-server/login",
			"/api/iam-server/register",
			"/api/iam-server/refresh",
			"/api/iam-server/logout",
		}),
		OptionalAuthPathPrefixes: csvOr("OPTIONAL_AUTH_PATH_PREFIXES", []string{
			"/api/telemetry-server/rum",
		}),
		MaxRequestBodyBytes: bytesOr("MAX_REQUEST_BODY_BYTES", 1<<20), // 1 MiB
		ReadTimeout:         durationOr("HTTP_READ_TIMEOUT", 15*time.Second),
		WriteTimeout:        durationOr("HTTP_WRITE_TIMEOUT", 30*time.Second),
		IdleTimeout:         durationOr("HTTP_IDLE_TIMEOUT", 120*time.Second),
	}

	if err := cfg.validate(mysqlHost, mysqlPassword); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) validate(mysqlHost, mysqlPassword string) error {
	if !c.IsProduction() {
		return nil
	}
	var missing []string
	if c.AccessTokenSecret == "" || c.AccessTokenSecret == devAccessTokenSecret {
		missing = append(missing, "ACCESS_TOKEN_SECRET")
	}
	if mysqlPassword == "" || mysqlPassword == devMysqlPassword {
		missing = append(missing, "MYSQL_PASSWORD")
	}
	if mysqlHost == "localhost" || mysqlHost == "127.0.0.1" {
		missing = append(missing, "MYSQL_HOST")
	}
	// CORS must be a strict, explicit allowlist in production. Any
	// localhost / wildcard / empty value indicates a misconfiguration.
	if len(c.AllowedOrigins) == 0 {
		missing = append(missing, "ALLOWED_FRONTEND_ORIGINS")
	} else {
		for _, o := range c.AllowedOrigins {
			lo := strings.ToLower(o)
			if lo == "*" || strings.Contains(lo, "localhost") || strings.Contains(lo, "127.0.0.1") {
				missing = append(missing, "ALLOWED_FRONTEND_ORIGINS (no localhost/wildcard in prod)")
				break
			}
			if !strings.HasPrefix(lo, "https://") {
				missing = append(missing, "ALLOWED_FRONTEND_ORIGINS (https:// only in prod)")
				break
			}
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("production environment requires explicit values for: %s",
			strings.Join(missing, ", "))
	}
	return nil
}

func durationOr(key string, fallback time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return fallback
	}
	return d
}

func bytesOr(key string, fallback int64) int64 {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
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
