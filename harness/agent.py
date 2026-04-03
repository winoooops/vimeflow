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
        print("  Review unavailable — treating as error so iteration budget is preserved.")
        return "error", None

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
    exhausted_ids: set = set()  # Features that hit max iterations without passing

    while True:
        pending = [
            f for f in get_pending_features(project_dir)
            if f.get("id") not in exhausted_ids
        ]
        if not pending:
            if exhausted_ids:
                print(f"\n  Done. {len(exhausted_ids)} feature(s) exhausted max iterations: {exhausted_ids}")
            else:
                print("\n  All features complete (or no pending features with met dependencies).")
            break

        feature = pending[0]
        feature_num += 1
        feature_id = feature.get("id", "?")

        print("\n" + "=" * 70)
        print(f"  FEATURE {feature_num}: #{feature_id} — {feature.get('description', '')}")
        print("=" * 70)

        findings = None
        iteration = 0

        while True:
            iteration += 1
            if max_iterations is not None and iteration > max_iterations:
                print(f"  Feature #{feature_id} hit max iterations ({max_iterations}). Moving on.")
                exhausted_ids.add(feature_id)
                break
            print_session_header(iteration, is_initializer=False)

            if skip_review:
                # No review -- just run Coder, then check if feature passed
                client = create_client(project_dir, model, sandbox=sandbox)
                prompt = get_coding_prompt()

                async with client:
                    status, response = await run_agent_session(client, prompt, project_dir)

                print_progress_summary(project_dir)

                # Re-check feature status after coder run
                updated = [
                    f for f in get_pending_features(project_dir)
                    if f.get("id") == feature_id
                ]
                if not updated:
                    # Feature is no longer pending — it passed
                    print(f"  Feature #{feature_id} passed on iteration {iteration}.")
                    break
                # Feature still pending — let the loop continue so
                # max_iterations is enforced on the next pass
                print(f"  Feature #{feature_id} still pending after iteration {iteration}.")
                await asyncio.sleep(AUTO_CONTINUE_DELAY_SECONDS)
                continue

            status, new_findings = await run_feature_iteration(
                project_dir, model, sandbox, feature, iteration, findings
            )

            print_progress_summary(project_dir)

            if status == "passed":
                # Verify feature is actually no longer pending
                still_pending = [
                    f for f in get_pending_features(project_dir)
                    if f.get("id") == feature_id
                ]
                if not still_pending:
                    print(f"  Feature #{feature_id} passed on iteration {iteration}.")
                    break
                # Review said clean but feature didn't flip passes=true
                print(f"  Feature #{feature_id} review clean but still pending. Continuing.")
                findings = None  # Clear stale findings so next iteration starts fresh
                await asyncio.sleep(AUTO_CONTINUE_DELAY_SECONDS)
            elif status == "has_findings":
                findings = new_findings
                print(f"  Feeding findings back to Coder (iteration {iteration + 1})...")
                await asyncio.sleep(AUTO_CONTINUE_DELAY_SECONDS)
            elif status == "error":
                print(f"  Feature #{feature_id} errored on iteration {iteration}. Counting toward budget.")
                # Don't break — let the max_iterations check at loop top
                # handle exhaustion so transient errors get retried.
                await asyncio.sleep(AUTO_CONTINUE_DELAY_SECONDS)

        await asyncio.sleep(AUTO_CONTINUE_DELAY_SECONDS)

    print("\n" + "=" * 70)
    print("  HARNESS COMPLETE (Phase 2: Feature Loop)")
    print("=" * 70)
    print(f"\n  Project: {project_dir.resolve()}")
    print_progress_summary(project_dir)


async def run_cloud_review_loop(
    project_dir: Path,
    model: str,
    sandbox: bool,
    max_relay_loops: int = 2,
    review_timeout: int = 300,
) -> str:
    """
    Phase 3: Push, create PR, poll for cloud Codex review, fix if needed.

    The Coordinator handles GitHub ops (push/PR/poll) directly via subprocess.
    Only the fix step spawns a Claude SDK session.

    Returns: "CLEAN", "FIXED", "ATTENTION", or "SKIPPED".
    """
    import subprocess
    from review import push_and_create_pr, poll_for_cloud_review
    from prompts import get_reviewer_prompt

    branch_result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True, text=True,
        cwd=str(project_dir),
    )
    branch = branch_result.stdout.strip()

    if not branch or branch == "main":
        print("  On main branch — skipping cloud review.")
        return "SKIPPED"

    print("\n" + "=" * 70)
    print("  PHASE 3: CLOUD REVIEW")
    print("=" * 70)

    pr_number = push_and_create_pr(
        project_dir, branch,
        title=f"feat: harness implementation ({branch})",
        body="Automated implementation by VIBM harness.",
    )

    if not pr_number:
        print("  Could not create PR. Skipping cloud review.")
        return "SKIPPED"

    status = "ATTENTION"
    last_comment_id: int | None = None

    for relay_loop in range(1, max_relay_loops + 1):
        print(f"\n  Relay loop {relay_loop}/{max_relay_loops}: waiting for Codex review...")
        review = poll_for_cloud_review(
            project_dir, pr_number,
            timeout=review_timeout,
            previous_comment_id=last_comment_id,
        )

        if not review:
            print("  Cloud review timed out.")
            break

        if not review["has_findings"]:
            print("  Cloud Codex review: CLEAN.")
            status = "CLEAN" if relay_loop == 1 else "FIXED"
            break

        print("  Cloud Codex review found issues.")
        print(f"  Findings:\n{review['raw_review'][:500]}")
        last_comment_id = review.get("comment_id")

        if relay_loop >= max_relay_loops:
            print(f"  Max relay loops ({max_relay_loops}) reached. ATTENTION needed.")
            break

        # Spawn Claude SDK session to fix findings
        print("\n  Spawning fix agent...")
        client = create_client(project_dir, model, sandbox=sandbox)
        prompt = get_reviewer_prompt(review["raw_review"])

        async with client:
            fix_status, _ = await run_agent_session(client, prompt, project_dir)

        if fix_status == "error":
            print("  Fix agent errored. Stopping relay loop.")
            break

        # Push fixes — triggers new Codex review on PR (synchronize event)
        push_result = subprocess.run(
            ["git", "push"],
            capture_output=True, text=True,
            cwd=str(project_dir),
        )
        if push_result.returncode != 0:
            print(f"  Push failed: {push_result.stderr}")
            break

        print("  Fixes pushed. Polling for next review...")

    print(f"\n  Phase 3 result: {status}")
    return status
