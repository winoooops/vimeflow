"""
SDK Client (opt-in fallback)
============================

Used when `--client sdk` is passed. Unlike the default CLI path (which
inherits the user's global `~/.claude` auth), this backend talks directly
to the Anthropic API and requires `ANTHROPIC_API_KEY`. The `claude_code_sdk`
imports below carry `# type: ignore` because the package is only needed
here and default environments don't install it.

Public factory mirrors `client.create_client` in shape — import aliased:

    from client import create_client as create_cli_client
    from sdk_client import create_client as create_sdk_client
"""

import os
from pathlib import Path

from client import BUILTIN_TOOLS, build_base_settings, write_settings_file


def create_client(
    project_dir: Path, model: str, *, sandbox: bool = True
):
    """Create a `claude_code_sdk.ClaudeSDKClient` with harness security layers.

    Fallback only — invoked via `--client sdk`. The default path is
    `client.create_client`. Same permissions + sandbox block as the CLI
    backend (via `build_base_settings`); the only divergence is hook wiring
    — SDK hooks run in-process via `HookMatcher` callables, whereas the CLI
    backend spawns `hook_runner.py` per tool call. Same security logic.

    Tool-surface caveat: `ClaudeCodeOptions.allowed_tools` is *permissive*
    — it marks the listed tools as allowed but does NOT remove MCP tools
    or other built-ins from the session. The CLI backend uses
    `claude -p --tools` which IS exclusive. Under `--no-sandbox`
    (`bypassPermissions`) this means the SDK fallback has a wider tool
    surface than the default CLI path: any globally-configured MCP tool
    remains invokable and bypasses our Bash / Write hooks. Stay on the
    CLI backend for production runs; use `--client sdk` only to debug
    the legacy path or when the CLI isn't available.

    Raises:
        ValueError: if `ANTHROPIC_API_KEY` is not set. The CLI default path
            inherits the user's `claude` CLI auth and never triggers this.
    """
    from claude_code_sdk import ClaudeCodeOptions, ClaudeSDKClient  # type: ignore[import-not-found]
    from claude_code_sdk.types import HookMatcher  # type: ignore[import-not-found]

    from security import bash_security_hook
    from hooks import pre_write_feature_list_hook

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise ValueError(
            "ANTHROPIC_API_KEY not set. The SDK fallback backend "
            "(--client sdk) requires it. The default CLI backend does not — "
            "omit --client sdk to use the user's `claude` CLI auth instead."
        )

    settings = build_base_settings(sandbox=sandbox)
    settings_file = write_settings_file(
        project_dir, settings, filename=".claude_settings.json"
    )

    mode_label = "sandbox + acceptEdits" if sandbox else "bypassPermissions (no sandbox)"
    print(f"  [sdk] {mode_label}, fs restricted to {project_dir.resolve()}")
    print(f"  [sdk] Bash: allowlist-validated (see harness/security.py)")
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
                    # `Write|Edit` — must match client.py. A prior version
                    # only hooked `Write`, letting an agent bypass the
                    # feature_list integrity check via the Edit tool.
                    HookMatcher(matcher="Write|Edit", hooks=[pre_write_feature_list_hook]),
                ],
            },
            max_turns=1000,
            cwd=str(project_dir.resolve()),
            settings=str(settings_file.resolve()),
        )
    )
