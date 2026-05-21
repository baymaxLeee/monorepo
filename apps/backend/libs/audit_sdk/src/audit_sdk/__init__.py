"""Audit event publishing (stub).

Wrap successful mutations:

    audit_sdk.record(
        actor=identity,
        action="bot.publish",
        resource={"type": "bot", "id": bot.id},
    )

Failed paths must NOT call record().
"""

import logging
from typing import Any


def record(*, actor: Any, action: str, resource: dict[str, Any]) -> None:
    logging.getLogger("audit").info(
        "audit", extra={"actor": actor, "action": action, "resource": resource}
    )
