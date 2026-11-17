package observability

import "testing"

func TestTracesEndpoint(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", " https://collector.example/ ")
	if got := tracesEndpoint(); got != "https://collector.example/v1/traces" {
		t.Fatalf("tracesEndpoint() = %q", got)
	}
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", " https://traces.example/v1/traces ")
	if got := tracesEndpoint(); got != "https://traces.example/v1/traces" {
		t.Fatalf("explicit traces endpoint = %q", got)
	}
}

func TestEnvOrTrimsAndFallsBack(t *testing.T) {
	t.Setenv("TEST_SERVICE_NAME", "  ")
	if got := envOr("TEST_SERVICE_NAME", "fallback"); got != "fallback" {
		t.Fatalf("empty value = %q", got)
	}
	t.Setenv("TEST_SERVICE_NAME", " service ")
	if got := envOr("TEST_SERVICE_NAME", "fallback"); got != "service" {
		t.Fatalf("configured value = %q", got)
	}
}
