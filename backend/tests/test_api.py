"""HTTP API: visitor flow, internal auth (token enforcement), admin authorization."""

import time

import httpx
import jwt

from app.api.deps import ADMISSION_COOKIE, VISITOR_COOKIE
from app.core.config import Settings
from app.repositories.queue_repo import QueueRepository
from tests.conftest import admin_headers, proxy_headers


async def admit_all(repo: QueueRepository, n: int = 50) -> None:
    await repo.acquire_leader("test-lock", 5000)
    await repo.admit(
        lock_token="test-lock",
        rate=1000,
        burst=n,
        max_active=0,
        ttl_ms=120_000,
        jtis=[f"jti-{i}-{time.time_ns()}" for i in range(n)],
    )


async def admitted_client(client: httpx.AsyncClient, repo: QueueRepository) -> str:
    """Join, get admitted, poll status; returns the admission token."""
    assert (await client.post("/api/v1/queue/join")).status_code == 200
    await admit_all(repo)
    resp = await client.get("/api/v1/queue/status")
    assert resp.json()["state"] == "admitted"
    return client.cookies[ADMISSION_COOKIE]


async def test_join_sets_httponly_cookie_and_returns_position(client: httpx.AsyncClient) -> None:
    resp = await client.post("/api/v1/queue/join")
    assert resp.status_code == 200
    body = resp.json()
    assert body["state"] == "waiting" and body["position"] == 1 and body["queue_length"] == 1
    assert body["estimate_status"] == "insufficient_data" and body["estimated_wait_seconds"] is None
    set_cookie = resp.headers["set-cookie"].lower()
    assert "httponly" in set_cookie and "samesite=lax" in set_cookie and "secure" not in set_cookie


async def test_join_is_idempotent_per_cookie(client: httpx.AsyncClient) -> None:
    await client.post("/api/v1/queue/join")
    again = await client.post("/api/v1/queue/join")
    assert again.json()["position"] == 1 and again.json()["queue_length"] == 1


