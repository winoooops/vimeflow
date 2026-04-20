import json
import sys
from pathlib import Path

from client import build_base_settings, build_settings_file


def test_build_base_settings_sandbox_on():
    s = build_base_settings(sandbox=True)
    assert s["permissions"]["defaultMode"] == "acceptEdits"
    assert s["sandbox"] == {"enabled": True, "autoAllowBashIfSandboxed": True}
    assert "hooks" not in s  # hooks are wired by each caller
    # Allow list is shared with the SDK fallback path
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


def test_build_settings_file_writes_hooks_with_sandbox(tmp_path):
    path = build_settings_file(tmp_path, sandbox=True)
    assert path.exists()
    data = json.loads(path.read_text())

    assert data["permissions"]["defaultMode"] == "acceptEdits"
    assert data["sandbox"]["enabled"] is True
    assert data["sandbox"]["autoAllowBashIfSandboxed"] is True

    # Allow rules — project-scoped
    assert "Read(.//**)" in data["permissions"]["allow"]
    assert "Bash(*)" in data["permissions"]["allow"]

    # Hook wiring
    bash_entries = [
        h for h in data["hooks"]["PreToolUse"] if h["matcher"] == "Bash"
    ]
    assert len(bash_entries) == 1
    bash_cmd = bash_entries[0]["hooks"][0]["command"]
    assert bash_entries[0]["hooks"][0]["type"] == "command"
    assert sys.executable in bash_cmd
    assert "hook_runner.py" in bash_cmd
    assert bash_cmd.strip().endswith(" bash")

    write_entries = [
        h for h in data["hooks"]["PreToolUse"] if "Write" in h["matcher"]
    ]
    assert len(write_entries) == 1
    write_cmd = write_entries[0]["hooks"][0]["command"]
    assert "feature_list" in write_cmd


def test_build_settings_file_no_sandbox(tmp_path):
    path = build_settings_file(tmp_path, sandbox=False)
    data = json.loads(path.read_text())
    assert data["permissions"]["defaultMode"] == "bypassPermissions"
    assert "sandbox" not in data


def test_build_settings_file_hook_runner_path_is_absolute(tmp_path):
    path = build_settings_file(tmp_path, sandbox=False)
    data = json.loads(path.read_text())
    bash_cmd = [
        h for h in data["hooks"]["PreToolUse"] if h["matcher"] == "Bash"
    ][0]["hooks"][0]["command"]
    # Extract the hook_runner.py path (between python and the kind arg)
    parts = bash_cmd.split()
    runner_path = parts[1]
    assert Path(runner_path).is_absolute()
    assert Path(runner_path).exists()
