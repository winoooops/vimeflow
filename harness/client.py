"""
Claude CLI Client Configuration
================================

Writes the `settings.json` file a `ClaudeCliSession` uses. The default
harness workflow runs `claude -p` per role and inherits CLI auth — no
`ANTHROPIC_API_KEY` is ever consulted on this path.

The opt-in SDK fallback (`--client sdk`) lives in `client_with_sdk.py`; it
is the only module that imports `claude_code_sdk` and enforces the API key.
"""

import json
import os
import sys
import tempfile
from pathlib import Path

# Isolate both backends from user-level `~/.claude/settings.json`. The
# `claude` CLI subprocess merges user + project settings, so user-level
# hooks (e.g. block-no-verify) would fire inside harness agents.
# Redirecting `CLAUDE_CONFIG_DIR` to an empty dir prevents this.
_ISOLATED_CONFIG_DIR = tempfile.mkdtemp(prefix="harness_claude_config_")
os.environ["CLAUDE_CONFIG_DIR"] = _ISOLATED_CONFIG_DIR


BUILTIN_TOOLS = [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "Bash",
]

# Project-scoped filesystem + bash allow rules. Shared by both backends.
_PERMISSION_ALLOW = [
    "Read(.//**)", "Write(.//**)", "Edit(.//**)",
    "Glob(.//**)", "Grep(.//**)", "Bash(*)",
]


def write_settings_file(
    project_dir: Path, settings: dict, *, filename: str
) -> Path:
    """Write a settings dict as JSON under `project_dir`. Shared IO helper.

    Creates `project_dir` if missing. Returns the absolute path. Both
    backends call this so the two settings files keep a single point of
    truth for mkdir / encoding / formatting.
    """
    project_dir.mkdir(parents=True, exist_ok=True)
    path = project_dir / filename
    path.write_text(json.dumps(settings, indent=2))
    return path


def build_base_settings(*, sandbox: bool) -> dict:
    """Return the permissions + (optional) sandbox block shared by both backends.

    Callers append their own `hooks` wiring:
      - CLI backend: subprocess commands pointing at `hook_runner.py`
      - SDK fallback: in-process `HookMatcher` callables

    The returned dict is a fresh copy per call — safe to mutate.
    """
    settings: dict = {
        "permissions": {"allow": list(_PERMISSION_ALLOW)},
    }
    if sandbox:
        settings["sandbox"] = {"enabled": True, "autoAllowBashIfSandboxed": True}
        settings["permissions"]["defaultMode"] = "acceptEdits"
    else:
        settings["permissions"]["defaultMode"] = "bypassPermissions"
    return settings


def build_settings_file(project_dir: Path, *, sandbox: bool = True) -> Path:
    """Write settings.json for a `ClaudeCliSession` run.

    Wires PreToolUse hooks through `harness/hook_runner.py` so the existing
    Python allowlist (`security.py`) + feature_list protection (`hooks.py`)
    keep firing under the CLI backend.
    """
    hook_runner = Path(__file__).resolve().parent / "hook_runner.py"

    settings = build_base_settings(sandbox=sandbox)
    settings["hooks"] = {
        "PreToolUse": [
            {
                "matcher": "Bash",
                "hooks": [{
                    "type": "command",
                    "command": f"{sys.executable} {hook_runner} bash",
                }],
            },
            {
                "matcher": "Write|Edit",
                "hooks": [{
                    "type": "command",
                    "command": f"{sys.executable} {hook_runner} feature_list",
                }],
            },
        ],
    }

    return write_settings_file(
        project_dir, settings, filename=".claude_settings_cli.json"
    )
