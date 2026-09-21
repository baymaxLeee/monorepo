package bootstrap

import (
	"fmt"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"net/url"
	"os"
)

type Config struct{ Port, InternalToken, DatabaseURL, PublicGatewayURL string }

func Env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func Load() (Config, error) {
	_ = godotenv.Load()
	token := Env("INTERNAL_API_TOKEN", "dev-internal-token")
	password := Env("POSTGRES_PASSWORD", "canvas")
	if Env("ENVIRONMENT", "development") == "production" && (token == "dev-internal-token" || password == "canvas") {
		return Config{}, fmt.Errorf("production requires explicit database credentials and internal token")
	}
	publicGatewayURL := Env("PUBLIC_GATEWAY_URL", "http://localhost:8000")
	parsed, parseErr := url.Parse(publicGatewayURL)
	if parseErr != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return Config{}, fmt.Errorf("PUBLIC_GATEWAY_URL must be an absolute HTTP URL")
	}
	if Env("ENVIRONMENT", "development") == "production" && parsed.Scheme != "https" {
		return Config{}, fmt.Errorf("production PUBLIC_GATEWAY_URL must use https")
	}
	return Config{Port: Env("PORT", "8012"), InternalToken: token, PublicGatewayURL: publicGatewayURL, DatabaseURL: fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", Env("POSTGRES_HOST", "localhost"), Env("POSTGRES_PORT", "5432"), Env("POSTGRES_USER", "canvas"), password, Env("POSTGRES_DATABASE", "canvas"), Env("POSTGRES_SSLMODE", "disable"))}, nil
}
func Connect(cfg Config) (*gorm.DB, error) {
	return gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
}
