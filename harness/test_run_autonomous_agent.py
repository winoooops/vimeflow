"""Integration tests for harness.agent.run_autonomous_agent.

Covers the two new correctness behaviors added in the v2 Tier 2
safety fixes (PR #77):

1. ``write_stamp`` is called after a successful Initializer run
   (once a ``feature_list.json`` was produced).
2. ``check_stamp_fresh`` gates Phase 2 resumption on an existing
   ``feature_list.json``: a stale stamp aborts the run unless
   ``ignore_stale_list=True``.

The Initializer path spawns a ``claude -p`` subprocess; we mock
``_make_session`` and ``run_agent_session`` so these tests run in
milliseconds without external API calls.
"""

from __future__ import annotations

import asyncio
from contextlib import AbstractAsyncContextManager
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest


class _StubSession(AbstractAsyncContextManager):
    """Bare async context manager — stands in for ClaudeCliSession."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return None


def _run(coro):
    return asyncio.run(coro)


# --- Case 1: Initializer success → write_stamp called ---------------------


def test_initializer_success_calls_write_stamp(tmp_path: Path) -> None:
    """After a successful Initializer that produces feature_list.json,
    run_autonomous_agent must call write_stamp with the spec path so
    subsequent runs can verify freshness. Returns True to signal that
    Phase 3 is allowed to proceed.
    """
    from agent import run_autonomous_agent

    # Simulate what the Initializer subprocess would write.
    def _fake_session_side_effect(*_args, **_kwargs):
        (tmp_path / "feature_list.json").write_text("[]")
        return "continue", ""

    (tmp_path / "app_spec.md").write_text("# spec\n")

    with patch("agent._make_session", return_value=_StubSession()), \
         patch("agent.run_agent_session", new=AsyncMock(side_effect=_fake_session_side_effect)), \
         patch("agent.get_pending_features", return_value=[]), \
         patch("agent.write_stamp") as mock_write_stamp, \
         patch("agent.check_stamp_fresh") as mock_check_fresh, \
         patch("agent.copy_spec_to_project"), \
         patch("agent.print_progress_summary"), \
         patch("agent.AUTO_CONTINUE_DELAY_SECONDS", 0):

        result = _run(run_autonomous_agent(
            project_dir=tmp_path,
            model="stub-model",
            max_iterations=1,
            skip_review=True,
        ))

    assert result is True, "normal Phase 2 completion must return True"
    assert mock_write_stamp.called, "write_stamp must be called after successful Initializer"
    args, kwargs = mock_write_stamp.call_args
    # spec_path should point at <project_dir>/app_spec.md
    assert args[0] == tmp_path
    assert args[1].name == "app_spec.md"
    # check_stamp_fresh must NOT run on a first-run (no prior feature_list.json)
    assert not mock_check_fresh.called


# --- Case 2: Initializer error → write_stamp NOT called -------------------


def test_initializer_error_does_not_write_stamp(tmp_path: Path) -> None:
    """If the Initializer fails, we must not record a stamp — doing so
    would falsely claim a successful generation. Must return False so
    Phase 3 is blocked even in --phase-3 auto mode.
    """
    from agent import run_autonomous_agent

    (tmp_path / "app_spec.md").write_text("# spec\n")

    with patch("agent._make_session", return_value=_StubSession()), \
         patch("agent.run_agent_session", new=AsyncMock(return_value=("error", ""))), \
         patch("agent.write_stamp") as mock_write_stamp, \
         patch("agent.copy_spec_to_project"), \
         patch("agent.print_progress_summary"):

        result = _run(run_autonomous_agent(
            project_dir=tmp_path,
            model="stub-model",
            max_iterations=1,
            skip_review=True,
        ))

    assert result is False, "initializer error must return False"
    assert not mock_write_stamp.called, "write_stamp must not run after initializer error"


# --- Case 3: Stale stamp aborts Phase 2 ----------------------------------


def test_stale_stamp_aborts_without_ignore_flag(tmp_path: Path, capsys) -> None:
    """With an existing feature_list.json, run_autonomous_agent must
    consult check_stamp_fresh and abort early if it reports non-fresh,
    *unless* ignore_stale_list=True. Must return False so the caller
    doesn't push the stale branch via Phase 3.
    """
    from agent import run_autonomous_agent

    (tmp_path / "feature_list.json").write_text("[]")  # pre-existing
    (tmp_path / "app_spec.md").write_text("# spec\n")

    stale_reason = "stamp hash abc123… vs current def456… (test stub reason)"

    with patch("agent._make_session") as mock_make_session, \
         patch("agent.run_agent_session", new=AsyncMock()) as mock_run_session, \
         patch("agent.check_stamp_fresh", return_value=(False, stale_reason)) as mock_check, \
         patch("agent.write_stamp") as mock_write_stamp:

        result = _run(run_autonomous_agent(
            project_dir=tmp_path,
            model="stub-model",
            max_iterations=1,
            skip_review=True,
            ignore_stale_list=False,
        ))

    assert result is False, "stale-stamp abort must return False"
    assert mock_check.called, "stale-guard must consult check_stamp_fresh"
    assert not mock_make_session.called, (
        "on stale detection, no session should be opened"
    )
    assert not mock_run_session.called
    assert not mock_write_stamp.called

    captured = capsys.readouterr()
    assert "ERROR" in captured.out
    assert stale_reason in captured.out
    assert "--ignore-stale-list" in captured.out


# --- Case 4: --ignore-stale-list bypasses the guard -----------------------


def test_ignore_stale_list_bypasses_guard(tmp_path: Path, capsys) -> None:
    """ignore_stale_list=True must allow Phase 2 to proceed even when
    check_stamp_fresh reports non-fresh, and must log a WARNING.
    """
    from agent import run_autonomous_agent

    (tmp_path / "feature_list.json").write_text("[]")  # pre-existing
    (tmp_path / "app_spec.md").write_text("# spec\n")

    with patch("agent._make_session", return_value=_StubSession()), \
         patch("agent.run_agent_session", new=AsyncMock(return_value=("continue", ""))), \
         patch("agent.check_stamp_fresh", return_value=(False, "some stale reason.")) as mock_check, \
         patch("agent.get_pending_features", return_value=[]), \
         patch("agent.print_progress_summary"), \
         patch("agent.AUTO_CONTINUE_DELAY_SECONDS", 0):

        _run(run_autonomous_agent(
            project_dir=tmp_path,
            model="stub-model",
            max_iterations=1,
            skip_review=True,
            ignore_stale_list=True,
        ))

    assert mock_check.called, "check_stamp_fresh must still run so the warning has content"
    captured = capsys.readouterr()
    assert "WARNING" in captured.out
    assert "--ignore-stale-list" in captured.out
    assert "ERROR" not in captured.out, "bypass path must not print ERROR"


# --- Case 5: Fresh stamp → normal Phase 2 proceeds ------------------------


def test_fresh_stamp_proceeds_silently(tmp_path: Path, capsys) -> None:
    """When check_stamp_fresh returns (True, ''), no warning / error
    logging, straight into Phase 2. Returns True for Phase 3 gating.
    """
    from agent import run_autonomous_agent

    (tmp_path / "feature_list.json").write_text("[]")
    (tmp_path / "app_spec.md").write_text("# spec\n")

    with patch("agent._make_session", return_value=_StubSession()), \
         patch("agent.run_agent_session", new=AsyncMock(return_value=("continue", ""))), \
         patch("agent.check_stamp_fresh", return_value=(True, "")), \
         patch("agent.get_pending_features", return_value=[]), \
         patch("agent.print_progress_summary"), \
         patch("agent.AUTO_CONTINUE_DELAY_SECONDS", 0):

        result = _run(run_autonomous_agent(
            project_dir=tmp_path,
            model="stub-model",
            max_iterations=1,
            skip_review=True,
        ))

    assert result is True
    captured = capsys.readouterr()
    assert "ERROR" not in captured.out
    assert "WARNING" not in captured.out


# --- Case 6: ignore_stale_list bypass returns True ------------------------


def test_ignore_stale_list_returns_true(tmp_path: Path) -> None:
    """When the user opts in to bypassing the stale guard, Phase 2 still
    runs and the function must return True so Phase 3 can proceed.
    """
    from agent import run_autonomous_agent

    (tmp_path / "feature_list.json").write_text("[]")
    (tmp_path / "app_spec.md").write_text("# spec\n")

    with patch("agent._make_session", return_value=_StubSession()), \
         patch("agent.run_agent_session", new=AsyncMock(return_value=("continue", ""))), \
         patch("agent.check_stamp_fresh", return_value=(False, "stub stale.")), \
         patch("agent.get_pending_features", return_value=[]), \
         patch("agent.print_progress_summary"), \
         patch("agent.AUTO_CONTINUE_DELAY_SECONDS", 0):

        result = _run(run_autonomous_agent(
            project_dir=tmp_path,
            model="stub-model",
            max_iterations=1,
            skip_review=True,
            ignore_stale_list=True,
        ))

    assert result is True, "bypass path must still return True so Phase 3 can run"
