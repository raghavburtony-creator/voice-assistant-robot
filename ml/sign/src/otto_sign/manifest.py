"""Auditable local sample manifests and leakage-resistant evaluation splits."""

from __future__ import annotations

import csv
import random
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable

MANIFEST_COLUMNS = (
    "sample_id",
    "relative_path",
    "language",
    "label",
    "gloss",
    "signer_id",
    "session_id",
    "source",
    "rights_basis",
    "attribution",
)
_LABEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
_VERIFIED_THIRD_PARTY_RIGHTS = {
    "explicit-rights-holder-permission",
    "cc-by-4.0-verified",
    "cc-by-sa-4.0-verified",
    "public-domain-verified",
}


class ManifestError(ValueError):
    """Raised when a dataset manifest is incomplete or unsafe to train from."""


@dataclass(frozen=True)
class SampleRecord:
    sample_id: str
    relative_path: str
    language: str
    label: str
    gloss: str
    signer_id: str
    session_id: str
    source: str
    rights_basis: str
    attribution: str


@dataclass(frozen=True)
class SplitPlan:
    assignments: dict[str, str]
    grouping: str
    evaluation_scope: str


def _required(row: dict[str, str], field: str, line: int) -> str:
    value = (row.get(field) or "").strip()
    if not value:
        raise ManifestError(f"manifest row {line}: {field} is required")
    return value


def _safe_relative_path(value: str, line: int) -> str:
    if "\\" in value:
        raise ManifestError(f"manifest row {line}: use forward slashes in relative_path")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise ManifestError(f"manifest row {line}: relative_path must stay inside the data directory")
    if path.suffix.lower() != ".npz":
        raise ManifestError(f"manifest row {line}: samples must be compressed landmark .npz files")
    return path.as_posix()


def load_manifest(path: str | Path, data_root: str | Path | None = None) -> list[SampleRecord]:
    """Load BSL examples and reject unknown data provenance before any training.

    The manifest never downloads data. Third-party samples must include a
    verified rights basis and attribution; self-recorded samples must affirm
    explicit signer consent. File paths are constrained to data_root.
    """
    manifest_path = Path(path)
    if not manifest_path.is_file():
        raise ManifestError(f"manifest does not exist: {manifest_path}")

    root = Path(data_root).resolve() if data_root is not None else manifest_path.parent.resolve()
    records: list[SampleRecord] = []
    seen_ids: set[str] = set()

    with manifest_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing_columns = set(MANIFEST_COLUMNS) - set(reader.fieldnames or [])
        if missing_columns:
            raise ManifestError("manifest is missing columns: " + ", ".join(sorted(missing_columns)))

        for line, row in enumerate(reader, start=2):
            sample_id = _required(row, "sample_id", line)
            if sample_id in seen_ids:
                raise ManifestError(f"manifest row {line}: duplicate sample_id {sample_id}")
            seen_ids.add(sample_id)

            relative_path = _safe_relative_path(_required(row, "relative_path", line), line)
            language = _required(row, "language", line).lower()
            if language != "bsl":
                raise ManifestError(f"manifest row {line}: this pipeline accepts BSL samples only")

            label = _required(row, "label", line)
            if not _LABEL.fullmatch(label):
                raise ManifestError(f"manifest row {line}: label must be a stable ID (letters, digits, dot, underscore or hyphen)")
            gloss = _required(row, "gloss", line)
            signer_id = _required(row, "signer_id", line)
            session_id = _required(row, "session_id", line)
            source = _required(row, "source", line)
            rights_basis = _required(row, "rights_basis", line)
            attribution = (row.get("attribution") or "").strip()

            if source.casefold() == "self-recorded":
                if rights_basis != "explicit-signer-consent":
                    raise ManifestError(f"manifest row {line}: self-recorded samples require explicit-signer-consent")
            else:
                if rights_basis.casefold() not in _VERIFIED_THIRD_PARTY_RIGHTS or not attribution:
                    raise ManifestError(
                        f"manifest row {line}: third-party data requires one of "
                        f"{', '.join(sorted(_VERIFIED_THIRD_PARTY_RIGHTS))} and attribution"
                    )

            record = SampleRecord(
                sample_id=sample_id,
                relative_path=relative_path,
                language=language,
                label=label,
                gloss=gloss,
                signer_id=signer_id,
                session_id=session_id,
                source=source,
                rights_basis=rights_basis,
                attribution=attribution,
            )

            sample_path = (root / relative_path).resolve()
            try:
                sample_path.relative_to(root)
            except ValueError as exc:
                raise ManifestError(f"manifest row {line}: sample path escapes data_root") from exc
            if data_root is not None and not sample_path.is_file():
                raise ManifestError(f"manifest row {line}: sample file does not exist: {relative_path}")

            records.append(record)

    if not records:
        raise ManifestError("manifest contains no samples")
    return records


def build_split_plan(records: Iterable[SampleRecord], seed: int = 42) -> SplitPlan:
    """Split by signer when possible, otherwise by capture session.

    At least three independent groups are required. A single-signer dataset is
    explicitly labelled session-held-out and is never reported as signer-
    independent. Two signers are not enough for a three-way signer split.
    """
    rows = list(records)
    if len(rows) < 3:
        raise ManifestError("at least three samples are required to build an evaluation split")

    signer_ids = {row.signer_id for row in rows}
    if len(signer_ids) >= 3:
        grouping = "signer"
        evaluation_scope = "signer-independent"
        group_for = lambda row: row.signer_id
    else:
        session_ids = {f"{row.signer_id}::{row.session_id}" for row in rows}
        if len(session_ids) < 3:
            raise ManifestError(
                "need at least three signers for signer-independent evaluation, "
                "or three distinct capture sessions for a session-held-out prototype"
            )
        grouping = "session"
        evaluation_scope = "personal-session-held-out" if len(signer_ids) == 1 else "multi-signer-session-held-out"
        group_for = lambda row: f"{row.signer_id}::{row.session_id}"

    groups = sorted({group_for(row) for row in rows})
    random.Random(seed).shuffle(groups)

    test_count = max(1, round(len(groups) * 0.15))
    validation_count = max(1, round(len(groups) * 0.15))
    while len(groups) - test_count - validation_count < 1:
        if validation_count > 1:
            validation_count -= 1
        elif test_count > 1:
            test_count -= 1
        else:
            raise ManifestError("not enough independent groups for train, validation and test")

    test_groups = set(groups[:test_count])
    validation_groups = set(groups[test_count : test_count + validation_count])
    train_groups = set(groups[test_count + validation_count :])

    assignments: dict[str, str] = {}
    for row in rows:
        group = group_for(row)
        split = "test" if group in test_groups else "validation" if group in validation_groups else "train"
        assignments[row.sample_id] = split

    if set(assignments.values()) != {"train", "validation", "test"}:
        raise ManifestError("split failed to produce train, validation and test samples")

    return SplitPlan(assignments=assignments, grouping=grouping, evaluation_scope=evaluation_scope)
