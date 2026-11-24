package bootstrap

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	envconfig "github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	Environment           string
	Port                  string
	RPCPort               string
	InternalServiceTokens map[string]string
	DatabaseURL           string
	DataDir               string
	MaxUploadBytes        int64
	MinFreeBytes          int64
	GCInterval            time.Duration
	CandidateAge          time.Duration
	Retention             time.Duration
	SigningKey            string
	DeliveryURLTTL        time.Duration
	RedisURL              string
}

func Load() (Config, error) {
	_ = godotenv.Load()
	raw, err := envconfig.ParseAs[struct {
		Environment           string        `env:"ENVIRONMENT" envDefault:"development"`
		Port                  string        `env:"PORT" envDefault:"8013"`
		RPCPort               string        `env:"RPC_PORT" envDefault:"9013"`
		InternalServiceTokens string        `env:"INTERNAL_SERVICE_TOKENS" envDefault:"{\"admin\":\"dev-admin-internal-token\",\"canvas\":\"dev-canvas-internal-token\",\"knowledge\":\"dev-knowledge-internal-token\",\"runtime\":\"dev-runtime-internal-token\"}"`
		PostgresHost          string        `env:"POSTGRES_HOST" envDefault:"localhost"`
		PostgresPort          string        `env:"POSTGRES_PORT" envDefault:"5432"`
		PostgresUser          string        `env:"POSTGRES_USER" envDefault:"storage"`
		Password              string        `env:"POSTGRES_PASSWORD" envDefault:"storage"`
		Database              string        `env:"POSTGRES_DATABASE" envDefault:"storage"`
		SSLMode               string        `env:"POSTGRES_SSLMODE" envDefault:"disable"`
		DataDir               string        `env:"STORAGE_DATA_DIR" envDefault:"./data"`
		MaxUploadBytes        int64         `env:"STORAGE_MAX_UPLOAD_BYTES" envDefault:"5368709120"`
		MinFreeBytes          int64         `env:"STORAGE_MIN_FREE_BYTES" envDefault:"1073741824"`
		GCInterval            time.Duration `env:"STORAGE_GC_INTERVAL" envDefault:"1h"`
		CandidateAge          time.Duration `env:"STORAGE_CANDIDATE_AGE" envDefault:"24h"`
		Retention             time.Duration `env:"STORAGE_RETENTION" envDefault:"168h"`
		SigningKey            string        `env:"STORAGE_SIGNING_KEY" envDefault:"dev-asset-delivery-signing-key"`
		DeliveryURLTTL        time.Duration `env:"STORAGE_DELIVERY_URL_TTL" envDefault:"6h"`
		RedisURL              string        `env:"REDIS_URL" envDefault:"redis://localhost:6379/0"`
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
		for _, key := range []string{"POSTGRES_PASSWORD", "STORAGE_DATA_DIR", "STORAGE_SIGNING_KEY", "INTERNAL_SERVICE_TOKENS"} {
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
	var internalServiceTokens map[string]string
	if err = json.Unmarshal([]byte(raw.InternalServiceTokens), &internalServiceTokens); err != nil {
		return Config{}, fmt.Errorf("INTERNAL_SERVICE_TOKENS must be a JSON object")
	}
	expectedCallers := map[string]bool{"admin": true, "canvas": true, "knowledge": true, "runtime": true}
	if len(internalServiceTokens) != len(expectedCallers) {
		return Config{}, fmt.Errorf("INTERNAL_SERVICE_TOKENS must define exactly admin, canvas, knowledge and runtime")
	}
	for caller, token := range internalServiceTokens {
		if !expectedCallers[caller] || token == "" {
			return Config{}, fmt.Errorf("INTERNAL_SERVICE_TOKENS must define exactly admin, canvas, knowledge and runtime")
		}
		if deployed && (len(token) < 32 || strings.HasPrefix(token, "dev-")) {
			return Config{}, fmt.Errorf("INTERNAL_SERVICE_TOKENS contains an invalid %s credential", caller)
		}
	}
	return Config{
		Environment: environment, Port: raw.Port, RPCPort: raw.RPCPort, InternalServiceTokens: internalServiceTokens, DataDir: raw.DataDir,
		DatabaseURL:    fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", raw.PostgresHost, raw.PostgresPort, raw.PostgresUser, raw.Password, raw.Database, raw.SSLMode),
		MaxUploadBytes: raw.MaxUploadBytes, MinFreeBytes: raw.MinFreeBytes,
		GCInterval: raw.GCInterval, CandidateAge: raw.CandidateAge, Retention: raw.Retention,
		SigningKey: raw.SigningKey, DeliveryURLTTL: raw.DeliveryURLTTL, RedisURL: raw.RedisURL,
	}, nil
}
