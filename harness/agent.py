"""
Agent Session Logic
===================

Core loop for running autonomous coding sessions.
"""

import asyncio
from pathlib import Path
from typing import Optional

from client import create_client
from progress import print_session_header, print_progress_summary
from prompts import get_initializer_prompt, get_coding_prompt, copy_spec_to_project

AUTO_CONTINUE_DELAY_SECONDS = 3


async def run_agent_session(
    client,
    message: str,
    project_dir: Path,
) -> tuple[str, str]:
    """
    Run a single agent session.

    Returns (status, response_text) where status is "continue" or "error".
    """
    print("  Sending prompt to Claude Code SDK...\n")

    try:
        await client.query(message)

        response_text = ""
        async for msg in client.receive_response():
            msg_type = type(msg).__name__

            if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                for block in msg.content:
                    block_type = type(block).__name__

                    if block_type == "TextBlock" and hasattr(block, "text"):
                        response_text += block.text
                        print(block.text, end="", flush=True)
                    elif block_type == "ToolUseBlock" and hasattr(block, "name"):
                        print(f"\n  [Tool: {block.name}]", flush=True)
                        if hasattr(block, "input"):
                            input_str = str(block.input)
                            if len(input_str) > 200:
                                print(f"    {input_str[:200]}...", flush=True)
                            else:
                                print(f"    {input_str}", flush=True)

            elif msg_type == "UserMessage" and hasattr(msg, "content"):
                for block in msg.content:
                    block_type = type(block).__name__

                    if block_type == "ToolResultBlock":
                        result_content = getattr(block, "content", "")
                        is_error = getattr(block, "is_error", False)

                        if "blocked" in str(result_content).lower():
                            print(f"    [BLOCKED] {result_content}", flush=True)
                        elif is_error:
                            print(f"    [Error] {str(result_content)[:500]}", flush=True)
                        else:
                            print("    [Done]", flush=True)

        print("\n" + "-" * 70 + "\n")
        return "continue", response_text

    except Exception as e:
        print(f"  Error during session: {e}")
        return "error", str(e)


async def run_autonomous_agent(
    project_dir: Path,
    model: str,
    max_iterations: Optional[int] = None,
    sandbox: bool = True,
) -> None:
    """Run the autonomous agent loop."""
    print("\n" + "=" * 70)
    print("  VIBM AUTONOMOUS DEVELOPMENT HARNESS")
    print("=" * 70)
    print(f"\n  Project:    {project_dir.resolve()}")
    print(f"  Model:      {model}")
    print(f"  Iterations: {max_iterations or 'unlimited'}")
    print()

    project_dir.mkdir(parents=True, exist_ok=True)

    tests_file = project_dir / "feature_list.json"
    is_first_run = not tests_file.exists()

    if is_first_run:
        print("  Mode: INITIALIZER (generating feature list from app_spec.md)")
        print()
        copy_spec_to_project(project_dir)
    else:
        print("  Mode: CODER (implementing features)")
        print_progress_summary(project_dir)

    iteration = 0

    while True:
        iteration += 1

        if max_iterations and iteration > max_iterations:
            print(f"\n  Reached max iterations ({max_iterations}). Run again to continue.")
            break

        print_session_header(iteration, is_first_run)

        client = create_client(project_dir, model, sandbox=sandbox)

        if is_first_run:
            prompt = get_initializer_prompt()
            is_first_run = False
        else:
            prompt = get_coding_prompt()

        async with client:
            status, response = await run_agent_session(client, prompt, project_dir)

        if status == "continue":
            print(f"  Auto-continuing in {AUTO_CONTINUE_DELAY_SECONDS}s...")
            print_progress_summary(project_dir)
            await asyncio.sleep(AUTO_CONTINUE_DELAY_SECONDS)

        elif status == "error":
            print("  Session errored. Retrying with fresh context...")
            await asyncio.sleep(AUTO_CONTINUE_DELAY_SECONDS)

        if max_iterations is None or iteration < max_iterations:
            await asyncio.sleep(1)

    print("\n" + "=" * 70)
    print("  HARNESS COMPLETE")
    print("=" * 70)
    print(f"\n  Project: {project_dir.resolve()}")
    print_progress_summary(project_dir)
