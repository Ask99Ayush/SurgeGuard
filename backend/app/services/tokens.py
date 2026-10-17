"""Admission tokens: HS256 JWTs with a ``kid`` header so keys can rotate."""

from __future__ import annotations

from dataclasses import dataclass

import jwt

from app.core.config import Settings

REQUIRED_CLAIMS = ["iss", "aud", "sub", "jti", "iat", "exp"]


class TokenError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class TokenClaims:
    sub: str
    jti: str
    iat: int
    exp: int


class TokenService:
    def __init__(self, settings: Settings) -> None:
        self.issuer = settings.token_issuer
        self.audience = settings.token_audience
        self.kid = settings.token_signing_kid
        self._keys = settings.signing_keys

    def mint(self, *, visitor_id: str, jti: str, issued_at_s: int, expires_at_s: int) -> str:
        """Deterministic for the same (visitor, jti, times): re-minting yields an equivalent token."""
        claims = {
            "iss": self.issuer,
            "aud": self.audience,
            "sub": visitor_id,
            "jti": jti,
            "iat": issued_at_s,
            "exp": expires_at_s,
        }
        return jwt.encode(claims, self._keys[self.kid], algorithm="HS256", headers={"kid": self.kid})

    def verify(self, token: str) -> TokenClaims:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise TokenError("malformed") from exc
        if header.get("alg") != "HS256":
            raise TokenError("bad_algorithm")
        key = self._keys.get(str(header.get("kid", "")))
        if key is None:
            raise TokenError("unknown_kid")
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=["HS256"],
                audience=self.audience,
                issuer=self.issuer,
                options={"require": REQUIRED_CLAIMS},
            )
        except jwt.ExpiredSignatureError as exc:
            raise TokenError("expired") from exc
        except jwt.InvalidSignatureError as exc:
            raise TokenError("bad_signature") from exc
        except jwt.InvalidIssuerError as exc:
            raise TokenError("bad_issuer") from exc
        except jwt.InvalidAudienceError as exc:
            raise TokenError("bad_audience") from exc
        except jwt.PyJWTError as exc:
            raise TokenError("invalid") from exc
        return TokenClaims(
            sub=str(claims["sub"]), jti=str(claims["jti"]), iat=int(claims["iat"]), exp=int(claims["exp"])
        )
