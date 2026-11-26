"""What the training report says about itself must match the split that produced it (D-29: no overclaiming)."""
from __future__ import annotations

import pytest
import torch

from otto_sign.features import FEATURE_DIM, FRAME_COUNT
from otto_sign.model import TemporalSignModel
from otto_sign.train import _evaluate, evaluation_warning


def test_every_evaluation_scope_gets_its_own_honest_warning():
    personal = evaluation_warning("personal-session-held-out")
    multi = evaluation_warning("multi-signer-session-held-out")
    independent = evaluation_warning("signer-independent")
    assert len({personal, multi, independent}) == 3
    assert "one signer" in personal
    # The same signers sit in training and test here, so it must say so and must not borrow the signer-held-out text.
    assert "not signer-independent" in multi and "signers appear in training and test" in multi
    assert "Signer-held-out" in independent and "Signer-held-out" not in multi


def _model(classes: int) -> TemporalSignModel:
    return TemporalSignModel(
        input_dim=FEATURE_DIM, num_classes=classes, max_frames=FRAME_COUNT, dimension=32, depth=1, heads=4, embedding_dim=16
    )


@pytest.mark.parametrize("classes", [2, 3])
def test_top3_is_not_reported_when_there_are_three_or_fewer_classes(classes):
    x = torch.zeros(4, FRAME_COUNT, FEATURE_DIM)
    y = torch.arange(4) % classes
    metrics = _evaluate(_model(classes), x, y, batch_size=2, device=torch.device("cpu"))
    assert metrics["top3_accuracy"] is None  # it would always be 1.0
    assert 0.0 <= metrics["top1_accuracy"] <= 1.0


def test_top3_is_reported_when_it_means_something():
    x = torch.zeros(4, FRAME_COUNT, FEATURE_DIM)
    y = torch.arange(4) % 5
    metrics = _evaluate(_model(5), x, y, batch_size=2, device=torch.device("cpu"))
    assert isinstance(metrics["top3_accuracy"], float) and 0.0 <= metrics["top3_accuracy"] <= 1.0
