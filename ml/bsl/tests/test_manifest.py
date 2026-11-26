import json

import numpy as np
import pytest

from otto_bsl.features import BASE_FEATURES, FEATURE_SCHEMA_VERSION
from otto_bsl.manifest import ManifestError, append_manifest_entry, load_manifest


def _sample(root, *, path="landmarks/sample.npz", source=None):
    landmark_path = root / path
    landmark_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        landmark_path,
        landmarks=np.zeros((5, BASE_FEATURES), dtype=np.float32),
        timestamps_ms=np.arange(5, dtype=np.int64),
        feature_schema_version=np.asarray(FEATURE_SCHEMA_VERSION, dtype=np.int64),
    )
    return {
        "sample_id": "sample-01",
        "label": "hello",
        "signer_id": "signer-01",
        "session_id": "session-01",
        "captured_at": "2026-11-26T12:00:00Z",
        "landmarks_path": path,
        "source": source or {
            "kind": "owner_recorded",
            "name": "Personal webcam recording",
            "license": "owner-recorded with explicit consent",
            "rights_confirmed": True,
            "consent_recorded": True,
            "attribution": "Owner-recorded example; consent confirmed at capture.",
        },
        "capture": {
            "feature_schema_version": FEATURE_SCHEMA_VERSION,
            "storage_mode": "landmarks_only",
            "frame_width": 640,
            "frame_height": 480,
            "frame_count": 5,
        },
    }


def test_valid_owner_recorded_row_is_appended_and_loaded(tmp_path):
    entry = _sample(tmp_path)
    append_manifest_entry(tmp_path, entry)
    assert load_manifest(tmp_path) == [entry]


@pytest.mark.parametrize("field,value", [
    ("signer_id", ""),
    ("session_id", ""),
    ("label", "Hello World"),
    ("captured_at", "2026-11-26T12:00:00"),
])
def test_required_metadata_is_validated(tmp_path, field, value):
    entry = _sample(tmp_path)
    entry[field] = value
    (tmp_path / "manifest.jsonl").write_text(json.dumps(entry) + "\n", encoding="utf-8")
    with pytest.raises(ManifestError):
        load_manifest(tmp_path)


def test_unconfirmed_rights_are_rejected(tmp_path):
    entry = _sample(tmp_path)
    entry["source"]["rights_confirmed"] = False
    (tmp_path / "manifest.jsonl").write_text(json.dumps(entry) + "\n", encoding="utf-8")
    with pytest.raises(ManifestError, match="rights"):
        load_manifest(tmp_path)


def test_third_party_rows_require_original_clip_rights_and_attribution(tmp_path):
    source = {
        "kind": "third_party",
        "name": "External BSL dataset",
        "license": "CC BY 4.0",
        "rights_confirmed": True,
        "attribution": "Required dataset and clip attribution",
        "source_url": "https://example.org/dataset",
    }
    entry = _sample(tmp_path, source=source)
    (tmp_path / "manifest.jsonl").write_text(json.dumps(entry) + "\n", encoding="utf-8")
    with pytest.raises(ManifestError, match="original clip copyright"):
        load_manifest(tmp_path)

    entry["source"]["original_copyright_confirmed"] = True
    (tmp_path / "manifest.jsonl").write_text(json.dumps(entry) + "\n", encoding="utf-8")
    assert len(load_manifest(tmp_path)) == 1


def test_path_traversal_and_raw_video_storage_are_rejected(tmp_path):
    entry = _sample(tmp_path)
    entry["landmarks_path"] = "../outside.npz"
    (tmp_path / "manifest.jsonl").write_text(json.dumps(entry) + "\n", encoding="utf-8")
    with pytest.raises(ManifestError, match="traversal"):
        load_manifest(tmp_path)

    entry = _sample(tmp_path)
    entry["capture"]["storage_mode"] = "raw_video"
    (tmp_path / "manifest.jsonl").write_text(json.dumps(entry) + "\n", encoding="utf-8")
    with pytest.raises(ManifestError, match="landmarks_only"):
        load_manifest(tmp_path)
