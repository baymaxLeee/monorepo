package bootstrap

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	envconfig "github.com/caarlos0/env/v11"
)

type Config struct {
	Environment      string
	Port             int
	DatabaseURL      string
	RuntimeURL       string
	AdminRPCTarget   string
	InternalAPIToken string
	ShutdownTimeout  time.Duration
}

func LoadConfig() (Config, error) {
	raw, err := envconfig.ParseAs[struct {
		Environment      string        `env:"ENVIRONMENT" envDefault:"development"`
		Port             int           `env:"PORT" envDefault:"8009"`
		PostgresHost     string        `env:"POSTGRES_HOST" envDefault:"localhost"`
		PostgresPort     int           `env:"POSTGRES_PORT" envDefault:"5432"`
		PostgresUser     string        `env:"POSTGRES_USER" envDefault:"chat"`
		PostgresPassword string        `env:"POSTGRES_PASSWORD" envDefault:"chat"`
		PostgresDatabase string        `env:"POSTGRES_DATABASE" envDefault:"chat"`
		RuntimeURL       string        `env:"RUNTIME_SERVICE_URL" envDefault:"http://localhost:8015"`
		AdminRPCTarget   string        `env:"ADMIN_RPC_TARGET" envDefault:"localhost:9001"`
		InternalAPIToken string        `env:"INTERNAL_API_TOKEN" envDefault:"dev-chat-internal-token"`
		ShutdownTimeout  time.Duration `env:"SHUTDOWN_TIMEOUT" envDefault:"10s"`
	}]()
	if err != nil {
		return Config{}, fmt.Errorf("parse environment: %w", err)
	}
	environment := strings.TrimSpace(raw.Environment)
	if environment != "development" {
		value, exists := os.LookupEnv("INTERNAL_API_TOKEN")
		if !exists || len(value) < 32 || strings.HasPrefix(value, "dev-") {
			return Config{}, fmt.Errorf("deployed environment requires an explicit strong INTERNAL_API_TOKEN")
		}
	}
	return Config{
		Environment: environment, Port: raw.Port,
		DatabaseURL: fmt.Sprintf("postgres://%s:%s@%s:%d/%s",
			url.QueryEscape(raw.PostgresUser), url.QueryEscape(raw.PostgresPassword), raw.PostgresHost,
			raw.PostgresPort, url.PathEscape(raw.PostgresDatabase)),
		RuntimeURL: raw.RuntimeURL, AdminRPCTarget: raw.AdminRPCTarget,
		InternalAPIToken: raw.InternalAPIToken, ShutdownTimeout: raw.ShutdownTimeout,
	}, nil
}
