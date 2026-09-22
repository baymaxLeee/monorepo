package observability

import (
	"context"
	"os"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func Configure(ctx context.Context, serviceName string) (func(context.Context) error, error) {
	endpoint := tracesEndpoint()
	if endpoint == "" {
		return func(context.Context) error { return nil }, nil
	}
	exporter, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpointURL(endpoint))
	if err != nil {
		return nil, err
	}
	res, err := resource.New(ctx, resource.WithAttributes(
		attribute.String("service.name", envOr("OTEL_SERVICE_NAME", serviceName)),
		attribute.String("deployment.environment.name", envOr("ENVIRONMENT", "development")),
	))
	if err != nil {
		return nil, err
	}
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.AlwaysSample())),
	)
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	return provider.Shutdown, nil
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func tracesEndpoint() string {
	raw := os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
	if raw != "" {
		return strings.TrimSpace(raw)
	}
	raw = os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if raw == "" {
		return ""
	}
	return strings.TrimRight(strings.TrimSpace(raw), "/") + "/v1/traces"
}
