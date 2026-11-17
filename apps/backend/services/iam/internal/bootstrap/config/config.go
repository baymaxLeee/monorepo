package config

import (
	"fmt"
	"os"
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

	devAccessTokenSecret = "dev-only-change-me"
	devPostgresPassword  = "iam"
)

type DatabaseConfig struct {
	Environment string
	DatabaseURL string
}

func (c DatabaseConfig) IsProduction() bool  { return c.Environment == EnvProduction }
func (c DatabaseConfig) IsDevelopment() bool { return c.Environment == EnvDevelopment }

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
	raw, err := envconfig.ParseAs[struct {
		Port                  string        `env:"PORT" envDefault:"8002"`
		AccessTokenSecret     string        `env:"ACCESS_TOKEN_SECRET" envDefault:"dev-only-change-me"`
		AccessTokenTTL        time.Duration `env:"ACCESS_TOKEN_TTL" envDefault:"5m"`
		RefreshTokenTTL       time.Duration `env:"REFRESH_TOKEN_TTL" envDefault:"168h"`
		RefreshCookieName     string        `env:"REFRESH_COOKIE_NAME" envDefault:"refresh_token"`
		RefreshCookieSecure   bool          `env:"REFRESH_COOKIE_SECURE" envDefault:"false"`
		RefreshCookieSameSite string        `env:"REFRESH_COOKIE_SAMESITE" envDefault:"lax"`
		RefreshCookieDomain   string        `env:"REFRESH_COOKIE_DOMAIN"`
		GuestWorkspaceID      string        `env:"GUEST_WORKSPACE_ID" envDefault:"guest-org"`
	}]()
	if err != nil {
		return ServerConfig{}, fmt.Errorf("parse server environment: %w", err)
	}
	cfg := ServerConfig{DatabaseConfig: database, Port: raw.Port, AccessTokenSecret: raw.AccessTokenSecret,
		AccessTokenTTL: raw.AccessTokenTTL, RefreshTokenTTL: raw.RefreshTokenTTL,
		RefreshCookieName: raw.RefreshCookieName, RefreshCookieSecure: raw.RefreshCookieSecure,
		RefreshCookieSameSite: raw.RefreshCookieSameSite, RefreshCookieDomain: raw.RefreshCookieDomain,
		GuestWorkspaceID: raw.GuestWorkspaceID}
	var missing []string
	if cfg.AccessTokenTTL <= 0 || cfg.RefreshTokenTTL <= 0 {
		return ServerConfig{}, fmt.Errorf("token TTLs must be positive")
	}
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
	raw, err := envconfig.ParseAs[struct {
		SuperAdminID          string `env:"SUPER_ADMIN_ID" envDefault:"demo-super-admin"`
		SuperAdminAccount     string `env:"SUPER_ADMIN_ACCOUNT" envDefault:"admin"`
		SuperAdminEmail       string `env:"SUPER_ADMIN_EMAIL" envDefault:"admin@example.com"`
		SuperAdminPassword    string `env:"SUPER_ADMIN_PASSWORD" envDefault:"admin123"`
		SuperAdminDisplayName string `env:"SUPER_ADMIN_DISPLAY_NAME" envDefault:"Super Admin"`
		GuestWorkspaceID      string `env:"GUEST_WORKSPACE_ID" envDefault:"guest-org"`
		GuestWorkspaceName    string `env:"GUEST_WORKSPACE_NAME" envDefault:"游客工作空间"`
		GuestWorkspaceSlug    string `env:"GUEST_WORKSPACE_SLUG" envDefault:"guest-workspace"`
	}]()
	if err != nil {
		return SeedConfig{}, fmt.Errorf("parse seed environment: %w", err)
	}
	cfg := SeedConfig{DatabaseConfig: database, SuperAdminID: raw.SuperAdminID,
		SuperAdminAccount: raw.SuperAdminAccount, SuperAdminEmail: raw.SuperAdminEmail,
		SuperAdminPassword: raw.SuperAdminPassword, SuperAdminDisplayName: raw.SuperAdminDisplayName,
		GuestWorkspaceID: raw.GuestWorkspaceID, GuestWorkspaceName: raw.GuestWorkspaceName,
		GuestWorkspaceSlug: raw.GuestWorkspaceSlug}
	if !cfg.IsDevelopment() && (os.Getenv("SUPER_ADMIN_ACCOUNT") == "" || os.Getenv("SUPER_ADMIN_EMAIL") == "" || os.Getenv("SUPER_ADMIN_PASSWORD") == "" || cfg.SuperAdminPassword == "admin123") {
		return SeedConfig{}, missingError([]string{"SUPER_ADMIN_ACCOUNT/EMAIL/PASSWORD"})
	}
	return cfg, nil
}

func loadDatabase() (DatabaseConfig, error) {
	raw, err := envconfig.ParseAs[struct {
		Environment string `env:"ENVIRONMENT" envDefault:"development"`
		Host        string `env:"POSTGRES_HOST" envDefault:"localhost"`
		Port        string `env:"POSTGRES_PORT" envDefault:"5432"`
		User        string `env:"POSTGRES_USER" envDefault:"iam"`
		Password    string `env:"POSTGRES_PASSWORD" envDefault:"iam"`
		Database    string `env:"IAM_POSTGRES_DATABASE" envDefault:"iam"`
		SSLMode     string `env:"POSTGRES_SSLMODE" envDefault:"disable"`
	}]()
	if err != nil {
		return DatabaseConfig{}, fmt.Errorf("parse database environment: %w", err)
	}
	switch raw.Environment {
	case EnvDevelopment, EnvStaging, EnvSingleVPS, EnvProduction:
	default:
		return DatabaseConfig{}, fmt.Errorf("unsupported ENVIRONMENT %q", raw.Environment)
	}
	var missing []string
	if raw.Environment != EnvDevelopment && (raw.Password == "" || raw.Password == devPostgresPassword) {
		missing = append(missing, "POSTGRES_PASSWORD")
	}
	if raw.Environment != EnvDevelopment && (raw.Host == "localhost" || raw.Host == "127.0.0.1") {
		missing = append(missing, "POSTGRES_HOST")
	}
	if len(missing) > 0 {
		return DatabaseConfig{}, missingError(missing)
	}
	return DatabaseConfig{Environment: raw.Environment, DatabaseURL: fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		raw.Host, raw.Port, raw.User, raw.Password, raw.Database, raw.SSLMode,
	)}, nil
}

func missingError(missing []string) error {
	return fmt.Errorf("deployed environment requires explicit values for: %s", strings.Join(missing, ", "))
}
