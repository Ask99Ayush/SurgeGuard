"""Proxy and security-boundary tests against the running Compose stack.

Run with `make test-proxy` (container on the edge, app and origin networks). Fail-closed tests that
need to stop containers live in scripts/fail-closed-check.sh.
"""

from __future__ import annotations

import asyncio
import os
import time

import httpx
import jwt
import pytest

PROTECTED = os.environ.get("PROTECTED_URL", "http://nginx:8080")
DIRECT = os.environ.get("DIRECT_URL", "http://nginx:8081")
API = os.environ.get("API_URL", "http://api:8000")
ORIGINS = os.environ.get("ORIGIN_URLS", "http://demo-1:8000,http://demo-2:8000").split(",")
ADMIN_KEY = os.environ["ADMIN_API_KEY"]
SIGNING_SECRET = os.environ["TOKEN_SIGNING_SECRET"]
KID = os.environ.get("TOKEN_SIGNING_KID", "k1")
ISSUER = os.environ["TOKEN_ISSUER"]
AUDIENCE = os.environ["TOKEN_AUDIENCE"]
JOIN_BURST = int(os.environ.get("PROXY_JOIN_RATE_LIMIT_BURST", "300"))
JOIN_RPS = int(os.environ.get("PROXY_JOIN_RATE_LIMIT_RPS", "50"))


def client() -> httpx.Client:
    return httpx.Client(base_url=PROTECTED, follow_redirects=False, timeout=10)


def admitted_client(max_wait: float = 60) -> httpx.Client:
    c = client()
    status = c.post("/api/v1/queue/join").json()
    deadline = time.time() + max_wait
    while status["state"] == "waiting" and time.time() < deadline:
        time.sleep(0.5)
        status = c.get("/api/v1/queue/status").json()
    assert status["state"] == "admitted", f"not admitted within {max_wait}s: {status}"
    assert "sg_admission" in c.cookies
    return c


def forge(sub: str, *, secret: str = SIGNING_SECRET, exp_in: int = 60, kid: str = KID, aud: str = AUDIENCE) -> str:
    now = int(time.time())
    claims = {"iss": ISSUER, "aud": aud, "sub": sub, "jti": f"forged-{now}", "iat": now - 1, "exp": now + exp_in}
    return jwt.encode(claims, secret, algorithm="HS256", headers={"kid": kid})


def visitor_id(c: httpx.Client) -> str:
    return c.cookies["sg_vid"].split(".")[0]


# ---------------------------------------------------------------------------- token enforcement
def test_unadmitted_visitor_is_sent_to_waiting_room() -> None:
    r = client().get("/")
    assert r.status_code == 302
    assert r.headers["location"].endswith("/waiting-room")
    assert "no-store" in r.headers.get("cache-control", "")


def test_post_without_token_never_reaches_origin() -> None:
    r = client().post("/results", data={"roll": "12345678"})
    assert r.status_code == 302 and "x-served-by" not in r.headers


def test_waiting_room_page_is_served() -> None:
    r = client().get("/waiting-room")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]


def test_admitted_visitor_reaches_origin_and_token_is_reusable() -> None:
    c = admitted_client()
    for _ in range(3):  # reusable for its TTL, not consumed per request
        r = c.get("/")
        assert r.status_code == 200
        assert r.headers["x-served-by"].startswith("demo-")
    form = c.post("/results", data={"roll": "20261234"})
    assert form.status_code == 200 and "Result for roll" in form.text


def test_garbage_and_forged_tokens_are_rejected() -> None:
    c = client()
    c.post("/api/v1/queue/join")
    vid = visitor_id(c)
    for token in (
        "garbage",
        forge(vid, secret="not-the-real-secret-0123456789abcdef"),  # bad signature
        forge(vid, exp_in=-30),  # expired
        forge(vid, aud="another-site"),  # wrong audience
        forge(vid, kid="unknown"),  # unknown key id
        jwt.encode({"sub": vid}, key=None, algorithm="none"),  # alg=none
    ):
        c.cookies.set("sg_admission", token)
        r = c.get("/")
        assert r.status_code == 302, token[:20]
        assert "x-served-by" not in r.headers


def test_tampered_token_is_rejected() -> None:
    c = admitted_client()
    token = c.cookies["sg_admission"]
    head, payload, sig = token.split(".")
    c.cookies.set("sg_admission", f"{head}.{payload}.{sig[::-1]}")
    assert c.get("/").status_code == 302


def test_token_cannot_be_used_by_another_visitor() -> None:
    owner = admitted_client()
    thief = client()
    thief.post("/api/v1/queue/join")
    thief.cookies.set("sg_admission", owner.cookies["sg_admission"])
    assert thief.get("/").status_code == 302


