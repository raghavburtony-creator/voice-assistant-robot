"""Small temporal Conv-Transformer candidate; no production recognizer integration."""

from __future__ import annotations

import math

import torch
from torch import nn


class TemporalAttentionBlock(nn.Module):
    """A minimal attention/MLP block built from export-friendly tensor operations."""

    def __init__(self, hidden_size: int, heads: int, dropout: float = 0.1) -> None:
        super().__init__()
        if hidden_size % heads:
            raise ValueError("hidden_size must be divisible by heads")
        self.hidden_size = hidden_size
        self.heads = heads
        self.head_size = hidden_size // heads
        self.norm_attention = nn.LayerNorm(hidden_size)
        self.qkv = nn.Linear(hidden_size, hidden_size * 3)
        self.attention_output = nn.Linear(hidden_size, hidden_size)
        self.norm_feed_forward = nn.LayerNorm(hidden_size)
        self.feed_forward = nn.Sequential(
            nn.Linear(hidden_size, hidden_size * 4),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size * 4, hidden_size),
        )
        self.dropout = nn.Dropout(dropout)

    def forward(self, sequence: torch.Tensor) -> torch.Tensor:
        batch, frames, _ = sequence.shape
        normalized = self.norm_attention(sequence)
        qkv = self.qkv(normalized).reshape(batch, frames, 3, self.heads, self.head_size)
        query = qkv[:, :, 0].transpose(1, 2)
        key = qkv[:, :, 1].transpose(1, 2)
        value = qkv[:, :, 2].transpose(1, 2)
        weights = torch.softmax(torch.matmul(query, key.transpose(-2, -1)) / math.sqrt(self.head_size), dim=-1)
        attended = torch.matmul(weights, value).transpose(1, 2).reshape(batch, frames, self.hidden_size)
        sequence = sequence + self.dropout(self.attention_output(attended))
        sequence = sequence + self.dropout(self.feed_forward(self.norm_feed_forward(sequence)))
        return sequence


class TemporalConvTransformer(nn.Module):
    """Classify a fixed-length sequence of normalized holistic landmark features."""

    def __init__(
        self,
        *,
        input_features: int,
        classes: int,
        sequence_frames: int = 64,
        hidden_size: int = 128,
        heads: int = 4,
        layers: int = 2,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        if input_features < 1 or classes < 2 or sequence_frames < 8:
            raise ValueError("input_features, classes and sequence_frames are outside supported bounds")
        if layers < 1 or hidden_size % heads:
            raise ValueError("layers must be positive and hidden_size divisible by heads")
        self.input_features = input_features
        self.classes = classes
        self.sequence_frames = sequence_frames
        self.hidden_size = hidden_size
        self.heads = heads
        self.layers = layers
        self.temporal_convolution = nn.Conv1d(input_features, hidden_size, kernel_size=5, padding=2)
        self.position = nn.Parameter(torch.zeros(1, sequence_frames, hidden_size))
        nn.init.normal_(self.position, mean=0.0, std=0.02)
        self.blocks = nn.ModuleList(
            TemporalAttentionBlock(hidden_size, heads, dropout) for _ in range(layers)
        )
        self.output_norm = nn.LayerNorm(hidden_size)
        self.classifier = nn.Linear(hidden_size, classes)

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        sequence = self.temporal_convolution(features.transpose(1, 2)).transpose(1, 2)
        sequence = sequence + self.position
        for block in self.blocks:
            sequence = block(sequence)
        pooled = self.output_norm(sequence).mean(dim=1)
        return self.classifier(pooled)
