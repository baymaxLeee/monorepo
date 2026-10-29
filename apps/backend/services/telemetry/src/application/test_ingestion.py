from typing import Any

import pytest

from application.ingestion import _float, _redact


def test_redaction_protects_nested_credentials_without_mutating_the_input() -> None:
    payload = {"name": "request", "headers": {"Authorization": "bearer-private"}, "items": [{"token": "private"}]}
    assert _redact(payload) == {
        "name": "request",
        "headers": {"Authorization": "[REDACTED]"},
        "items": [{"token": "[REDACTED]"}],
    }
    assert payload["headers"] == {"Authorization": "bearer-private"}


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf"), None, "invalid"])
def test_non_finite_or_invalid_metrics_are_normalized(value: Any) -> None:
    assert _float(value) == 0.0


def test_valid_metric_keeps_its_value() -> None:
    assert _float("12.5") == 12.5
