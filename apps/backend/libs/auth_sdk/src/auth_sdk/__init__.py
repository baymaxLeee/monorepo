"""Auth SDK: JWT verification, identity propagation (stubs)."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")


@dataclass(frozen=True, slots=True)
class Identity:
    user_id: str
    tenant_id: str
    roles: tuple[str, ...] = ()


def require_action(action: str) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Decorator placeholder. Real impl checks IAM."""

    def decorator(fn: Callable[P, R]) -> Callable[P, R]:
        return fn

    return decorator
