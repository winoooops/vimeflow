#!/usr/bin/env python3

"""
VIBM Autonomous Development Harness
====================================

Adapted from Anthropic's autonomous-coding quickstart.
Implements the two-agent pattern (initializer + coding agent) to
autonomously build VIBM, a Tauri/TypeScript/Rust desktop application.

Usage:
  python autonomous_agent_demo.py
  python autonomous_agent_demo.py --max-iterations 5
  python autonomous_agent_demo.py --model claude-sonnet-4-5-20250929
"""

import argparse
import asyncio
import os
from pathlib import Path

from agent import run_autonomous_agent

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
        help="Maximum iterations (default: unlimited)",
    )

    parser.add_argument(
        "--model",
        type=str,
        default=DEFAULT_MODEL,
        help=f"Claude model (default: {DEFAULT_MODEL})",
    )

    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY environment variable not set")
        print("\nGet your API key from: https://console.anthropic.com/")
        print("Then: export ANTHROPIC_API_KEY='your-key-here'")
        return

    try:
        asyncio.run(
            run_autonomous_agent(
                project_dir=args.project_dir,
                model=args.model,
                max_iterations=args.max_iterations,
            )
        )
    except KeyboardInterrupt:
        print("\n\nInterrupted by user. Run again to resume.")
    except Exception as e:
        print(f"\nFatal error: {e}")
        raise


if __name__ == "__main__":
    main()
