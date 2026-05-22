package config

import (
	"fmt"
	"os"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
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

func Load() Config {
	_ = godotenv.Load()

	mysqlHost := envOr("MYSQL_HOST", "localhost")
	mysqlPort := envOr("MYSQL_PORT", "3306")
	mysqlUser := envOr("MYSQL_USER", "dev")
	mysqlPassword := envOr("MYSQL_PASSWORD", "dev")
	mysqlDatabase := envOr("IAM_MYSQL_DATABASE", "iam")

	return Config{
		Port: envOr("PORT", "8002"),
		DatabaseURL: fmt.Sprintf(
			"%s:%s@tcp(%s:%s)/%s?parseTime=true&multiStatements=true",
			mysqlUser, mysqlPassword, mysqlHost, mysqlPort, mysqlDatabase,
		),
		AccessTokenSecret:     envOr("ACCESS_TOKEN_SECRET", "dev-only-change-me"),
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
