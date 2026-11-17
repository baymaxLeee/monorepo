package bootstrap

import (
	"fmt"
	"math"
	"strings"

	envconfig "github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	Environment          string
	Port                 string
	DatabaseURL          string
	SampleRatePerform    float64
	SampleRateEvent      float64
	ClickHouseHTTPURL    string
	ClickHouseUser       string
	ClickHousePassword   string
	OTELExporterEndpoint string
}

func Load() (Config, error) {
	_ = godotenv.Load()
	raw, err := envconfig.ParseAs[struct {
		Environment          string  `env:"ENVIRONMENT" envDefault:"development"`
		Port                 string  `env:"PORT" envDefault:"8008"`
		PostgresHost         string  `env:"POSTGRES_HOST" envDefault:"localhost"`
		PostgresPort         string  `env:"POSTGRES_PORT" envDefault:"5432"`
		PostgresUser         string  `env:"POSTGRES_USER" envDefault:"telemetry"`
		PostgresPassword     string  `env:"POSTGRES_PASSWORD" envDefault:"telemetry"`
		PostgresDatabase     string  `env:"POSTGRES_DATABASE" envDefault:"telemetry"`
		PostgresSSLMode      string  `env:"POSTGRES_SSLMODE" envDefault:"disable"`
		SampleRatePerform    float64 `env:"SAMPLE_RATE_PERFORM" envDefault:"1"`
		SampleRateEvent      float64 `env:"SAMPLE_RATE_EVENT" envDefault:"1"`
		ClickHouseHTTPURL    string  `env:"CLICKHOUSE_HTTP_URL"`
		ClickHouseUser       string  `env:"CLICKHOUSE_USER" envDefault:"default"`
		ClickHousePassword   string  `env:"CLICKHOUSE_PASSWORD"`
		OTELExporterEndpoint string  `env:"OTEL_EXPORTER_OTLP_ENDPOINT"`
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

	host := strings.TrimSpace(raw.PostgresHost)
	password := raw.PostgresPassword
	if environment != "development" {
		if insecurePassword(password) {
			return Config{}, fmt.Errorf("deployed environment requires explicit POSTGRES_PASSWORD")
		}
		if host == "localhost" || host == "127.0.0.1" {
			return Config{}, fmt.Errorf("deployed environment requires explicit POSTGRES_HOST")
		}
	}
	if !finite(raw.SampleRatePerform) || !finite(raw.SampleRateEvent) {
		return Config{}, fmt.Errorf("sampling rates must be finite numbers")
	}

	return Config{
		Environment:          environment,
		Port:                 strings.TrimSpace(raw.Port),
		DatabaseURL:          fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", host, raw.PostgresPort, raw.PostgresUser, password, raw.PostgresDatabase, raw.PostgresSSLMode),
		SampleRatePerform:    raw.SampleRatePerform,
		SampleRateEvent:      raw.SampleRateEvent,
		ClickHouseHTTPURL:    strings.TrimSpace(raw.ClickHouseHTTPURL),
		ClickHouseUser:       strings.TrimSpace(raw.ClickHouseUser),
		ClickHousePassword:   raw.ClickHousePassword,
		OTELExporterEndpoint: strings.TrimSpace(raw.OTELExporterEndpoint),
	}, nil
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func insecurePassword(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "dev", "password", "admin", "telemetry":
		return true
	default:
		return false
	}
}
