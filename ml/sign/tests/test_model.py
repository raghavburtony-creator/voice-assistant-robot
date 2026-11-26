from __future__ import annotations

import torch
import pytest

from otto_sign.features import FEATURE_DIM, FRAME_COUNT
from otto_sign.model import TemporalSignModel


def test_temporal_model_returns_logits_and_normalized_embeddings():
    model = TemporalSignModel(
        input_dim=FEATURE_DIM,
        num_classes=4,
        max_frames=FRAME_COUNT,
        dimension=32,
        depth=1,
        heads=4,
        embedding_dim=16,
    )
    logits, embeddings = model(torch.zeros(2, FRAME_COUNT, FEATURE_DIM))

    assert logits.shape == (2, 4)
    assert embeddings.shape == (2, 16)
    torch.testing.assert_close(
        embeddings.norm(dim=-1),
        torch.ones(2),
        atol=1e-5,
        rtol=1e-5,
    )


def test_temporal_model_rejects_wrong_feature_dimension():
    model = TemporalSignModel(input_dim=FEATURE_DIM, num_classes=3, dimension=32, depth=1, heads=4)
    with pytest.raises(ValueError, match="input must have shape"):
        model(torch.zeros(1, FRAME_COUNT, FEATURE_DIM - 1))
