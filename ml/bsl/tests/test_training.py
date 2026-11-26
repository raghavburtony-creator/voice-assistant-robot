import json

import numpy as np

from otto_bsl.export import export_checkpoint
from otto_bsl.features import BASE_FEATURES, FEATURE_SCHEMA_VERSION
from otto_bsl.training import train_model


def _write_dataset(root):
    (root / "landmarks").mkdir(parents=True)
    rows = []
    for signer in ("signer-a", "signer-b", "signer-c"):
        for label_index, label in enumerate(("hello", "thanks")):
            sample_id = f"{signer}-{label}"
            points = np.zeros((10, BASE_FEATURES), dtype=np.float32)
            points[:, label_index] = np.linspace(0.0, 1.0, 10) + label_index
            np.savez_compressed(
                root / "landmarks" / f"{sample_id}.npz",
                landmarks=points,
                timestamps_ms=np.arange(10, dtype=np.int64) * 33,
                feature_schema_version=np.asarray(FEATURE_SCHEMA_VERSION, dtype=np.int64),
            )
            rows.append({
                "sample_id": sample_id,
                "label": label,
                "signer_id": signer,
                "session_id": f"session-{signer}",
                "captured_at": "2026-11-26T12:00:00Z",
                "landmarks_path": f"landmarks/{sample_id}.npz",
                "source": {
                    "kind": "owner_recorded",
                    "name": "Synthetic test fixture",
                    "license": "owner-recorded with explicit consent",
                    "rights_confirmed": True,
                    "consent_recorded": True,
                    "attribution": "Synthetic test fixture; no person data.",
                },
                "capture": {
                    "feature_schema_version": FEATURE_SCHEMA_VERSION,
                    "storage_mode": "landmarks_only",
                    "frame_width": 640,
                    "frame_height": 480,
                    "frame_count": 10,
                },
            })
    (root / "manifest.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in rows),
        encoding="utf-8",
    )


def test_training_reports_signer_split_and_exports_valid_onnx(tmp_path):
    data_root = tmp_path / "data"
    output_dir = tmp_path / "artifacts"
    data_root.mkdir()
    _write_dataset(data_root)
    report = train_model(
        data_root,
        output_dir,
        sequence_frames=8,
        epochs=1,
        batch_size=2,
        hidden_size=16,
        heads=4,
        layers=1,
        patience=1,
    )
    assert report["evaluation_method"] == "signer-held-out"
    assert report["sample_count"] == 6
    assert set(report["per_class"]) == {"hello", "thanks"}
    assert (output_dir / "evaluation.json").is_file()

    checkpoint = output_dir / "bsl_temporal_candidate.pt"
    onnx_path = export_checkpoint(checkpoint, output_dir / "bsl_temporal_candidate.onnx")
    assert onnx_path.is_file() and onnx_path.stat().st_size > 0
    assert 0.0 <= report["macro_f1"] <= 1.0
