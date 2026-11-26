"""Strict local dataset manifest validation. No third-party data is downloaded here."""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any

import numpy as np

from .features import BASE_FEATURES, FEATURE_SCHEMA_VERSION

LABEL_RE = re.compile(r"^[a-z][a-z0-9_-]{0,47}$")
IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$")
SOURCE_KINDS = {"owner_recorded", "third_party"}


class ManifestError(ValueError):
    """A dataset manifest row is missing provenance, rights or valid local data."""


def _require_identifier(value: Any, field: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER_RE.fullmatch(value):
        raise ManifestError(f"{field} must be a short opaque identifier")
    return value


def _safe_landmark_path(root: Path, value: Any) -> Path:
    if not isinstance(value, str) or not value or "\\" in value:
        raise ManifestError("landmarks_path must be a relative POSIX path")
    relative = PurePosixPath(value)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise ManifestError("landmarks_path must not contain traversal or absolute components")
    if relative.suffix != ".npz":
        raise ManifestError("landmarks_path must point to an NPZ landmark file")

    candidate = root.joinpath(*relative.parts)
    cursor = root
    for part in relative.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ManifestError("landmarks_path cannot traverse symlinks")
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root.resolve(strict=True))
    except (OSError, ValueError) as exc:
        raise ManifestError("landmarks_path must resolve to a file inside the dataset directory") from exc
    if not resolved.is_file():
        raise ManifestError("landmarks_path must point to a regular file")
    return resolved


def _validate_source(source: Any) -> dict[str, Any]:
    if not isinstance(source, dict) or source.get("kind") not in SOURCE_KINDS:
        raise ManifestError("source.kind must be owner_recorded or third_party")
    if source.get("rights_confirmed") is not True:
        raise ManifestError("source rights must be explicitly confirmed before training")
    for key in ("name", "license", "attribution"):
        if not isinstance(source.get(key), str) or not source[key].strip():
            raise ManifestError(f"source.{key} is required")

    if source["kind"] == "owner_recorded":
        if source.get("consent_recorded") is not True:
            raise ManifestError("owner-recorded samples require explicit recording consent")
    else:
        url = source.get("source_url")
        if not isinstance(url, str) or not url.startswith(("https://", "http://")):
            raise ManifestError("third-party samples require a source_url")
        if source.get("original_copyright_confirmed") is not True:
            raise ManifestError("third-party dataset terms and original clip copyright must both be checked")
    return source


def validate_entry(entry: Any, data_root: Path) -> dict[str, Any]:
    if not isinstance(entry, dict):
        raise ManifestError("Each manifest row must be a JSON object")
    sample_id = _require_identifier(entry.get("sample_id"), "sample_id")
    label = entry.get("label")
    if not isinstance(label, str) or not LABEL_RE.fullmatch(label):
        raise ManifestError("label must be a lowercase slug (letters, digits, underscore or hyphen)")
    signer_id = _require_identifier(entry.get("signer_id"), "signer_id")
    session_id = _require_identifier(entry.get("session_id"), "session_id")
    captured_at = entry.get("captured_at")
    if not isinstance(captured_at, str):
        raise ManifestError("captured_at must be an ISO-8601 timestamp")
    try:
        timestamp = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ManifestError("captured_at must be an ISO-8601 timestamp") from exc
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ManifestError("captured_at must include a timezone")

    source = _validate_source(entry.get("source"))
    capture = entry.get("capture")
    if not isinstance(capture, dict):
        raise ManifestError("capture metadata is required")
    if capture.get("feature_schema_version") != FEATURE_SCHEMA_VERSION:
        raise ManifestError("unsupported feature_schema_version")
    if capture.get("storage_mode") != "landmarks_only":
        raise ManifestError("only landmarks_only samples are accepted")
    if type(capture.get("frame_width")) is not int or capture["frame_width"] <= 0:
        raise ManifestError("capture.frame_width must be a positive integer")
    if type(capture.get("frame_height")) is not int or capture["frame_height"] <= 0:
        raise ManifestError("capture.frame_height must be a positive integer")
    if type(capture.get("frame_count")) is not int or capture["frame_count"] < 5:
        raise ManifestError("capture.frame_count must be at least five")

    landmarks_file = _safe_landmark_path(data_root.resolve(), entry.get("landmarks_path"))
    try:
        with np.load(landmarks_file, allow_pickle=False) as payload:
            required = {"landmarks", "timestamps_ms", "feature_schema_version"}
            if not required.issubset(payload.files):
                raise ManifestError("landmark NPZ is missing required arrays")
            landmarks = payload["landmarks"]
            timestamps_ms = payload["timestamps_ms"]
            version = int(np.asarray(payload["feature_schema_version"]).item())
    except (OSError, ValueError, KeyError) as exc:
        if isinstance(exc, ManifestError):
            raise
        raise ManifestError("landmark NPZ could not be read safely") from exc
    if version != FEATURE_SCHEMA_VERSION:
        raise ManifestError("landmark NPZ feature schema version does not match")
    if landmarks.ndim != 2 or landmarks.shape[1] != BASE_FEATURES or landmarks.shape[0] < 5:
        raise ManifestError(f"landmarks must have shape [frames, {BASE_FEATURES}]")
    if timestamps_ms.shape != (landmarks.shape[0],) or not np.isfinite(timestamps_ms).all():
        raise ManifestError("timestamps_ms must contain one finite timestamp per frame")
    if not np.isfinite(landmarks).all():
        raise ManifestError("landmark features must be finite")
    if int(capture["frame_count"]) != landmarks.shape[0]:
        raise ManifestError("capture.frame_count does not match the landmark array")
    return entry


def load_manifest(data_root: str | Path, manifest_path: str | Path | None = None) -> list[dict[str, Any]]:
    """Read and validate JSONL rows; local files must remain beneath data_root."""
    root = Path(data_root).resolve()
    path = Path(manifest_path) if manifest_path is not None else root / "manifest.jsonl"
    if not path.is_absolute():
        path = root / path
    try:
        path = path.resolve(strict=True)
        path.relative_to(root)
    except (OSError, ValueError) as exc:
        raise ManifestError("manifest must be a file inside the dataset directory") from exc
    if not path.is_file():
        raise ManifestError("manifest must be a regular file")

    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ManifestError(f"Invalid JSON on manifest line {line_number}") from exc
        validated = validate_entry(entry, root)
        if validated["sample_id"] in seen:
            raise ManifestError(f"Duplicate sample_id on manifest line {line_number}")
        seen.add(validated["sample_id"])
        entries.append(validated)
    return entries


def append_manifest_entry(data_root: str | Path, entry: dict[str, Any]) -> None:
    """Validate and append a single row after its local landmark file has been written."""
    root = Path(data_root).resolve()
    validate_entry(entry, root)
    manifest = root / "manifest.jsonl"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    with manifest.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, sort_keys=True, separators=(",", ":")) + "\n")
