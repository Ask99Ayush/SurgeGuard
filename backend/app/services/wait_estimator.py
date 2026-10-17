"""Wait estimate from queue position and *measured* recent admission throughput."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

EstimateStatus = Literal["available", "insufficient_data", "paused"]


@dataclass(frozen=True)
class WaitEstimate:
    status: EstimateStatus
    seconds: int | None
    measured_rate_per_s: float | None


def estimate_wait(
    *, position: int, admissions_in_window: int, window_seconds: int, min_samples: int, paused: bool
) -> WaitEstimate:
    """``position`` is 1-based. No estimate is produced from configured rates, only measurements."""
    if paused:
        return WaitEstimate("paused", None, None)
    if admissions_in_window < min_samples:
        return WaitEstimate("insufficient_data", None, None)
    rate = admissions_in_window / window_seconds
    seconds = max(1, round(position / rate))
    return WaitEstimate("available", seconds, round(rate, 3))