def test_revoked_token_is_rejected() -> None:
    c = admitted_client()
    assert c.get("/").status_code == 200
    vid = visitor_id(c)
    r = httpx.post(f"{API}/api/v1/admin/visitors/{vid}/reject", json={"reason": "test"}, headers={"X-Admin-Key": ADMIN_KEY})
    assert r.status_code == 200 and r.json()["token_revoked"]
    assert c.get("/").status_code == 302


def test_client_supplied_internal_headers_do_not_bypass_auth() -> None:
    spoofed = {
        "X-SG-Proxy-Secret": "anything",
        "X-Origin-Key": "anything",
        "X-SG-Visitor": "AAAAAAAAAAAAAAAAAAAAAA",
        "X-Original-URI": "/waiting-room",
        "X-Admin-Key": ADMIN_KEY,
        "X-Forwarded-For": "127.0.0.1",
        "X-Real-IP": "127.0.0.1",
    }
    r = client().get("/", headers=spoofed)
    assert r.status_code == 302


# ---------------------------------------------------------------------------- isolation
@pytest.mark.parametrize("path", ["/internal/auth", "/_sg_auth", "/api/v1/admin/overview", "/metrics"])
def test_internal_and_admin_paths_are_not_public(path: str) -> None:
    r = client().get(path, headers={"X-Admin-Key": ADMIN_KEY})
    assert r.status_code == 404


def test_internal_auth_rejects_callers_without_proxy_secret() -> None:
    assert httpx.get(f"{API}/internal/auth").status_code == 403


@pytest.mark.parametrize("origin", ORIGINS)
def test_direct_origin_access_is_blocked(origin: str) -> None:
    r = httpx.get(f"{origin}/")
    assert r.status_code == 403
    assert httpx.get(f"{origin}/", headers={"X-Origin-Key": "guess"}).status_code == 403
    assert httpx.get(f"{origin}/health").status_code == 200  # only health/metrics are open


def test_admin_api_requires_key_inside_network() -> None:
    assert httpx.get(f"{API}/api/v1/admin/overview").status_code == 401
    assert httpx.get(f"{API}/api/v1/admin/overview", headers={"X-Admin-Key": "wrong"}).status_code == 401
    assert httpx.get(f"{API}/api/v1/admin/overview", headers={"X-Admin-Key": ADMIN_KEY}).status_code == 200


# ---------------------------------------------------------------------------- caching
def test_public_static_content_is_cached_without_cookies() -> None:
    c = client()
    c.get("/static/site.css")
    r = c.get("/static/site.css", headers={"Cookie": "sg_vid=abc; sg_admission=xyz"})
    assert r.status_code == 200
    assert r.headers.get("x-cache-status") == "HIT"
    assert "set-cookie" not in r.headers


def test_dynamic_admitted_responses_are_never_cached() -> None:
    c = admitted_client()
    for _ in range(3):
        r = c.get("/")
        assert r.status_code == 200
        assert r.headers.get("x-cache-status") in (None, "")
        assert "no-store" in r.headers.get("cache-control", "")


def test_queue_api_is_not_cacheable() -> None:
    r = client().post("/api/v1/queue/join")
    assert "no-store" in r.headers.get("cache-control", "")


# ---------------------------------------------------------------------------- rate limiting
def test_per_client_join_rate_limit_returns_429() -> None:
    total = JOIN_BURST + JOIN_RPS * 10

    async def run() -> list[int]:
        async with httpx.AsyncClient(base_url=PROTECTED, limits=httpx.Limits(max_connections=100), timeout=20) as ac:
            sem = asyncio.Semaphore(100)

            async def one() -> int:
                async with sem:
                    # Nginx counts every join attempt per client IP, cookie or not.
                    return (await ac.post("/api/v1/queue/join")).status_code

            return await asyncio.gather(*(one() for _ in range(total)))

    codes = asyncio.run(run())
    assert 429 in codes, "expected some joins to be rate limited"
    assert codes.count(200) >= JOIN_BURST // 2
    assert set(codes) <= {200, 429}
    time.sleep(JOIN_BURST / JOIN_RPS + 1)  # let the bucket refill so later runs are unaffected


# ---------------------------------------------------------------------------- unprotected path
def test_unprotected_path_reaches_origin_directly() -> None:
    r = httpx.get(f"{DIRECT}/")
    assert r.status_code in (200, 503)  # 503 only if the fragile origin is saturated
    assert r.headers.get("x-served-by", "").startswith("demo-")
