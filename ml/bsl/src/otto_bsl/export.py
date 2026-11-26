"""Export a trained temporal candidate to ONNX; export never downloads or publishes it."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from .features import FEATURE_SCHEMA_VERSION, FEATURE_SIZE
from .model import TemporalConvTransformer


def export_checkpoint(checkpoint_path: str | Path, output_path: str | Path) -> Path:
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    if checkpoint.get("feature_schema_version") != FEATURE_SCHEMA_VERSION:
        raise ValueError("Checkpoint feature schema version is incompatible with this exporter")
    if int(checkpoint.get("input_features", -1)) != FEATURE_SIZE:
        raise ValueError("Checkpoint feature width is incompatible with this exporter")
    model = TemporalConvTransformer(
        input_features=int(checkpoint["input_features"]),
        classes=len(checkpoint["labels"]),
        sequence_frames=int(checkpoint["sequence_frames"]),
        hidden_size=int(checkpoint["hidden_size"]),
        heads=int(checkpoint["heads"]),
        layers=int(checkpoint["layers"]),
        dropout=0.0,
    )
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    example = torch.zeros(
        2,
        int(checkpoint["sequence_frames"]),
        int(checkpoint["input_features"]),
        dtype=torch.float32,
    )
    # The current ONNX exporter uses torch.export (dynamo=True); batch is
    # dynamic, while the versioned feature width and clip length are fixed.
    program = torch.onnx.export(
        model,
        (example,),
        f=None,
        input_names=["landmark_sequence"],
        output_names=["class_logits"],
        dynamic_shapes=({0: torch.export.Dim("batch_size")},),
        dynamo=True,
    )
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    program.save(destination)

    import onnx

    exported = onnx.load(str(destination))
    metadata = {
        "otto_bsl_feature_schema_version": str(FEATURE_SCHEMA_VERSION),
        "otto_bsl_feature_size": str(FEATURE_SIZE),
        "otto_bsl_sequence_frames": str(checkpoint["sequence_frames"]),
        "otto_bsl_labels": json.dumps(checkpoint["labels"], separators=(",", ":")),
        "otto_bsl_task": "personal-bsl-isolated-sign-prototype",
    }
    existing = {item.key for item in exported.metadata_props}
    for key, value in metadata.items():
        if key not in existing:
            item = exported.metadata_props.add()
            item.key = key
        else:
            item = next(prop for prop in exported.metadata_props if prop.key == key)
        item.value = value
    onnx.checker.check_model(exported)
    onnx.save(exported, str(destination))
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a trained personal BSL candidate to ONNX.")
    parser.add_argument("--checkpoint", type=Path, default=Path("artifacts/bsl_temporal_candidate.pt"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/bsl_temporal_candidate.onnx"))
    args = parser.parse_args()
    print(export_checkpoint(args.checkpoint, args.output))


if __name__ == "__main__":
    main()
