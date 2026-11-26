"""Consent-gated local webcam collection. Only landmarks are persisted, never video."""

from __future__ import annotations

import argparse
import csv
import re
import time
import uuid
from pathlib import Path

import numpy as np

from .features import LANDMARK_COUNT, sequence_features
from .manifest import MANIFEST_COLUMNS

_LABEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")


def validate_label_id(label: str) -> str:
    """Validate a label before it is used in any output path."""
    if not isinstance(label, str) or not _LABEL_ID.fullmatch(label):
        raise ValueError("label must be a 1-64 character ID using letters, digits, dot, underscore or hyphen")
    return label


def _copy_landmarks(destination: np.ndarray, start: int, source: object) -> None:
    points = getattr(source, "landmark", None)
    if points is None:
        return
    limit = min(len(points), destination.shape[0] - start)
    for index in range(limit):
        point = points[index]
        destination[start + index] = (point.x, point.y, point.z)


def _holistic_frame(results: object) -> np.ndarray:
    frame = np.full((LANDMARK_COUNT, 3), np.nan, dtype=np.float32)
    _copy_landmarks(frame, 0, getattr(results, "pose_landmarks", None))
    _copy_landmarks(frame, 33, getattr(results, "face_landmarks", None))
    _copy_landmarks(frame, 501, getattr(results, "left_hand_landmarks", None))
    _copy_landmarks(frame, 522, getattr(results, "right_hand_landmarks", None))
    return frame


def _append_manifest(path: Path, row: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    write_header = not path.exists() or path.stat().st_size == 0
    with path.open("a", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=MANIFEST_COLUMNS)
        if write_header:
            writer.writeheader()
        writer.writerow(row)


def collect(args: argparse.Namespace) -> int:
    # Validate before creating directories: the label is also used in the local output path.
    validate_label_id(args.label)
    if not args.session_id.strip() or not args.signer_id.strip():
        raise RuntimeError("signer-id and session-id are required")
    if args.takes < 1:
        raise RuntimeError("takes must be at least one")

    # Optional imports keep the manifest, feature and model tests independent of camera drivers.
    try:
        import cv2
        import mediapipe as mp
    except ImportError as exc:
        raise RuntimeError(
            "camera collection needs the optional dependencies; install the capture extra"
        ) from exc

    if not args.consent_confirmed:
        raise RuntimeError("confirm the signer has explicitly consented with --consent-confirmed")

    data_root = Path(args.data_root).resolve()
    raw_root = data_root / "raw" / args.label
    raw_root.mkdir(parents=True, exist_ok=True)
    manifest_path = data_root / "manifest.csv"

    camera = cv2.VideoCapture(args.camera)
    if not camera.isOpened():
        raise RuntimeError(f"could not open camera {args.camera}")

    samples_saved = 0
    try:
        with mp.solutions.holistic.Holistic(
            static_image_mode=False,
            model_complexity=1,
            smooth_landmarks=True,
            enable_segmentation=False,
            refine_face_landmarks=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        ) as holistic:
            while samples_saved < args.takes:
                landmarks: list[np.ndarray] = []
                timestamps: list[float] = []
                width = 0
                height = 0
                recording = False
                started_at = 0.0
                while True:
                    ok, image = camera.read()
                    if not ok:
                        raise RuntimeError("camera stopped returning frames")
                    height, width = image.shape[:2]
                    preview = cv2.flip(image, 1)
                    status = "SPACE: start take   Q: quit"
                    key = cv2.waitKey(1) & 0xFF

                    if key == ord("q"):
                        return samples_saved
                    if key == 32 and not recording:
                        recording = True
                        started_at = time.perf_counter()
                        landmarks = []
                        timestamps = []
                    elif key == 32 and recording:
                        recording = False
                        break

                    if recording:
                        results = holistic.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
                        landmarks.append(_holistic_frame(results))
                        timestamps.append((time.perf_counter() - started_at) * 1000.0)
                        status = f"RECORDING {len(landmarks)} frames   SPACE: finish   Q: quit"

                    cv2.putText(
                        preview,
                        f"BSL label: {args.label} | take {samples_saved + 1}/{args.takes}",
                        (12, 28),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.58,
                        (255, 255, 255),
                        2,
                    )
                    cv2.putText(
                        preview,
                        status,
                        (12, 56),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.52,
                        (255, 255, 255),
                        2,
                    )
                    cv2.imshow("Otto BSL sample collector", preview)

                if len(landmarks) < 8:
                    print("Skipped take: at least 8 frames are required.")
                    continue

                sequence = np.stack(landmarks).astype(np.float32)
                times = np.asarray(timestamps, dtype=np.float64)
                try:
                    # Reject bad framing before it enters the training set.
                    sequence_features(sequence, width, height, times)
                except ValueError as exc:
                    print(f"Skipped take: {exc}")
                    continue

                sample_id = uuid.uuid4().hex[:16]
                relative_path = Path("raw") / args.label / f"{sample_id}.npz"
                output_path = data_root / relative_path
                np.savez_compressed(
                    output_path,
                    landmarks=sequence,
                    timestamps_ms=times,
                    frame_width=np.asarray(width, dtype=np.int32),
                    frame_height=np.asarray(height, dtype=np.int32),
                )
                _append_manifest(
                    manifest_path,
                    {
                        "sample_id": sample_id,
                        "relative_path": relative_path.as_posix(),
                        "language": "bsl",
                        "label": args.label,
                        "gloss": args.gloss or args.label,
                        "signer_id": args.signer_id,
                        "session_id": args.session_id,
                        "source": "self-recorded",
                        "rights_basis": "explicit-signer-consent",
                        "attribution": "Owner-recorded BSL prototype sample",
                    },
                )
                samples_saved += 1
                print(f"Saved landmark sample {sample_id} ({len(landmarks)} frames).")
    finally:
        camera.release()
        cv2.destroyAllWindows()

    return samples_saved


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Record local BSL examples as landmark sequences (no video is saved).")
    parser.add_argument("--label", required=True, help="Stable class ID, e.g. HELLO or HELLO_LONDON_VARIANT")
    parser.add_argument("--gloss", help="Human-readable BSL gloss; defaults to --label")
    parser.add_argument("--signer-id", required=True, help="Pseudonymous signer ID; use the same ID for one signer")
    parser.add_argument("--session-id", required=True, help="New ID for each separate recording session")
    parser.add_argument("--takes", type=int, default=10, help="Number of samples to collect for this label")
    parser.add_argument("--camera", type=int, default=0, help="OpenCV camera index")
    parser.add_argument("--data-root", default="data", help="Local data directory (ignored by Git)")
    parser.add_argument(
        "--consent-confirmed",
        action="store_true",
        required=True,
        help="Confirm the signer explicitly agreed to local landmark recording and model training",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        saved = collect(args)
    except RuntimeError as exc:
        parser.error(str(exc))
    print(f"Finished. Saved {saved} BSL landmark samples under {Path(args.data_root).resolve()}.")


if __name__ == "__main__":
    main()
