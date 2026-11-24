package bootstrap

import (
	"strings"
	"testing"
)

func TestLoadConfigRequiresStrongWorkloadCredentialOutsideDevelopment(t *testing.T) {
	t.Setenv("ENVIRONMENT", "single-vps")
	t.Setenv("INTERNAL_API_TOKEN", "dev-chat-internal-token")
	if _, err := LoadConfig(); err == nil || !strings.Contains(err.Error(), "INTERNAL_API_TOKEN") {
		t.Fatalf("LoadConfig() error = %v, want workload credential rejection", err)
	}

	t.Setenv("INTERNAL_API_TOKEN", "strong-chat-internal-token-value-123")
	config, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if config.Environment != "single-vps" {
		t.Fatalf("environment = %q", config.Environment)
	}
}
