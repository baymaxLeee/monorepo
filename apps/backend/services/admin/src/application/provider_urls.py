"""Validation for administrator-configured provider endpoints."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

from kernel.errors import RequestError


def _assert_public_address(value: str) -> None:
    try:
        address = ipaddress.ip_address(value)
    except ValueError as exc:
        raise RequestError("provider base_url resolved to an invalid IP address") from exc
    if not address.is_global:
        raise RequestError("provider base_url must not resolve to a private or reserved address")


async def validate_provider_base_url(value: str) -> str:
    """Require a public HTTP(S) endpoint and resolve DNS before any request."""

    normalized = value.strip().rstrip("/")
    parsed = urlsplit(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise RequestError("provider base_url must be an absolute HTTP(S) URL")
    if parsed.username or parsed.password:
        raise RequestError("provider base_url must not contain credentials")

    hostname = parsed.hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith((".localhost", ".local", ".internal")):
        raise RequestError("provider base_url must use a public host")

    try:
        _assert_public_address(hostname)
        return normalized
    except RequestError:
        try:
            ipaddress.ip_address(hostname)
        except ValueError:
            pass
        else:
            raise

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        records = await asyncio.to_thread(
            socket.getaddrinfo,
            hostname,
            port,
            type=socket.SOCK_STREAM,
        )
    except (OSError, UnicodeError, ValueError) as exc:
        raise RequestError("provider base_url host could not be resolved") from exc
    if not records:
        raise RequestError("provider base_url host could not be resolved")
    for record in records:
        _assert_public_address(str(record[4][0]))
    return normalized
