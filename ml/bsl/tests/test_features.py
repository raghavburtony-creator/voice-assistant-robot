import numpy as np

from otto_bsl.features import BASE_FEATURES, FEATURE_SIZE, LANDMARK_COUNT, make_temporal_features, normalize_frame, resample_sequence


def _point(x, y, z=0.0):
    return {"x": x, "y": y, "z": z, "visibility": 1.0}


def _landmarks():
    pose = [_point(0.5, 0.5) for _ in range(33)]
    pose[11] = _point(0.4, 0.35)
    pose[12] = _point(0.6, 0.35)
    pose[23] = _point(0.43, 0.7)
    pose[24] = _point(0.57, 0.7)
    face = [_point(0.5, 0.3) for _ in range(478)]
    left = [_point(0.35 + index / 1000, 0.5) for index in range(21)]
    right = [_point(0.65 - index / 1000, 0.5) for index in range(21)]
    return {"pose": pose, "face": face, "left_hand": left, "right_hand": right}


def test_feature_schema_is_fixed_and_includes_hands_and_non_manual_points():
    assert LANDMARK_COUNT == 78
    assert BASE_FEATURES == 312
    assert FEATURE_SIZE == 546
    frame = normalize_frame(_landmarks(), frame_width=640, frame_height=480)
    assert frame.shape == (BASE_FEATURES,)
    assert np.isfinite(frame).all()
    assert np.count_nonzero(frame[3::4]) == LANDMARK_COUNT


def test_spatial_normalization_is_stable_across_camera_resolution():
    original = normalize_frame(_landmarks(), frame_width=640, frame_height=480)
    doubled = normalize_frame(_landmarks(), frame_width=1280, frame_height=960)
    np.testing.assert_allclose(original, doubled, atol=1e-6)


def test_missing_body_anchor_fails_closed_to_zeros():
    data = _landmarks()
    data["pose"] = None
    frame = normalize_frame(data, frame_width=640, frame_height=480)
    assert np.count_nonzero(frame) == 0


def test_resampling_and_temporal_deltas_have_fixed_shape():
    source = np.zeros((3, BASE_FEATURES), dtype=np.float32)
    source[:, 0] = [0.0, 1.0, 3.0]
    resampled = resample_sequence(source, target_frames=16)
    assert resampled.shape == (16, BASE_FEATURES)
    assert resampled[0, 0] == 0.0
    assert resampled[-1, 0] == 3.0

    temporal = make_temporal_features(source, target_frames=16)
    assert temporal.shape == (16, FEATURE_SIZE)
    assert temporal[0, BASE_FEATURES] == 0.0
    assert np.all(temporal[1:, BASE_FEATURES] > 0.0)
