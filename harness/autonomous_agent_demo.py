#!/usr/bin/env python3

"""
VIBM Autonomous Development Harness
====================================

Adapted from Anthropic's autonomous-coding quickstart.
Implements the two-agent pattern (initializer + coding agent) to
autonomously build VIBM, a Tauri/TypeScript/Rust desktop application.

Usage:
  python3 autonomous_agent_demo.py --clean         # Fresh start: wipe runtime files, run initializer
  python3 autonomous_agent_demo.py --max-iterations 5
  python3 autonomous_agent_demo.py --no-sandbox    # Windows/WSL2 only
"""

import argparse
import asyncio
import os
import platform
import shutil
import stat
import sys
from pathlib import Path

from agent import run_autonomous_agent, run_cloud_review_loop

DEFAULT_MODEL = "claude-sonnet-4-5-20250929"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="VIBM Autonomous Development Harness",
    )

    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path(__file__).parent.parent,
        help="Project directory (default: vibm root)",
    )

    parser.add_argument(
        "--max-iterations",
        type=int,
        default=None,
        help="Maximum iterations per feature (default: unlimited)",
    )

    parser.add_argument(
        "--model",
        type=str,
        default=DEFAULT_MODEL,
        help=f"Claude model (default: {DEFAULT_MODEL})",
    )

    parser.add_argument(
        "--no-sandbox",
        action="store_true",
        default=False,
        help="Disable OS-level sandbox (only recommended for Windows/WSL2)",
    )

    parser.add_argument(
        "--clean",
        action="store_true",
        default=False,
        help="Wipe runtime files (feature_list.json, claude-progress.txt) before starting. Forces the initializer agent to run fresh. Preserves app_spec.md — delete that manually if you really want to reset the spec.",
    )

    parser.add_argument(
        "--skip-review",
        action="store_true",
        default=False,
        help="Skip local Codex review in the feature loop",
    )

    parser.add_argument(
        "--review-timeout",
        type=int,
        default=300,
        help="Max seconds to wait for cloud Codex review (default: 300)",
    )

    parser.add_argument(
        "--max-relay-loops",
        type=int,
        default=2,
        help="Max cloud review-fix cycles in Phase 3 (default: 2)",
    )

    parser.add_argument(
        "--skip-relay",
        action="store_true",
        default=False,
        help=(
            "Skip Phase 3 cloud review entirely. Equivalent to "
            "`--phase-3 skip`; kept for backwards compatibility."
        ),
    )

    parser.add_argument(
        "--phase-3",
        choices=["auto", "confirm", "skip"],
        default="confirm",
        help=(
            "How to handle Phase 3 (push branch, open PR, relay cloud "
            "Codex review): 'auto' runs it without asking; 'confirm' "
            "(default) prompts on a tty and auto-skips on a non-tty so "
            "backgrounded runs never push unattended; 'skip' disables "
            "Phase 3 entirely. Passing --skip-relay is equivalent to "
            "--phase-3 skip."
        ),
    )

    parser.add_argument(
        "--ignore-stale-list",
        action="store_true",
        default=False,
        help=(
            "Proceed even if .feature_list_stamp.json is missing or does "
            "not match the current app_spec.md hash. Default behavior is "
            "to refuse to run Phase 2 on a stale feature_list.json so the "
            "harness never silently resumes a list that doesn't match the "
            "spec it was generated from."
        ),
    )

    parser.add_argument(
        "--client",
        choices=["cli", "sdk"],
        default="cli",
        help=(
            "Claude client backend. Default 'cli' runs `claude -p` per role "
            "and inherits the user's Claude Code CLI auth. 'sdk' is an "
            "opt-in fallback that requires ANTHROPIC_API_KEY — use only "
            "when the CLI path is unavailable (CLI not installed, auth "
            "issue, custom ANTHROPIC_BASE_URL)."
        ),
    )

    return parser.parse_args()


def _is_wsl() -> bool:
    """Detect if running inside WSL."""
    try:
        with open("/proc/version", "r") as f:
            return "microsoft" in f.read().lower()
    except OSError:
        return False


def resolve_sandbox(no_sandbox_flag: bool) -> bool:
    """
    Determine whether sandbox should be enabled.

    Default: sandbox ON (recommended for macOS/Linux).
    Disabled only when --no-sandbox is explicitly passed.
    On WSL2 first run without --no-sandbox, warn the user.
    """
    if no_sandbox_flag:
        print("  Sandbox: DISABLED (--no-sandbox flag)")
        print("  Python hooks still validate all bash commands.")
        return False

    if _is_wsl():
        print("  Warning: WSL2 detected. OS-level sandbox may be unreliable.")
        print("  If you encounter issues, re-run with --no-sandbox")
        print("  Python hooks still validate all bash commands regardless.")
        print()

    return True


RUNTIME_FILES = [
    "feature_list.json",
    "claude-progress.txt",
    ".feature_list_stamp.json",
]


