from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


class QueueStatus(BaseModel):
    """What the waiting room shows. Every field is derived from server state; nothing is guessed."""

    state: Literal["waiting", "admitted", "expired", "rejected"]
    position: int | None = Field(None, description="1-based place in line while waiting")
    queue_length: int | None = Field(None, description="Visitors currently waiting")
    estimated_wait_seconds: int | None = Field(
        None, description="Approximate, from measured admission throughput; null when unavailable"
    )
    estimate_status: Literal["available", "insufficient_data", "paused", "not_applicable"]
    measured_admission_rate: float | None = Field(None, description="Admissions/s over the estimate window")
    paused: bool = False
    poll_after_seconds: float
    admitted_until: int | None = Field(None, description="Unix seconds when the admission token expires")
    redirect_to: str | None = None


ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ErrorResponse, "description": "Visitor not in queue"},
    429: {"model": ErrorResponse, "description": "Rate limited"},
    503: {"model": ErrorResponse, "description": "Queue full or dependency unavailable (fail closed)"},
}
