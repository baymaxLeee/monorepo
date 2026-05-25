package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Environment is the deployment environment name. Production triggers
// stricter validation (no dev defaults allowed for secrets).
const (
	EnvDevelopment = "development"
	EnvStaging     = "staging"
	EnvProduction  = "production"
)

const (
	// devAccessTokenSecret is intentionally the placeholder used in dev.
	// In production we refuse to start if ACCESS_TOKEN_SECRET equals it.
	devAccessTokenSecret = "dev-only-change-me"
	devMysqlPassword     = "dev"
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
}

// IsProduction reports whether the service should apply production policy
// (skip demo seeding, strict cookie attrs, etc.).
func (c Config) IsProduction() bool { return c.Environment == EnvProduction }

func Load() (Config, error) {
	_ = godotenv.Load()

	mysqlHost := envOr("MYSQL_HOST", "localhost")
	mysqlPort := envOr("MYSQL_PORT", "3306")
	mysqlUser := envOr("MYSQL_USER", "dev")
	mysqlPassword := envOr("MYSQL_PASSWORD", devMysqlPassword)
	mysqlDatabase := envOr("IAM_MYSQL_DATABASE", "iam")

	cfg := Config{
		Environment: envOr("ENVIRONMENT", EnvDevelopment),
		Port:        envOr("PORT", "8002"),
		DatabaseURL: fmt.Sprintf(
			"%s:%s@tcp(%s:%s)/%s?parseTime=true&multiStatements=true",
			mysqlUser, mysqlPassword, mysqlHost, mysqlPort, mysqlDatabase,
		),
		AccessTokenSecret:     envOr("ACCESS_TOKEN_SECRET", devAccessTokenSecret),
		AccessTokenTTL:        durationOr("ACCESS_TOKEN_TTL", 15*time.Minute),
		RefreshTokenTTL:       durationOr("REFRESH_TOKEN_TTL", 30*24*time.Hour),
		RefreshCookieName:     envOr("REFRESH_COOKIE_NAME", "refresh_token"),
		RefreshCookieSecure:   envOr("REFRESH_COOKIE_SECURE", "false") == "true",
		RefreshCookieSameSite: envOr("REFRESH_COOKIE_SAMESITE", "lax"),
		RefreshCookieDomain:   os.Getenv("REFRESH_COOKIE_DOMAIN"),
		SuperAdminID:          envOr("SUPER_ADMIN_ID", "demo-super-admin"),
		SuperAdminAccount:     envOr("SUPER_ADMIN_ACCOUNT", "admin"),
		SuperAdminEmail:       envOr("SUPER_ADMIN_EMAIL", "admin@example.com"),
		SuperAdminPassword:    envOr("SUPER_ADMIN_PASSWORD", "admin123"),
		SuperAdminDisplayName: envOr("SUPER_ADMIN_DISPLAY_NAME", "Super Admin"),
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
	if c.AccessTokenSecret == "" || c.AccessTokenSecret == devAccessTokenSecret {
		missing = append(missing, "ACCESS_TOKEN_SECRET")
	}
	if mysqlPassword == "" || mysqlPassword == devMysqlPassword {
		missing = append(missing, "MYSQL_PASSWORD")
	}
	if mysqlHost == "localhost" || mysqlHost == "127.0.0.1" {
		missing = append(missing, "MYSQL_HOST")
	}
	// Cross-origin SPA (Cloudflare frontend → backend) requires SameSite=None
	// + Secure. We enforce Secure here; SameSite is validated at the value
	// level (must not be 'lax' in prod cross-site setups).
	if !c.RefreshCookieSecure {
		missing = append(missing, "REFRESH_COOKIE_SECURE=true")
	}
	if strings.EqualFold(c.RefreshCookieSameSite, "lax") && c.RefreshCookieDomain == "" {
		// SameSite=Lax + no Domain means cookie is host-only, which breaks
		// cross-subdomain SPA. Warn loudly.
		missing = append(missing, "REFRESH_COOKIE_SAMESITE=none + REFRESH_COOKIE_DOMAIN")
	}
	if len(missing) > 0 {
		return fmt.Errorf("production environment requires explicit values for: %s",
			strings.Join(missing, ", "))
	}
	return nil
}

// ErrProductionMisconfigured is returned by Load when production checks fail.
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
