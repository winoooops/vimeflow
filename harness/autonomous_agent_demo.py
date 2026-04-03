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
import stat
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
        help="Wipe runtime files (feature_list.json, claude-progress.txt, app_spec.md) before starting. Forces the initializer agent to run fresh.",
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
        help="Skip Phase 3 cloud review entirely",
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
    "app_spec.md",
]


def clean_runtime_files(project_dir: Path) -> None:
    """Remove harness runtime files to force a fresh initializer run."""
    print("  Cleaning runtime files...")
    for name in RUNTIME_FILES:
        path = project_dir / name
        if path.exists():
            path.unlink()
            print(f"    Removed {name}")
    print()


def preflight_checks() -> bool:
    """Run preflight checks before starting the harness."""
    ok = True

    # Check API key
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY environment variable not set")
        print("\nOption 1: export ANTHROPIC_API_KEY='your-key-here'")
        print("Option 2: add it to .env at the project root")
        print("   The harness does NOT auto-load .env; source it first:")
        print("   set -a && source .env && set +a")
        return False

    # Check optional base URL
    base_url = os.environ.get("ANTHROPIC_BASE_URL")
    if base_url:
        print(f"  API base URL: {base_url}")

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

    if not preflight_checks():
        return

    if args.clean:
        clean_runtime_files(args.project_dir)

    # --no-sandbox flag or HARNESS_NO_SANDBOX env var
    no_sandbox = args.no_sandbox or os.environ.get("HARNESS_NO_SANDBOX") == "1"
    sandbox = resolve_sandbox(no_sandbox)

    try:
        asyncio.run(
            run_autonomous_agent(
                project_dir=args.project_dir,
                model=args.model,
                max_iterations=args.max_iterations,
                sandbox=sandbox,
                skip_review=args.skip_review,
            )
        )

        # Phase 3: Cloud review (if not skipped)
        if not args.skip_relay:
            asyncio.run(
                run_cloud_review_loop(
                    project_dir=args.project_dir,
                    model=args.model,
                    sandbox=sandbox,
                    max_relay_loops=args.max_relay_loops,
                    review_timeout=args.review_timeout,
                )
            )

    except KeyboardInterrupt:
        print("\n\nInterrupted by user. Run again to resume.")
    except Exception as e:
        print(f"\nFatal error: {e}")
        raise


if __name__ == "__main__":
    main()
