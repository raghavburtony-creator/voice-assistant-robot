from __future__ import annotations

import pytest

from app.voice.perception import PerceptionGateway, PerceptionRejected


def jpeg() -> bytes:
    return b"\xff\xd8\xff" + b"x" * 20


def test_frame_requires_explicit_consent() -> None:
    gateway = PerceptionGateway()
    with pytest.raises(PerceptionRejected):
        gateway.ingest_frame("screen", jpeg(), timestamp=1.0)


def test_camera_and_screen_are_provider_independent() -> None:
    gateway = PerceptionGateway()
    gateway.set_consent("camera", True)
    gateway.set_consent("screen", True)

    camera = gateway.ingest_frame("camera", jpeg(), timestamp=1.0)
    screen = gateway.ingest_frame("screen", jpeg(), timestamp=1.0)

    assert camera.source == "camera"
    assert screen.source == "screen"
    assert camera.kind == screen.kind == "frame"
    assert camera.consent == screen.consent == "granted"


def test_rate_limit_is_per_source() -> None:
    gateway = PerceptionGateway()
    gateway.set_consent("camera", True)
    gateway.set_consent("screen", True)

    gateway.ingest_frame("camera", jpeg(), timestamp=1.0)
    with pytest.raises(PerceptionRejected):
        gateway.ingest_frame("camera", jpeg(), timestamp=1.5)

    gateway.ingest_frame("screen", jpeg(), timestamp=1.5)


def test_revoking_consent_removes_latest_observation() -> None:
    gateway = PerceptionGateway()
    gateway.set_consent("screen", True)
    gateway.ingest_frame("screen", jpeg(), timestamp=1.0)

    gateway.set_consent("screen", False)

    assert gateway.latest("screen") is None
    assert gateway.summary() == []


def test_summary_never_contains_frame_bytes() -> None:
    gateway = PerceptionGateway()
    gateway.set_consent("camera", True)
    gateway.ingest_frame("camera", jpeg(), timestamp=1.0)

    summary = gateway.summary()

    assert summary[0]["source"] == "camera"
    assert "data" not in summary[0]


def test_context_is_timestamped_and_consent_checked() -> None:
    gateway = PerceptionGateway()
    gateway.set_consent("browser", True)
    observation = gateway.ingest_context("browser", {"page": "home"}, timestamp=5.0)

    assert observation.source == "browser"
    assert observation.kind == "context"
    assert observation.timestamp == 5.0
    assert gateway.latest("browser") == observation
