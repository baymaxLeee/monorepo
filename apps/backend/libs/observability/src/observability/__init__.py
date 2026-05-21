"""Observability: OpenTelemetry setup (stub)."""

import logging


def setup(service_name: str) -> None:
    """Initialize OTel exporters for the given service. Stub for now."""
    logging.getLogger(service_name).info("observability initialized (stub)")
