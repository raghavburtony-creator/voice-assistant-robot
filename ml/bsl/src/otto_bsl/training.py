"""Train and evaluate the personal BSL isolated-sign temporal candidate."""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from .features import FEATURE_SCHEMA_VERSION, FEATURE_SIZE, make_temporal_features
from .manifest import load_manifest
from .model import TemporalConvTransformer
from .splits import SplitPlan, split_entries


def _load_arrays(entries: tuple[dict[str, Any], ...], root: Path, sequence_frames: int):
    features: list[np.ndarray] = []
    labels: list[str] = []
    for entry in entries:
        path = root / entry["landmarks_path"]
        with np.load(path, allow_pickle=False) as payload:
            base = payload["landmarks"]
        features.append(make_temporal_features(base, sequence_frames))
        labels.append(entry["label"])
    if not features:
        raise ValueError("A training split cannot be empty")
    return np.stack(features).astype(np.float32), labels


def _metrics(y_true: np.ndarray, y_pred: np.ndarray, labels: list[str]) -> dict[str, Any]:
    confusion = np.zeros((len(labels), len(labels)), dtype=np.int64)
    index = {label: position for position, label in enumerate(labels)}
    for truth, predicted in zip(y_true.tolist(), y_pred.tolist()):
        confusion[index[truth], index[predicted]] += 1
    per_class: dict[str, dict[str, float | int]] = {}
    precisions: list[float] = []
    recalls: list[float] = []
    f1s: list[float] = []
    for position, label in enumerate(labels):
        tp = int(confusion[position, position])
        predicted_count = int(confusion[:, position].sum())
        actual_count = int(confusion[position, :].sum())
        precision = tp / predicted_count if predicted_count else 0.0
        recall = tp / actual_count if actual_count else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class[label] = {
            "support": actual_count,
            "precision": precision,
            "recall": recall,
            "f1": f1,
        }
        precisions.append(precision)
        recalls.append(recall)
        f1s.append(f1)
    return {
        "accuracy": float(np.mean(y_true == y_pred)),
        "macro_precision": float(np.mean(precisions)),
        "macro_recall": float(np.mean(recalls)),
        "macro_f1": float(np.mean(f1s)),
        "per_class": per_class,
        "confusion_matrix": confusion.tolist(),
        "confusion_labels": labels,
    }


def _evaluate(model, loader, loss_function, device):
    model.eval()
    losses: list[float] = []
    truths: list[int] = []
    predictions: list[int] = []
    with torch.no_grad():
        for batch_features, batch_labels in loader:
            batch_features = batch_features.to(device)
            batch_labels = batch_labels.to(device)
            logits = model(batch_features)
            losses.append(float(loss_function(logits, batch_labels).item()))
            truths.extend(batch_labels.cpu().tolist())
            predictions.extend(logits.argmax(dim=1).cpu().tolist())
    return float(np.mean(losses)), np.asarray(truths), np.asarray(predictions)


