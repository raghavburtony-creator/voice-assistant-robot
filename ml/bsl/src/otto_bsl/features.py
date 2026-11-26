"""Deterministic holistic landmark selection and spatial/temporal normalization."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

FEATURE_SCHEMA_VERSION = 1

# Pose: shoulders, elbows, wrists, hand attachment points and hips. These are
# MediaPipe Pose landmark indices; the hand meshes themselves are kept in full.
POSE_INDICES = (11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24)

# Eyebrows, eyes, nose bridge, cheeks, lips and chin. These stable Face Mesh
# indices retain non-manual cues without storing all 478 face points.
FACE_INDICES = (
    10, 33, 54, 67, 70, 105, 107, 127, 133, 145, 152,
    159, 263, 276, 283, 296, 300, 323, 362, 374, 386, 389,
)
HAND_POINTS = 21
LANDMARK_COUNT = len(POSE_INDICES) + len(FACE_INDICES) + HAND_POINTS * 2
CHANNELS_PER_LANDMARK = 4  # normalized x, y, z and detection visibility/presence
BASE_FEATURES = LANDMARK_COUNT * CHANNELS_PER_LANDMARK
FEATURE_SIZE = BASE_FEATURES + LANDMARK_COUNT * 3  # xyz velocity over normalized clip time


class FeatureError(ValueError):
    """A landmark clip cannot be converted into the versioned feature schema."""


def _attribute(point: Any, name: str, default: float = 0.0) -> float:
    if isinstance(point, Mapping):
        value = point.get(name, default)
    else:
        value = getattr(point, name, default)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if np.isfinite(number) else default


def _landmark(point: Any, width: int, height: int) -> tuple[np.ndarray, float]:
    # MediaPipe NormalizedLandmark x/y use separate normalized image axes.
    # Convert to pixels before normalization so aspect ratio does not distort
    # geometry. z is width-relative and is scaled by the same pixel width.
    confidence = _attribute(point, "visibility", _attribute(point, "presence", 1.0))
    confidence = float(np.clip(confidence, 0.0, 1.0))
    xyz = np.asarray(
        [
            _attribute(point, "x") * width,
            _attribute(point, "y") * height,
            _attribute(point, "z") * width,
        ],
        dtype=np.float32,
    )
    if not np.isfinite(xyz).all():
        return np.zeros(3, dtype=np.float32), 0.0
    return xyz, confidence


def _at(points: Sequence[Any] | None, index: int, width: int, height: int):
    if points is None or index >= len(points):
        return np.zeros(3, dtype=np.float32), 0.0
    return _landmark(points[index], width, height)


def normalize_frame(
    landmarks: Mapping[str, Sequence[Any] | None],
    *,
    frame_width: int,
    frame_height: int,
) -> np.ndarray:
    """Return one 312-value normalized frame (78 landmarks x 4 channels).

    Coordinates are centered on the shoulder midpoint and divided by shoulder
    width. If shoulders are not visible, hip midpoint and torso length provide
    the fallback anchor. Without usable body anchors the frame is all zeros;
    it is not guessed from camera bounds.
    """
    if frame_width <= 0 or frame_height <= 0:
        raise FeatureError("Frame dimensions must be positive")

    pose = landmarks.get("pose")
    face = landmarks.get("face")
    left_hand = landmarks.get("left_hand")
    right_hand = landmarks.get("right_hand")

    pose_points = {index: _at(pose, index, frame_width, frame_height) for index in POSE_INDICES}
    left_shoulder, left_shoulder_conf = pose_points[11]
    right_shoulder, right_shoulder_conf = pose_points[12]
    left_hip, left_hip_conf = pose_points[23]
    right_hip, right_hip_conf = pose_points[24]

    shoulders_visible = left_shoulder_conf >= 0.25 and right_shoulder_conf >= 0.25
    hips_visible = left_hip_conf >= 0.25 and right_hip_conf >= 0.25
    if shoulders_visible:
        center = (left_shoulder + right_shoulder) / 2.0
        scale = float(np.linalg.norm(left_shoulder[:2] - right_shoulder[:2]))
    elif hips_visible:
        center = (left_hip + right_hip) / 2.0
        scale = float(np.linalg.norm(left_hip[:2] - right_hip[:2]))
    else:
        return np.zeros(BASE_FEATURES, dtype=np.float32)

    if scale < max(frame_width, frame_height) * 0.015:
        return np.zeros(BASE_FEATURES, dtype=np.float32)

    # Scale z in image-width units, like x, and leave the confidence channel
    # unscaled. Missing detections stay exactly zero.
    groups = (
        [(pose, index, pose_points[index]) for index in POSE_INDICES],
        [(face, index, _at(face, index, frame_width, frame_height)) for index in FACE_INDICES],
        [(left_hand, index, _at(left_hand, index, frame_width, frame_height)) for index in range(HAND_POINTS)],
        [(right_hand, index, _at(right_hand, index, frame_width, frame_height)) for index in range(HAND_POINTS)],
    )
    values: list[float] = []
    for points, _index, (xyz, confidence) in (
        item for group in groups for item in group
    ):
        if points is None or confidence <= 0.0:
            values.extend((0.0, 0.0, 0.0, 0.0))
            continue
        relative = (xyz - center) / scale
        values.extend((float(relative[0]), float(relative[1]), float(relative[2]), confidence))

    result = np.asarray(values, dtype=np.float32)
    if result.shape != (BASE_FEATURES,) or not np.isfinite(result).all():
        raise FeatureError("Landmark conversion produced an invalid feature frame")
    return result


def resample_sequence(frames: np.ndarray, target_frames: int = 64) -> np.ndarray:
    """Linearly resample [time, BASE_FEATURES] to a fixed temporal length."""
    sequence = np.asarray(frames, dtype=np.float32)
    if sequence.ndim != 2 or sequence.shape[1] != BASE_FEATURES:
        raise FeatureError(f"Expected a [frames, {BASE_FEATURES}] landmark array")
    if sequence.shape[0] < 1:
        raise FeatureError("A sign clip must contain at least one frame")
    if target_frames < 8:
        raise FeatureError("target_frames must be at least 8")
    if not np.isfinite(sequence).all():
        raise FeatureError("Landmark features must be finite")
    if sequence.shape[0] == 1:
        return np.repeat(sequence, target_frames, axis=0)

    source_time = np.linspace(0.0, 1.0, sequence.shape[0], dtype=np.float32)
    target_time = np.linspace(0.0, 1.0, target_frames, dtype=np.float32)
    output = np.empty((target_frames, BASE_FEATURES), dtype=np.float32)
    for column in range(BASE_FEATURES):
        output[:, column] = np.interp(target_time, source_time, sequence[:, column])
    return output


def make_temporal_features(frames: np.ndarray, target_frames: int = 64) -> np.ndarray:
    """Create fixed-length features: normalized landmarks plus normalized-time xyz deltas."""
    spatial = resample_sequence(frames, target_frames)
    points = spatial.reshape(target_frames, LANDMARK_COUNT, CHANNELS_PER_LANDMARK)
    coordinates = points[:, :, :3]
    velocity = np.zeros_like(coordinates)
    velocity[1:] = np.diff(coordinates, axis=0) * float(target_frames - 1)
    combined = np.concatenate((spatial, velocity.reshape(target_frames, -1)), axis=1)
    if combined.shape != (target_frames, FEATURE_SIZE) or not np.isfinite(combined).all():
        raise FeatureError("Temporal feature conversion produced an invalid array")
    return combined.astype(np.float32, copy=False)
