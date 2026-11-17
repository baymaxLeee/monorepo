package bootstrap

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	envconfig "github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type Config struct {
	Environment      string
	Port             string
	RPCPort          string
	DatabaseURL      string
	RedisURL         string
	PublicGatewayURL string
	AdminRPCTarget   string
	StorageRPCTarget string
}

func serviceURL(key, value string) (string, error) {
	parsed, parseErr := url.Parse(value)
	if parseErr != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", fmt.Errorf("%s must be an absolute HTTP URL", key)
	}
	return value, nil
}

func Load() (Config, error) {
	_ = godotenv.Load()
	raw, err := envconfig.ParseAs[struct {
		Environment      string `env:"ENVIRONMENT" envDefault:"development"`
		Port             string `env:"PORT" envDefault:"8012"`
		RPCPort          string `env:"RPC_PORT" envDefault:"9012"`
		PostgresHost     string `env:"POSTGRES_HOST" envDefault:"localhost"`
		PostgresPort     string `env:"POSTGRES_PORT" envDefault:"5432"`
		PostgresUser     string `env:"POSTGRES_USER" envDefault:"canvas"`
		PostgresPassword string `env:"POSTGRES_PASSWORD" envDefault:"canvas"`
		PostgresDatabase string `env:"POSTGRES_DATABASE" envDefault:"canvas"`
		PostgresSSLMode  string `env:"POSTGRES_SSLMODE" envDefault:"disable"`
		RedisURL         string `env:"REDIS_URL" envDefault:"redis://localhost:6379/0"`
		PublicGatewayURL string `env:"PUBLIC_GATEWAY_URL" envDefault:"http://localhost:8000"`
		AdminRPCTarget   string `env:"ADMIN_RPC_TARGET" envDefault:"localhost:9001"`
		StorageRPCTarget string `env:"STORAGE_RPC_TARGET" envDefault:"localhost:9013"`
	}]()
	if err != nil {
		return Config{}, fmt.Errorf("parse environment: %w", err)
	}
	environment := strings.TrimSpace(raw.Environment)
	switch environment {
	case "development", "staging", "single-vps", "production":
	default:
		return Config{}, fmt.Errorf("unsupported ENVIRONMENT %q", environment)
	}
	deployed := environment != "development"
	if deployed {
		for _, key := range []string{"POSTGRES_HOST", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DATABASE", "REDIS_URL", "PUBLIC_GATEWAY_URL", "ADMIN_RPC_TARGET", "STORAGE_RPC_TARGET"} {
			value, exists := os.LookupEnv(key)
			if !exists || strings.TrimSpace(value) == "" {
				return Config{}, fmt.Errorf("%s is required outside development", key)
			}
		}
	}
	if deployed && raw.PostgresPassword == "canvas" {
		return Config{}, fmt.Errorf("POSTGRES_PASSWORD must use non-development credentials")
	}
	if deployed && raw.PostgresHost == "localhost" {
		return Config{}, fmt.Errorf("POSTGRES_HOST must not use localhost outside development")
	}
	if deployed && strings.Contains(raw.RedisURL, "localhost") {
		return Config{}, fmt.Errorf("REDIS_URL must not use localhost outside development")
	}
	if deployed && strings.HasPrefix(raw.AdminRPCTarget, "localhost:") {
		return Config{}, fmt.Errorf("ADMIN_RPC_TARGET must not use localhost outside development")
	}
	if deployed && strings.HasPrefix(raw.StorageRPCTarget, "localhost:") {
		return Config{}, fmt.Errorf("STORAGE_RPC_TARGET must not use localhost outside development")
	}
	publicGatewayURL, err := serviceURL("PUBLIC_GATEWAY_URL", raw.PublicGatewayURL)
	if err != nil {
		return Config{}, err
	}
	if environment == "production" && !strings.HasPrefix(publicGatewayURL, "https://") {
		return Config{}, fmt.Errorf("production PUBLIC_GATEWAY_URL must use https")
	}
	return Config{
		Environment:      environment,
		Port:             raw.Port,
		RPCPort:          raw.RPCPort,
		PublicGatewayURL: publicGatewayURL,
		RedisURL:         raw.RedisURL,
		AdminRPCTarget:   raw.AdminRPCTarget,
		StorageRPCTarget: raw.StorageRPCTarget,
		DatabaseURL:      fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", raw.PostgresHost, raw.PostgresPort, raw.PostgresUser, raw.PostgresPassword, raw.PostgresDatabase, raw.PostgresSSLMode),
	}, nil
}
func Connect(cfg Config) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return nil, err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(16)
	sqlDB.SetMaxIdleConns(8)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)
	return db, nil
}
