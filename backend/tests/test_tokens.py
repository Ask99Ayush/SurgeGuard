import time

import jwt
import pytest

from app.core.security import new_visitor_id, sign_visitor_id, verify_visitor_cookie
from app.services.tokens import TokenError, TokenService
from tests.conftest import make_settings


def _mint(service: TokenService, *, exp_in: int = 60, sub: str = "visitor") -> str:
    now = int(time.time())
    return service.mint(visitor_id=sub, jti="jti-1", issued_at_s=now, expires_at_s=now + exp_in)


def test_valid_token_roundtrip() -> None:
    service = TokenService(make_settings())
    claims = service.verify(_mint(service))
    assert claims.sub == "visitor" and claims.jti == "jti-1"
    assert jwt.get_unverified_header(_mint(service))["kid"] == "k1"


def test_expired_token_rejected() -> None:
    service = TokenService(make_settings())
    with pytest.raises(TokenError, match="expired"):
        service.verify(_mint(service, exp_in=-5))


def test_tampered_payload_rejected() -> None:
    service = TokenService(make_settings())
    header, payload, sig = _mint(service).split(".")
    forged_payload = jwt.utils.base64url_encode(b'{"sub":"attacker"}').decode()
    with pytest.raises(TokenError, match="bad_signature"):
        service.verify(f"{header}.{forged_payload}.{sig}")


def test_wrong_secret_rejected() -> None:
    other = TokenService(make_settings(token_signing_secret="another-secret-0123456789abcdef0123"))
    with pytest.raises(TokenError, match="bad_signature"):
        TokenService(make_settings()).verify(_mint(other))


def test_wrong_issuer_and_audience_rejected() -> None:
    service = TokenService(make_settings())
    with pytest.raises(TokenError, match="bad_issuer"):
        service.verify(_mint(TokenService(make_settings(token_issuer="evil"))))
    with pytest.raises(TokenError, match="bad_audience"):
        service.verify(_mint(TokenService(make_settings(token_audience="other-site"))))


def test_alg_none_and_garbage_rejected() -> None:
    service = TokenService(make_settings())
    unsigned = jwt.encode({"sub": "x"}, key=None, algorithm="none", headers={"kid": "k1"})
    with pytest.raises(TokenError, match="bad_algorithm"):
        service.verify(unsigned)
    with pytest.raises(TokenError, match="malformed"):
        service.verify("not-a-jwt")


def test_missing_claim_rejected() -> None:
    settings = make_settings()
    token = jwt.encode(
        {"iss": settings.token_issuer, "aud": settings.token_audience, "sub": "v", "exp": int(time.time()) + 60},
        settings.token_signing_secret.get_secret_value(),
        algorithm="HS256",
        headers={"kid": "k1"},
    )
    with pytest.raises(TokenError, match="invalid"):
        TokenService(settings).verify(token)


def test_key_rotation() -> None:
    old = make_settings(token_signing_kid="k0", token_signing_secret="old-secret-0123456789abcdef0123")
    old_token = _mint(TokenService(old))
    rotated = make_settings(token_signing_kid="k1", token_verify_keys="k0:old-secret-0123456789abcdef0123")
    assert TokenService(rotated).verify(old_token).sub == "visitor"  # retired key still verifies
    assert jwt.get_unverified_header(_mint(TokenService(rotated)))["kid"] == "k1"  # new tokens use new key
    retired = make_settings(token_signing_kid="k1")
    with pytest.raises(TokenError, match="unknown_kid"):
        TokenService(retired).verify(old_token)


def test_visitor_cookie_sign_verify_and_tamper() -> None:
    secret = "cookie-secret-0123456789abcdef"
    vid = new_visitor_id()
    cookie = sign_visitor_id(vid, secret)
    assert verify_visitor_cookie(cookie, secret) == vid
    assert verify_visitor_cookie(cookie, "another-secret-0123456789") is None
    other = new_visitor_id()
    assert verify_visitor_cookie(f"{other}.{cookie.split('.')[1]}", secret) is None
    assert verify_visitor_cookie("garbage", secret) is None
    assert verify_visitor_cookie(None, secret) is None
