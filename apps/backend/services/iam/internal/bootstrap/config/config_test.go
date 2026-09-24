package config

import (
	"strings"
	"testing"
)

func setDeployedDatabase(t *testing.T) {
	t.Helper()
	t.Setenv("ENVIRONMENT", EnvSingleVPS)
	t.Setenv("POSTGRES_HOST", "postgres")
	t.Setenv("POSTGRES_PASSWORD", "test-iam-postgres-password")
}

func TestLoadSeedDoesNotRequireServerSecrets(t *testing.T) {
	setDeployedDatabase(t)
	t.Setenv("ACCESS_TOKEN_SECRET", "")
	t.Setenv("SUPER_ADMIN_ACCOUNT", "admin")
	t.Setenv("SUPER_ADMIN_EMAIL", "admin@example.com")
	t.Setenv("SUPER_ADMIN_PASSWORD", "strong-admin-password")

	if _, err := LoadSeed(); err != nil {
		t.Fatalf("LoadSeed() error = %v", err)
	}
}

func TestLoadServerDoesNotRequireBootstrapSecrets(t *testing.T) {
	setDeployedDatabase(t)
	t.Setenv("ACCESS_TOKEN_SECRET", strings.Repeat("a", 32))
	t.Setenv("SUPER_ADMIN_ACCOUNT", "")
	t.Setenv("SUPER_ADMIN_EMAIL", "")
	t.Setenv("SUPER_ADMIN_PASSWORD", "")

	if _, err := LoadServer(); err != nil {
		t.Fatalf("LoadServer() error = %v", err)
	}
}

func TestLoadSeedRequiresBootstrapCredentialsOutsideDevelopment(t *testing.T) {
	setDeployedDatabase(t)
	t.Setenv("SUPER_ADMIN_ACCOUNT", "admin")
	t.Setenv("SUPER_ADMIN_EMAIL", "admin@example.com")
	t.Setenv("SUPER_ADMIN_PASSWORD", "")

	_, err := LoadSeed()
	if err == nil || !strings.Contains(err.Error(), "SUPER_ADMIN_ACCOUNT/EMAIL/PASSWORD") {
		t.Fatalf("LoadSeed() error = %v, want missing bootstrap credentials", err)
	}
}

func TestLoadServerRequiresAccessTokenSecretOutsideDevelopment(t *testing.T) {
	setDeployedDatabase(t)
	t.Setenv("ACCESS_TOKEN_SECRET", "")

	_, err := LoadServer()
	if err == nil || !strings.Contains(err.Error(), "ACCESS_TOKEN_SECRET") {
		t.Fatalf("LoadServer() error = %v, want missing access token secret", err)
	}
}
