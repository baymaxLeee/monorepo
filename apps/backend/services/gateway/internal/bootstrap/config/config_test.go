package config

import (
	"os"
	"testing"
	"time"
)

func TestLoadUsesUnifiedSixtySecondDefaultTimeout(t *testing.T) {
	value, existed := os.LookupEnv("HTTP_DEFAULT_TIMEOUT")
	if err := os.Unsetenv("HTTP_DEFAULT_TIMEOUT"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if existed {
			_ = os.Setenv("HTTP_DEFAULT_TIMEOUT", value)
		} else {
			_ = os.Unsetenv("HTTP_DEFAULT_TIMEOUT")
		}
	})
	t.Chdir(t.TempDir())
	t.Setenv("ENVIRONMENT", EnvDevelopment)
	t.Setenv("HTTP_READ_TIMEOUT", "1ns")
	t.Setenv("HTTP_WRITE_TIMEOUT", "1ns")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DefaultTimeout != 60*time.Second {
		t.Fatalf("default timeout = %s, want 60s", cfg.DefaultTimeout)
	}
}

func TestLoadRejectsNonPositiveDefaultTimeout(t *testing.T) {
	t.Chdir(t.TempDir())
	t.Setenv("ENVIRONMENT", EnvDevelopment)
	t.Setenv("HTTP_DEFAULT_TIMEOUT", "0s")

	if _, err := Load(); err == nil {
		t.Fatal("expected non-positive default timeout to be rejected")
	}
}
