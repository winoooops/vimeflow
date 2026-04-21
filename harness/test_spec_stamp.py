"""Tests for harness/spec_stamp.py."""

from __future__ import annotations

import json
from pathlib import Path

import spec_stamp


def test_write_stamp_records_hash_and_filename(tmp_path: Path) -> None:
    spec = tmp_path / "app_spec.md"
    spec.write_text("# hello\n")

    spec_stamp.write_stamp(tmp_path, spec)

    stamp_path = tmp_path / spec_stamp.STAMP_FILENAME
    assert stamp_path.exists()
    stamp = json.loads(stamp_path.read_text())
    assert stamp["app_spec_hash"] == spec_stamp.hash_spec(spec)
    assert stamp["app_spec_path"] == "app_spec.md"
    assert "generated_at" in stamp


def test_write_stamp_no_op_when_spec_missing(tmp_path: Path) -> None:
    spec_stamp.write_stamp(tmp_path, tmp_path / "does-not-exist.md")
    assert not (tmp_path / spec_stamp.STAMP_FILENAME).exists()


def test_check_fresh_true_when_hashes_match(tmp_path: Path) -> None:
    spec = tmp_path / "app_spec.md"
    spec.write_text("original content\n")
    spec_stamp.write_stamp(tmp_path, spec)

    is_fresh, reason = spec_stamp.check_stamp_fresh(tmp_path, spec)
    assert is_fresh is True
    assert reason == ""


def test_check_fresh_false_when_spec_changed(tmp_path: Path) -> None:
    spec = tmp_path / "app_spec.md"
    spec.write_text("original content\n")
    spec_stamp.write_stamp(tmp_path, spec)

    spec.write_text("edited content — this is a different spec\n")

    is_fresh, reason = spec_stamp.check_stamp_fresh(tmp_path, spec)
    assert is_fresh is False
    assert "changed" in reason
    assert "--ignore-stale-list" in reason


def test_check_fresh_false_when_stamp_missing(tmp_path: Path) -> None:
    spec = tmp_path / "app_spec.md"
    spec.write_text("content\n")

    is_fresh, reason = spec_stamp.check_stamp_fresh(tmp_path, spec)
    assert is_fresh is False
    assert spec_stamp.STAMP_FILENAME in reason


def test_check_fresh_false_when_spec_missing(tmp_path: Path) -> None:
    """Stamp on disk but no app_spec.md — can't verify, treat as stale."""
    (tmp_path / spec_stamp.STAMP_FILENAME).write_text(
        json.dumps(
            {
                "app_spec_hash": "deadbeef",
                "app_spec_path": "app_spec.md",
                "generated_at": "2026-04-21T00:00:00+00:00",
            }
        )
    )
    is_fresh, reason = spec_stamp.check_stamp_fresh(
        tmp_path, tmp_path / "app_spec.md"
    )
    assert is_fresh is False
    assert "no such file" in reason


def test_check_fresh_handles_corrupt_stamp(tmp_path: Path) -> None:
    """Corrupt stamp (exists but unparseable) must produce a distinct
    message from the "stamp missing" case — otherwise the user sees
    "not found" for a file that's visibly present, which is confusing.
    """
    spec = tmp_path / "app_spec.md"
    spec.write_text("content\n")
    (tmp_path / spec_stamp.STAMP_FILENAME).write_text("{not valid json")

    is_fresh, reason = spec_stamp.check_stamp_fresh(tmp_path, spec)
    assert is_fresh is False
    assert spec_stamp.STAMP_FILENAME in reason
    assert "could not be parsed" in reason
    assert "no " not in reason.lower().split(".")[0], (
        "corrupt-stamp message must not suggest the file is missing"
    )


def test_check_fresh_missing_vs_corrupt_messages_differ(tmp_path: Path) -> None:
    """Regression guard: the two not-fresh failure modes must produce
    visibly different messages so the user can tell them apart."""
    spec = tmp_path / "app_spec.md"
    spec.write_text("content\n")

    _, missing_reason = spec_stamp.check_stamp_fresh(tmp_path, spec)

    (tmp_path / spec_stamp.STAMP_FILENAME).write_text("not json")
    _, corrupt_reason = spec_stamp.check_stamp_fresh(tmp_path, spec)

    assert missing_reason != corrupt_reason
    assert "no " in missing_reason.lower()
    assert "could not be parsed" in corrupt_reason