def should_run_phase_3(
    mode: str,
    legacy_skip_relay: bool = False,
    *,
    stdin_isatty: bool | None = None,
    prompt_fn=input,
) -> bool:
    """Decide whether to run the Phase 3 cloud review relay.

    ``mode`` is one of ``"auto"``, ``"confirm"``, ``"skip"`` from the
    ``--phase-3`` argument. ``legacy_skip_relay`` is ``True`` when the
    caller passed the older ``--skip-relay`` flag; it unconditionally
    disables Phase 3 for back-compat.

    ``stdin_isatty`` and ``prompt_fn`` are injected for testing; in
    production they default to the real stdin state and :func:`input`.
    A ``confirm`` run on a non-tty (e.g. Claude's background task
    runner) auto-skips so backgrounded harness runs never push
    unattended. A ``confirm`` run on a tty prompts the user.
    """
    if legacy_skip_relay or mode == "skip":
        return False
    if mode == "auto":
        return True
    # mode == "confirm"
    if stdin_isatty is None:
        stdin_isatty = sys.stdin.isatty()
    if not stdin_isatty:
        print(
            "  Phase 3 is gated behind user confirmation (--phase-3 confirm, "
            "the default), and this run is not attached to a tty. "
            "Auto-skipping the cloud review relay. "
            "Pass --phase-3 auto to opt in to non-interactive Phase 3, "
            "or run /harness-plugin:loop's Phase 3 step manually after "
            "reviewing the Phase 2 output."
        )
        return False
    print()
    print("  " + "=" * 60)
    print("  PHASE 3 CONFIRMATION")
    print("  " + "=" * 60)
    print("  Phase 2 is complete. Phase 3 will:")
    print("    - git push the current branch to origin")
    print("    - gh pr create (or find an existing PR)")
    print("    - poll for the cloud Codex review and spawn a fix loop")
    print()
    answer = prompt_fn("  Run Phase 3 now? [y/N]: ").strip().lower()
    if answer in ("y", "yes"):
        return True
    print("  Skipping Phase 3. You can run it later manually or rerun "
          "the harness with --phase-3 auto.")
    return False


def clean_runtime_files(project_dir: Path) -> None:
    """Remove harness runtime files to force a fresh initializer run.

    Preserves ``app_spec.md`` — that is the user's authored product
    specification, not harness runtime state. Wiping it here used to
    force the initializer to fall back to ``prompts/app_spec.md`` (the
    default VIBM template), silently replacing the user's real spec.
    If a user genuinely wants to wipe their spec they can delete it
    manually; ``--clean`` only touches machine-generated artifacts.
    """
    print("  Cleaning runtime files...")
    for name in RUNTIME_FILES:
        path = project_dir / name
        if path.exists():
            path.unlink()
            print(f"    Removed {name}")
    print()


def preflight_checks(client_kind: str = "cli") -> bool:
    """Run preflight checks before starting the harness.

    No auth check here — the default CLI backend inherits the user's
    `claude` CLI login. The opt-in SDK fallback (`--client sdk`) enforces
    its own ANTHROPIC_API_KEY requirement inside
    `sdk_client.create_client`.

    For `--client cli`, verify the `claude` binary is on PATH up front —
    otherwise the first session spawn fails deep inside
    `asyncio.create_subprocess_exec` with a cryptic FileNotFoundError,
    well after the harness has printed startup banners.
    """
    if client_kind == "cli" and not shutil.which("claude"):
        print("Error: 'claude' CLI not found on PATH.")
        print("Install: npm install -g @anthropic-ai/claude-code")
        print("Then run `claude /login` to authenticate.")
        print("Or pass --client sdk to use the legacy SDK backend (requires ANTHROPIC_API_KEY).")
        return False

    ok = True

    # Fix ripgrep permissions (Claude Code vendor binary)
    rg_paths = [
        Path.home() / ".npm-global/lib/node_modules/@anthropic-ai/claude-code/vendor/ripgrep/x64-linux/rg",
        Path.home() / ".local/lib/node_modules/@anthropic-ai/claude-code/vendor/ripgrep/x64-linux/rg",
    ]
    for rg_path in rg_paths:
        if rg_path.exists() and not os.access(rg_path, os.X_OK):
            print(f"  Fixing rg permissions: {rg_path}")
            rg_path.chmod(rg_path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    return ok


def main() -> None:
    args = parse_args()

    if not preflight_checks(client_kind=args.client):
        return

    if args.clean:
        clean_runtime_files(args.project_dir)

    # --no-sandbox flag or HARNESS_NO_SANDBOX env var
    no_sandbox = args.no_sandbox or os.environ.get("HARNESS_NO_SANDBOX") == "1"
    sandbox = resolve_sandbox(no_sandbox)

    try:
        phase2_ok = asyncio.run(
            run_autonomous_agent(
                project_dir=args.project_dir,
                model=args.model,
                max_iterations=args.max_iterations,
                sandbox=sandbox,
                skip_review=args.skip_review,
                client_kind=args.client,
                ignore_stale_list=args.ignore_stale_list,
            )
        )

        # Phase 3 must NOT run if Phase 2 aborted early (stale-stamp guard,
        # initializer failure) — the branch may contain no new work or an
        # incomplete feature list, and --phase-3 auto would otherwise push
        # that state and open a PR.
        if not phase2_ok:
            print("  Phase 2 did not complete normally — skipping Phase 3.")
        elif should_run_phase_3(args.phase_3, args.skip_relay):
            asyncio.run(
                run_cloud_review_loop(
                    project_dir=args.project_dir,
                    model=args.model,
                    sandbox=sandbox,
                    max_relay_loops=args.max_relay_loops,
                    review_timeout=args.review_timeout,
                    client_kind=args.client,
                )
            )

    except KeyboardInterrupt:
        print("\n\nInterrupted by user. Run again to resume.")
    except Exception as e:
        print(f"\nFatal error: {e}")
        raise


if __name__ == "__main__":
    main()
