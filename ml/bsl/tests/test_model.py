import torch

from otto_bsl.features import FEATURE_SIZE
from otto_bsl.model import TemporalConvTransformer


def test_temporal_conv_transformer_returns_one_logit_vector_per_clip():
    model = TemporalConvTransformer(
        input_features=FEATURE_SIZE,
        classes=3,
        sequence_frames=16,
        hidden_size=32,
        heads=4,
        layers=1,
    )
    values = torch.randn(2, 16, FEATURE_SIZE)
    output = model(values)
    assert output.shape == (2, 3)
    output.square().mean().backward()
    assert all(parameter.grad is not None for parameter in model.parameters() if parameter.requires_grad)
