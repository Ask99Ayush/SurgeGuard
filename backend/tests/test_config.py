import pytest
from pydantic import ValidationError

from app.core.config import Settings
from tests.conftest import make_settings


def test_valid_settings_parse_lists_and_keys() -> None:
    s = make_settings(token_verify_keys="k0:old-secret-0123456789abcdef0123")
    assert s.backend_urls == ["http://demo-1:8000", "http://demo-2:8000"]
    assert set(s.signing_keys) == {"k0", "k1"}


def test_missing_required_value_fails_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in list(__import__("os").environ):
        if key.startswith(("TOKEN_", "REDIS_", "ADMIN_", "BACKEND_")):
            monkeypatch.delenv(key, raising=False)
    with pytest.raises(ValidationError):
        Settings()  # type: ignore[call-arg]


def test_short_secret_rejected_outside_development() -> None:
    with pytest.raises(ValidationError, match="at least 32 bytes"):
        make_settings(app_env="staging", token_signing_secret="x" * 20)


def test_short_secret_rejected_even_in_development() -> None:
    with pytest.raises(ValidationError, match="at least 16 bytes"):
        make_settings(app_env="development", token_signing_secret="short")


def test_placeholder_secret_rejected() -> None:
    with pytest.raises(ValidationError, match="placeholder"):
        make_settings(admin_api_key="<generated>-padding-padding-padding")


def test_production_requires_secure_cookies() -> None:
    with pytest.raises(ValidationError, match="COOKIE_SECURE"):
        make_settings(
            app_env="production",
            cookie_secure=False,
            **{
                k: "p" * 40
                for k in ("token_signing_secret", "visitor_cookie_secret", "internal_auth_secret", "admin_api_key")
            },
        )


def test_invalid_backend_url_rejected() -> None:
    with pytest.raises(ValidationError, match="invalid backend URL"):
        make_settings(backend_urls="demo-1:8000")


def test_heartbeat_must_exceed_poll_interval() -> None:
    with pytest.raises(ValidationError, match="HEARTBEAT_TIMEOUT_SECONDS"):
        make_settings(heartbeat_timeout_seconds=5, queue_poll_interval_seconds=3)


def test_public_summary_has_no_secrets() -> None:
    s = make_settings()
    text = repr(s.public_summary())
    for secret in (s.token_signing_secret, s.visitor_cookie_secret, s.internal_auth_secret, s.admin_api_key):
        assert secret.get_secret_value() not in text
