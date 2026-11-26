"""The ONNX export is part of the pipeline's promise, so it is exercised, not assumed."""
from __future__ import annotations

import pytest
import torch

from otto_sign.features import FEATURE_DIM, FRAME_COUNT
from otto_sign.model import TemporalSignModel
from otto_sign.train import _export_onnx, _require_onnx

onnx = pytest.importorskip("onnx")


def test_the_export_writes_a_valid_model_with_the_documented_inputs_and_outputs(tmp_path):
    model = TemporalSignModel(
        input_dim=FEATURE_DIM, num_classes=3, max_frames=FRAME_COUNT, dimension=32, depth=1, heads=4, embedding_dim=16
    )
    path = tmp_path / "model.onnx"
    _export_onnx(model, path, torch.device("cpu"))

    exported = onnx.load(str(path))
    onnx.checker.check_model(exported)
    assert [i.name for i in exported.graph.input] == ["landmark_sequence"]
    assert [o.name for o in exported.graph.output] == ["logits", "embedding"]


def test_a_missing_export_extra_is_reported_up_front(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def refuse_onnx(name, *args, **kwargs):
        if name == "onnx":
            raise ImportError("no onnx")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", refuse_onnx)
    with pytest.raises(RuntimeError, match="export extra"):
        _require_onnx()
