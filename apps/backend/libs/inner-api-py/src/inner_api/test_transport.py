import pytest

from inner_api.transport import InnerApiCaller


def test_caller_injects_fixed_identity_and_deadline() -> None:
    options = InnerApiCaller("knowledge", "secret", 12.0).options({"TraceParent": "trace"})
    assert options == {
        "metadata": [
            ("traceparent", "trace"),
            ("x-caller-service", "knowledge"),
            ("x-internal-token", "secret"),
        ],
        "timeout": 12.0,
    }


@pytest.mark.parametrize("key", ["X-Caller-Service", "x-internal-token", "grpc-timeout"])
def test_caller_rejects_transport_metadata_override(key: str) -> None:
    with pytest.raises(ValueError, match="transport-owned"):
        InnerApiCaller("knowledge", "secret").options({key: "forged"})
