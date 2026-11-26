import pytest

from otto_bsl.capture import CONSENT_PHRASE, require_recording_consent


def test_recording_requires_the_explicit_consent_phrase():
    with pytest.raises(PermissionError):
        require_recording_consent("yes")
    with pytest.raises(PermissionError):
        require_recording_consent("")
    require_recording_consent(CONSENT_PHRASE)
