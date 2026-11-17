"""OpenTelemetry setup shared by Python services."""

from __future__ import annotations

import os
from urllib.parse import urljoin

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

_configured = False


def configure_opentelemetry(service_name: str) -> None:
    """Configure OTLP trace export when an endpoint is present."""

    global _configured
    if _configured:
        return

    traces_endpoint = _traces_endpoint()
    if not traces_endpoint:
        return

    provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": os.getenv("OTEL_SERVICE_NAME", service_name),
                "deployment.environment.name": os.getenv("ENVIRONMENT", "development"),
            }
        )
    )
    provider.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(endpoint=traces_endpoint),
            max_queue_size=512,
            max_export_batch_size=128,
            schedule_delay_millis=5000,
            export_timeout_millis=5000,
        )
    )
    trace.set_tracer_provider(provider)
    _configured = True


def _traces_endpoint() -> str:
    if endpoint := os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"):
        return endpoint
    base = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    if not base:
        return ""
    return urljoin(base.rstrip("/") + "/", "v1/traces")
