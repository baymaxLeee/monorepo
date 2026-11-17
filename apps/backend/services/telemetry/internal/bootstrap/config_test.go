package bootstrap

import "testing"

func TestLoadRejectsDevelopmentCredentialsOutsideDevelopment(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("POSTGRES_HOST", "postgres")
	t.Setenv("POSTGRES_PASSWORD", "telemetry")
	if _, err := Load(); err == nil {
		t.Fatal("insecure production password was accepted")
	}
}

func TestLoadPreservesSamplingValues(t *testing.T) {
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("SAMPLE_RATE_PERFORM", "0.25")
	t.Setenv("SAMPLE_RATE_EVENT", "0.75")
	config, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if config.SampleRatePerform != 0.25 || config.SampleRateEvent != 0.75 {
		t.Fatalf("unexpected sampling config: %#v", config)
	}
}
