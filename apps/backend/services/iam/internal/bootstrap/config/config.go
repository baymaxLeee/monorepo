package config

import (
	"fmt"
	"os"
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
	devPostgresPassword  = "iam"
)

// DatabaseConfig is shared by the HTTP server and the one-shot identity seed.
type DatabaseConfig struct {
	Environment string
	DatabaseURL string
}

func (c DatabaseConfig) IsProduction() bool  { return c.Environment == EnvProduction }
func (c DatabaseConfig) IsDevelopment() bool { return c.Environment == EnvDevelopment }

// ServerConfig contains only long-running IAM HTTP server configuration.
type ServerConfig struct {
	DatabaseConfig
	Port                  string
	AccessTokenSecret     string
	AccessTokenTTL        time.Duration
	RefreshTokenTTL       time.Duration
	RefreshCookieName     string
	RefreshCookieSecure   bool
	RefreshCookieSameSite string
	RefreshCookieDomain   string
	GuestWorkspaceID      string
}

// SeedConfig contains only the inputs needed by the identity bootstrap.
type SeedConfig struct {
	DatabaseConfig
	SuperAdminID          string
	SuperAdminAccount     string
	SuperAdminEmail       string
	SuperAdminPassword    string
	SuperAdminDisplayName string
	GuestWorkspaceID      string
	GuestWorkspaceName    string
	GuestWorkspaceSlug    string
}

func LoadServer() (ServerConfig, error) {
	_ = godotenv.Overload()

	database, err := loadDatabase()
	if err != nil {
		return ServerConfig{}, err
	}
	cfg := ServerConfig{
		DatabaseConfig:        database,
		Port:                  envOr("PORT", "8002"),
		AccessTokenSecret:     envOr("ACCESS_TOKEN_SECRET", devAccessTokenSecret),
		AccessTokenTTL:        durationOr("ACCESS_TOKEN_TTL", 5*time.Minute),
		RefreshTokenTTL:       durationOr("REFRESH_TOKEN_TTL", 7*24*time.Hour),
		RefreshCookieName:     envOr("REFRESH_COOKIE_NAME", "refresh_token"),
		RefreshCookieSecure:   envOr("REFRESH_COOKIE_SECURE", "false") == "true",
		RefreshCookieSameSite: envOr("REFRESH_COOKIE_SAMESITE", "lax"),
		RefreshCookieDomain:   os.Getenv("REFRESH_COOKIE_DOMAIN"),
		GuestWorkspaceID:      envOr("GUEST_WORKSPACE_ID", "guest-org"),
	}

	var missing []string
	if !cfg.IsDevelopment() && (len(cfg.AccessTokenSecret) < 32 || cfg.AccessTokenSecret == devAccessTokenSecret) {
		missing = append(missing, "ACCESS_TOKEN_SECRET")
	}
	if cfg.IsProduction() && !cfg.RefreshCookieSecure {
		missing = append(missing, "REFRESH_COOKIE_SECURE=true")
	}
	if cfg.IsProduction() && strings.EqualFold(cfg.RefreshCookieSameSite, "lax") && cfg.RefreshCookieDomain == "" {
		missing = append(missing, "REFRESH_COOKIE_SAMESITE=none + REFRESH_COOKIE_DOMAIN")
	}
	if len(missing) > 0 {
		return ServerConfig{}, missingError(missing)
	}
	return cfg, nil
}

func LoadSeed() (SeedConfig, error) {
	_ = godotenv.Overload()

	database, err := loadDatabase()
	if err != nil {
		return SeedConfig{}, err
	}
	cfg := SeedConfig{
		DatabaseConfig:        database,
		SuperAdminID:          envOr("SUPER_ADMIN_ID", "demo-super-admin"),
		SuperAdminAccount:     envOr("SUPER_ADMIN_ACCOUNT", "admin"),
		SuperAdminEmail:       envOr("SUPER_ADMIN_EMAIL", "admin@example.com"),
		SuperAdminPassword:    envOr("SUPER_ADMIN_PASSWORD", "admin123"),
		SuperAdminDisplayName: envOr("SUPER_ADMIN_DISPLAY_NAME", "Super Admin"),
		GuestWorkspaceID:      envOr("GUEST_WORKSPACE_ID", "guest-org"),
		GuestWorkspaceName:    envOr("GUEST_WORKSPACE_NAME", "游客工作空间"),
		GuestWorkspaceSlug:    envOr("GUEST_WORKSPACE_SLUG", "guest-workspace"),
	}

	if !cfg.IsDevelopment() && (os.Getenv("SUPER_ADMIN_ACCOUNT") == "" || os.Getenv("SUPER_ADMIN_EMAIL") == "" || os.Getenv("SUPER_ADMIN_PASSWORD") == "" || cfg.SuperAdminPassword == "admin123") {
		return SeedConfig{}, missingError([]string{"SUPER_ADMIN_ACCOUNT/EMAIL/PASSWORD"})
	}
	return cfg, nil
}

func loadDatabase() (DatabaseConfig, error) {
	environment := envOr("ENVIRONMENT", EnvDevelopment)
	pgHost := envOr("POSTGRES_HOST", "localhost")
	pgPort := envOr("POSTGRES_PORT", "5432")
	pgUser := envOr("POSTGRES_USER", "iam")
	pgPassword := envOr("POSTGRES_PASSWORD", devPostgresPassword)
	pgDatabase := envOr("IAM_POSTGRES_DATABASE", "iam")
	pgSSLMode := envOr("POSTGRES_SSLMODE", "disable")

	switch environment {
	case EnvDevelopment, EnvStaging, EnvSingleVPS, EnvProduction:
	default:
		return DatabaseConfig{}, fmt.Errorf("unsupported ENVIRONMENT %q", environment)
	}

	var missing []string
	if environment != EnvDevelopment && (pgPassword == "" || pgPassword == devPostgresPassword) {
		missing = append(missing, "POSTGRES_PASSWORD")
	}
	if environment != EnvDevelopment && (pgHost == "localhost" || pgHost == "127.0.0.1") {
		missing = append(missing, "POSTGRES_HOST")
	}
	if len(missing) > 0 {
		return DatabaseConfig{}, missingError(missing)
	}

	return DatabaseConfig{
		Environment: environment,
		DatabaseURL: fmt.Sprintf(
			"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
			pgHost, pgPort, pgUser, pgPassword, pgDatabase, pgSSLMode,
		),
	}, nil
}

func missingError(missing []string) error {
	return fmt.Errorf("deployed environment requires explicit values for: %s", strings.Join(missing, ", "))
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
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
