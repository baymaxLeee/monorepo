package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

const (
	EnvDevelopment = "development"
	EnvStaging     = "staging"
	EnvSingleVPS   = "single-vps"
	EnvProduction  = "production"
)

const (
	devAccessTokenSecret = "dev-only-change-me"
)

type Config struct {
	Environment              string
	Port                     string
	AdminServiceURL          string
	ChatServiceURL           string
	IAMServiceURL            string
	KnowledgeServiceURL      string
	TelemetryServiceURL      string
	AllowedOrigins           []string
	RedisURL                 string
	AccessTokenSecret        string
	OptionalAuthPathPrefixes []string
	PublicPathPrefixes       []string
	PublicExactPaths         []string
	MaxRequestBodyBytes      int64
	ReadTimeout              time.Duration
	WriteTimeout             time.Duration
	IdleTimeout              time.Duration
	RateLimitEnabled         bool
	RateLimitRequests        int
	RateLimitWindow          time.Duration
}

func (c Config) IsProduction() bool { return c.Environment == EnvProduction }

func (c Config) IsSingleVPS() bool { return c.Environment == EnvSingleVPS }

func Load() (Config, error) {
	_ = godotenv.Overload()

	redisHost := envOr("REDIS_HOST", "localhost")
	redisPort := envOr("REDIS_PORT", "6379")
	redisDB := envOr("REDIS_DB", "1")

	cfg := Config{
		Environment:         envOr("ENVIRONMENT", EnvDevelopment),
		Port:                envOr("PORT", "8000"),
		AdminServiceURL:     envOr("ADMIN_SERVICE_URL", "http://localhost:8001"),
		ChatServiceURL:      envOr("CHAT_SERVICE_URL", "http://localhost:8009"),
		IAMServiceURL:       envOr("IAM_SERVICE_URL", "http://localhost:8002"),
		KnowledgeServiceURL: envOr("KNOWLEDGE_SERVICE_URL", "http://localhost:8010"),
		TelemetryServiceURL: envOr("TELEMETRY_SERVICE_URL", "http://localhost:8008"),
		AllowedOrigins:      csvOr("ALLOWED_FRONTEND_ORIGINS", []string{"http://localhost:3000", "http://localhost:3001"}),
		RedisURL:            fmt.Sprintf("redis://%s:%s/%s", redisHost, redisPort, redisDB),
		AccessTokenSecret:   envOr("ACCESS_TOKEN_SECRET", devAccessTokenSecret),
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
			"/api/knowledge-server/resources",
		}),
		// Method-aware exact publics: the register page must read the applyable
		// org list before authenticating, but POST /orgs and /orgs/{id}/... stay
		// protected — so this is GET-only and exact, never a prefix.
		PublicExactPaths: csvOr("PUBLIC_EXACT_PATHS", []string{
			"GET /api/iam-server/orgs",
		}),
		OptionalAuthPathPrefixes: csvOr("OPTIONAL_AUTH_PATH_PREFIXES", []string{
			"/api/telemetry-server/rum",
		}),
		MaxRequestBodyBytes: bytesOr("MAX_REQUEST_BODY_BYTES", 10<<20),
		ReadTimeout:         durationOr("HTTP_READ_TIMEOUT", 15*time.Second),
		WriteTimeout:        durationOr("HTTP_WRITE_TIMEOUT", 30*time.Second),
		IdleTimeout:         durationOr("HTTP_IDLE_TIMEOUT", 120*time.Second),
		RateLimitEnabled:    boolOr("RATE_LIMIT_ENABLED", true),
		RateLimitRequests:   intOr("RATE_LIMIT_REQUESTS", 600),
		RateLimitWindow:     durationOr("RATE_LIMIT_WINDOW", time.Minute),
	}

	if err := cfg.validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) validate() error {
	if !c.IsProduction() {
		return nil
	}
	var missing []string
	if c.AccessTokenSecret == "" || c.AccessTokenSecret == devAccessTokenSecret {
		missing = append(missing, "ACCESS_TOKEN_SECRET")
	}
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

func boolOr(key string, fallback bool) bool {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	b, err := strconv.ParseBool(raw)
	if err != nil {
		return fallback
	}
	return b
}

func intOr(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
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
