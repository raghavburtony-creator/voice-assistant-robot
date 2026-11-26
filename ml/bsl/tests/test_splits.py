import pytest

from otto_bsl.splits import split_entries


def _entries(signers, sessions=3):
    return [
        {
            "sample_id": f"{signer}-{session}-{label}",
            "signer_id": signer,
            "session_id": f"session-{session}",
            "label": label,
        }
        for signer in signers
        for session in range(sessions)
        for label in ("hello", "thanks")
    ]


def _assert_disjoint(left, right, key):
    assert {item[key] for item in left}.isdisjoint({item[key] for item in right})


def test_multiple_signers_are_held_out_as_groups():
    plan = split_entries(_entries(["signer-a", "signer-b", "signer-c", "signer-d"]))
    assert plan.method == "signer-held-out"
    _assert_disjoint(plan.train, plan.validation, "signer_id")
    _assert_disjoint(plan.train, plan.test, "signer_id")
    _assert_disjoint(plan.validation, plan.test, "signer_id")
    assert plan.evaluation_label == "signer-held-out evaluation"


def test_one_signer_uses_session_held_out_personal_evaluation():
    plan = split_entries(_entries(["owner-1"], sessions=5))
    assert plan.method == "session-held-out"
    assert plan.evaluation_label == "session-held-out personal evaluation (single signer)"
    _assert_disjoint(plan.train, plan.validation, "session_id")
    _assert_disjoint(plan.train, plan.test, "session_id")
    _assert_disjoint(plan.validation, plan.test, "session_id")


def test_two_signers_or_two_sessions_fail_instead_of_random_clip_split():
    with pytest.raises(ValueError, match="three independent"):
        split_entries(_entries(["signer-a", "signer-b"]))
    with pytest.raises(ValueError, match="three independent"):
        split_entries(_entries(["owner-1"], sessions=2))
