# Codex Feedback Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate local Codex CLI review into the harness feature loop (per-iteration code→review→fix), add a Coordinator-driven cloud review phase after all features, and change iteration semantics to per-feature budget.

**Architecture:** The harness gains a local Codex review step inside each feature iteration (Coder implements → Codex CLI reviews → findings fed back to Coder). After all features complete, the Coordinator (Python, not an agent) pushes to GitHub, polls for cloud Codex review, and spawns a Coder+Reviewer cluster if fixes are needed.

**Tech Stack:** Python 3.10+, Claude Code SDK, Codex CLI (`codex exec review`), `gh` CLI, asyncio, subprocess.

**Spec:** `docs/superpowers/specs/2026-04-03-codex-feedback-loop-design.md`

---

## File Map

| File                                 | Action | Responsibility                                                     |
| ------------------------------------ | ------ | ------------------------------------------------------------------ |
| `harness/review.py`                  | Create | Local Codex review runner + cloud review polling + findings parser |
| `harness/prompts/reviewer_prompt.md` | Create | Coder prompt for fixing cloud Codex findings                       |
| `harness/security.py`                | Edit   | Add `gh` to allowlist with scoped subcommand validator             |
| `harness/prompts.py`                 | Edit   | Add `get_reviewer_prompt()` + `get_coding_prompt_with_findings()`  |
| `harness/agent.py`                   | Edit   | Inner loop: per-feature iterations with Coder→Reviewer cycle       |
| `harness/autonomous_agent_demo.py`   | Edit   | New CLI flags, Phase 3 cloud review call                           |

---

### Task 1: Add `gh` subcommand validator to security.py

The Reviewer needs `gh` for PR operations, but only specific read/create commands — no destructive operations.

**Files:**

- Modify: `harness/security.py`
- Test: manual verification via Python REPL

- [ ] **Step 1: Write tests for the validator**

Create `harness/test_security.py`:

```python
"""Tests for gh subcommand validation."""

from security import validate_gh_command, extract_commands

# --- validate_gh_command ---


def test_gh_pr_create_allowed():
    assert validate_gh_command("gh pr create --title 'test' --body 'body'") == (True, "")


def test_gh_pr_view_allowed():
    assert validate_gh_command("gh pr view --json number") == (True, "")


def test_gh_pr_list_allowed():
    assert validate_gh_command("gh pr list --head my-branch") == (True, "")


def test_gh_api_get_comments_allowed():
    assert validate_gh_command("gh api repos/owner/repo/issues/1/comments") == (True, "")


def test_gh_auth_status_allowed():
    assert validate_gh_command("gh auth status") == (True, "")


def test_gh_pr_close_blocked():
    ok, reason = validate_gh_command("gh pr close 1")
    assert not ok
    assert "not allowed" in reason.lower()


def test_gh_pr_merge_blocked():
    ok, reason = validate_gh_command("gh pr merge 1")
    assert not ok


def test_gh_repo_delete_blocked():
    ok, reason = validate_gh_command("gh repo delete owner/repo")
    assert not ok


def test_gh_api_delete_blocked():
    ok, reason = validate_gh_command("gh api -X DELETE repos/owner/repo/issues/1")
    assert not ok


def test_gh_api_put_blocked():
    ok, reason = validate_gh_command("gh api -X PUT repos/owner/repo")
    assert not ok


def test_gh_api_patch_blocked():
    ok, reason = validate_gh_command("gh api -X PATCH repos/owner/repo")
    assert not ok


def test_gh_issue_delete_blocked():
    ok, reason = validate_gh_command("gh issue delete 1")
    assert not ok


def test_gh_release_blocked():
    ok, reason = validate_gh_command("gh release create v1.0")
    assert not ok


def test_gh_unknown_subcommand_blocked():
    ok, reason = validate_gh_command("gh workflow run deploy")
    assert not ok


def test_extract_commands_includes_gh():
    cmds = extract_commands("gh pr create --title 'test'")
    assert "gh" in cmds
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd harness && python -m pytest test_security.py -v
```

