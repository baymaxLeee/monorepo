package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

const (
	EnvDevelopment = "development"
	EnvStaging     = "staging"
	EnvSingleVPS   = "single-vps"
	EnvProduction  = "production"

	devInternalAPIToken = "dev-internal-token"
	devMysqlPassword    = "dev"
)

type Config struct {
	Environment       string
	Port              string
	DatabaseURL       string
	InternalAPIToken  string
	StorageDataDir    string
	MaxObjectBytes    int64
	DefaultBucketName string
}

func (c Config) IsProduction() bool { return c.Environment == EnvProduction }

func Load() (Config, error) {
	_ = godotenv.Load()

	mysqlHost := envOr("MYSQL_HOST", "localhost")
	mysqlPort := envOr("MYSQL_PORT", "3306")
	mysqlUser := envOr("MYSQL_USER", "dev")
	mysqlPassword := envOr("MYSQL_PASSWORD", devMysqlPassword)
	mysqlDatabase := envOr("STORAGE_MYSQL_DATABASE", "storage")

	cfg := Config{
		Environment: envOr("ENVIRONMENT", EnvDevelopment),
		Port:        envOr("PORT", "8010"),
		DatabaseURL: fmt.Sprintf(
			"%s:%s@tcp(%s:%s)/%s?parseTime=true&multiStatements=true",
			mysqlUser, mysqlPassword, mysqlHost, mysqlPort, mysqlDatabase,
		),
		InternalAPIToken:  envOr("INTERNAL_API_TOKEN", devInternalAPIToken),
		StorageDataDir:    envOr("STORAGE_DATA_DIR", ".data/storage"),
		MaxObjectBytes:    int64Or("STORAGE_MAX_OBJECT_BYTES", 10<<20),
		DefaultBucketName: envOr("STORAGE_DEFAULT_BUCKET", "chat"),
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
	if c.InternalAPIToken == "" || c.InternalAPIToken == devInternalAPIToken {
		missing = append(missing, "INTERNAL_API_TOKEN")
	}
	if mysqlPassword == "" || mysqlPassword == devMysqlPassword {
		missing = append(missing, "MYSQL_PASSWORD")
	}
	if mysqlHost == "localhost" || mysqlHost == "127.0.0.1" {
		missing = append(missing, "MYSQL_HOST")
	}
	if c.StorageDataDir == "" {
		missing = append(missing, "STORAGE_DATA_DIR")
	}
	if len(missing) > 0 {
		return fmt.Errorf("production environment requires explicit values for: %s", strings.Join(missing, ", "))
	}
	return nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func int64Or(key string, fallback int64) int64 {
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
