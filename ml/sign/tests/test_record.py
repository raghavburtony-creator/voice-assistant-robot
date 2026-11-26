from __future__ import annotations

import pytest

from otto_sign.record import validate_label_id


@pytest.mark.parametrize("label", ["HELLO", "THANK_YOU", "HELLO_2", "variant-west-1", "Sign.v1"])
def test_accepts_stable_label_ids(label):
    assert validate_label_id(label) == label


@pytest.mark.parametrize("label", ["", "../escape", "../../tmp", "/absolute", "hello world", ".", "x" * 65])
def test_rejects_label_ids_that_could_escape_or_break_output_paths(label):
    with pytest.raises(ValueError):
        validate_label_id(label)
