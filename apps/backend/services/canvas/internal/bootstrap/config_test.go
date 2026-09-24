package bootstrap

import (
	"strings"
	"testing"
)

var deployedEnvironment = map[string]string{
	"ENVIRONMENT":             "single-vps",
	"INTERNAL_API_TOKEN":      "test-canvas-internal-token-000001",
	"INTERNAL_SERVICE_TOKENS": "{\"chat\":\"test-chat-internal-token-00000001\",\"executor\":\"test-executor-internal-token-0001\"}",
	"POSTGRES_HOST":           "postgres",
	"POSTGRES_USER":           "canvas",
	"POSTGRES_PASSWORD":       "test-password",
	"POSTGRES_DATABASE":       "canvas",
	"REDIS_URL":               "redis://redis:6379/3",
	"PUBLIC_GATEWAY_URL":      "http://example.test:8080",
	"ADMIN_SERVICE_URL":       "http://admin:8001",
	"ASSET_SERVICE_URL":       "http://asset:8013",
	"EXECUTOR_SERVICE_URL":    "http://executor:8011",
}

func setDeployedEnvironment(t *testing.T) {
	t.Helper()
	for key, value := range deployedEnvironment {
		t.Setenv(key, value)
	}
}

func TestLoadDevelopmentDefaults(t *testing.T) {
	t.Setenv("ENVIRONMENT", "development")
	for key := range deployedEnvironment {
		if key != "ENVIRONMENT" {
			t.Setenv(key, "")
		}
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.PublicGatewayURL != "http://localhost:8000" || cfg.RedisURL != "redis://localhost:6379/0" {
		t.Fatalf("unexpected development defaults: %+v", cfg)
	}
}

func TestLoadDeployedEnvironmentRequiresExplicitConfiguration(t *testing.T) {
	for key := range deployedEnvironment {
		if key == "ENVIRONMENT" {
			continue
		}
		t.Run(key, func(t *testing.T) {
			setDeployedEnvironment(t)
			t.Setenv(key, "")
			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), key) {
				t.Fatalf("Load() error = %v, want error naming %s", err, key)
			}
		})
	}
}

func TestLoadProductionRequiresHTTPSPublicGateway(t *testing.T) {
	setDeployedEnvironment(t)
	t.Setenv("ENVIRONMENT", "production")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "must use https") {
		t.Fatalf("Load() error = %v, want HTTPS requirement", err)
	}
}

func TestLoadDeployedEnvironmentRejectsDevelopmentCredentials(t *testing.T) {
	for key, value := range map[string]string{
		"INTERNAL_API_TOKEN": "dev-internal-token",
		"POSTGRES_PASSWORD":  "canvas",
	} {
		t.Run(key, func(t *testing.T) {
			setDeployedEnvironment(t)
			t.Setenv(key, value)
			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), "non-development") {
				t.Fatalf("Load() error = %v, want development credential rejection", err)
			}
		})
	}
}

func TestLoadDeployedEnvironmentRejectsInvalidServiceCredentials(t *testing.T) {
	for name, value := range map[string]string{
		"missing caller":    "{\"chat\":\"test-chat-internal-token-00000001\"}",
		"development token": "{\"chat\":\"dev-chat-internal-token\",\"executor\":\"test-executor-internal-token-0001\"}",
		"duplicate token":   "{\"chat\":\"same-internal-token-00000000000000\",\"executor\":\"same-internal-token-00000000000000\"}",
	} {
		t.Run(name, func(t *testing.T) {
			setDeployedEnvironment(t)
			t.Setenv("INTERNAL_SERVICE_TOKENS", value)
			if _, err := Load(); err == nil {
				t.Fatal("Load() accepted invalid internal service credentials")
			}
		})
	}
}

func TestLoadRejectsUnknownEnvironment(t *testing.T) {
	t.Setenv("ENVIRONMENT", "prod")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "unsupported ENVIRONMENT") {
		t.Fatalf("Load() error = %v, want unsupported environment", err)
	}
}
