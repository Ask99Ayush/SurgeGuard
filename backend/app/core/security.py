"""Opaque visitor identity (signed cookie) and constant-time comparisons."""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets

VISITOR_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{22}$")


def constant_time_equals(provided: str | None, expected: str) -> bool:
    if provided is None:
        return False
    return hmac.compare_digest(provided.encode(), expected.encode())


def new_visitor_id() -> str:
    """128 bits of randomness, URL-safe, fixed length (22 chars)."""
    return secrets.token_urlsafe(16)


def _mac(visitor_id: str, secret: str) -> str:
    digest = hmac.new(secret.encode(), f"visitor:{visitor_id}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def sign_visitor_id(visitor_id: str, secret: str) -> str:
    return f"{visitor_id}.{_mac(visitor_id, secret)}"


def verify_visitor_cookie(value: str | None, secret: str) -> str | None:
    """Return the visitor id if the cookie is well formed and correctly signed, else None."""
    if not value or len(value) > 128:
        return None
    visitor_id, sep, mac = value.partition(".")
    if not sep or not VISITOR_ID_PATTERN.match(visitor_id):
        return None
    if not hmac.compare_digest(mac.encode(), _mac(visitor_id, secret).encode()):
        return None
    return visitor_id
