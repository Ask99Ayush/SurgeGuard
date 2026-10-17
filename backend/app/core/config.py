"""Validated runtime configuration. Every value comes from the environment; startup fails fast
on missing or unsafe values."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Annotated, Any, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

PLACEHOLDER = re.compile(r"<generated>|change[-_ ]?me", re.IGNORECASE)
KID_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,32}$")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    app_env: Literal["development", "test", "staging", "production"]
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    api_host: str = "0.0.0.0"  # noqa: S104 - container-internal bind address
    api_port: int = Field(8000, ge=1, le=65535)

    redis_url: str
    redis_password: SecretStr | None = None
    redis_key_prefix: str = Field("sg", pattern=r"^[A-Za-z0-9_-]{1,32}$")
    redis_socket_timeout_seconds: float = Field(1.0, gt=0, le=10)

    admission_rate: float = Field(gt=0, le=10_000)
    admission_burst: int = Field(10, ge=1, le=100_000)
    max_active_admitted: int = Field(0, ge=0)
    queue_max_size: int = Field(100_000, ge=1)
    queue_poll_interval_seconds: float = Field(gt=0, le=60)
    heartbeat_timeout_seconds: int = Field(ge=5, le=3600)
    rejoin_grace_seconds: int = Field(60, ge=0, le=3600)
    visitor_record_ttl_seconds: int = Field(86_400, ge=60)
    worker_tick_seconds: float = Field(0.5, gt=0, le=10)
    worker_lock_ttl_seconds: int = Field(5, ge=1, le=120)
    wait_estimate_window_seconds: int = Field(60, ge=5, le=3600)
    wait_estimate_min_samples: int = Field(5, ge=1)
    event_log_size: int = Field(200, ge=10, le=10_000)
    terminal_index_size: int = Field(10_000, ge=100)

    backend_urls: Annotated[list[str], NoDecode]
    backend_health_path: str = "/health"
    backend_health_interval_seconds: float = Field(2, gt=0, le=300)
    backend_health_timeout_seconds: float = Field(1, gt=0, le=30)
    backend_health_failure_threshold: int = Field(2, ge=1, le=20)
    backend_health_recovery_threshold: int = Field(2, ge=1, le=20)

    token_ttl_seconds: int = Field(ge=30, le=86_400)
    token_signing_secret: SecretStr
    token_signing_kid: str = "k1"  # noqa: S105 - key id, not a secret
    token_verify_keys: Annotated[dict[str, SecretStr], NoDecode] = Field(default_factory=dict)
    token_issuer: str = Field(min_length=1)
    token_audience: str = Field(min_length=1)
    visitor_cookie_secret: SecretStr
    cookie_secure: bool
    internal_auth_secret: SecretStr

    admin_api_key: SecretStr

    rate_limit_requests: int = Field(ge=1)
    rate_limit_window_seconds: int = Field(ge=1, le=3600)

    metrics_enabled: bool = True
    worker_metrics_port: int = Field(9100, ge=1, le=65535)

    @field_validator("backend_urls", mode="before")
    @classmethod
    def _split_urls(cls, value: object) -> object:
        if isinstance(value, str):
            value = [part.strip() for part in value.split(",") if part.strip()]
        if not isinstance(value, list) or not value:
            raise ValueError("BACKEND_URLS must list at least one backend")
        for url in value:
            if not re.match(r"^https?://[^\s/]+", str(url)):
                raise ValueError(f"invalid backend URL: {url!r}")
        return value

    @field_validator("token_verify_keys", mode="before")
    @classmethod
    def _parse_verify_keys(cls, value: object) -> object:
        if isinstance(value, dict):
            return value
        if not value:
            return {}
        parsed: dict[str, str] = {}
        for item in str(value).split(","):
            item = item.strip()
            if not item:
                continue
            kid, sep, secret = item.partition(":")
            if not sep or not KID_PATTERN.match(kid) or not secret:
                raise ValueError("TOKEN_VERIFY_KEYS must be kid:secret pairs separated by commas")
            parsed[kid] = secret
        return parsed

    @field_validator("token_signing_kid")
    @classmethod
    def _check_kid(cls, value: str) -> str:
        if not KID_PATTERN.match(value):
            raise ValueError("TOKEN_SIGNING_KID must match [A-Za-z0-9_.-]{1,32}")
        return value

    @model_validator(mode="after")
    def _check_secrets(self) -> Settings:
        min_len = 16 if self.app_env in ("development", "test") else 32
        secrets = {
            "TOKEN_SIGNING_SECRET": self.token_signing_secret,
            "VISITOR_COOKIE_SECRET": self.visitor_cookie_secret,
            "INTERNAL_AUTH_SECRET": self.internal_auth_secret,
            "ADMIN_API_KEY": self.admin_api_key,
            **{f"TOKEN_VERIFY_KEYS[{kid}]": s for kid, s in self.token_verify_keys.items()},
        }
        for name, secret in secrets.items():
            raw = secret.get_secret_value()
            if PLACEHOLDER.search(raw):
                raise ValueError(f"{name} still contains a placeholder; run scripts/setup.sh")
            if len(raw.encode()) < min_len:
                raise ValueError(f"{name} must be at least {min_len} bytes in {self.app_env}")
        if self.token_signing_kid in self.token_verify_keys:
            raise ValueError("TOKEN_VERIFY_KEYS must not repeat the active TOKEN_SIGNING_KID")
        if self.app_env == "production" and not self.cookie_secure:
            raise ValueError("COOKIE_SECURE must be true in production")
        if self.heartbeat_timeout_seconds <= self.queue_poll_interval_seconds * 2:
            raise ValueError("HEARTBEAT_TIMEOUT_SECONDS must exceed twice QUEUE_POLL_INTERVAL_SECONDS")
        return self

    def redis_kwargs(self) -> dict[str, Any]:
        return {
            "password": self.redis_password.get_secret_value() if self.redis_password else None,
            "socket_timeout": self.redis_socket_timeout_seconds,
            "socket_connect_timeout": self.redis_socket_timeout_seconds,
        }

    @classmethod
    def public_defaults(cls) -> dict[str, object]:
        """Code defaults for the keys in public_summary() (keys without a default are omitted)."""
        defaults: dict[str, object] = {}
        for name, field in cls.model_fields.items():
            if field.is_required() or field.default_factory is not None:
                continue
            defaults[name] = field.default
        return defaults

    @property
    def signing_keys(self) -> dict[str, str]:
        """All keys accepted for verification, keyed by kid (active key included)."""
        keys = {kid: s.get_secret_value() for kid, s in self.token_verify_keys.items()}
        keys[self.token_signing_kid] = self.token_signing_secret.get_secret_value()
        return keys

    def public_summary(self) -> dict[str, object]:
        """Non-secret configuration safe to show in the admin console."""
        return {
            "app_env": self.app_env,
            "admission_rate": self.admission_rate,
            "admission_burst": self.admission_burst,
            "max_active_admitted": self.max_active_admitted,
            "queue_max_size": self.queue_max_size,
            "queue_poll_interval_seconds": self.queue_poll_interval_seconds,
            "heartbeat_timeout_seconds": self.heartbeat_timeout_seconds,
            "rejoin_grace_seconds": self.rejoin_grace_seconds,
            "token_ttl_seconds": self.token_ttl_seconds,
            "token_issuer": self.token_issuer,
            "token_audience": self.token_audience,
            "token_signing_kid": self.token_signing_kid,
            "token_verify_kids": sorted(self.token_verify_keys),
            "cookie_secure": self.cookie_secure,
            "rate_limit_requests": self.rate_limit_requests,
            "rate_limit_window_seconds": self.rate_limit_window_seconds,
            "backend_count": len(self.backend_urls),
            "backend_health_interval_seconds": self.backend_health_interval_seconds,
            "backend_health_failure_threshold": self.backend_health_failure_threshold,
            "backend_health_recovery_threshold": self.backend_health_recovery_threshold,
            "wait_estimate_window_seconds": self.wait_estimate_window_seconds,
            "wait_estimate_min_samples": self.wait_estimate_min_samples,
            "metrics_enabled": self.metrics_enabled,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
