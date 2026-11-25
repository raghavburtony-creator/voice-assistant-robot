from __future__ import annotations

from app.voice.continuity import (
    CONTINUITY_ENABLED_HEADER,
    CONTINUITY_IDENTITY_HEADER,
    MAX_CONTINUITY_IDENTITY_CHARS,
    ContinuityContext,
    from_headers,
)


def test_missing_or_untrusted_continuity_falls_back_to_none():
    headers = {
        CONTINUITY_ENABLED_HEADER: "true",
        CONTINUITY_IDENTITY_HEADER: "visitor-123",
    }
    assert from_headers(headers, trusted_proxy=False, scope="Otto Demo") is None
    assert from_headers({}, trusted_proxy=True, scope="Otto Demo") is None
    assert from_headers(
        {CONTINUITY_ENABLED_HEADER: "false", CONTINUITY_IDENTITY_HEADER: "visitor-123"},
        trusted_proxy=True,
        scope="Otto Demo",
    ) is None


def test_enabled_continuity_keeps_only_the_opaque_identity_and_scope():
    result = from_headers(
        {
            CONTINUITY_ENABLED_HEADER: "TRUE",
            CONTINUITY_IDENTITY_HEADER: "opaque-host-id-123",
            "x-unrelated-header": "secret",
        },
        trusted_proxy=True,
        scope="Otto Demo",
    )
    assert result == ContinuityContext(scope="Otto Demo", identity="opaque-host-id-123")
    assert "x-unrelated-header" not in result.__dict__


def test_identity_is_bounded_and_control_characters_are_rejected():
    base = {
        CONTINUITY_ENABLED_HEADER: "1",
        CONTINUITY_IDENTITY_HEADER: "visitor",
    }
    assert from_headers({**base, CONTINUITY_IDENTITY_HEADER: "x" * (MAX_CONTINUITY_IDENTITY_CHARS + 1)},
                        trusted_proxy=True, scope="Otto Demo") is None
    assert from_headers({**base, CONTINUITY_IDENTITY_HEADER: "visitor\n123"},
                        trusted_proxy=True, scope="Otto Demo") is None
    assert from_headers({**base, CONTINUITY_IDENTITY_HEADER: "visitor\t123"},
                        trusted_proxy=True, scope="Otto Demo") is None


def test_identity_is_not_accepted_without_a_valid_scope():
    headers = {
        CONTINUITY_ENABLED_HEADER: "true",
        CONTINUITY_IDENTITY_HEADER: "visitor-123",
    }
    assert from_headers(headers, trusted_proxy=True, scope=" ") is None