def train_model(
    data_root: str | Path,
    output_dir: str | Path,
    *,
    sequence_frames: int = 64,
    epochs: int = 30,
    batch_size: int = 8,
    learning_rate: float = 0.0005,
    hidden_size: int = 128,
    heads: int = 4,
    layers: int = 2,
    seed: int = 42,
    patience: int = 6,
) -> dict[str, Any]:
    if epochs < 1 or batch_size < 1 or patience < 1:
        raise ValueError("epochs, batch_size and patience must be positive")
    root = Path(data_root).resolve()
    entries = load_manifest(root)
    labels = sorted({entry["label"] for entry in entries})
    if len(labels) < 2:
        raise ValueError("At least two distinct labels are required for isolated-sign classification")
    split = split_entries(entries, seed=seed)
    label_ids = {label: index for index, label in enumerate(labels)}

    train_x, train_names = _load_arrays(split.train, root, sequence_frames)
    validation_x, validation_names = _load_arrays(split.validation, root, sequence_frames)
    test_x, test_names = _load_arrays(split.test, root, sequence_frames)
    missing_training = sorted(set(labels) - set(train_names))
    if missing_training:
        raise ValueError(f"Training groups do not contain every class: {', '.join(missing_training)}")

    encode = lambda names: np.asarray([label_ids[name] for name in names], dtype=np.int64)
    train_y, validation_y, test_y = map(encode, (train_names, validation_names, test_names))
    torch.manual_seed(seed)
    np.random.seed(seed)
    random.seed(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = TemporalConvTransformer(
        input_features=FEATURE_SIZE,
        classes=len(labels),
        sequence_frames=sequence_frames,
        hidden_size=hidden_size,
        heads=heads,
        layers=layers,
    ).to(device)
    train_loader = DataLoader(
        TensorDataset(torch.from_numpy(train_x), torch.from_numpy(train_y)),
        batch_size=batch_size,
        shuffle=True,
    )
    validation_loader = DataLoader(
        TensorDataset(torch.from_numpy(validation_x), torch.from_numpy(validation_y)),
        batch_size=batch_size,
        shuffle=False,
    )
    test_loader = DataLoader(
        TensorDataset(torch.from_numpy(test_x), torch.from_numpy(test_y)),
        batch_size=batch_size,
        shuffle=False,
    )
    loss_function = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
    best_validation_loss = float("inf")
    best_state = None
    best_epoch = 0
    stale_epochs = 0

    for epoch in range(1, epochs + 1):
        model.train()
        for batch_features, batch_labels in train_loader:
            optimizer.zero_grad(set_to_none=True)
            logits = model(batch_features.to(device))
            loss = loss_function(logits, batch_labels.to(device))
            loss.backward()
            optimizer.step()
        validation_loss, _, _ = _evaluate(model, validation_loader, loss_function, device)
        if validation_loss < best_validation_loss:
            best_validation_loss = validation_loss
            best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
            best_epoch = epoch
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= patience:
                break

    if best_state is None:
        raise RuntimeError("Training produced no valid checkpoint")
    model.load_state_dict(best_state)
    test_loss, truth_ids, predicted_ids = _evaluate(model, test_loader, loss_function, device)
    truth_labels = np.asarray([labels[index] for index in truth_ids])
    predicted_labels = np.asarray([labels[index] for index in predicted_ids])
    metrics = _metrics(truth_labels, predicted_labels, labels)

    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    checkpoint_path = output / "bsl_temporal_candidate.pt"
    checkpoint = {
        "state_dict": best_state,
        "labels": labels,
        "input_features": FEATURE_SIZE,
        "sequence_frames": sequence_frames,
        "hidden_size": hidden_size,
        "heads": heads,
        "layers": layers,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "evaluation_method": split.method,
        "evaluation_label": split.evaluation_label,
        "best_epoch": best_epoch,
    }
    torch.save(checkpoint, checkpoint_path)

    report = {
        "task": "personal BSL isolated-sign classification",
        "evaluation_method": split.method,
        "evaluation_label": split.evaluation_label,
        "signer_count": len({entry["signer_id"] for entry in entries}),
        "session_count": len({entry["session_id"] for entry in entries}),
        "sample_count": len(entries),
        "labels": labels,
        "split_group_counts": {
            "train": len(split.train_groups),
            "validation": len(split.validation_groups),
            "test": len(split.test_groups),
        },
        "best_epoch": best_epoch,
        "best_validation_loss": best_validation_loss,
        "test_loss": test_loss,
        **metrics,
        "limitations": [
            "This is a personal prototype evaluation, not signer-independent evidence when only one signer is present.",
            "No sentence recognition, translation or production SignRecognizer integration is claimed.",
            "Small or imbalanced datasets can produce unstable per-class metrics.",
        ],
    }
    (output / "evaluation.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the offline personal BSL isolated-sign candidate.")
    parser.add_argument("--data-root", type=Path, default=Path("local-data"))
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts"))
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--sequence-frames", type=int, default=64)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    report = train_model(
        args.data_root,
        args.output_dir,
        epochs=args.epochs,
        batch_size=args.batch_size,
        sequence_frames=args.sequence_frames,
        seed=args.seed,
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
