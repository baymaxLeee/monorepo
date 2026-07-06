package config

import (
	"errors"
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

type Config struct {
	Environment           string
	Port                  string
	DatabaseURL           string
	AccessTokenSecret     string
	AccessTokenTTL        time.Duration
	RefreshTokenTTL       time.Duration
	RefreshCookieName     string
	RefreshCookieSecure   bool
	RefreshCookieSameSite string
	RefreshCookieDomain   string
	SuperAdminID          string
	SuperAdminAccount     string
	SuperAdminEmail       string
	SuperAdminPassword    string
	SuperAdminDisplayName string
	GuestOrgID            string
	GuestOrgName          string
	GuestOrgSlug          string
}

func (c Config) IsProduction() bool { return c.Environment == EnvProduction }

func (c Config) IsSingleVPS() bool { return c.Environment == EnvSingleVPS }

func Load() (Config, error) {
	_ = godotenv.Overload()

	pgHost := envOr("POSTGRES_HOST", "localhost")
	pgPort := envOr("POSTGRES_PORT", "5432")
	pgUser := envOr("POSTGRES_USER", "iam")
	pgPassword := envOr("POSTGRES_PASSWORD", devPostgresPassword)
	pgDatabase := envOr("IAM_POSTGRES_DATABASE", "iam")
	pgSSLMode := envOr("POSTGRES_SSLMODE", "disable")

	cfg := Config{
		Environment: envOr("ENVIRONMENT", EnvDevelopment),
		Port:        envOr("PORT", "8002"),
		DatabaseURL: fmt.Sprintf(
			"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
			pgHost, pgPort, pgUser, pgPassword, pgDatabase, pgSSLMode,
		),
		AccessTokenSecret:     envOr("ACCESS_TOKEN_SECRET", devAccessTokenSecret),
		AccessTokenTTL:        durationOr("ACCESS_TOKEN_TTL", 5*time.Minute),
		RefreshTokenTTL:       durationOr("REFRESH_TOKEN_TTL", 7*24*time.Hour),
		RefreshCookieName:     envOr("REFRESH_COOKIE_NAME", "refresh_token"),
		RefreshCookieSecure:   envOr("REFRESH_COOKIE_SECURE", "false") == "true",
		RefreshCookieSameSite: envOr("REFRESH_COOKIE_SAMESITE", "lax"),
		RefreshCookieDomain:   os.Getenv("REFRESH_COOKIE_DOMAIN"),
		SuperAdminID:          envOr("SUPER_ADMIN_ID", "demo-super-admin"),
		SuperAdminAccount:     envOr("SUPER_ADMIN_ACCOUNT", "admin"),
		SuperAdminEmail:       envOr("SUPER_ADMIN_EMAIL", "admin@example.com"),
		SuperAdminPassword:    envOr("SUPER_ADMIN_PASSWORD", "admin123"),
		SuperAdminDisplayName: envOr("SUPER_ADMIN_DISPLAY_NAME", "Super Admin"),
		GuestOrgID:            envOr("GUEST_ORG_ID", "guest-org"),
		GuestOrgName:          envOr("GUEST_ORG_NAME", "游客组织"),
		GuestOrgSlug:          envOr("GUEST_ORG_SLUG", "guest-org"),
	}

	if err := cfg.validate(pgHost, pgPassword); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) validate(pgHost, pgPassword string) error {
	if !c.IsProduction() {
		return nil
	}
	var missing []string
	if c.AccessTokenSecret == "" || c.AccessTokenSecret == devAccessTokenSecret {
		missing = append(missing, "ACCESS_TOKEN_SECRET")
	}
	if pgPassword == "" || pgPassword == devPostgresPassword {
		missing = append(missing, "POSTGRES_PASSWORD")
	}
	if pgHost == "localhost" || pgHost == "127.0.0.1" {
		missing = append(missing, "POSTGRES_HOST")
	}
	if !c.RefreshCookieSecure {
		missing = append(missing, "REFRESH_COOKIE_SECURE=true")
	}
	if os.Getenv("SUPER_ADMIN_ACCOUNT") == "" || os.Getenv("SUPER_ADMIN_EMAIL") == "" || os.Getenv("SUPER_ADMIN_PASSWORD") == "" || c.SuperAdminPassword == "admin123" {
		missing = append(missing, "SUPER_ADMIN_ACCOUNT/EMAIL/PASSWORD")
	}
	if strings.EqualFold(c.RefreshCookieSameSite, "lax") && c.RefreshCookieDomain == "" {
		missing = append(missing, "REFRESH_COOKIE_SAMESITE=none + REFRESH_COOKIE_DOMAIN")
	}
	if len(missing) > 0 {
		return fmt.Errorf("production environment requires explicit values for: %s",
			strings.Join(missing, ", "))
	}
	return nil
}

var ErrProductionMisconfigured = errors.New("production misconfigured")

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
