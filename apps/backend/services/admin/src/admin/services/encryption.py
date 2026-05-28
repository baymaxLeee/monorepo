"""Symmetric encryption for at-rest secrets (LLM API keys).

We use Fernet (AES-128-CBC + HMAC-SHA256) which gives authenticated
encryption out of the box. The key is loaded once from
`Settings.admin_secret_key` and **must** be a 32-byte url-safe base64 string
(what `Fernet.generate_key()` returns). In non-production environments we
allow a dev fallback key so `just dev` works without manual setup.

Production guards are in `config.py`: `_enforce_production_safety` will
reject the dev fallback when `ENVIRONMENT=production`.
"""

from __future__ import annotations

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from kernel.errors import BaseError

from admin.config import get_settings


class ProviderKeyUndecryptableError(BaseError):
    status_code = 500
    code = "provider_key_undecryptable"


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    secret = get_settings().admin_secret_key.strip()
    try:
        return Fernet(secret.encode("utf-8"))
    except (ValueError, TypeError) as exc:
        raise RuntimeError(
            "ADMIN_SECRET_KEY must be a 32-byte url-safe base64 Fernet key; "
            "generate one with `python -c 'from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())'`"
        ) from exc


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        # Most likely cause: ADMIN_SECRET_KEY was rotated without re-encrypting
        # existing rows. Surface a clear actionable error.
        raise ProviderKeyUndecryptableError(
            "stored api_key is unreadable; ADMIN_SECRET_KEY may have rotated",
        ) from exc


def mask(plaintext: str) -> str:
    """Public-safe rendering of an API key: "sk-xxxx...xxxx" style."""

    if not plaintext:
        return ""
    if len(plaintext) <= 8:
        return "*" * len(plaintext)
    return f"{plaintext[:4]}{'*' * 4}{plaintext[-4:]}"
