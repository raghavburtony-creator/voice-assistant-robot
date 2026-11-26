"""Train and export the local BSL isolated-sign model."""

from __future__ import annotations

import argparse
import copy
import json
import random
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
from torch import Tensor
from torch.utils.data import DataLoader, TensorDataset

from .features import FEATURE_DIM, FEATURE_SCHEMA_VERSION, FRAME_COUNT, sequence_features
from .manifest import ManifestError, SampleRecord, build_split_plan, load_manifest
from .model import TemporalSignModel


def _load_feature_rows(records: list[SampleRecord], data_root: Path, frame_count: int) -> dict[str, np.ndarray]:
    features: dict[str, np.ndarray] = {}
    for record in records:
        sample_path = (data_root / record.relative_path).resolve()
        try:
            sample_path.relative_to(data_root.resolve())
        except ValueError as exc:
            raise ManifestError(f"sample path escapes data directory: {record.relative_path}") from exc
        try:
            with np.load(sample_path, allow_pickle=False) as sample:
                landmarks = sample["landmarks"]
                width = int(np.asarray(sample["frame_width"]).item())
                height = int(np.asarray(sample["frame_height"]).item())
                timestamps = sample["timestamps_ms"] if "timestamps_ms" in sample.files else None
        except (OSError, KeyError, ValueError) as exc:
            raise ManifestError(f"could not read landmark sample {record.relative_path}: {exc}") from exc
        features[record.sample_id] = sequence_features(
            landmarks,
            width,
            height,
            timestamps_ms=timestamps,
            frame_count=frame_count,
        )
    return features


def _check_class_coverage(records: list[SampleRecord], assignments: dict[str, str]) -> None:
    expected = {record.label for record in records}
    by_split: dict[str, set[str]] = defaultdict(set)
    counts: dict[str, int] = defaultdict(int)
    for record in records:
        split = assignments[record.sample_id]
        by_split[split].add(record.label)
        counts[split] += 1

    if by_split["train"] != expected:
        missing = expected - by_split["train"]
        raise ManifestError(
            "training split is missing labels: " + ", ".join(sorted(missing))
        )
    for split in ("validation", "test"):
        if counts[split] == 0:
            raise ManifestError(f"{split} split is empty")
    # Held-out signers/session groups need not demonstrate every class. Report
    # per-class support and leave missing held-out classes unscored rather than
    # leaking samples across the split to manufacture coverage.


def _evaluate(model: TemporalSignModel, x: Tensor, y: Tensor, batch_size: int, device: torch.device) -> dict:
    model.eval()
    loader = DataLoader(TensorDataset(x, y), batch_size=batch_size, shuffle=False)
    correct = 0
    top_three = 0
    count = 0
    per_class_total = torch.zeros(model.num_classes, dtype=torch.long)
    per_class_correct = torch.zeros(model.num_classes, dtype=torch.long)
    with torch.no_grad():
        for batch_x, batch_y in loader:
            logits, _ = model(batch_x.to(device))
            targets = batch_y.to(device)
            predictions = logits.argmax(dim=1)
            correct += int((predictions == targets).sum().item())
            k = min(3, model.num_classes)
            top_indices = logits.topk(k, dim=1).indices
            top_three += int((top_indices == targets.unsqueeze(1)).any(dim=1).sum().item())
            count += int(targets.numel())
            for label in range(model.num_classes):
                selected = targets == label
                per_class_total[label] += selected.sum().cpu()
                per_class_correct[label] += ((predictions == targets) & selected).sum().cpu()

    class_metrics = {}
    for label, support, hits in zip(
        range(model.num_classes), per_class_total.tolist(), per_class_correct.tolist(), strict=True
    ):
        class_metrics[str(label)] = {
            "support": support,
            "recall": (hits / support) if support else None,
        }
    return {
        "samples": count,
        "top1_accuracy": (correct / count) if count else 0.0,
        "top3_accuracy": (top_three / count) if count else 0.0,
        "per_class_index": class_metrics,
    }


def _export_onnx(model: TemporalSignModel, output_path: Path, device: torch.device) -> None:
    try:
        import onnx  # noqa: F401
    except ImportError as exc:
        raise RuntimeError("ONNX export requires the optional export extra") from exc

    model.eval()
    dummy = torch.zeros(1, model.max_frames, model.input_dim, dtype=torch.float32, device=device)
    torch.onnx.export(
        model,
        dummy,
        str(output_path),
        input_names=["landmark_sequence"],
        output_names=["logits", "embedding"],
        dynamic_axes={
            "landmark_sequence": {0: "batch"},
            "logits": {0: "batch"},
            "embedding": {0: "batch"},
        },
        opset_version=17,
        dynamo=False,
    )


