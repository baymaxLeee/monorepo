package bootstrap

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	envconfig "github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

const devSecret = "MFnLpzWN-y-Hh0aJtaxKXh4uOFcljnPC6FwpDF4S5Y8="

type Config struct {
	Environment           string
	Port                  int
	RPCPort               int
	DatabaseURL           string
	RedisAddress          string
	RedisDB               int
	AdminSecretKey        string
	StorageRPCTarget      string
	InternalAPIToken      string
	InternalServiceTokens map[string]string
	ShutdownTimeout       time.Duration
}

func Load() (Config, error) {
	_ = godotenv.Load()
	raw, err := envconfig.ParseAs[struct {
		Environment           string        `env:"ENVIRONMENT" envDefault:"development"`
		Port                  int           `env:"PORT" envDefault:"8001"`
		RPCPort               int           `env:"RPC_PORT" envDefault:"9001"`
		PostgresHost          string        `env:"POSTGRES_HOST" envDefault:"localhost"`
		PostgresPort          int           `env:"POSTGRES_PORT" envDefault:"5432"`
		PostgresUser          string        `env:"POSTGRES_USER" envDefault:"admin"`
		PostgresPassword      string        `env:"POSTGRES_PASSWORD" envDefault:"admin"`
		PostgresDatabase      string        `env:"POSTGRES_DATABASE" envDefault:"admin"`
		RedisHost             string        `env:"REDIS_HOST" envDefault:"localhost"`
		RedisPort             int           `env:"REDIS_PORT" envDefault:"6379"`
		RedisDB               int           `env:"REDIS_DB" envDefault:"0"`
		AdminSecretKey        string        `env:"ADMIN_SECRET_KEY" envDefault:"MFnLpzWN-y-Hh0aJtaxKXh4uOFcljnPC6FwpDF4S5Y8="`
		StorageRPCTarget      string        `env:"STORAGE_RPC_TARGET" envDefault:"localhost:9013"`
		InternalAPIToken      string        `env:"INTERNAL_API_TOKEN" envDefault:"dev-admin-internal-token"`
		InternalServiceTokens string        `env:"INTERNAL_SERVICE_TOKENS" envDefault:"{\"canvas\":\"dev-canvas-internal-token\",\"chat\":\"dev-chat-internal-token\",\"knowledge\":\"dev-knowledge-internal-token\"}"`
		ShutdownTimeout       time.Duration `env:"SHUTDOWN_TIMEOUT" envDefault:"10s"`
	}]()
	if err != nil {
		return Config{}, fmt.Errorf("parse environment: %w", err)
	}
	environment := strings.TrimSpace(raw.Environment)
	var internalServiceTokens map[string]string
	if err = json.Unmarshal([]byte(raw.InternalServiceTokens), &internalServiceTokens); err != nil {
		return Config{}, fmt.Errorf("INTERNAL_SERVICE_TOKENS must be a JSON object")
	}
	expectedCallers := map[string]bool{"canvas": true, "chat": true, "knowledge": true}
	if len(internalServiceTokens) != len(expectedCallers) {
		return Config{}, fmt.Errorf("INTERNAL_SERVICE_TOKENS must define exactly canvas, chat and knowledge")
	}
	for caller, token := range internalServiceTokens {
		if !expectedCallers[caller] || token == "" {
			return Config{}, fmt.Errorf("INTERNAL_SERVICE_TOKENS must define exactly canvas, chat and knowledge")
		}
	}
	if environment != "development" {
		var unsafe []string
		if raw.PostgresHost == "localhost" || raw.PostgresHost == "127.0.0.1" {
			unsafe = append(unsafe, "POSTGRES_HOST")
		}
		if raw.RedisHost == "localhost" || raw.RedisHost == "127.0.0.1" {
			unsafe = append(unsafe, "REDIS_HOST")
		}
		if strings.TrimSpace(raw.PostgresPassword) == "" || strings.EqualFold(raw.PostgresPassword, "admin") || strings.EqualFold(raw.PostgresPassword, "password") || strings.EqualFold(raw.PostgresPassword, "dev") {
			unsafe = append(unsafe, "POSTGRES_PASSWORD")
		}
		if raw.AdminSecretKey == devSecret {
			unsafe = append(unsafe, "ADMIN_SECRET_KEY")
		}
		if value, exists := os.LookupEnv("INTERNAL_API_TOKEN"); !exists || len(value) < 32 || strings.HasPrefix(value, "dev-") {
			unsafe = append(unsafe, "INTERNAL_API_TOKEN")
		}
		for _, token := range internalServiceTokens {
			if len(token) < 32 || strings.HasPrefix(token, "dev-") {
				unsafe = append(unsafe, "INTERNAL_SERVICE_TOKENS")
				break
			}
		}
		if len(unsafe) > 0 {
			return Config{}, fmt.Errorf("deployed environment requires explicit values for: %s", strings.Join(unsafe, ", "))
		}
	}
	return Config{
		Environment: environment, Port: raw.Port, RPCPort: raw.RPCPort,
		DatabaseURL: fmt.Sprintf("postgres://%s:%s@%s:%d/%s", url.QueryEscape(raw.PostgresUser),
			url.QueryEscape(raw.PostgresPassword), raw.PostgresHost, raw.PostgresPort, raw.PostgresDatabase),
		RedisAddress: fmt.Sprintf("%s:%d", raw.RedisHost, raw.RedisPort), RedisDB: raw.RedisDB,
		AdminSecretKey: raw.AdminSecretKey, StorageRPCTarget: raw.StorageRPCTarget,
		InternalAPIToken: raw.InternalAPIToken, InternalServiceTokens: internalServiceTokens,
		ShutdownTimeout: raw.ShutdownTimeout,
	}, nil
}
