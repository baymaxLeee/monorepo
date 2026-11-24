package bootstrap

import (
	"strings"
	"testing"
	"time"
)

func TestDeliveryConfiguration(t *testing.T) {
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("STORAGE_DELIVERY_URL_TTL", "")
	t.Setenv("REDIS_URL", "redis://cache.example:6379/2")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DeliveryURLTTL != 6*time.Hour || cfg.RedisURL != "redis://cache.example:6379/2" {
		t.Fatalf("delivery config: ttl=%v redis=%s", cfg.DeliveryURLTTL, cfg.RedisURL)
	}
	for _, value := range []string{"0", "-1h", "invalid"} {
		t.Setenv("STORAGE_DELIVERY_URL_TTL", value)
		if _, err := Load(); err == nil {
			t.Fatalf("accepted invalid ttl %q", value)
		}
	}
}

func TestDevelopmentDatabaseIdentityDefaultsToStorage(t *testing.T) {
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("POSTGRES_USER", "")
	t.Setenv("POSTGRES_PASSWORD", "")
	t.Setenv("POSTGRES_DATABASE", "")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"user=storage", "password=storage", "dbname=storage"} {
		if !strings.Contains(cfg.DatabaseURL, expected) {
			t.Fatalf("database URL %q does not contain %q", cfg.DatabaseURL, expected)
		}
	}
}

func TestInternalServiceCredentialsAreExact(t *testing.T) {
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("INTERNAL_SERVICE_TOKENS", `{"admin":"a","canvas":"c","knowledge":"k","runtime":"r"}`)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.InternalServiceTokens) != 4 || cfg.InternalServiceTokens["runtime"] != "r" {
		t.Fatalf("internal service tokens = %#v", cfg.InternalServiceTokens)
	}

	for _, value := range []string{`{"runtime":"r"}`, `{"admin":"a","canvas":"c","knowledge":"k","runtime":"r","other":"o"}`, `{`} {
		t.Setenv("INTERNAL_SERVICE_TOKENS", value)
		if _, err = Load(); err == nil {
			t.Fatalf("accepted invalid internal service credentials %q", value)
		}
	}
}

func TestDeploymentRequiresStrongInternalServiceCredentials(t *testing.T) {
	t.Setenv("ENVIRONMENT", "single-vps")
	t.Setenv("POSTGRES_PASSWORD", "deployment-storage-password")
	t.Setenv("STORAGE_DATA_DIR", "/var/lib/storage")
	t.Setenv("STORAGE_SIGNING_KEY", strings.Repeat("k", 32))
	t.Setenv("INTERNAL_SERVICE_TOKENS", "")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "INTERNAL_SERVICE_TOKENS is required") {
		t.Fatalf("missing internal service credentials error = %v", err)
	}

	strong := strings.Repeat("x", 32)
	t.Setenv("INTERNAL_SERVICE_TOKENS", `{"admin":"`+strong+`","canvas":"`+strong+`","knowledge":"`+strong+`","runtime":"`+strong+`"}`)
	if _, err := Load(); err != nil {
		t.Fatalf("valid deployment configuration: %v", err)
	}
}
