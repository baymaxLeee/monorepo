package bootstrap

import (
	"testing"
	"time"
)

func TestDeliveryConfiguration(t *testing.T) {
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("INTERNAL_SERVICE_TOKENS", "")
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
