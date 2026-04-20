"""
Claude CLI Client Configuration
================================

Writes the `settings.json` file a `ClaudeCliSession` uses. The default
harness workflow runs `claude -p` per role and inherits CLI auth — no
`ANTHROPIC_API_KEY` is ever consulted on this path.

The opt-in SDK fallback (`--client sdk`) lives in `client_fallback.py`; it
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


def build_settings_file(project_dir: Path, *, sandbox: bool = True) -> Path:
    """Write settings.json for a `ClaudeCliSession` run.

    Wires PreToolUse hooks through `harness/hook_runner.py` so the existing
    Python allowlist (`security.py`) + feature_list protection (`hooks.py`)
    keep firing under the CLI backend.
    """
    hook_runner = Path(__file__).resolve().parent / "hook_runner.py"

    settings: dict = {
        "permissions": {
            "allow": [
                "Read(.//**)", "Write(.//**)", "Edit(.//**)",
                "Glob(.//**)", "Grep(.//**)", "Bash(*)",
            ],
        },
        "hooks": {
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
        },
    }

    if sandbox:
        settings["sandbox"] = {"enabled": True, "autoAllowBashIfSandboxed": True}
        settings["permissions"]["defaultMode"] = "acceptEdits"
    else:
        settings["permissions"]["defaultMode"] = "bypassPermissions"

    project_dir.mkdir(parents=True, exist_ok=True)
    path = project_dir / ".claude_settings_cli.json"
    path.write_text(json.dumps(settings, indent=2))
    return path
