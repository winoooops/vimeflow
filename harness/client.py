"""
Claude CLI Client
=================

Default backend. Runs `claude -p` per role and inherits the user's Claude
Code CLI auth — no `ANTHROPIC_API_KEY` is ever consulted on this path.

`create_client(project_dir, model, role, sandbox)` is the public factory.
The SDK fallback (`sdk_client.create_client`) mirrors it.
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


def create_client(
    project_dir: Path,
    model: str,
    *,
    role: str,
    sandbox: bool = True,
):
    """Create a `ClaudeCliSession` wired with the harness security layers.

    Writes a `.claude_settings_cli.json` under `project_dir` with PreToolUse
    hooks pointing at `hook_runner.py` so the Python allowlist + feature_list
    protection keep firing under the CLI backend. Returns a ready-to-use
    session.
    """
    from cli_client import ClaudeCliSession

    hook_runner = Path(__file__).resolve().parent / "hook_runner.py"

    settings = build_base_settings(sandbox=sandbox)
    # CLI-only wiring. `claude -p` is a subprocess — our Python process
    # isn't there when it decides to run a tool, so the only handoff
    # channel is settings.json on disk. Hooks declared here fire a
    # subprocess per tool call; `hook_runner.py` reads the hook JSON
    # from stdin and delegates to security.bash_security_hook /
    # hooks.pre_write_feature_list_hook.
    #
    # The SDK backend (sdk_client.py) uses the same two Python callables
    # but passes them directly via `HookMatcher(...)` on ClaudeCodeOptions
    # — in-process, no subprocess round-trip — so its settings file
    # intentionally omits this block.
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

    settings_path = write_settings_file(
        project_dir, settings, filename=".claude_settings_cli.json"
    )

    mode_label = "sandbox + acceptEdits" if sandbox else "bypassPermissions (no sandbox)"
    print(f"  [cli] {mode_label}, fs restricted to {project_dir.resolve()}")
    print(f"  [cli] Bash: allowlist-validated (see harness/security.py)")
    print()

    return ClaudeCliSession(
        role=role,
        project_dir=project_dir,
        model=model,
        settings_path=settings_path,
        allowed_tools=BUILTIN_TOOLS,
    )
