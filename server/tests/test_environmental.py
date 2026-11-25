from __future__ import annotations

from app.voice.environmental import (
    DUPLICATE_TOPIC_WINDOW_SECONDS,
    MAX_MESSAGE_CHARS,
    MIN_PROPOSAL_GAP_SECONDS,
    DeterministicFakeEnvironmentalAdapter,
    accept_environmental_proposal,
    clean_environmental_proposal,
)


def state_with_camera_frame(at: float = 100.0) -> dict:
    return {
        "capture_source": "camera",
        "perception": {"latest": [{
            "source": "camera", "kind": "frame", "consent": "granted", "timestamp": at,
        }]},
    }


def candidate(**overrides) -> dict:
    return {"topic": "object", "message": "A parcel is on the table.", "confidence": "sufficient", **overrides}


def test_contract_cleans_text_caps_message_and_drops_extra_fields():
    parsed = clean_environmental_proposal(candidate(message="  A\x00 parcel\n is here  ", action="navigate", where="#save"))
    assert parsed is not None
    assert parsed.topic == "object"
    assert parsed.message == "A parcel is here"
    long = clean_environmental_proposal(candidate(message="x" * 500))
    assert long is not None and len(long.message) == MAX_MESSAGE_CHARS


def test_contract_rejects_unknown_topics_uncertainty_and_malformed_values():
    for value in (
        candidate(topic="identity"), candidate(topic="face"), candidate(topic="emotion"),
        candidate(topic="object", confidence="uncertain"), candidate(message="  "),
        candidate(message=5), None, "object", [],
    ):
        assert clean_environmental_proposal(value) is None


def test_fake_adapter_is_deterministic_and_does_not_depend_on_observation():
    fake = DeterministicFakeEnvironmentalAdapter(candidate())
    assert fake.propose(b"frame one") == candidate()
    assert fake.propose(b"completely different frame") == candidate()
    abstain = DeterministicFakeEnvironmentalAdapter(None)
    assert abstain.propose(object()) is None


def test_proposal_requires_a_fresh_consented_camera_frame_in_this_session():
    proposal = candidate()
    assert accept_environmental_proposal({}, proposal, now=100.0) is None
    screen = state_with_camera_frame()
    screen["capture_source"] = "screen"
    assert accept_environmental_proposal(screen, proposal, now=100.0) is None
    revoked = state_with_camera_frame()
    revoked["perception"]["latest"][0]["consent"] = "revoked"
    assert accept_environmental_proposal(revoked, proposal, now=100.0) is None
    stale = state_with_camera_frame(at=90.0)
    assert accept_environmental_proposal(stale, proposal, now=100.0) is None
    future = state_with_camera_frame(at=101.0)
    assert accept_environmental_proposal(future, proposal, now=100.0) is None


def test_only_the_first_proposal_passes_the_session_rate_and_duplicate_limits():
    state = state_with_camera_frame()
    first = accept_environmental_proposal(state, candidate(), now=100.0)
    assert first is not None
    assert accept_environmental_proposal(state, candidate(topic="activity"), now=100.0 + MIN_PROPOSAL_GAP_SECONDS - 0.1) is None

    later = 100.0 + MIN_PROPOSAL_GAP_SECONDS
    state["perception"]["latest"][0]["timestamp"] = later
    assert accept_environmental_proposal(state, candidate(topic="object"), now=later) is None

    # A different topic can pass after the global gap; repeating it is suppressed for the duplicate window.
    next_at = later + MIN_PROPOSAL_GAP_SECONDS
    state["perception"]["latest"][0]["timestamp"] = next_at
    assert accept_environmental_proposal(state, candidate(topic="activity"), now=next_at) is not None
    duplicate_at = next_at + MIN_PROPOSAL_GAP_SECONDS
    state["perception"]["latest"][0]["timestamp"] = duplicate_at
    assert accept_environmental_proposal(state, candidate(topic="activity"), now=duplicate_at) is None
    assert DUPLICATE_TOPIC_WINDOW_SECONDS > MIN_PROPOSAL_GAP_SECONDS
