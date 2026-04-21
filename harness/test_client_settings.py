import json
import sys
from pathlib import Path

from cli_client import ClaudeCliSession
from client import (
    BUILTIN_TOOLS,
    build_base_settings,
    create_client,
    write_settings_file,
)


def test_build_base_settings_sandbox_on():
    s = build_base_settings(sandbox=True)
    assert s["permissions"]["defaultMode"] == "acceptEdits"
    assert s["sandbox"] == {"enabled": True, "autoAllowBashIfSandboxed": True}
    assert "hooks" not in s  # hooks are wired by each caller
    assert "Bash(*)" in s["permissions"]["allow"]


def test_build_base_settings_sandbox_off():
    s = build_base_settings(sandbox=False)
    assert s["permissions"]["defaultMode"] == "bypassPermissions"
    assert "sandbox" not in s


def test_build_base_settings_returns_fresh_copy():
    a = build_base_settings(sandbox=True)
    a["permissions"]["allow"].append("mutation")
    b = build_base_settings(sandbox=True)
    assert "mutation" not in b["permissions"]["allow"]


def test_write_settings_file_creates_missing_dir(tmp_path):
    target_dir = tmp_path / "nested" / "dir"
    assert not target_dir.exists()
    path = write_settings_file(target_dir, {"k": 1}, filename="custom.json")
    assert path == target_dir / "custom.json"
    assert path.exists()
    assert json.loads(path.read_text()) == {"k": 1}


def test_write_settings_file_overwrites(tmp_path):
    path = write_settings_file(tmp_path, {"a": 1}, filename="s.json")
    write_settings_file(tmp_path, {"a": 2}, filename="s.json")
    assert json.loads(path.read_text()) == {"a": 2}


def test_create_client_returns_session_with_sandbox(tmp_path, capsys):
    session = create_client(
        tmp_path, "claude-sonnet-4-5-20250929", role="coder", sandbox=True
    )
    assert isinstance(session, ClaudeCliSession)
    assert session.role == "coder"
    assert session.allowed_tools == BUILTIN_TOOLS
    assert session.settings_path == tmp_path / ".claude_settings_cli.json"

    # Settings file on disk matches expectations
    data = json.loads(session.settings_path.read_text())
    assert data["permissions"]["defaultMode"] == "acceptEdits"
    assert data["sandbox"]["enabled"] is True

    bash_entries = [
        h for h in data["hooks"]["PreToolUse"] if h["matcher"] == "Bash"
    ]
    assert len(bash_entries) == 1
    bash_cmd = bash_entries[0]["hooks"][0]["command"]
    assert sys.executable in bash_cmd
    assert "hook_runner.py" in bash_cmd
    assert bash_cmd.strip().endswith(" bash")

    write_entries = [
        h for h in data["hooks"]["PreToolUse"] if "Write" in h["matcher"]
    ]
    assert len(write_entries) == 1
    assert "feature_list" in write_entries[0]["hooks"][0]["command"]


def test_create_client_no_sandbox(tmp_path):
    session = create_client(
        tmp_path, "claude-sonnet-4-5-20250929", role="coder", sandbox=False
    )
    data = json.loads(session.settings_path.read_text())
    assert data["permissions"]["defaultMode"] == "bypassPermissions"
    assert "sandbox" not in data


def test_create_client_hook_runner_path_is_absolute(tmp_path):
    session = create_client(
        tmp_path, "claude-sonnet-4-5-20250929", role="coder", sandbox=False
    )
    data = json.loads(session.settings_path.read_text())
    bash_cmd = [
        h for h in data["hooks"]["PreToolUse"] if h["matcher"] == "Bash"
    ][0]["hooks"][0]["command"]
    # shlex.split must round-trip the quoted command correctly — it's what
    # the Claude CLI's `sh -c` does internally before exec'ing the hook.
    import shlex
    parts = shlex.split(bash_cmd)
    assert len(parts) == 3  # python, runner.py, kind
    assert Path(parts[1]).is_absolute()
    assert Path(parts[1]).exists()
    assert parts[2] == "bash"


def test_create_client_hook_command_survives_paths_with_spaces(tmp_path, monkeypatch):
    """If the Python interpreter path has a space, the hook command must
    still shlex.split back into 3 tokens. Pre-fix: sh -c would split on
    the embedded space, drop the runner, and silently bypass hooks."""
    import shlex
    import sys as _sys

    # Simulate a space in sys.executable (mirrors Windows "Program Files").
    monkeypatch.setattr(_sys, "executable", "/usr/local/weird dir/python3")
    session = create_client(
        tmp_path, "claude-sonnet-4-5-20250929", role="coder", sandbox=False
    )
    data = json.loads(session.settings_path.read_text())
    bash_cmd = [
        h for h in data["hooks"]["PreToolUse"] if h["matcher"] == "Bash"
    ][0]["hooks"][0]["command"]
    parts = shlex.split(bash_cmd)
    assert parts[0] == "/usr/local/weird dir/python3"
    assert parts[-1] == "bash"
    assert len(parts) == 3
