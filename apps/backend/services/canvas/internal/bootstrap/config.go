package bootstrap

import (
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type Config struct {
	Environment         string
	Port                string
	InternalToken       string
	DatabaseURL         string
	RedisURL            string
	PublicGatewayURL    string
	AdminServiceURL     string
	KnowledgeServiceURL string
	ExecutorServiceURL  string
}

func Env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func requiredEnv(key string, deployed bool, fallback string) (string, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value != "" {
		return value, nil
	}
	if deployed {
		return "", fmt.Errorf("%s is required outside development", key)
	}
	return fallback, nil
}

func serviceURL(key string, deployed bool, fallback string) (string, error) {
	value, err := requiredEnv(key, deployed, fallback)
	if err != nil {
		return "", err
	}
	parsed, parseErr := url.Parse(value)
	if parseErr != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", fmt.Errorf("%s must be an absolute HTTP URL", key)
	}
	return value, nil
}

func Load() (Config, error) {
	_ = godotenv.Load()
	environment := strings.TrimSpace(Env("ENVIRONMENT", "development"))
	switch environment {
	case "development", "staging", "single-vps", "production":
	default:
		return Config{}, fmt.Errorf("unsupported ENVIRONMENT %q", environment)
	}
	deployed := environment != "development"
	token, err := requiredEnv("INTERNAL_API_TOKEN", deployed, "dev-internal-token")
	if err != nil {
		return Config{}, err
	}
	password, err := requiredEnv("POSTGRES_PASSWORD", deployed, "canvas")
	if err != nil {
		return Config{}, err
	}
	if deployed && (token == "dev-internal-token" || password == "canvas") {
		return Config{}, fmt.Errorf("deployed environments require non-development database credentials and internal token")
	}
	postgresHost, err := requiredEnv("POSTGRES_HOST", deployed, "localhost")
	if err != nil {
		return Config{}, err
	}
	postgresUser, err := requiredEnv("POSTGRES_USER", deployed, "canvas")
	if err != nil {
		return Config{}, err
	}
	postgresDatabase, err := requiredEnv("POSTGRES_DATABASE", deployed, "canvas")
	if err != nil {
		return Config{}, err
	}
	redisURL, err := requiredEnv("REDIS_URL", deployed, "redis://localhost:6379/0")
	if err != nil {
		return Config{}, err
	}
	publicGatewayURL, err := serviceURL("PUBLIC_GATEWAY_URL", deployed, "http://localhost:8000")
	if err != nil {
		return Config{}, err
	}
	if environment == "production" && !strings.HasPrefix(publicGatewayURL, "https://") {
		return Config{}, fmt.Errorf("production PUBLIC_GATEWAY_URL must use https")
	}
	adminServiceURL, err := serviceURL("ADMIN_SERVICE_URL", deployed, "http://localhost:8001")
	if err != nil {
		return Config{}, err
	}
	knowledgeServiceURL, err := serviceURL("KNOWLEDGE_SERVICE_URL", deployed, "http://localhost:8010")
	if err != nil {
		return Config{}, err
	}
	executorServiceURL, err := serviceURL("EXECUTOR_SERVICE_URL", deployed, "http://localhost:8011")
	if err != nil {
		return Config{}, err
	}
	return Config{
		Environment:         environment,
		Port:                Env("PORT", "8012"),
		InternalToken:       token,
		PublicGatewayURL:    publicGatewayURL,
		RedisURL:            redisURL,
		AdminServiceURL:     adminServiceURL,
		KnowledgeServiceURL: knowledgeServiceURL,
		ExecutorServiceURL:  executorServiceURL,
		DatabaseURL:         fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", postgresHost, Env("POSTGRES_PORT", "5432"), postgresUser, password, postgresDatabase, Env("POSTGRES_SSLMODE", "disable")),
	}, nil
}
func Connect(cfg Config) (*gorm.DB, error) {
	return gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
}
