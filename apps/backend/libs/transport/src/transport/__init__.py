"""Cross-service transport.

Service-to-service calls go through clients defined here, NOT through direct
imports of other services' code.
"""

from .http_client import HTTPClient

__all__ = ["HTTPClient"]
