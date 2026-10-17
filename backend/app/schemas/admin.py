from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class PauseRequest(BaseModel):
    reason: str = Field("manual", min_length=1, max_length=200)


class RejectRequest(BaseModel):
    reason: str = Field("admin", min_length=1, max_length=200)


class VisitorRow(BaseModel):
    visitor_id: str
    state: str
    position: int | None
    seq: int | None
    joined_at_ms: int | None
    updated_at_ms: int | None
    admitted_at_ms: int | None
    token_expires_at_ms: int | None
    expired_reason: str | None
    reject_reason: str | None


class VisitorPage(BaseModel):
    state: Literal["all", "waiting", "admitted", "expired", "rejected"]
    total: int
    page: int
    page_size: int
    items: list[VisitorRow]


class PauseState(BaseModel):
    paused: bool
    reason: str | None = None
    actor: str | None = None
    since_ms: int | None = None


class EventItem(BaseModel):
    ts_ms: int
    kind: str
    level: str
    message: str
    data: dict[str, Any] = {}
