"""Explicit-consent webcam collection. Frames stay in memory; only landmarks are written."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .features import FEATURE_SCHEMA_VERSION, normalize_frame
from .manifest import append_manifest_entry
from .manifest import LABEL_RE, IDENTIFIER_RE

CONSENT_PHRASE = "I CONSENT TO SAVE SIGN LANDMARKS ONLY"


class CaptureCancelled(RuntimeError):
    """The signer cancelled the sample before it was saved."""


def require_recording_consent(response: str) -> None:
    if response.strip() != CONSENT_PHRASE:
        raise PermissionError("Recording was not started; the exact consent phrase was not entered.")


def _as_groups(result):
    return {
        "pose": result.pose_landmarks,
        "face": result.face_landmarks,
        "left_hand": result.left_hand_landmarks,
        "right_hand": result.right_hand_landmarks,
    }


def collect_webcam_landmarks(
    model_asset_path: str | Path,
    *,
    consent_response: str,
    camera_index: int = 0,
    duration_seconds: float = 3.0,
) -> tuple[np.ndarray, np.ndarray, int, int]:
    """Capture one sign clip; never creates a video/image file or network request."""
    require_recording_consent(consent_response)
    if not 0.5 <= duration_seconds <= 10.0:
        raise ValueError("duration_seconds must be between 0.5 and 10 seconds")
    model_path = Path(model_asset_path).expanduser().resolve()
    if not model_path.is_file():
        raise FileNotFoundError(
            f"Holistic Landmarker asset not found: {model_path}. Place the task model locally; it is not downloaded."
        )

    try:
        import cv2
        import mediapipe as mp
    except ImportError as exc:
        raise RuntimeError("Install the capture extra: pip install -e '.[capture]'") from exc

    capture = cv2.VideoCapture(camera_index)
    if not capture.isOpened():
        capture.release()
        raise RuntimeError("Could not open the selected webcam")

    frames: list[np.ndarray] = []
    timestamps: list[int] = []
    start = time.monotonic()
    previous_timestamp = -1
    frame_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
    frame_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480
    options = mp.tasks.vision.HolisticLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        min_face_detection_confidence=0.5,
        min_pose_detection_confidence=0.5,
    )
    try:
        with mp.tasks.vision.HolisticLandmarker.create_from_options(options) as landmarker:
            while time.monotonic() - start < duration_seconds:
                ok, image = capture.read()
                if not ok:
                    continue
                frame_height, frame_width = image.shape[:2]
                timestamp_ms = max(previous_timestamp + 1, int((time.monotonic() - start) * 1000))
                previous_timestamp = timestamp_ms
                rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = landmarker.detect_for_video(mp_image, timestamp_ms)
                frames.append(
                    normalize_frame(_as_groups(result), frame_width=frame_width, frame_height=frame_height)
                )
                timestamps.append(timestamp_ms)

                remaining = max(0, int(duration_seconds - (time.monotonic() - start)))
                preview = image.copy()
                cv2.putText(
                    preview,
                    f"Landmarks only - {remaining}s left | SPACE finish | Q cancel",
                    (12, 28),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (40, 220, 40),
                    2,
                )
                cv2.imshow("Otto personal BSL capture", preview)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), 27):
                    raise CaptureCancelled("Capture cancelled; no sample was saved")
                if key == ord(" "):
                    break
    finally:
        capture.release()
        cv2.destroyAllWindows()

    if len(frames) < 5:
        raise CaptureCancelled("Too few frames were captured; no sample was saved")
    landmark_array = np.stack(frames).astype(np.float32)
    if not np.any(landmark_array[:, 3::4] > 0):
        raise CaptureCancelled("No usable body/hand landmarks were detected; no sample was saved")
    return landmark_array, np.asarray(timestamps, dtype=np.int64), frame_width, frame_height


def collect_sample(
    *,
    label: str,
    signer_id: str,
    session_id: str,
    data_root: str | Path,
    model_asset_path: str | Path,
    consent_response: str,
    camera_index: int = 0,
    duration_seconds: float = 3.0,
) -> dict:
    if not isinstance(label, str) or not LABEL_RE.fullmatch(label):
        raise ValueError("label must be a lowercase slug")
    for value, name in ((signer_id, "signer_id"), (session_id, "session_id")):
        if not isinstance(value, str) or not IDENTIFIER_RE.fullmatch(value):
            raise ValueError(f"{name} must be a short opaque identifier")
    require_recording_consent(consent_response)

    landmarks, timestamps, width, height = collect_webcam_landmarks(
        model_asset_path,
        consent_response=consent_response,
        camera_index=camera_index,
        duration_seconds=duration_seconds,
    )
    root = Path(data_root).expanduser().resolve()
    landmark_dir = root / "landmarks"
    landmark_dir.mkdir(parents=True, exist_ok=True)
    sample_id = str(uuid.uuid4())
    relative_path = Path("landmarks") / f"{sample_id}.npz"
    output_path = root / relative_path
    temp_path = output_path.with_suffix(".npz.tmp")
    model_hash = hashlib.sha256(Path(model_asset_path).expanduser().read_bytes()).hexdigest()
    with temp_path.open("wb") as handle:
        np.savez_compressed(
            handle,
            landmarks=landmarks,
            timestamps_ms=timestamps,
            feature_schema_version=np.asarray(FEATURE_SCHEMA_VERSION, dtype=np.int64),
        )
    temp_path.replace(output_path)

    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    entry = {
        "sample_id": sample_id,
        "label": label,
        "signer_id": signer_id,
        "session_id": session_id,
        "captured_at": captured_at,
        "landmarks_path": relative_path.as_posix(),
        "source": {
            "kind": "owner_recorded",
            "name": "Personal webcam recording",
            "license": "owner-recorded with explicit consent",
            "rights_confirmed": True,
            "consent_recorded": True,
            "attribution": "Owner-recorded example; signer consent confirmed at capture.",
        },
        "capture": {
            "feature_schema_version": FEATURE_SCHEMA_VERSION,
            "storage_mode": "landmarks_only",
            "frame_width": width,
            "frame_height": height,
            "frame_count": int(len(landmarks)),
            "duration_ms": int(timestamps[-1] - timestamps[0]),
            "landmarker_model_sha256": model_hash,
        },
    }
    append_manifest_entry(root, entry)
    return entry


def main() -> None:
    parser = argparse.ArgumentParser(description="Record one explicitly consented BSL sign as landmarks only.")
    parser.add_argument("--label", required=True, help="Short lowercase sign label, e.g. hello")
    parser.add_argument("--signer-id", required=True, help="Pseudonymous signer id; do not use a full name")
    parser.add_argument("--session-id", required=True, help="Opaque capture-session id")
    parser.add_argument("--model-asset", type=Path, required=True, help="Existing local holistic_landmarker.task path")
    parser.add_argument("--data-root", type=Path, default=Path("local-data"))
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--duration", type=float, default=3.0)
    args = parser.parse_args()
    print("This recording is processed locally. Raw camera frames are shown in memory and are not saved.")
    print("Only normalized pose, hand and selected face landmark sequences plus metadata are written.")
    consent = input(f"To start recording, type exactly: {CONSENT_PHRASE}\n> ")
    entry = collect_sample(
        label=args.label,
        signer_id=args.signer_id,
        session_id=args.session_id,
        data_root=args.data_root,
        model_asset_path=args.model_asset,
        consent_response=consent,
        camera_index=args.camera,
        duration_seconds=args.duration,
    )
    print(json.dumps({"saved_sample_id": entry["sample_id"], "label": entry["label"]}, indent=2))


if __name__ == "__main__":
    main()
