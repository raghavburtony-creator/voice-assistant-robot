"""Export a trained temporal candidate to ONNX; export never downloads or publishes it."""

from __future__ import annotations

import argparse
from pathlib import Path

import torch

from .model import TemporalConvTransformer


def export_checkpoint(checkpoint_path: str | Path, output_path: str | Path) -> Path:
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
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

    onnx.checker.check_model(onnx.load(str(destination)))
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a trained personal BSL candidate to ONNX.")
    parser.add_argument("--checkpoint", type=Path, default=Path("artifacts/bsl_temporal_candidate.pt"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/bsl_temporal_candidate.onnx"))
    args = parser.parse_args()
    print(export_checkpoint(args.checkpoint, args.output))


if __name__ == "__main__":
    main()
