"""
Code Review Integration
=======================

Local Codex CLI review and cloud review polling via gh CLI.
The Coordinator calls these functions directly — no SDK session needed.
"""

import json
import re
import subprocess
import time
from pathlib import Path


def run_local_review(project_dir: Path, base_branch: str = "main") -> dict:
    """
    Run Codex CLI review locally.

    Returns dict with:
      - has_findings: bool
      - raw_review: str (the full Codex output)
      - findings: list (parsed if possible)
    """
    cmd = [
        "codex", "exec", "review",
        "--base", base_branch,
        "--model", "gpt-5.2-codex",
        "--full-auto",
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(project_dir),
            timeout=300,
        )
        output = result.stdout + result.stderr
        if result.returncode != 0:
            return {
                "has_findings": False,
                "raw_review": f"Error: codex exited with code {result.returncode}\n{output.strip()}",
                "findings": [],
                "error": "codex_failed",
            }
    except FileNotFoundError:
        return {
            "has_findings": False,
            "raw_review": "Error: codex CLI not found",
            "findings": [],
            "error": "codex_not_found",
        }
    except subprocess.TimeoutExpired:
        return {
            "has_findings": False,
            "raw_review": "Error: codex review timed out",
            "findings": [],
            "error": "timeout",
        }

    return parse_codex_output(output)


def parse_codex_output(output: str) -> dict:
    """Parse Codex CLI review output into structured findings."""
    codex_sections = re.split(r"^codex$", output, flags=re.MULTILINE)
    review_text = codex_sections[-1].strip() if len(codex_sections) > 1 else output.strip()

    no_issue_patterns = [
        r"no\s+(?:actionable\s+)?issues",
        r"no\s+issues\s+(?:found|introduced|identified|meeting)",
        r"changes\s+appear\s+consistent",
        r"patch\s+(?:is\s+)?correct",
    ]

    has_findings = True
    for pattern in no_issue_patterns:
        if re.search(pattern, review_text, re.IGNORECASE):
            has_findings = False
            break

    return {
        "has_findings": has_findings,
        "raw_review": review_text,
        "findings": [],
    }


def push_and_create_pr(project_dir: Path, branch: str, title: str, body: str) -> int | None:
    """
    Push branch and create PR. Returns PR number or None on failure.
    """
    push_result = subprocess.run(
        ["git", "push", "-u", "origin", branch],
        capture_output=True, text=True,
        cwd=str(project_dir),
    )
    if push_result.returncode != 0:
        print(f"  Error pushing: {push_result.stderr}")
        return None

    check = subprocess.run(
        ["gh", "pr", "view", "--json", "number"],
        capture_output=True, text=True,
        cwd=str(project_dir),
    )
    if check.returncode == 0:
        try:
            return json.loads(check.stdout)["number"]
        except (json.JSONDecodeError, KeyError):
            pass

    create = subprocess.run(
        ["gh", "pr", "create", "--title", title, "--body", body],
        capture_output=True, text=True,
        cwd=str(project_dir),
    )
    if create.returncode != 0:
        print(f"  Error creating PR: {create.stderr}")
        return None

    match = re.search(r"/pull/(\d+)", create.stdout)
    return int(match.group(1)) if match else None


def _get_repo_name(project_dir: Path) -> str | None:
    """Get owner/repo from gh CLI."""
    result = subprocess.run(
        ["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
        capture_output=True, text=True,
        cwd=str(project_dir),
    )
    name = result.stdout.strip()
    return name if result.returncode == 0 and name else None


def poll_for_cloud_review(
    project_dir: Path,
    pr_number: int,
    timeout: int = 300,
    poll_interval: int = 30,
    previous_comment_id: int | None = None,
) -> dict | None:
    """
    Poll for a Codex review comment on the PR.
    Returns parsed review dict (with 'comment_id' field) or None on timeout.

    If previous_comment_id is provided, waits for a comment with a higher ID
    (avoids reprocessing stale reviews after fixes, even if text is identical).
    """
    repo = _get_repo_name(project_dir)
    if not repo:
        print("  Error: could not resolve repo name via gh CLI")
        return None

    elapsed = 0
    while elapsed < timeout:
        # Fetch comment id + body pairs as JSON array
        comments = subprocess.run(
            ["gh", "api", f"repos/{repo}/issues/{pr_number}/comments",
             "--jq", "[.[] | {id, body}]"],
            capture_output=True, text=True,
            cwd=str(project_dir),
        )

        if comments.returncode == 0:
            try:
                entries = json.loads(comments.stdout)
            except (json.JSONDecodeError, ValueError):
                entries = []

            # Reverse to get the latest (newest) Codex comment
            for entry in reversed(entries):
                if "## Codex Code Review" in entry.get("body", ""):
                    comment_id = entry["id"]
                    # Skip if it's the same or older comment
                    if previous_comment_id and comment_id <= previous_comment_id:
                        break  # newest is stale, keep polling
                    result = parse_cloud_review_comment(entry["body"])
                    result["comment_id"] = comment_id
                    return result

        print(f"  Waiting for Codex review... ({elapsed}s / {timeout}s)")
        time.sleep(poll_interval)
        elapsed += poll_interval

    return None


def parse_cloud_review_comment(body: str) -> dict:
    """Parse a formatted Codex review PR comment."""
    has_findings = "No issues found" not in body and "patch is correct" not in body.lower()

    return {
        "has_findings": has_findings,
        "raw_review": body,
        "findings": [],
    }
