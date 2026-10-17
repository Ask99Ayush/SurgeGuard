"""Fixed-window rate limiter in Redis. Keyed by client IP, which is a rate signal, not identity."""

from __future__ import annotations

import time

from redis.asyncio import Redis


class RateLimiter:
    def __init__(self, redis: Redis, prefix: str, limit: int, window_seconds: int) -> None:
        self.redis = redis
        self.prefix = prefix
        self.limit = limit
        self.window = window_seconds

    async def hit(self, bucket: str, client: str) -> tuple[bool, int]:
        """Return (allowed, retry_after_seconds)."""
        now = int(time.time())
        window_id = now // self.window
        key = f"{self.prefix}:rl:{bucket}:{client}:{window_id}"
        pipe = self.redis.pipeline(transaction=True)
        pipe.incr(key)
        pipe.expire(key, self.window + 1)
        count, _ = await pipe.execute()
        if int(count) > self.limit:
            return False, self.window - (now % self.window)
        return True, 0
