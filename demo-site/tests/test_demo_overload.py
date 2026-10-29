"""Tests for the demo origin capacity limit, overload simulation, and recovery."""

from __future__ import annotations

import asyncio
import importlib.util
import os
from pathlib import Path
import sys
import pytest
import httpx

# Set required environment variables before importing app
os.environ["DEMO_MAX_CONCURRENCY"] = "3"
os.environ["DEMO_WORK_MS"] = "100"
os.environ["DEMO_QUEUE_TIMEOUT_MS"] = "80"
os.environ["ORIGIN_SHARED_SECRET"] = "test-origin-secret-0123456789"
os.environ["INSTANCE_NAME"] = "demo-test"

_demo_main = Path(__file__).resolve().parent.parent / "app" / "main.py"
_spec = importlib.util.spec_from_file_location("demo_site_main", _demo_main)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
sys.modules["demo_site_main"] = _mod
_spec.loader.exec_module(_mod)

app = _mod.app
MAX_CONCURRENCY = _mod.MAX_CONCURRENCY
WORK_MS = _mod.WORK_MS
QUEUE_TIMEOUT_MS = _mod.QUEUE_TIMEOUT_MS


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.asyncio
async def test_health_check_open_without_key():
    """Health check must be open without origin key and return 200 OK."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["instance"] == "demo-test"


@pytest.mark.asyncio
async def test_metrics_endpoint_open():
    """Metrics endpoint must be reachable and return Prometheus text format."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/metrics")
        assert res.status_code == 200
        assert "demo_requests_total" in res.text


@pytest.mark.asyncio
async def test_origin_key_enforcement():
    """Requests to application paths without valid X-Origin-Key must return 403 Forbidden."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        # No key header
        res = await client.get("/")
        assert res.status_code == 403
        assert "Direct access to the origin without proxy key is not allowed" in res.text

        # Invalid key header
        res = await client.get("/", headers={"x-origin-key": "wrong-secret-value"})
        assert res.status_code == 403


@pytest.mark.asyncio
async def test_normal_traffic_within_capacity():
    """Requests within capacity limit must return 200 OK."""
    headers = {"x-origin-key": "test-origin-secret-0123456789"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/", headers=headers)
        assert res.status_code == 200
        assert "Senior Secondary Examination Results" in res.text


@pytest.mark.asyncio
async def test_overload_simulation_and_recovery():
    """When concurrent requests exceed MAX_CONCURRENCY, excess requests must receive 503 Overload,

    and subsequent requests must recover immediately once inflight work finishes.
    """
    headers = {"x-origin-key": "test-origin-secret-0123456789"}

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        # Fire 8 concurrent requests when MAX_CONCURRENCY is 3 and QUEUE_TIMEOUT_MS is 80ms
        async def fetch_one(idx: int):
            try:
                r = await client.get(f"/?roll={1001 + idx}", headers=headers)
                return r.status_code, r.text, r.headers
            except Exception as e:
                return 0, str(e), {}

        tasks = [asyncio.create_task(fetch_one(i)) for i in range(8)]
        results = await asyncio.gather(*tasks)

        status_codes = [r[0] for r in results]
        # Some should succeed (200) and some should be rejected with 503 Service Overloaded
        assert 200 in status_codes, f"Expected 200 in results: {status_codes}"
        assert 503 in status_codes, f"Expected 503 in results: {status_codes}"
        assert set(status_codes) <= {200, 503}

        # Check headers and content on 503 responses
        overload_res = [r for r in results if r[0] == 503]
        for _, text, headers_dict in overload_res:
            assert "Service Overloaded" in text or "503" in text
            assert headers_dict.get("retry-after") == "5"
            assert headers_dict.get("x-served-by") == "demo-test"

        # RECOVERY TEST: Wait for active work to drain (WORK_MS is 100ms)
        await asyncio.sleep(0.2)

        # Immediate follow-up request must succeed with 200 OK
        recovered_res = await client.get("/", headers=headers)
        assert recovered_res.status_code == 200
        assert "Senior Secondary Examination Results" in recovered_res.text


@pytest.mark.asyncio
async def test_live_load_reports_accurate_state():
    """The /live-load endpoint must report current active slots and saturation."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/live-load")
        assert res.status_code == 200
        data = res.json()
        assert data["max"] == 3
        assert "active" in data
        assert "saturated" in data
