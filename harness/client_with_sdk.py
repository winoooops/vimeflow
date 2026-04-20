"""
SDK Fallback Client
===================

Opt-in backup path for when the default `claude -p` subprocess (see
`cli_client.py`) isn't available — e.g. the `claude` CLI isn't installed,
auth is broken, or you need `ANTHROPIC_BASE_URL` to point at a proxy.

Normal workflow never touches this module. Only `agent._make_session` imports
it, and only when `client_kind == "sdk"`. That keeps `claude_code_sdk` out of
the default import graph and means a missing SDK install never breaks the CLI
path — which is also why the `claude_code_sdk` imports below carry
`# type: ignore` hints: editors inspecting a default-env interpreter will
correctly not resolve them.

Requires `ANTHROPIC_API_KEY` — the check lives inside
`create_sdk_client_fallback` (not in preflight) so it only fires on explicit
opt-in.
"""

import os
from pathlib import Path

from client import BUILTIN_TOOLS, build_base_settings, write_settings_file


def create_sdk_client_fallback(
    project_dir: Path, model: str, *, sandbox: bool = True
):
    """Create a `claude_code_sdk.ClaudeSDKClient` with harness security layers.

    Fallback only — invoked via `--client sdk`. The default path is CLI.

    Security mirrors the CLI backend's settings (via `build_base_settings`):
      - Settings isolation via `CLAUDE_CONFIG_DIR` (set in `client.py`)
      - `acceptEdits` under sandbox, `bypassPermissions` without
      - Python hooks on Bash (allowlist) and Write (feature_list protection)

    The only divergence from the CLI backend is hook wiring: SDK hooks run
    in-process via `HookMatcher` callables, whereas the CLI backend spawns
    `hook_runner.py` per tool call. Same underlying security logic.

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
    mode_label = (
        "sandbox + acceptEdits"
        if sandbox
        else "bypassPermissions (no sandbox)"
    )

    settings_file = write_settings_file(
        project_dir, settings, filename=".claude_settings.json"
    )

    print(f"  [fallback] SDK client: {mode_label}, fs restricted to {project_dir.resolve()}")
    print(f"  [fallback] Bash: allowlist-validated (see harness/security.py)")
    print(f"  [fallback] Config: isolated from user settings (CLAUDE_CONFIG_DIR)")
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
