"""Compact temporal Conv-Transformer for isolated BSL sign classification."""

from __future__ import annotations

import torch
from torch import Tensor, nn
import torch.nn.functional as F


class TemporalConvBlock(nn.Module):
    """Depthwise temporal convolution to model short local motion patterns."""

    def __init__(self, dimension: int, kernel_size: int = 5, dropout: float = 0.1) -> None:
        super().__init__()
        self.norm = nn.LayerNorm(dimension)
        self.expand = nn.Linear(dimension, dimension * 2)
        self.depthwise = nn.Conv1d(
            dimension,
            dimension,
            kernel_size=kernel_size,
            padding=kernel_size // 2,
            groups=dimension,
        )
        self.mix_norm = nn.LayerNorm(dimension)
        self.project = nn.Linear(dimension, dimension)
        self.dropout = nn.Dropout(dropout)

    def forward(self, values: Tensor) -> Tensor:
        hidden = F.glu(self.expand(self.norm(values)), dim=-1)
        hidden = self.depthwise(hidden.transpose(1, 2)).transpose(1, 2)
        hidden = self.project(F.gelu(self.mix_norm(hidden)))
        return values + self.dropout(hidden)


class TemporalSignModel(nn.Module):
    """Small convolution/attention model that accepts normalized landmark sequences."""

    def __init__(
        self,
        input_dim: int,
        num_classes: int,
        max_frames: int = 64,
        dimension: int = 128,
        depth: int = 3,
        heads: int = 4,
        embedding_dim: int = 128,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        if input_dim < 1 or num_classes < 2 or max_frames < 2:
            raise ValueError("input_dim, max_frames and at least two classes are required")
        if dimension % heads:
            raise ValueError("dimension must be divisible by heads")

        self.input_dim = input_dim
        self.num_classes = num_classes
        self.max_frames = max_frames
        self.stem = nn.Sequential(nn.Linear(input_dim, dimension), nn.LayerNorm(dimension))
        self.position = nn.Parameter(torch.zeros(1, max_frames, dimension))
        nn.init.trunc_normal_(self.position, std=0.02)
        self.convolutions = nn.ModuleList(
            TemporalConvBlock(dimension, dropout=dropout) for _ in range(depth)
        )
        self.attention = nn.ModuleList(
            nn.TransformerEncoderLayer(
                d_model=dimension,
                nhead=heads,
                dim_feedforward=dimension * 2,
                dropout=dropout,
                activation="gelu",
                batch_first=True,
                norm_first=True,
            )
            for _ in range(depth)
        )
        self.final_norm = nn.LayerNorm(dimension)
        self.embedding = nn.Linear(dimension, embedding_dim)
        self.classifier = nn.Linear(embedding_dim, num_classes)

    def forward(self, frames: Tensor) -> tuple[Tensor, Tensor]:
        if frames.ndim != 3 or frames.shape[-1] != self.input_dim:
            raise ValueError(f"input must have shape [batch, frames, {self.input_dim}]")
        if frames.shape[1] > self.max_frames:
            raise ValueError(f"input has {frames.shape[1]} frames; maximum is {self.max_frames}")

        hidden = self.stem(frames) + self.position[:, : frames.shape[1]]
        for convolution, attention in zip(self.convolutions, self.attention, strict=True):
            hidden = convolution(hidden)
            hidden = attention(hidden)
        pooled = self.final_norm(hidden).mean(dim=1)
        embedding = F.normalize(self.embedding(pooled), p=2, dim=-1)
        logits = self.classifier(embedding)
        return logits, embedding


def count_parameters(model: nn.Module) -> int:
    return sum(parameter.numel() for parameter in model.parameters() if parameter.requires_grad)
