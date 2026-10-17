"""Recent operational events (pause/resume, backend down/up, leader changes) in a capped list."""

from __future__ import annotations

import json
import logging
from typing import Any

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.repositories.queue_repo import now_ms

log = logging.getLogger(__name__)


class EventLog:
    def __init__(self, redis: Redis, prefix: str, size: int) -> None:
        self.redis = redis
        self.key = f"{prefix}:events"
        self.size = size

    async def record(self, kind: str, message: str, level: str = "info", **data: Any) -> None:
        event = {"ts_ms": now_ms(), "kind": kind, "level": level, "message": message, "data": data}
        log.info("event", extra={"event_kind": kind, "event_message": message})
        try:
            pipe = self.redis.pipeline(transaction=True)
            pipe.lpush(self.key, json.dumps(event))
            pipe.ltrim(self.key, 0, self.size - 1)
            await pipe.execute()
        except RedisError:
            log.warning("could not persist event", extra={"event_kind": kind})

    async def recent(self, limit: int) -> list[dict[str, Any]]:
        rows = await self.redis.lrange(self.key, 0, limit - 1)  # type: ignore[misc]
        return [json.loads(raw) for raw in rows]
