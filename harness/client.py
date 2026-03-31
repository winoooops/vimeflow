"""
Claude SDK Client Configuration
================================

Creates a Claude Code SDK client configured for VIBM development.
"""

import json
import os
import tempfile
from pathlib import Path

from claude_code_sdk import ClaudeCodeOptions, ClaudeSDKClient
from claude_code_sdk.types import HookMatcher

from security import bash_security_hook
from hooks import pre_write_feature_list_hook

# Isolate SDK sessions from user-level ~/.claude/settings.json.
# The CLI subprocess merges user + project settings, so user-level
# hooks (e.g. block-no-verify) would fire inside harness agents.
# Redirecting CLAUDE_CONFIG_DIR to an empty dir prevents this.
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


def create_client(project_dir: Path, model: str) -> ClaudeSDKClient:
    """
    Create a Claude Code SDK client with security layers.

    Security:
      1. Settings isolation — CLAUDE_CONFIG_DIR prevents user-level hooks
      2. Permissions — bypassPermissions for full autonomy, file ops scoped to project_dir
      3. Python hooks — bash allowlist (security.py) + feature_list protection (hooks.py)

    Note: sandbox.enabled is not used. On Linux/WSL2 it's unreliable (may be no-op)
    and redundant when Python hooks already validate every bash command.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")

    security_settings = {
        "permissions": {
            "defaultMode": "bypassPermissions",
            "allow": [
                "Read(.//**)",
                "Write(.//**)",
                "Edit(.//**)",
                "Glob(.//**)",
                "Grep(.//**)",
                "Bash(*)",
            ],
        },
    }

    project_dir.mkdir(parents=True, exist_ok=True)

    settings_file = project_dir / ".claude_settings.json"
    with open(settings_file, "w") as f:
        json.dump(security_settings, f, indent=2)

    print(f"  Security: bypassPermissions, fs restricted to {project_dir.resolve()}")
    print(f"  Bash: allowlist-validated (see harness/security.py)")
    print(f"  Config: isolated from user settings (CLAUDE_CONFIG_DIR)")
    print()

    return ClaudeSDKClient(
        options=ClaudeCodeOptions(
            model=model,
            system_prompt=(
                "You are an expert Tauri/TypeScript/Rust developer building VIBM, "
                "a desktop coding agent conversation manager. "
                "Follow the project's CLAUDE.md, rules/, and agents/ specifications. "
                "Use immutable patterns, explicit error handling, and write tests first."
            ),
            allowed_tools=BUILTIN_TOOLS,
            hooks={
                "PreToolUse": [
                    HookMatcher(matcher="Bash", hooks=[bash_security_hook]),
                    HookMatcher(matcher="Write", hooks=[pre_write_feature_list_hook]),
                ],
            },
            max_turns=1000,
            cwd=str(project_dir.resolve()),
            settings=str(settings_file.resolve()),
        )
    )
