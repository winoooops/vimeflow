import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

HOOK_RUNNER = Path(__file__).parent / "hook_runner.py"


def run_hook(kind: str, payload: dict, extra_env: dict | None = None) -> dict:
    env = {**os.environ, **(extra_env or {})}
    proc = subprocess.run(
        [sys.executable, str(HOOK_RUNNER), kind],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        timeout=15,
        env=env,
    )
    assert proc.returncode == 0, f"hook_runner exited {proc.returncode}: {proc.stderr}"
    if not proc.stdout.strip():
        return {}
    return json.loads(proc.stdout)


def test_bash_hook_allows_npm():
    result = run_hook("bash", {"tool_input": {"command": "npm test"}})
    assert result.get("decision") != "block"


def test_bash_hook_blocks_empty_command():
    result = run_hook("bash", {"tool_input": {"command": "   "}})
    assert result.get("decision") == "block"
    assert "empty" in result.get("reason", "").lower()


def test_bash_hook_blocks_unknown_command_when_judge_disabled():
    result = run_hook(
        "bash",
        {"tool_input": {"command": "nmap localhost"}},
        extra_env={"HARNESS_POLICY_JUDGE": "deny"},
    )
    assert result.get("decision") == "block"
    assert "nmap" in result.get("reason", "")


def test_feature_list_hook_allows_non_matching_path(tmp_path):
    result = run_hook(
        "feature_list",
        {"tool_input": {"file_path": str(tmp_path / "other.json"), "content": "[]"}},
    )
    assert result.get("decision") != "block"


def test_hook_runner_unknown_kind_blocks():
    proc = subprocess.run(
        [sys.executable, str(HOOK_RUNNER), "unknown"],
        input=json.dumps({}),
        text=True,
        capture_output=True,
        timeout=5,
    )
    assert proc.returncode == 0
    out = json.loads(proc.stdout)
    assert out.get("decision") == "block"


def test_hook_runner_bad_json_blocks():
    proc = subprocess.run(
        [sys.executable, str(HOOK_RUNNER), "bash"],
        input="not json",
        text=True,
        capture_output=True,
        timeout=5,
    )
    assert proc.returncode == 0
    out = json.loads(proc.stdout)
    assert out.get("decision") == "block"
    assert "json" in out.get("reason", "").lower()


def test_hook_runner_fails_closed_when_hook_raises(tmp_path, monkeypatch, capsys):
    """If a hook function raises, hook_runner MUST emit a block decision.

    Claude CLI defaults to allow when a hook produces no decision JSON
    (see client.py), so a raw crash would silently bypass security. We
    verify the fix in-process by replacing `bash_security_hook` in the
    module's import site with one that raises, and invoking main()
    directly so monkeypatch actually sticks.
    """
    import importlib
    import hook_runner as hr

    async def exploding_hook(*args, **kwargs):
        raise RuntimeError("simulated judge timeout")

    monkeypatch.setattr(hr, "bash_security_hook", exploding_hook)
    monkeypatch.setattr(sys, "argv", ["hook_runner.py", "bash"])
    monkeypatch.setattr(sys, "stdin", __import__("io").StringIO(
        json.dumps({"tool_input": {"command": "anything"}})
    ))

    rc = hr.main()
    assert rc == 0
    stdout = capsys.readouterr().out
    out = json.loads(stdout)
    assert out.get("decision") == "block"
    reason = out.get("reason", "").lower()
    assert "hook_runner" in reason
    assert "runtimeerror" in reason
    assert "simulated judge timeout" in reason

    # Restore for subsequent tests — pytest handles this via monkeypatch.
    importlib.reload(hr)