async def test_status_requires_visitor_cookie(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/v1/queue/status")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_in_queue"


async def test_forged_visitor_cookie_gets_new_identity(client: httpx.AsyncClient) -> None:
    client.cookies.set(VISITOR_COOKIE, "AAAAAAAAAAAAAAAAAAAAAA.forged")
    resp = await client.get("/api/v1/queue/status")
    assert resp.status_code == 404


async def test_admitted_visitor_gets_token_cookie(
    client: httpx.AsyncClient, repo: QueueRepository, settings: Settings
) -> None:
    token = await admitted_client(client, repo)
    claims = jwt.decode(token, options={"verify_signature": False})
    assert {"iss", "aud", "sub", "jti", "iat", "exp"} <= set(claims)
    assert claims["iss"] == settings.token_issuer
    # the same token is returned on later polls (reusable for its TTL, not per request)
    await client.get("/api/v1/queue/status")
    assert client.cookies[ADMISSION_COOKIE] == token


async def test_wait_estimate_uses_measured_throughput(client: httpx.AsyncClient, repo: QueueRepository) -> None:
    others = [httpx.AsyncClient(transport=client._transport, base_url="http://test") for _ in range(4)]
    for other in others:
        await other.post("/api/v1/queue/join")
    await repo.acquire_leader("L", 5000)
    await repo.admit(lock_token="L", rate=100, burst=3, max_active=0, ttl_ms=60_000, jtis=["a", "b", "c"])
    await client.post("/api/v1/queue/join")
    body = (await client.get("/api/v1/queue/status")).json()
    assert body["position"] == 2 and body["estimate_status"] == "available"
    assert body["estimated_wait_seconds"] == 40  # 3 admissions / 60 s window -> 0.05/s; position 2
    for other in others:
        await other.aclose()


async def test_join_rate_limit(settings: Settings, redis) -> None:  # type: ignore[no-untyped-def]
    from asgi_lifespan import LifespanManager

    from app.main import create_app
    from tests.conftest import make_settings

    limited = make_settings(redis_key_prefix=settings.redis_key_prefix, rate_limit_requests=3)
    app = create_app(limited, redis)
    async with LifespanManager(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            codes = [
                (await c.post("/api/v1/queue/join", headers={"X-Real-IP": "10.0.0.1"})).status_code for _ in range(5)
            ]
            other_ip = await c.post("/api/v1/queue/join", headers={"X-Real-IP": "10.0.0.2"})
    assert codes == [200, 200, 200, 429, 429]
    assert other_ip.status_code == 200


# ----------------------------------------------------------------------------- /internal/auth
async def test_internal_auth_requires_proxy_secret(client: httpx.AsyncClient, repo: QueueRepository) -> None:
    await admitted_client(client, repo)
    assert (await client.get("/internal/auth")).status_code == 403
    assert (await client.get("/internal/auth", headers={"X-SG-Proxy-Secret": "guess"})).status_code == 403


async def test_internal_auth_valid_token(client: httpx.AsyncClient, repo: QueueRepository, settings: Settings) -> None:
    await admitted_client(client, repo)
    resp = await client.get("/internal/auth", headers=proxy_headers(settings))
    assert resp.status_code == 204 and resp.headers["x-sg-visitor"]


async def test_internal_auth_rejects_missing_and_tampered(
    client: httpx.AsyncClient, repo: QueueRepository, settings: Settings
) -> None:
    assert (await client.get("/internal/auth", headers=proxy_headers(settings))).status_code == 401
    token = await admitted_client(client, repo)
    head, payload, sig = token.split(".")
    tampered = f"{head}.{payload}.{sig[:-2]}{'AA' if sig[-2:] != 'AA' else 'BB'}"
    client.cookies.set(ADMISSION_COOKIE, tampered)
    assert (await client.get("/internal/auth", headers=proxy_headers(settings))).status_code == 401


async def test_internal_auth_rejects_expired_token(
    client: httpx.AsyncClient, repo: QueueRepository, settings: Settings
) -> None:
    await admitted_client(client, repo)
    now = int(time.time())
    expired = jwt.encode(
        {
            "iss": settings.token_issuer,
            "aud": settings.token_audience,
            "sub": "x",
            "jti": "j",
            "iat": now - 100,
            "exp": now - 10,
        },
        settings.token_signing_secret.get_secret_value(),
        algorithm="HS256",
        headers={"kid": "k1"},
    )
    client.cookies.set(ADMISSION_COOKIE, expired)
    assert (await client.get("/internal/auth", headers=proxy_headers(settings))).status_code == 401


async def test_internal_auth_rejects_token_of_another_visitor(
    client: httpx.AsyncClient, repo: QueueRepository, settings: Settings
) -> None:
    token = await admitted_client(client, repo)
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as thief:
        await thief.post("/api/v1/queue/join")
        thief.cookies.set(ADMISSION_COOKIE, token)
        assert (await thief.get("/internal/auth", headers=proxy_headers(settings))).status_code == 401


async def test_revoked_token_rejected(client: httpx.AsyncClient, repo: QueueRepository, settings: Settings) -> None:
    token = await admitted_client(client, repo)
    sub = jwt.decode(token, options={"verify_signature": False})["sub"]
    resp = await client.post(
        f"/api/v1/admin/visitors/{sub}/reject", json={"reason": "abuse"}, headers=admin_headers(settings)
    )
    assert resp.status_code == 200 and resp.json()["token_revoked"] is True
    assert (await client.get("/internal/auth", headers=proxy_headers(settings))).status_code == 401


# ----------------------------------------------------------------------------- admin API
ADMIN_ROUTES = [
    ("GET", "/api/v1/admin/overview"),
    ("GET", "/api/v1/admin/visitors"),
    ("GET", "/api/v1/admin/backends"),
    ("GET", "/api/v1/admin/events"),
    ("GET", "/api/v1/admin/config"),
    ("GET", "/api/v1/admin/queue/pause"),
    ("POST", "/api/v1/admin/queue/pause"),
    ("POST", "/api/v1/admin/queue/resume"),
    ("POST", "/api/v1/admin/visitors/AAAAAAAAAAAAAAAAAAAAAA/reject"),
]


async def test_admin_routes_reject_missing_or_wrong_key(client: httpx.AsyncClient) -> None:
    for method, path in ADMIN_ROUTES:
        for headers in ({}, {"X-Admin-Key": "wrong"}, {"X-Admin-Key": ""}):
            resp = await client.request(method, path, headers=headers, json={})
            assert resp.status_code == 401, (method, path, headers)
            assert resp.json()["error"]["code"] == "unauthorized"


async def test_admin_overview_and_listing(client: httpx.AsyncClient, settings: Settings) -> None:
    for _ in range(3):
        async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as v:
            await v.post("/api/v1/queue/join")
    h = admin_headers(settings)
    overview = (await client.get("/api/v1/admin/overview", headers=h)).json()
    assert overview["queue"]["waiting"] == 3 and overview["redis"]["ok"] is True
    assert overview["worker"] == {"alive": False}  # no worker in this test: reported, not invented
    default = (await client.get("/api/v1/admin/visitors", headers=h)).json()
    assert default["state"] == "all" and default["total"] == 3
    page = (await client.get("/api/v1/admin/visitors?state=waiting&page=1&page_size=2", headers=h)).json()
    assert page["total"] == 3 and [i["position"] for i in page["items"]] == [1, 2]
    assert (await client.get("/api/v1/admin/visitors?state=bogus", headers=h)).status_code == 422


async def test_admin_pause_resume_and_events(client: httpx.AsyncClient, settings: Settings) -> None:
    h = admin_headers(settings)
    resp = await client.post("/api/v1/admin/queue/pause", json={"reason": "maintenance"}, headers=h)
    assert resp.json()["paused"] is True and resp.json()["reason"] == "maintenance"
    await client.post("/api/v1/queue/join")
    status = (await client.get("/api/v1/queue/status")).json()
    assert status["paused"] is True and status["estimate_status"] == "paused"
    assert (await client.post("/api/v1/admin/queue/resume", headers=h)).json()["paused"] is False
    kinds = [e["kind"] for e in (await client.get("/api/v1/admin/events", headers=h)).json()]
    assert kinds[:2] == ["admission_resumed", "admission_paused"]


async def test_admin_reject_invalid_transition(client: httpx.AsyncClient, settings: Settings) -> None:
    h = admin_headers(settings)
    resp = await client.post("/api/v1/admin/visitors/AAAAAAAAAAAAAAAAAAAAAA/reject", json={}, headers=h)
    assert resp.status_code == 404
    await client.post("/api/v1/queue/join")
    page = (await client.get("/api/v1/admin/visitors", headers=h)).json()
    vid = page["items"][0]["visitor_id"]
    assert (await client.post(f"/api/v1/admin/visitors/{vid}/reject", json={}, headers=h)).status_code == 200
    assert (await client.post(f"/api/v1/admin/visitors/{vid}/reject", json={}, headers=h)).status_code == 409


async def test_config_endpoint_returns_defaults(client: httpx.AsyncClient, settings: Settings) -> None:
    body = (await client.get("/api/v1/admin/config", headers=admin_headers(settings))).json()
    assert body["defaults"]["admission_burst"] == 10  # code default
    assert body["admission_burst"] == 5  # test override, so the console marks it as changed
    assert "admission_rate" not in body["defaults"]  # required: no default to compare against


async def test_config_endpoint_exposes_no_secrets(client: httpx.AsyncClient, settings: Settings) -> None:
    text = (await client.get("/api/v1/admin/config", headers=admin_headers(settings))).text
    for secret in (
        settings.token_signing_secret,
        settings.visitor_cookie_secret,
        settings.internal_auth_secret,
        settings.admin_api_key,
    ):
        assert secret.get_secret_value() not in text


async def test_health_endpoints(client: httpx.AsyncClient) -> None:
    assert (await client.get("/healthz")).json() == {"status": "ok"}
    assert (await client.get("/readyz")).status_code == 200
    metrics = await client.get("/metrics")
    assert metrics.status_code == 200 and "surgeguard_http_requests_total" in metrics.text
