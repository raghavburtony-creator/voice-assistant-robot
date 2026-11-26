"""Camera-normalized temporal features from MediaPipe Holistic landmarks.

Input frame layout follows MediaPipe Holistic: 33 pose, 468 face mesh,
21 left-hand and 21 right-hand landmarks (543 total). Only selected facial
points are included, but both hands and upper-body points are retained.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

FEATURE_SCHEMA_VERSION = 1
FRAME_COUNT = 64
LANDMARK_COUNT = 543

# Pose landmarks are indexed in the 33-point pose block.
POSE_POINTS = (0, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24)
FACE_POINTS = (
    10, 70, 63, 105, 66, 107, 336, 296, 334, 293, 300,
    33, 133, 159, 145, 362, 263, 386, 374,
    61, 291, 13, 14, 78, 308, 317, 402, 318, 324, 87, 178, 88, 95,
    0, 17, 152, 234, 454, 127, 356,
)
LEFT_HAND_START = 501
RIGHT_HAND_START = 522
HAND_POINTS = 21
POSE_COUNT = len(POSE_POINTS)
FACE_COUNT = len(FACE_POINTS)
POSITION_DIM = (HAND_POINTS * 2 + POSE_COUNT + FACE_COUNT) * 3
LOCAL_HAND_DIM = HAND_POINTS * 2 * 3
PRESENCE_DIM = 4
FEATURE_DIM = POSITION_DIM * 2 + LOCAL_HAND_DIM + PRESENCE_DIM
SHOULDER_LEFT = 11
SHOULDER_RIGHT = 12
HAND_WRIST = 0
HAND_MIDDLE_MCP = 9


def _resample(sequence: NDArray[np.float32], source_times: NDArray[np.float64], frame_count: int) -> NDArray[np.float32]:
    if sequence.shape[0] == 1:
        return np.repeat(sequence, frame_count, axis=0)
    target_times = np.linspace(source_times[0], source_times[-1], frame_count)
    output = np.empty((frame_count, sequence.shape[1]), dtype=np.float32)
    for column in range(sequence.shape[1]):
        output[:, column] = np.interp(target_times, source_times, sequence[:, column])
    return output


def sequence_features(
    landmarks: NDArray[np.floating],
    frame_width: int,
    frame_height: int,
    timestamps_ms: NDArray[np.floating] | None = None,
    frame_count: int = FRAME_COUNT,
) -> NDArray[np.float32]:
    """Return fixed-length [frame_count, FEATURE_DIM] normalized motion features.

    MediaPipe x/y coordinates are scaled into pixels before normalization,
    avoiding portrait/landscape aspect-ratio distortion. z is scaled by frame
    width, as in MediaPipe's coordinate convention. No left/right mirroring is
    performed: handedness and direction can distinguish BSL signs.
    """
    values = np.asarray(landmarks, dtype=np.float64)
    if values.ndim != 3 or values.shape[1:] != (LANDMARK_COUNT, 3):
        raise ValueError(f"landmarks must have shape [frames, {LANDMARK_COUNT}, 3]")
    if values.shape[0] < 1:
        raise ValueError("at least one landmark frame is required")
    if frame_width <= 0 or frame_height <= 0 or frame_count < 2:
        raise ValueError("frame dimensions and frame_count must be positive")

    values = values.copy()
    values[:, :, 0] *= float(frame_width)
    values[:, :, 1] *= float(frame_height)
    values[:, :, 2] *= float(frame_width)

    left_shoulder = values[:, SHOULDER_LEFT, :2]
    right_shoulder = values[:, SHOULDER_RIGHT, :2]
    shoulder_visible = np.isfinite(left_shoulder).all(axis=1) & np.isfinite(right_shoulder).all(axis=1)
    if not shoulder_visible.any():
        raise ValueError("upper-body framing is required: both shoulders must be visible in at least one frame")

    shoulder_mid = (left_shoulder[shoulder_visible] + right_shoulder[shoulder_visible]) / 2.0
    shoulder_widths = np.linalg.norm(left_shoulder[shoulder_visible] - right_shoulder[shoulder_visible], axis=1)
    scale = float(np.median(shoulder_widths))
    if not np.isfinite(scale) or scale < 2.0:
        raise ValueError("shoulder width is too small to normalize this recording")

    center_x, center_y = np.median(shoulder_mid, axis=0)
    shoulder_depth = (
        values[shoulder_visible, SHOULDER_LEFT, 2] + values[shoulder_visible, SHOULDER_RIGHT, 2]
    ) / 2.0
    finite_depth = shoulder_depth[np.isfinite(shoulder_depth)]
    center_z = float(np.median(finite_depth)) if finite_depth.size else 0.0

    values[:, :, 0] = (values[:, :, 0] - center_x) / scale
    values[:, :, 1] = (values[:, :, 1] - center_y) / scale
    values[:, :, 2] = (values[:, :, 2] - center_z) / scale

    point_indices = (
        list(range(LEFT_HAND_START, LEFT_HAND_START + HAND_POINTS))
        + list(range(RIGHT_HAND_START, RIGHT_HAND_START + HAND_POINTS))
        + list(POSE_POINTS)
        + [33 + index for index in FACE_POINTS]
    )
    selected = values[:, point_indices, :]
    positions = selected.reshape(values.shape[0], -1)

    local_hands: list[NDArray[np.float64]] = []
    for start in (LEFT_HAND_START, RIGHT_HAND_START):
        hand = values[:, start : start + HAND_POINTS, :]
        wrist = hand[:, HAND_WRIST : HAND_WRIST + 1, :]
        middle = hand[:, HAND_MIDDLE_MCP, :] - hand[:, HAND_WRIST, :]
        hand_scale = np.linalg.norm(middle[:, :2], axis=1)
        valid = np.isfinite(wrist[:, 0, :2]).all(axis=1) & np.isfinite(middle[:, :2]).all(axis=1) & (hand_scale > 1e-4)
        local = np.zeros_like(hand)
        local[valid] = (hand[valid] - wrist[valid]) / hand_scale[valid, None, None]
        local_hands.append(local.reshape(values.shape[0], -1))
    local_features = np.concatenate(local_hands, axis=1)

    left_hand = values[:, LEFT_HAND_START : LEFT_HAND_START + HAND_POINTS, :2]
    right_hand = values[:, RIGHT_HAND_START : RIGHT_HAND_START + HAND_POINTS, :2]
    pose = values[:, :33, :2]
    face = values[:, 33:501, :2]
    presence = np.stack(
        [
            np.isfinite(left_hand).all(axis=2).any(axis=1),
            np.isfinite(right_hand).all(axis=2).any(axis=1),
            np.isfinite(pose).all(axis=2).any(axis=1),
            np.isfinite(face).all(axis=2).any(axis=1),
        ],
        axis=1,
    ).astype(np.float64)

    positions = np.nan_to_num(positions, nan=0.0, posinf=0.0, neginf=0.0)
    local_features = np.nan_to_num(local_features, nan=0.0, posinf=0.0, neginf=0.0)
    raw_features = np.concatenate([positions, local_features, presence], axis=1)

    if timestamps_ms is None:
        times = np.arange(values.shape[0], dtype=np.float64) * (1000.0 / 30.0)
    else:
        times = np.asarray(timestamps_ms, dtype=np.float64)
        if times.ndim != 1 or times.shape[0] != values.shape[0] or not np.isfinite(times).all():
            raise ValueError("timestamps_ms must have one finite timestamp per frame")
        if times.size > 1 and np.any(np.diff(times) <= 0):
            raise ValueError("timestamps_ms must be strictly increasing")

    velocities = np.zeros_like(positions)
    if positions.shape[0] > 1:
        delta_seconds = np.diff(times) / 1000.0
        velocities[1:] = np.diff(positions, axis=0) / delta_seconds[:, None]
        velocities = np.clip(velocities, -100.0, 100.0)
    complete = np.concatenate([raw_features, velocities], axis=1).astype(np.float32)

    if complete.shape[1] != FEATURE_DIM:
        raise RuntimeError(f"feature schema mismatch: expected {FEATURE_DIM}, got {complete.shape[1]}")
    sampled = _resample(complete, times, frame_count)
    return np.nan_to_num(sampled, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)
