package config

import (
	"fmt"
	"strings"
	"time"

	envconfig "github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

const (
	EnvDevelopment = "development"
	EnvStaging     = "staging"
	EnvSingleVPS   = "single-vps"
	EnvProduction  = "production"
)

const devAccessTokenSecret = "dev-only-change-me"

type Config struct {
	Environment              string
	Port                     string
	AdminServiceURL          string
	AssetServiceURL          string
	ChatServiceURL           string
	CanvasServiceURL         string
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

func (c Config) IsProduction() bool  { return c.Environment == EnvProduction }
func (c Config) IsDevelopment() bool { return c.Environment == EnvDevelopment }

func Load() (Config, error) {
	_ = godotenv.Overload()
	raw, err := envconfig.ParseAs[struct {
		Environment              string        `env:"ENVIRONMENT" envDefault:"development"`
		Port                     string        `env:"PORT" envDefault:"8000"`
		AdminServiceURL          string        `env:"ADMIN_SERVICE_URL" envDefault:"http://localhost:8001"`
		AssetServiceURL          string        `env:"STORAGE_SERVICE_URL" envDefault:"http://localhost:8013"`
		ChatServiceURL           string        `env:"CHAT_SERVICE_URL" envDefault:"http://localhost:8009"`
		CanvasServiceURL         string        `env:"CANVAS_SERVICE_URL" envDefault:"http://localhost:8012"`
		IAMServiceURL            string        `env:"IAM_SERVICE_URL" envDefault:"http://localhost:8002"`
		KnowledgeServiceURL      string        `env:"KNOWLEDGE_SERVICE_URL" envDefault:"http://localhost:8010"`
		TelemetryServiceURL      string        `env:"TELEMETRY_SERVICE_URL" envDefault:"http://localhost:8008"`
		AllowedOrigins           []string      `env:"ALLOWED_FRONTEND_ORIGINS" envSeparator:"," envDefault:"http://localhost:3000,http://localhost:3001"`
		RedisHost                string        `env:"REDIS_HOST" envDefault:"localhost"`
		RedisPort                string        `env:"REDIS_PORT" envDefault:"6379"`
		RedisDB                  string        `env:"REDIS_DB" envDefault:"1"`
		AccessTokenSecret        string        `env:"ACCESS_TOKEN_SECRET" envDefault:"dev-only-change-me"`
		OptionalAuthPathPrefixes []string      `env:"OPTIONAL_AUTH_PATH_PREFIXES" envSeparator:"," envDefault:"/api/telemetry-server/rum"`
		PublicPathPrefixes       []string      `env:"PUBLIC_PATH_PREFIXES" envSeparator:"," envDefault:"/,/healthz,/livez,/readyz,/api/storage-server/media,/api/iam-server/account-availability,/api/iam-server/login,/api/iam-server/register,/api/iam-server/refresh,/api/iam-server/logout"`
		PublicExactPaths         []string      `env:"PUBLIC_EXACT_PATHS" envSeparator:"," envDefault:"GET /api/iam-server/workspaces"`
		MaxRequestBodyBytes      int64         `env:"MAX_REQUEST_BODY_BYTES" envDefault:"536870912"`
		ReadTimeout              time.Duration `env:"HTTP_READ_TIMEOUT" envDefault:"15s"`
		WriteTimeout             time.Duration `env:"HTTP_WRITE_TIMEOUT" envDefault:"30s"`
		IdleTimeout              time.Duration `env:"HTTP_IDLE_TIMEOUT" envDefault:"120s"`
		RateLimitEnabled         bool          `env:"RATE_LIMIT_ENABLED" envDefault:"true"`
		RateLimitRequests        int           `env:"RATE_LIMIT_REQUESTS" envDefault:"600"`
		RateLimitWindow          time.Duration `env:"RATE_LIMIT_WINDOW" envDefault:"1m"`
	}]()
	if err != nil {
		return Config{}, fmt.Errorf("parse environment: %w", err)
	}
	cfg := Config{
		Environment: raw.Environment, Port: raw.Port,
		AdminServiceURL: raw.AdminServiceURL, AssetServiceURL: raw.AssetServiceURL,
		ChatServiceURL: raw.ChatServiceURL, CanvasServiceURL: raw.CanvasServiceURL,
		IAMServiceURL: raw.IAMServiceURL, KnowledgeServiceURL: raw.KnowledgeServiceURL,
		TelemetryServiceURL: raw.TelemetryServiceURL, AllowedOrigins: clean(raw.AllowedOrigins),
		RedisURL:          fmt.Sprintf("redis://%s:%s/%s", raw.RedisHost, raw.RedisPort, raw.RedisDB),
		AccessTokenSecret: raw.AccessTokenSecret, OptionalAuthPathPrefixes: clean(raw.OptionalAuthPathPrefixes),
		PublicPathPrefixes: clean(raw.PublicPathPrefixes), PublicExactPaths: clean(raw.PublicExactPaths),
		MaxRequestBodyBytes: raw.MaxRequestBodyBytes, ReadTimeout: raw.ReadTimeout,
		WriteTimeout: raw.WriteTimeout, IdleTimeout: raw.IdleTimeout,
		RateLimitEnabled: raw.RateLimitEnabled, RateLimitRequests: raw.RateLimitRequests,
		RateLimitWindow: raw.RateLimitWindow,
	}
	if err := cfg.validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) validate() error {
	switch c.Environment {
	case EnvDevelopment, EnvStaging, EnvSingleVPS, EnvProduction:
	default:
		return fmt.Errorf("unsupported ENVIRONMENT %q", c.Environment)
	}
	if c.MaxRequestBodyBytes <= 0 || c.RateLimitRequests <= 0 || c.ReadTimeout <= 0 || c.WriteTimeout <= 0 || c.IdleTimeout <= 0 || c.RateLimitWindow <= 0 {
		return fmt.Errorf("gateway limits and durations must be positive")
	}
	var missing []string
	if !c.IsDevelopment() && (c.AccessTokenSecret == "" || c.AccessTokenSecret == devAccessTokenSecret) {
		missing = append(missing, "ACCESS_TOKEN_SECRET")
	}
	if c.IsProduction() && len(c.AllowedOrigins) == 0 {
		missing = append(missing, "ALLOWED_FRONTEND_ORIGINS")
	} else if c.IsProduction() {
		for _, origin := range c.AllowedOrigins {
			lower := strings.ToLower(origin)
			if lower == "*" || strings.Contains(lower, "localhost") || strings.Contains(lower, "127.0.0.1") || !strings.HasPrefix(lower, "https://") {
				missing = append(missing, "ALLOWED_FRONTEND_ORIGINS (production requires https without localhost/wildcard)")
				break
			}
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("deployed environment requires explicit values for: %s", strings.Join(missing, ", "))
	}
	return nil
}

func clean(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			result = append(result, value)
		}
	}
	return result
}
