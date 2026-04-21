"""Tests for autonomous_agent_demo.py module-level helpers."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path


def _load_module():
    """Load autonomous_agent_demo without triggering argparse."""
    sys.path.insert(0, str(Path(__file__).parent))
    return importlib.import_module("autonomous_agent_demo")


def test_clean_runtime_files_removes_generated_artifacts(tmp_path: Path) -> None:
    """clean_runtime_files removes feature_list.json and claude-progress.txt."""
    demo = _load_module()

    (tmp_path / "feature_list.json").write_text("[]")
    (tmp_path / "claude-progress.txt").write_text("notes")

    demo.clean_runtime_files(tmp_path)

    assert not (tmp_path / "feature_list.json").exists()
    assert not (tmp_path / "claude-progress.txt").exists()


def test_clean_runtime_files_preserves_app_spec(tmp_path: Path) -> None:
    """clean_runtime_files must never touch app_spec.md — it's the user's source.

    Regression test for the bug where --clean wiped the user's authored
    spec and silently replaced it with the default VIBM template on the
    next initializer run.
    """
    demo = _load_module()

    spec_body = "# MyApp\n\nUser's authored spec, must survive --clean.\n"
    (tmp_path / "app_spec.md").write_text(spec_body)
    (tmp_path / "feature_list.json").write_text("[]")

    demo.clean_runtime_files(tmp_path)

    assert (tmp_path / "app_spec.md").exists()
    assert (tmp_path / "app_spec.md").read_text() == spec_body


def test_runtime_files_list_does_not_contain_app_spec() -> None:
    """app_spec.md MUST NOT be in RUNTIME_FILES — it's user input, not runtime state."""
    demo = _load_module()

    assert "app_spec.md" not in demo.RUNTIME_FILES
    assert "feature_list.json" in demo.RUNTIME_FILES
    assert "claude-progress.txt" in demo.RUNTIME_FILES


def test_clean_runtime_files_no_op_when_files_missing(tmp_path: Path) -> None:
    """clean_runtime_files tolerates missing files (e.g. first run)."""
    demo = _load_module()

    demo.clean_runtime_files(tmp_path)  # must not raise