Expected: FAIL — `validate_gh_command` does not exist yet.

- [ ] **Step 3: Add `gh` to ALLOWED_COMMANDS and implement validator**

In `harness/security.py`, add `"gh"` to `ALLOWED_COMMANDS`:

```python
ALLOWED_COMMANDS = {
    # ... existing commands ...
    # GitHub CLI (scoped by validate_gh_command)
    "gh",
}
```

Add `"gh"` to `COMMANDS_NEEDING_EXTRA_VALIDATION`:

```python
COMMANDS_NEEDING_EXTRA_VALIDATION = {"pkill", "chmod", "rm", "gh"}
```

Add the validator function after `validate_rm_command`:

```python
# Allowed gh subcommand patterns (allowlist-only)
GH_ALLOWED_PATTERNS = [
    ("pr", "create"),
    ("pr", "view"),
    ("pr", "list"),
    ("api",),       # GET only — blocked if -X DELETE/PUT/PATCH
    ("auth", "status"),
]

GH_BLOCKED_API_METHODS = {"-X DELETE", "-X PUT", "-X PATCH", "--method DELETE", "--method PUT", "--method PATCH"}


def validate_gh_command(command: str) -> tuple[bool, str]:
    """Validate gh CLI commands against a strict allowlist."""
    try:
        tokens = shlex.split(command)
    except ValueError:
        tokens = command.split()

    # Remove 'gh' prefix
    args = [t for t in tokens if t != "gh"]

    if not args:
        return False, "Empty gh command not allowed"

    # Check for blocked API methods (destructive HTTP methods)
    command_upper = command.upper()
    for blocked in GH_BLOCKED_API_METHODS:
        if blocked.upper() in command_upper:
            return False, f"gh api with {blocked} not allowed"

    # Check subcommand against allowlist
    for pattern in GH_ALLOWED_PATTERNS:
        if len(args) >= len(pattern) and tuple(args[:len(pattern)]) == pattern:
            return True, ""

    sub = " ".join(args[:2]) if len(args) >= 2 else args[0]
    return False, f"gh subcommand '{sub}' not allowed. Allowed: pr create, pr view, pr list, api (GET), auth status"
```

Add the `gh` case to the validation loop in `bash_security_hook`:

```python
elif cmd == "gh":
    ok, reason = validate_gh_command(command)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd harness && python -m pytest test_security.py -v
```

Expected: all 15 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add harness/security.py harness/test_security.py
git commit -m "feat: add gh subcommand validator to harness security allowlist"
```

---

### Task 2: Create review module (review.py)

The review module handles both local Codex CLI review and cloud review polling.

**Files:**

- Create: `harness/review.py`
- Test: `harness/test_review.py`

- [ ] **Step 1: Write tests for the review module**

Create `harness/test_review.py`:

```python
"""Tests for review module — parsing and validation."""

from review import parse_codex_output, parse_cloud_review_comment


def test_parse_codex_output_no_findings():
    output = """OpenAI Codex v0.114.0
--------
codex
No actionable issues were found."""
    result = parse_codex_output(output)
    assert result["has_findings"] is False
    assert result["findings"] == []


def test_parse_codex_output_with_findings():
    output = """thinking
**Found issue**
Some thinking text
codex
Found 2 issues:
1. [HIGH] Missing error handling in src/app.ts:42
   The function does not handle the error case.
2. [MEDIUM] Unused import in src/utils.ts:1
   Remove unused import."""
    result = parse_codex_output(output)
    assert result["has_findings"] is True
    assert result["raw_review"] != ""


