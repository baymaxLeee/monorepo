"""Auth SDK: JWT verification, identity propagation (stubs)."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Identity:
    user_id: str
    tenant_id: str
    roles: tuple[str, ...] = ()


def require_action(action: str):
    """Decorator placeholder. Real impl checks IAM."""

    def decorator(fn):
        return fn

    return decorator
