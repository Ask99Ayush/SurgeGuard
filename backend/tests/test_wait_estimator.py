from app.services.wait_estimator import estimate_wait


def test_insufficient_data_gives_no_number() -> None:
    est = estimate_wait(position=10, admissions_in_window=2, window_seconds=60, min_samples=5, paused=False)
    assert est.status == "insufficient_data" and est.seconds is None


def test_paused_gives_no_number() -> None:
    est = estimate_wait(position=10, admissions_in_window=600, window_seconds=60, min_samples=5, paused=True)
    assert est.status == "paused" and est.seconds is None


def test_estimate_from_measured_rate() -> None:
    est = estimate_wait(position=100, admissions_in_window=600, window_seconds=60, min_samples=5, paused=False)
    assert est.status == "available" and est.seconds == 10 and est.measured_rate_per_s == 10


def test_estimate_never_zero() -> None:
    est = estimate_wait(position=1, admissions_in_window=6000, window_seconds=60, min_samples=5, paused=False)
    assert est.seconds == 1
