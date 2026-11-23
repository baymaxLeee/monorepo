package bootstrap

import (
	"fmt"
	"os"
	"strings"
	"time"

	envconfig "github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	Environment       string
	Port              string
	RPCPort           string
	RPCAllowedCallers []string
	DatabaseURL       string
	DataDir           string
	MaxUploadBytes    int64
	MinFreeBytes      int64
	GCInterval        time.Duration
	CandidateAge      time.Duration
	Retention         time.Duration
	SigningKey        string
	DeliveryURLTTL    time.Duration
	RedisURL          string
}

func Load() (Config, error) {
	_ = godotenv.Load()
	raw, err := envconfig.ParseAs[struct {
		Environment       string        `env:"ENVIRONMENT" envDefault:"development"`
		Port              string        `env:"PORT" envDefault:"8013"`
		RPCPort           string        `env:"RPC_PORT" envDefault:"9013"`
		RPCAllowedCallers []string      `env:"STORAGE_RPC_ALLOWED_CALLERS" envSeparator:","`
		PostgresHost      string        `env:"POSTGRES_HOST" envDefault:"localhost"`
		PostgresPort      string        `env:"POSTGRES_PORT" envDefault:"5432"`
		PostgresUser      string        `env:"POSTGRES_USER" envDefault:"storage"`
		Password          string        `env:"POSTGRES_PASSWORD" envDefault:"storage"`
		Database          string        `env:"POSTGRES_DATABASE" envDefault:"storage"`
		SSLMode           string        `env:"POSTGRES_SSLMODE" envDefault:"disable"`
		DataDir           string        `env:"STORAGE_DATA_DIR" envDefault:"./data"`
		MaxUploadBytes    int64         `env:"STORAGE_MAX_UPLOAD_BYTES" envDefault:"5368709120"`
		MinFreeBytes      int64         `env:"STORAGE_MIN_FREE_BYTES" envDefault:"1073741824"`
		GCInterval        time.Duration `env:"STORAGE_GC_INTERVAL" envDefault:"1h"`
		CandidateAge      time.Duration `env:"STORAGE_CANDIDATE_AGE" envDefault:"24h"`
		Retention         time.Duration `env:"STORAGE_RETENTION" envDefault:"168h"`
		SigningKey        string        `env:"STORAGE_SIGNING_KEY" envDefault:"dev-asset-delivery-signing-key"`
		DeliveryURLTTL    time.Duration `env:"STORAGE_DELIVERY_URL_TTL" envDefault:"6h"`
		RedisURL          string        `env:"REDIS_URL" envDefault:"redis://localhost:6379/0"`
	}]()
	if err != nil {
		return Config{}, fmt.Errorf("parse environment: %w", err)
	}
	environment := strings.TrimSpace(raw.Environment)
	if environment != "development" && environment != "staging" && environment != "single-vps" && environment != "production" {
		return Config{}, fmt.Errorf("unsupported ENVIRONMENT %q", environment)
	}
	deployed := environment != "development"
	if deployed {
		for _, key := range []string{"POSTGRES_PASSWORD", "STORAGE_DATA_DIR", "STORAGE_SIGNING_KEY", "STORAGE_RPC_ALLOWED_CALLERS"} {
			value, exists := os.LookupEnv(key)
			if !exists || strings.TrimSpace(value) == "" {
				return Config{}, fmt.Errorf("%s is required outside development", key)
			}
		}
	}
	if deployed && (raw.Password == "storage" || !strings.HasPrefix(raw.DataDir, "/")) {
		return Config{}, fmt.Errorf("deployed environments require non-development database credentials and an absolute STORAGE_DATA_DIR")
	}
	if raw.MaxUploadBytes <= 0 || raw.MinFreeBytes <= 0 {
		return Config{}, fmt.Errorf("storage byte limits must be positive")
	}
	if raw.GCInterval <= 0 || raw.CandidateAge <= 0 || raw.Retention <= 0 || raw.DeliveryURLTTL <= 0 {
		return Config{}, fmt.Errorf("storage durations must be positive")
	}
	if deployed && len(raw.SigningKey) < 32 {
		return Config{}, fmt.Errorf("STORAGE_SIGNING_KEY must be at least 32 bytes outside development")
	}
	allowedCallers := make([]string, 0, len(raw.RPCAllowedCallers))
	seenCallers := make(map[string]struct{}, len(raw.RPCAllowedCallers))
	for _, value := range raw.RPCAllowedCallers {
		caller := strings.TrimSpace(value)
		if !validWorkloadName(caller) {
			return Config{}, fmt.Errorf("invalid STORAGE_RPC_ALLOWED_CALLERS workload %q", value)
		}
		if _, exists := seenCallers[caller]; exists {
			return Config{}, fmt.Errorf("duplicate STORAGE_RPC_ALLOWED_CALLERS workload %q", caller)
		}
		seenCallers[caller] = struct{}{}
		allowedCallers = append(allowedCallers, caller)
	}
	return Config{
		Environment: environment, Port: raw.Port, RPCPort: raw.RPCPort, RPCAllowedCallers: allowedCallers, DataDir: raw.DataDir,
		DatabaseURL:    fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", raw.PostgresHost, raw.PostgresPort, raw.PostgresUser, raw.Password, raw.Database, raw.SSLMode),
		MaxUploadBytes: raw.MaxUploadBytes, MinFreeBytes: raw.MinFreeBytes,
		GCInterval: raw.GCInterval, CandidateAge: raw.CandidateAge, Retention: raw.Retention,
		SigningKey: raw.SigningKey, DeliveryURLTTL: raw.DeliveryURLTTL, RedisURL: raw.RedisURL,
	}, nil
}

func validWorkloadName(value string) bool {
	if len(value) == 0 || len(value) > 64 || value[0] < 'a' || value[0] > 'z' {
		return false
	}
	for _, character := range value[1:] {
		if (character < 'a' || character > 'z') && (character < '0' || character > '9') && character != '-' {
			return false
		}
	}
	return true
}
