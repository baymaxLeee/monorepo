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

func TestRPCAllowedCallersAreDeploymentConfiguration(t *testing.T) {
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("STORAGE_RPC_ALLOWED_CALLERS", "media-owner,preview-worker")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.RPCAllowedCallers) != 2 || cfg.RPCAllowedCallers[0] != "media-owner" || cfg.RPCAllowedCallers[1] != "preview-worker" {
		t.Fatalf("RPC allowed callers = %#v", cfg.RPCAllowedCallers)
	}

	for _, value := range []string{"invalid_name", "duplicate,duplicate"} {
		t.Setenv("STORAGE_RPC_ALLOWED_CALLERS", value)
		if _, err = Load(); err == nil {
			t.Fatalf("accepted invalid RPC caller list %q", value)
		}
	}
}

func TestDeploymentRequiresRPCAllowedCallers(t *testing.T) {
	t.Setenv("ENVIRONMENT", "single-vps")
	t.Setenv("POSTGRES_PASSWORD", "deployment-storage-password")
	t.Setenv("STORAGE_DATA_DIR", "/var/lib/storage")
	t.Setenv("STORAGE_SIGNING_KEY", strings.Repeat("k", 32))
	t.Setenv("STORAGE_RPC_ALLOWED_CALLERS", "")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "STORAGE_RPC_ALLOWED_CALLERS is required") {
		t.Fatalf("missing RPC caller allowlist error = %v", err)
	}

	t.Setenv("STORAGE_RPC_ALLOWED_CALLERS", "media-owner")
	if _, err := Load(); err != nil {
		t.Fatalf("valid deployment configuration: %v", err)
	}
}