def train(args: argparse.Namespace) -> dict:
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)

    data_root = Path(args.data_root).resolve()
    records = load_manifest(args.manifest, data_root=data_root)
    plan = build_split_plan(records, seed=args.seed)
    _check_class_coverage(records, plan.assignments)
    labels = sorted({record.label for record in records})
    if len(labels) < 2:
        raise ManifestError("at least two distinct BSL sign labels are required to train a classifier")
    label_to_index = {label: index for index, label in enumerate(labels)}
    feature_rows = _load_feature_rows(records, data_root, args.frame_count)

    split_rows: dict[str, list[SampleRecord]] = {name: [] for name in ("train", "validation", "test")}
    for record in records:
        split_rows[plan.assignments[record.sample_id]].append(record)

    def tensors(split: str) -> tuple[Tensor, Tensor]:
        rows = split_rows[split]
        x = np.stack([feature_rows[row.sample_id] for row in rows]).astype(np.float32)
        y = np.asarray([label_to_index[row.label] for row in rows], dtype=np.int64)
        return torch.from_numpy(x), torch.from_numpy(y)

    train_x, train_y = tensors("train")
    validation_x, validation_y = tensors("validation")
    test_x, test_y = tensors("test")

    if args.device == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(args.device)
    model = TemporalSignModel(
        input_dim=FEATURE_DIM,
        num_classes=len(labels),
        max_frames=args.frame_count,
    ).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    generator = torch.Generator().manual_seed(args.seed)
    loader = DataLoader(
        TensorDataset(train_x, train_y),
        batch_size=args.batch_size,
        shuffle=True,
        generator=generator,
    )

    best_validation = -1.0
    best_state = copy.deepcopy(model.state_dict())
    best_epoch = 0
    stale_epochs = 0
    for epoch in range(1, args.epochs + 1):
        model.train()
        for batch_x, batch_y in loader:
            optimizer.zero_grad(set_to_none=True)
            logits, _ = model(batch_x.to(device))
            loss = torch.nn.functional.cross_entropy(logits, batch_y.to(device), label_smoothing=0.05)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
        scheduler.step()

        validation_metrics = _evaluate(model, validation_x, validation_y, args.batch_size, device)
        score = validation_metrics["top1_accuracy"]
        print(
            f"epoch {epoch:03d}/{args.epochs} "
            f"validation_top1={score:.4f} validation_top3={validation_metrics['top3_accuracy']:.4f}"
        )
        if score > best_validation:
            best_validation = score
            best_state = copy.deepcopy(model.state_dict())
            best_epoch = epoch
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= args.patience:
                break

    model.load_state_dict(best_state)
    test_metrics = _evaluate(model, test_x, test_y, args.batch_size, device)
    test_metrics["per_class"] = {
        labels[int(index)]: result for index, result in test_metrics.pop("per_class_index").items()
    }

    output_dir = Path(args.output).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = output_dir / "best.pt"
    onnx_path = output_dir / "bsl-sign-v1.onnx"
    torch.save(
        {
            "state_dict": model.state_dict(),
            "input_dim": model.input_dim,
            "num_classes": model.num_classes,
            "max_frames": model.max_frames,
            "labels": labels,
            "feature_schema_version": FEATURE_SCHEMA_VERSION,
        },
        checkpoint_path,
    )
    _export_onnx(model, onnx_path, device)

    metadata = {
        "model_version": "otto-bsl-temporal-v1",
        "language": "bsl",
        "task": "isolated-sign-classification",
        "labels": labels,
        "input_dim": FEATURE_DIM,
        "frame_count": args.frame_count,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "evaluation_scope": plan.evaluation_scope,
        "split_grouping": plan.grouping,
        "best_epoch": best_epoch,
        "training_samples": len(split_rows["train"]),
        "validation_samples": len(split_rows["validation"]),
        "test_samples": len(split_rows["test"]),
        "checkpoint": checkpoint_path.name,
        "onnx": onnx_path.name,
    }
    metrics = {
        "evaluation_scope": plan.evaluation_scope,
        "split_grouping": plan.grouping,
        "best_epoch": best_epoch,
        "best_validation_top1": best_validation,
        "test": test_metrics,
        "warning": (
            "Session-held-out results from one signer do not measure generalization to other signers."
            if plan.evaluation_scope == "personal-session-held-out"
            else "Signer-held-out results still require external signer and real-world validation before release."
        ),
    }
    (output_dir / "model.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    (output_dir / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {onnx_path} ({plan.evaluation_scope}).")
    return metrics


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Train an isolated BSL sign model from a local consented manifest.")
    parser.add_argument("--manifest", default="data/manifest.csv")
    parser.add_argument("--data-root", default="data")
    parser.add_argument("--output", default="runs/bsl-personal")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--patience", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--frame-count", type=int, default=FRAME_COUNT)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if args.epochs < 1 or args.patience < 1 or args.batch_size < 1:
        parser.error("epochs, patience and batch-size must be positive")
    try:
        train(args)
    except (ManifestError, RuntimeError, ValueError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
