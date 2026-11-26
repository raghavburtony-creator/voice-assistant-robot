"""Leak-resistant grouped evaluation splits for signer/session-held-out prototypes."""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any, Sequence


@dataclass(frozen=True)
class SplitPlan:
    method: str
    train: tuple[dict[str, Any], ...]
    validation: tuple[dict[str, Any], ...]
    test: tuple[dict[str, Any], ...]
    train_groups: tuple[str, ...]
    validation_groups: tuple[str, ...]
    test_groups: tuple[str, ...]

    @property
    def evaluation_label(self) -> str:
        if self.method == "signer-held-out":
            return "signer-held-out evaluation"
        return "session-held-out personal evaluation (single signer)"


def _partition_groups(groups: Sequence[str], seed: int) -> tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    unique = sorted(set(groups))
    if len(unique) < 3:
        raise ValueError(
            "At least three independent signers or sessions are required for train/validation/test; "
            "collect more independent groups instead of falling back to a random clip split."
        )
    shuffled = list(unique)
    random.Random(seed).shuffle(shuffled)
    count = len(shuffled)
    train_count = min(max(1, round(count * 0.70)), count - 2)
    validation_count = min(max(1, round(count * 0.15)), count - train_count - 1)
    return (
        tuple(sorted(shuffled[:train_count])),
        tuple(sorted(shuffled[train_count:train_count + validation_count])),
        tuple(sorted(shuffled[train_count + validation_count:])),
    )


def split_entries(entries: Sequence[dict[str, Any]], *, seed: int = 42) -> SplitPlan:
    """Split by signer whenever more than one signer exists; one signer uses sessions.

    Two signers are not enough to produce disjoint train/validation/test groups.
    The function deliberately refuses a random clip split in that case.
    """
    if not entries:
        raise ValueError("No manifest entries were supplied")
    signers = {item["signer_id"] for item in entries}
    if len(signers) > 1:
        method, field = "signer-held-out", "signer_id"
    else:
        method, field = "session-held-out", "session_id"

    groups = sorted({item[field] for item in entries})
    train_groups, validation_groups, test_groups = _partition_groups(groups, seed)
    by_group = lambda selected: tuple(
        item for item in entries if item[field] in set(selected)
    )
    plan = SplitPlan(
        method=method,
        train=by_group(train_groups),
        validation=by_group(validation_groups),
        test=by_group(test_groups),
        train_groups=train_groups,
        validation_groups=validation_groups,
        test_groups=test_groups,
    )
    if not plan.train or not plan.validation or not plan.test:
        raise ValueError("Evaluation split unexpectedly produced an empty partition")
    return plan
