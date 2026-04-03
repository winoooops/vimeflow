"""
Agent Session Logic
===================

Core loop for running autonomous coding sessions with local Codex review.
"""

import asyncio
import json
from pathlib import Path
from typing import Optional

from client import create_client
from progress import print_session_header, print_progress_summary
from prompts import (
    get_initializer_prompt,
    get_coding_prompt,
    get_coding_prompt_with_findings,
    copy_spec_to_project,
)
from review import run_local_review

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


def get_pending_features(project_dir: Path) -> list[dict]:
    """Get features where passes=false and all dependencies are met."""
    tests_file = project_dir / "feature_list.json"
    if not tests_file.exists():
        return []

    try:
        with open(tests_file, "r") as f:
            features = json.load(f)
    except (json.JSONDecodeError, IOError):
        return []

    passing_ids = {
        f.get("id") for f in features if f.get("passes", False)
    }

    pending = []
    for f in features:
        if f.get("passes", False):
            continue
        deps = set(f.get("dependencies", []))
        if deps.issubset(passing_ids):
            pending.append(f)

    return pending


async def run_feature_iteration(
    project_dir: Path,
    model: str,
    sandbox: bool,
    feature: dict,
    iteration: int,
    findings: str | None = None,
) -> tuple[str, str | None]:
    """
    Run one Coder->Reviewer iteration for a feature.

    Returns (status, findings_text):
      - ("passed", None) -- review clean, feature done
      - ("has_findings", "...") -- review found issues
      - ("error", None) -- session errored
    """
    feature_desc = feature.get("description", f"Feature #{feature.get('id', '?')}")

    print(f"\n  Feature: {feature_desc}")
    print(f"  Iteration: {iteration}")
    print()

    # --- Coder phase ---
    client = create_client(project_dir, model, sandbox=sandbox)

    if findings:
        prompt = get_coding_prompt_with_findings(findings)
    else:
        prompt = get_coding_prompt()

    async with client:
        status, response = await run_agent_session(client, prompt, project_dir)

    if status == "error":
        return "error", None

    # --- Reviewer phase (local Codex CLI) ---
    print("  Running local Codex review...")
    review_result = run_local_review(project_dir)

    if review_result.get("error"):
        print(f"  Codex review error: {review_result['error']}")
        print("  Skipping review, treating as passed.")
        return "passed", None

    if review_result["has_findings"]:
        print("  Codex found issues. Will feed back to Coder.")
        return "has_findings", review_result["raw_review"]
    else:
        print("  Codex review: clean. Feature passed.")
        return "passed", None


async def run_autonomous_agent(
    project_dir: Path,
    model: str,
    max_iterations: Optional[int] = None,
    sandbox: bool = True,
    skip_review: bool = False,
) -> None:
    """
    Run the autonomous agent loop.

    Phase 1: Initializer (if no feature_list.json)
    Phase 2: Feature loop with per-feature Coder->Reviewer iterations
    """
    print("\n" + "=" * 70)
    print("  VIBM AUTONOMOUS DEVELOPMENT HARNESS")
    print("=" * 70)
    print(f"\n  Project:    {project_dir.resolve()}")
    print(f"  Model:      {model}")
    print(f"  Iterations: {max_iterations or 'unlimited'} (per feature)")
    print(f"  Review:     {'disabled' if skip_review else 'enabled (local Codex)'}")
    print()

    project_dir.mkdir(parents=True, exist_ok=True)

    tests_file = project_dir / "feature_list.json"
    is_first_run = not tests_file.exists()

    # --- Phase 1: Initializer ---
    if is_first_run:
        print("  Mode: INITIALIZER (generating feature list from app_spec.md)")
        print()
        copy_spec_to_project(project_dir)

        print_session_header(1, is_initializer=True)

        client = create_client(project_dir, model, sandbox=sandbox)
        prompt = get_initializer_prompt()

        async with client:
            status, response = await run_agent_session(client, prompt, project_dir)

        if status == "error":
            print("  Initializer failed. Check logs and retry.")
            return

        print_progress_summary(project_dir)
        await asyncio.sleep(AUTO_CONTINUE_DELAY_SECONDS)

    # --- Phase 2: Feature loop ---
    print("\n  Mode: FEATURE LOOP (Coder + Reviewer per feature)")
    print_progress_summary(project_dir)

    feature_num = 0
    while True:
        pending = get_pending_features(project_dir)
        if not pending:
            print("\n  All features complete (or no pending features with met dependencies).")
            break

        feature = pending[0]
        feature_num += 1
        feature_id = feature.get("id", "?")

        print("\n" + "=" * 70)
        print(f"  FEATURE {feature_num}: #{feature_id} — {feature.get('description', '')}")
        print("=" * 70)

        budget = max_iterations or 999
        findings = None

        for iteration in range(1, budget + 1):
            print_session_header(iteration, is_initializer=False)

            if skip_review:
                # No review -- just run Coder once
                client = create_client(project_dir, model, sandbox=sandbox)
                prompt = get_coding_prompt()

                async with client:
                    status, response = await run_agent_session(client, prompt, project_dir)

                print_progress_summary(project_dir)
                break  # One iteration per feature when review is off

            status, new_findings = await run_feature_iteration(
                project_dir, model, sandbox, feature, iteration, findings
            )

            print_progress_summary(project_dir)

            if status == "passed":
                print(f"  Feature #{feature_id} passed on iteration {iteration}.")
                break
            elif status == "has_findings":
                findings = new_findings
                print(f"  Feeding findings back to Coder (iteration {iteration + 1})...")
                await asyncio.sleep(AUTO_CONTINUE_DELAY_SECONDS)
            elif status == "error":
                print(f"  Feature #{feature_id} errored on iteration {iteration}. Moving on.")
                break

        else:
            print(f"  Feature #{feature_id} hit max iterations ({budget}). Moving on.")

        await asyncio.sleep(AUTO_CONTINUE_DELAY_SECONDS)

    print("\n" + "=" * 70)
    print("  HARNESS COMPLETE (Phase 2: Feature Loop)")
    print("=" * 70)
    print(f"\n  Project: {project_dir.resolve()}")
    print_progress_summary(project_dir)
