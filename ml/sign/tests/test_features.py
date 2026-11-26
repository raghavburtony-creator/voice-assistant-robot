from __future__ import annotations

import numpy as np
import pytest

from otto_sign.features import FEATURE_DIM, FRAME_COUNT, sequence_features


def _landmarks(frame_count=12):
    rng = np.random.default_rng(7)
    values = rng.uniform(0.25, 0.75, size=(frame_count, 543, 3)).astype(np.float32)
    values[:, :, 2] = rng.normal(0.0, 0.01, size=(frame_count, 543))
    values[:, 11, 0] = 0.40
    values[:, 12, 0] = 0.60
    values[:, 11, 1] = 0.30
    values[:, 12, 1] = 0.30
    return values


def test_extracts_fixed_length_features_for_both_hands_body_and_face():
    result = sequence_features(
        _landmarks(),
        frame_width=640,
        frame_height=480,
        timestamps_ms=np.arange(12, dtype=np.float64) * 33.3,
    )

    assert result.shape == (FRAME_COUNT, FEATURE_DIM)
    assert result.dtype == np.float32
    assert np.isfinite(result).all()


def test_features_are_stable_when_camera_resolution_is_scaled_uniformly():
    values = _landmarks()
    base = sequence_features(values, frame_width=640, frame_height=480)
    scaled = sequence_features(values, frame_width=1280, frame_height=960)

    np.testing.assert_allclose(base, scaled, rtol=1e-5, atol=1e-5)


def test_rejects_recordings_without_visible_shoulders():
    values = _landmarks()
    values[:, 11:13, :] = np.nan

    with pytest.raises(ValueError, match="both shoulders"):
        sequence_features(values, frame_width=640, frame_height=480)


def test_rejects_bad_landmark_shapes_and_timestamps():
    with pytest.raises(ValueError, match="543"):
        sequence_features(np.zeros((4, 21, 3)), frame_width=640, frame_height=480)

    values = _landmarks()
    with pytest.raises(ValueError, match="strictly increasing"):
        sequence_features(values, 640, 480, timestamps_ms=np.ones(12))
