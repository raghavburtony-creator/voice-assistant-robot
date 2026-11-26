from __future__ import annotations

import csv

import pytest

from otto_sign.manifest import ManifestError, SampleRecord, build_split_plan, load_manifest

FIELDS = (
    "sample_id", "relative_path", "language", "label", "gloss", "signer_id",
    "session_id", "source", "rights_basis", "attribution",
)


def _write_manifest(path, rows):
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def _row(sample_id="one", session="day-1", relative_path="raw/hello/one.npz"):
    return {
        "sample_id": sample_id,
        "relative_path": relative_path,
        "language": "bsl",
        "label": "HELLO",
        "gloss": "HELLO",
        "signer_id": "self",
        "session_id": session,
        "source": "self-recorded",
        "rights_basis": "explicit-signer-consent",
        "attribution": "Owner-recorded BSL prototype sample",
    }


def test_loads_a_self_recorded_bsl_sample_from_inside_data_root(tmp_path):
    data_root = tmp_path / "data"
    sample = data_root / "raw" / "hello" / "one.npz"
    sample.parent.mkdir(parents=True)
    sample.touch()
    manifest = data_root / "manifest.csv"
    _write_manifest(manifest, [_row()])

    records = load_manifest(manifest, data_root)

    assert len(records) == 1
    assert records[0].label == "HELLO"
    assert records[0].language == "bsl"


@pytest.mark.parametrize(
    "changes",
    [
        {"language": "asl"},
        {"rights_basis": "unknown"},
        {"relative_path": "../outside.npz"},
        {"relative_path": "/tmp/outside.npz"},
        {"label": "HELLO SPACE"},
        {"session_id": ""},
    ],
)
def test_rejects_invalid_or_unapproved_manifest_rows(tmp_path, changes):
    data_root = tmp_path / "data"
    data_root.mkdir()
    row = _row()
    row.update(changes)
    manifest = data_root / "manifest.csv"
    _write_manifest(manifest, [row])

    with pytest.raises(ManifestError):
        load_manifest(manifest, data_root)


def test_third_party_data_requires_rights_basis_and_attribution(tmp_path):
    data_root = tmp_path / "data"
    sample = data_root / "raw" / "hello" / "one.npz"
    sample.parent.mkdir(parents=True)
    sample.touch()
    row = _row()
    row.update({"source": "bsl-dict", "rights_basis": "cc-by-4.0-verified", "attribution": ""})
    manifest = data_root / "manifest.csv"
    _write_manifest(manifest, [row])

    with pytest.raises(ManifestError, match="attribution"):
        load_manifest(manifest, data_root)


def _record(sample_id, session_id, signer_id="self", label="HELLO"):
    return SampleRecord(
        sample_id=sample_id,
        relative_path=f"raw/{sample_id}.npz",
        language="bsl",
        label=label,
        gloss=label,
        signer_id=signer_id,
        session_id=session_id,
        source="self-recorded",
        rights_basis="explicit-signer-consent",
        attribution="Owner-recorded",
    )


def test_single_signer_is_split_by_session_and_clearly_labelled_personal():
    records = [
        _record("a", "day-1"),
        _record("b", "day-2"),
        _record("c", "day-3"),
    ]

    plan = build_split_plan(records)

    assert plan.grouping == "session"
    assert plan.evaluation_scope == "personal-session-held-out"
    assert set(plan.assignments.values()) == {"train", "validation", "test"}


def test_three_signers_are_split_by_signer():
    records = [
        _record("a", "session-a", "signer-a"),
        _record("b", "session-b", "signer-b"),
        _record("c", "session-c", "signer-c"),
    ]

    plan = build_split_plan(records)

    assert plan.grouping == "signer"
    assert plan.evaluation_scope == "signer-independent"
    assert set(plan.assignments.values()) == {"train", "validation", "test"}


def test_two_sessions_are_not_misreported_as_a_valid_evaluation():
    with pytest.raises(ManifestError, match="three distinct capture sessions"):
        build_split_plan([_record("a", "day-1"), _record("b", "day-2"), _record("c", "day-2")])


def test_held_out_splits_may_lack_a_class_without_leaking_samples():
    from otto_sign.train import _check_class_coverage

    records = [
        _record("a", "train-session", "signer-a", "HELLO"),
        _record("d", "train-session", "signer-a", "THANK_YOU"),
        _record("b", "validation-session", "signer-b", "HELLO"),
        _record("c", "test-session", "signer-c", "THANK_YOU"),
    ]
    assignments = {"a": "train", "d": "train", "b": "validation", "c": "test"}

    _check_class_coverage(records, assignments)


def test_third_party_license_must_be_explicitly_verified(tmp_path):
    data_root = tmp_path / "data"
    sample = data_root / "raw" / "hello" / "one.npz"
    sample.parent.mkdir(parents=True)
    sample.touch()
    row = _row()
    row.update({
        "source": "bsl-dict",
        "rights_basis": "CC-BY-4.0",
        "attribution": "Oxford BSLDict",
    })
    manifest = data_root / "manifest.csv"
    _write_manifest(manifest, [row])

    with pytest.raises(ManifestError, match="third-party data requires"):
        load_manifest(manifest, data_root)
