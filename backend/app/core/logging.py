"""Structured JSON logging with redaction of anything that looks like a credential."""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import UTC, datetime

SENSITIVE_KEYS = re.compile(r"secret|password|token|cookie|authorization|api[_-]?key", re.IGNORECASE)
JWT_PATTERN = re.compile(r"eyJ[\w-]+\.[\w-]+\.[\w-]+")
_RESERVED = set(vars(logging.makeLogRecord({}))) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def __init__(self, service: str) -> None:
        super().__init__()
        self.service = service

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "service": self.service,
            "logger": record.name,
            "msg": JWT_PATTERN.sub("[jwt-redacted]", record.getMessage()),
        }
        for key, value in vars(record).items():
            if key in _RESERVED or key.startswith("_"):
                continue
            payload[key] = "[redacted]" if SENSITIVE_KEYS.search(key) else value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str, service: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter(service))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # Uvicorn access logs would duplicate our request log line and may include query strings.
    logging.getLogger("uvicorn.access").disabled = True
    for name in ("uvicorn", "uvicorn.error", "httpx"):
        logging.getLogger(name).handlers = []
        logging.getLogger(name).propagate = True
    logging.getLogger("httpx").setLevel("WARNING")
