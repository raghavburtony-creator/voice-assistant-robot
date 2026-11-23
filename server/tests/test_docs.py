"""The decision log, the labels, the milestones and the issue templates stay consistent (docs/decisions.md, CONTRIBUTING.md)."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
DECISIONS = (ROOT / "docs" / "decisions.md").read_text(encoding="utf-8")
CONTRIBUTING = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")
LABELS = json.loads((ROOT / ".github" / "labels.json").read_text(encoding="utf-8"))
MILESTONES = json.loads((ROOT / ".github" / "milestones.json").read_text(encoding="utf-8"))
TEMPLATES = sorted((ROOT / ".github" / "ISSUE_TEMPLATE").glob("[0-9]-*.yml"))

SECTIONS = ["Why", "Scope", "Out of scope", "Done when", "Read first", "Blocks / Blocked by", "Parent"]
Q_STATUS = re.compile(r"^(open|dropped|answered by D-\d{2})$")
D_STATUS = re.compile(r"^(current|amended by D-\d{2}|superseded by D-\d{2})$")


def _section(text: str, heading: str) -> str:
    start = text.index(heading)
    end = text.find("\n## ", start + len(heading))
    return text[start:] if end == -1 else text[start:end]


def _table(text: str) -> list[list[str]]:
    """The body rows of the first markdown table in `text`, as stripped cells."""
    rows = [line for line in text.splitlines() if line.startswith("|")]
    return [[cell.strip() for cell in row.strip("|").split("|")] for row in rows[2:]]


def _numbers(prefix: str, ids: list[str]) -> list[int]:
    return [int(i[2:]) for i in ids if i.startswith(prefix)]


DECISION_IDS = re.findall(r"^## (D-\d{2}) ", DECISIONS, flags=re.M)
QUESTION_IDS = [row[0] for row in _table(_section(DECISIONS, "## Open questions"))]
INDEX = _table(_section(DECISIONS, "## Index"))


def test_decision_and_question_numbers_are_unique_and_have_no_gaps():
    for prefix, ids in (("D-", DECISION_IDS), ("Q-", QUESTION_IDS)):
        numbers = _numbers(prefix, ids)
        assert numbers == list(range(1, len(numbers) + 1)), f"{prefix} numbers repeat, skip or are out of order: {ids}"


def test_next_free_numbers_are_right():
    match = re.search(r"Next free: \*\*D-(\d{2})\*\*, \*\*Q-(\d{2})\*\*", DECISIONS)
    assert match, "the 'Next free' line is missing from Rules for entries"
    assert int(match[1]) == len(DECISION_IDS) + 1
    assert int(match[2]) == len(QUESTION_IDS) + 1


def test_index_lists_every_decision_and_question_once_with_a_known_status():
    assert [row[0] for row in INDEX] == DECISION_IDS + QUESTION_IDS
    for row in INDEX:
        pattern = D_STATUS if row[0].startswith("D-") else Q_STATUS
        assert pattern.match(row[-1]), f"{row[0]} has an unknown status: {row[-1]!r}"


def test_index_status_of_a_question_matches_its_row():
    questions = {row[0]: row[-1] for row in _table(_section(DECISIONS, "## Open questions"))}
    for row in INDEX:
        if row[0] in questions:
            assert row[-1] == questions[row[0]], f"{row[0]}: index says {row[-1]!r}, the table says {questions[row[0]]!r}"


def test_every_decision_has_decision_why_and_where():
    for number, body in zip(DECISION_IDS, re.split(r"^## D-\d{2} .*$", DECISIONS, flags=re.M)[1:]):
        body = body.split("\n## ")[0]
        for part in ("**Decision:**", "**Why:**", "**Where:**"):
            assert part in body, f"{number} has no {part}"


def test_amended_or_superseded_decisions_point_at_a_real_one():
    for row in INDEX:
        target = re.search(r"by (D-\d{2})", row[-1])
        if target:
            assert target[1] in DECISION_IDS, f"{row[0]} points at {target[1]}, which doesn't exist"


def test_labels_are_well_formed_and_cover_type_priority_and_difficulty():
    names = [label["name"] for label in LABELS]
    assert len(names) == len(set(names)), "a label is defined twice"
    for label in LABELS:
        assert re.fullmatch(r"[0-9A-F]{6}", label["color"]), label
        assert 0 < len(label["description"]) <= 100, f"GitHub caps a label description at 100 characters: {label['name']}"
    for group in ("type: ", "priority: ", "difficulty: "):
        assert any(name.startswith(group) for name in names), f"no {group!r} labels"


def test_contributing_documents_exactly_the_defined_labels_and_milestones():
    documented = {row[0].strip("`"): row[1].replace("`", "") for row in _table(_section(CONTRIBUTING, "## Labels"))}
    assert documented == {label["name"]: label["description"] for label in LABELS}
    milestones = {row[0]: row[1] for row in _table(_section(CONTRIBUTING, "## Milestones"))}
    assert milestones == {m["title"]: m["description"] for m in MILESTONES}


@pytest.mark.parametrize("template", TEMPLATES, ids=lambda p: p.name)
def test_issue_templates_have_every_section_and_only_defined_labels(template: Path):
    form = yaml.safe_load(template.read_text(encoding="utf-8"))
    assert form["name"] and form["description"], f"{template.name} needs a name and a description"
    fields = [field for field in form["body"] if field["type"] != "markdown"]
    ids = [field["id"] for field in fields]
    assert len(ids) == len(set(ids)), f"{template.name} repeats a field id"
    sections = [field["attributes"]["label"] for field in fields]
    for section in SECTIONS:
        assert section in sections, f"{template.name} has no {section!r} section"
        assert fields[sections.index(section)]["validations"]["required"], f"{template.name}: {section!r} must be required"
    names = {label["name"] for label in LABELS}
    for used in form.get("labels", []):
        assert used in names, f"{template.name} uses a label that .github/labels.json doesn't define: {used}"


def test_template_chooser_and_label_workflow_are_valid_yaml():
    config = yaml.safe_load((ROOT / ".github" / "ISSUE_TEMPLATE" / "config.yml").read_text(encoding="utf-8"))
    assert isinstance(config["blank_issues_enabled"], bool)
    workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "sync-labels.yml").read_text(encoding="utf-8"))
    assert workflow["permissions"] == {"contents": "read", "issues": "write"}


def test_there_is_a_template_for_tasks_epics_and_questions():
    assert [p.name for p in TEMPLATES] == ["1-task.yml", "2-epic.yml", "3-question.yml"]