def test_parse_cloud_review_comment_json():
    body = '''## Codex Code Review

### 🟠 [HIGH] Missing error handling

📍 `src/app.ts` L42-45
🎯 Confidence: 85%

The function does not handle the error case.

---

**Overall: ⚠️ patch has issues** (confidence: 78%)

> One maintainability issue found.'''
    result = parse_cloud_review_comment(body)
    assert result["has_findings"] is True
    assert "Missing error handling" in result["raw_review"]


def test_parse_cloud_review_comment_clean():
    body = '''## Codex Code Review

✅ No issues found.

**Overall: ✅ patch is correct** (confidence: 92%)

> No issues introduced by the diff.'''
    result = parse_cloud_review_comment(body)
    assert result["has_findings"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd harness && python -m pytest test_review.py -v
```

Expected: FAIL — `review` module does not exist.

- [ ] **Step 3: Create `harness/review.py`**

```python
"""
Code Review Integration
=======================

Local Codex CLI review and cloud review polling via gh CLI.
The Coordinator calls these functions directly — no SDK session needed.
"""

import asyncio
import json
import re
import subprocess
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
    # Extract the final codex message (after last 'codex' marker)
    codex_sections = re.split(r"^codex$", output, flags=re.MULTILINE)
    review_text = codex_sections[-1].strip() if len(codex_sections) > 1 else output.strip()

    # Check for "no issues" patterns
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

    Uses gh CLI — requires gh auth login.
    """
    # Push branch
    push_result = subprocess.run(
        ["git", "push", "-u", "origin", branch],
        capture_output=True, text=True,
        cwd=str(project_dir),
    )
    if push_result.returncode != 0:
        print(f"  Error pushing: {push_result.stderr}")
        return None

    # Check if PR already exists
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

    # Create new PR
    create = subprocess.run(
        ["gh", "pr", "create", "--title", title, "--body", body],
        capture_output=True, text=True,
        cwd=str(project_dir),
    )
    if create.returncode != 0:
        print(f"  Error creating PR: {create.stderr}")
        return None

    # Extract PR number from URL output
    match = re.search(r"/pull/(\d+)", create.stdout)
    return int(match.group(1)) if match else None


def poll_for_cloud_review(
    project_dir: Path,
    pr_number: int,
    timeout: int = 300,
    poll_interval: int = 30,
) -> dict | None:
    """
    Poll for a Codex review comment on the PR.

    Returns parsed review dict or None on timeout.
    """
    import time

    # Get repo info
    repo_result = subprocess.run(
        ["gh", "pr", "view", str(pr_number), "--json", "url"],
        capture_output=True, text=True,
        cwd=str(project_dir),
    )
    if repo_result.returncode != 0:
        return None

    elapsed = 0
    while elapsed < timeout:
        comments = subprocess.run(
            ["gh", "api", f"repos/{{owner}}/{{repo}}/issues/{pr_number}/comments",
             "--jq", ".[].body"],
            capture_output=True, text=True,
            cwd=str(project_dir),
        )

        if comments.returncode == 0:
            for comment_body in comments.stdout.split("\n"):
                if "## Codex Code Review" in comment_body:
                    return parse_cloud_review_comment(comment_body)

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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd harness && python -m pytest test_review.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add harness/review.py harness/test_review.py
git commit -m "feat: add review module for local Codex CLI and cloud review polling"
```

---

### Task 3: Create reviewer prompt

The prompt template for the Coder agent when fixing cloud Codex review findings (Phase 3).

**Files:**

- Create: `harness/prompts/reviewer_prompt.md`
- Modify: `harness/prompts.py`

- [ ] **Step 1: Create `harness/prompts/reviewer_prompt.md`**

````markdown
## YOUR ROLE - REVIEW FIX AGENT

You are fixing code review findings from an automated cross-vendor review (OpenAI Codex). This is a FRESH context window — you have no memory of previous sessions.

### STEP 1: GET YOUR BEARINGS (MANDATORY)

```bash
pwd
cat CLAUDE.md
git log --oneline -10
cat feature_list.json | head -40
```
````

### STEP 2: REVIEW FINDINGS

The following review findings were reported. For each finding:

1. **Read the file** at the specified path and line range
2. **Understand the issue** in context (read surrounding code)
3. **Decide your action:**
   - **FIX** — make the minimal change to resolve the issue
   - **SKIP** — explain why (false positive, intentional pattern, out of scope)
   - **ESCALATE** — flag as needing redesign (too large for a targeted fix)

### REVIEW FINDINGS:

{findings}

### STEP 3: FIX ISSUES

For each finding you decided to FIX:

1. Make the minimal change — do not refactor beyond what's needed
2. Run tests: `npm run test` and `npm run lint`
3. Verify the fix doesn't break anything
4. Commit: `git commit -m "fix: [description of what was fixed]"`

### STEP 4: REPORT

Update `claude-progress.txt` with:

- Which findings were FIXED, SKIPPED, or ESCALATED
- Reasoning for each SKIP
- Any ESCALATED items that need human attention

### RULES

- Fix ONLY what the review identified — no drive-by refactoring
- Never introduce new issues while fixing existing ones
- If unsure about a finding, SKIP it with explanation rather than guessing
- Run `npm run lint && npm run test` after ALL fixes

````

- [ ] **Step 2: Add `get_reviewer_prompt` and `get_coding_prompt_with_findings` to `harness/prompts.py`**

Add these functions after the existing `get_coding_prompt`:

```python
def get_reviewer_prompt(findings: str) -> str:
    """Load reviewer prompt with findings injected."""
    template = load_prompt("reviewer_prompt")
    return template.replace("{findings}", findings)


def get_coding_prompt_with_findings(findings: str) -> str:
    """Load coding prompt with review findings appended for fix iterations."""
    base = load_prompt("coding_prompt")
    review_section = (
        "\n\n---\n\n"
        "## REVIEW FINDINGS FROM PREVIOUS ITERATION\n\n"
        "The following issues were found by the code reviewer (Codex). "
        "Address these findings as part of your implementation work:\n\n"
        f"{findings}\n\n"
        "For each finding: fix it if valid, skip if false positive (explain why)."
    )
    return base + review_section
````

- [ ] **Step 3: Commit**

```bash
git add harness/prompts/reviewer_prompt.md harness/prompts.py
git commit -m "feat: add reviewer prompt and coding-with-findings prompt loader"
```

---

### Task 4: Rewrite agent.py for per-feature iteration loop

The core change: each feature gets up to `max_iterations` rounds of Coder→Reviewer.

**Files:**

- Modify: `harness/agent.py`

- [ ] **Step 1: Rewrite `harness/agent.py`**

```python
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
    Run one Coder→Reviewer iteration for a feature.

    Returns (status, findings_text):
      - ("passed", None) — review clean, feature done
      - ("has_findings", "...") — review found issues
      - ("error", None) — session errored
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
        print(f"  Codex found issues. Will feed back to Coder.")
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
    Phase 2: Feature loop with per-feature Coder→Reviewer iterations
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
                # No review — just run Coder once
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
```

- [ ] **Step 2: Verify syntax**

```bash
cd harness && python -c "import ast; ast.parse(open('agent.py').read()); print('Syntax OK')"
```

Expected: `Syntax OK`

- [ ] **Step 3: Commit**

```bash
git add harness/agent.py
git commit -m "refactor: rewrite agent loop for per-feature iterations with Coder+Reviewer"
```

---

### Task 5: Update coordinator with new CLI flags

Add `--skip-review`, `--review-timeout`, `--max-relay-loops` flags and Phase 3 cloud review call.

**Files:**

- Modify: `harness/autonomous_agent_demo.py`

- [ ] **Step 1: Update `harness/autonomous_agent_demo.py`**

Add new CLI arguments to `parse_args()` after the `--clean` argument:

```python
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
```

Update the `asyncio.run()` call in `main()` to pass `skip_review`:

```python
        asyncio.run(
            run_autonomous_agent(
                project_dir=args.project_dir,
                model=args.model,
                max_iterations=args.max_iterations,
                sandbox=sandbox,
                skip_review=args.skip_review,
            )
        )
```

Add Phase 3 cloud review after the agent loop in `main()`, before the `except` blocks:

```python
        # Phase 3: Cloud review (if not skipped)
        if not args.skip_relay:
            from review import push_and_create_pr, poll_for_cloud_review

            branch_result = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                capture_output=True, text=True,
                cwd=str(args.project_dir),
            )
            branch = branch_result.stdout.strip()

            if branch and branch != "main":
                print("\n" + "=" * 70)
                print("  PHASE 3: CLOUD REVIEW")
                print("=" * 70)

                pr_number = push_and_create_pr(
                    args.project_dir, branch,
                    title=f"feat: harness implementation ({branch})",
                    body="Automated implementation by VIBM harness.",
                )

                if pr_number:
                    print(f"  PR #{pr_number} created. Waiting for Codex review...")
                    review = poll_for_cloud_review(
                        args.project_dir, pr_number,
                        timeout=args.review_timeout,
                    )

                    if review and review["has_findings"]:
                        print("  Cloud Codex review found issues.")
                        print("  TODO: Spawn Coder+Reviewer cluster for fixes.")
                        print(f"  Findings:\n{review['raw_review'][:500]}")
                    elif review:
                        print("  Cloud Codex review: CLEAN.")
                    else:
                        print("  Cloud review timed out.")
                else:
                    print("  Could not create PR. Skipping cloud review.")
```

Add `import subprocess` at the top of the file with the other imports.

- [ ] **Step 2: Verify syntax**

```bash
cd harness && python -c "import ast; ast.parse(open('autonomous_agent_demo.py').read()); print('Syntax OK')"
```

Expected: `Syntax OK`

- [ ] **Step 3: Commit**

```bash
git add harness/autonomous_agent_demo.py
git commit -m "feat: add Phase 3 cloud review and new CLI flags (--skip-review, --skip-relay)"
```

---

### Task 6: Verify end-to-end

Final checks: all Python syntax valid, imports resolve, tests pass.

**Files:**

- Verify: all created and modified files

- [ ] **Step 1: Verify all files exist**

```bash
ls -la harness/review.py
ls -la harness/test_security.py
ls -la harness/test_review.py
ls -la harness/prompts/reviewer_prompt.md
```

All four files should exist.

- [ ] **Step 2: Verify Python syntax for all modified files**

```bash
cd harness && python -c "
import ast
for f in ['agent.py', 'autonomous_agent_demo.py', 'security.py', 'review.py', 'prompts.py']:
    ast.parse(open(f).read())
    print(f'{f}: OK')
"
```

Expected: all 5 files print OK.

- [ ] **Step 3: Run all harness tests**

```bash
cd harness && python -m pytest test_security.py test_review.py -v
```

Expected: all tests PASS.

- [ ] **Step 4: Verify CLI help shows new flags**

```bash
cd harness && python autonomous_agent_demo.py --help
```

Expected: `--skip-review`, `--review-timeout`, `--max-relay-loops`, `--skip-relay` all appear.

- [ ] **Step 5: Verify existing frontend tests still pass**

```bash
npm run lint && npm run type-check && npm test
```

Expected: all pass (no frontend code was changed).

---

## Setup Notes (for the developer, not automated)

After implementation:

1. **Install Codex CLI** if not already: `npm i -g @openai/codex`
2. **Install `gh` CLI** if not already: see https://cli.github.com/
3. **Authenticate gh**: `gh auth login`
4. **Test locally**: Run `cd harness && python autonomous_agent_demo.py --max-iterations 1` to verify the inner loop works
5. **Test with review disabled**: `python autonomous_agent_demo.py --max-iterations 1 --skip-review` to verify backward compatibility
