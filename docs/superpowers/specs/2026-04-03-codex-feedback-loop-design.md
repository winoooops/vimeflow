# Codex Feedback Loop — Design Spec

**Date**: 2026-04-03
**Status**: Draft
**Depends on**: Codex Code Review Agent (2026-04-02 spec, merged to main)

## Problem

The harness runs a Coder agent that implements features autonomously, but there's
no automated quality gate. Code is implemented once per feature with no review loop.
The Codex code review runs on GitHub after a PR is created, but its findings aren't
fed back into the local agent. The harness "fires and forgets" with no cross-vendor
review cycle.

## Solution

Redesign the harness loop with two key changes:

1. **Local review loop per feature**: Each feature gets a Coder (Claude Code) +
   Reviewer (Codex CLI) pair that iterate locally. The Coder implements, Codex
   reviews locally via `codex exec review`, Claude fixes, Codex re-reviews — until
   clean or the iteration budget is exhausted.

2. **Relay agent for cloud review**: After all features are done, a Relay agent
   pushes code, creates a PR, polls for the cloud Codex review, and if issues are
   found, spawns the same local Coder + Reviewer pair to fix them.

## Key Concept: Iteration ≠ Feature

In the current harness, one iteration = one feature (pick next, implement, done).
This is wrong. In real harness engineering, a single feature can take multiple
iterations — the agent implements, gets reviewed, fixes, gets re-reviewed.

**New model**: `--max-iterations` is a **per-feature budget**. With `--max-iterations 5`
and 10 features, each feature gets up to 5 rounds of (code → local review → fix).
If a feature passes local review on iteration 2, it moves on early. If it still has
issues after iteration 5, the coordinator marks it and moves to the next feature.

## Decisions

| Decision           | Choice                                                         | Rationale                                                          |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| Inner loop agents  | Coder (Claude) + Reviewer (Codex CLI) per feature              | Cross-vendor review catches blind spots; local = fast              |
| Iteration model    | Per-feature budget, not global                                 | Each feature gets fair attempt count; mirrors real engineering     |
| Local review tool  | `codex exec review --base`                                     | Already proven locally; reads AGENTS.md automatically              |
| Cloud review       | Coordinator handles GitHub ops; spawns agent cluster for fixes | No SDK session needed for push/PR/poll; agents only for code fixes |
| Fix agent          | Claude Code SDK                                                | Claude does code changes; Codex is read-only reviewer              |
| Decision authority | Claude Code agent judges each finding                          | Flexible; can fix, skip (false positive), or flag (needs redesign) |
| `gh` permissions   | Scoped subcommand validator                                    | Only allow specific operations; block destructive commands         |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Coordinator (autonomous_agent_demo.py)                       │
│                                                              │
│  Phase 1: Initializer                                        │
│  └── app_spec.md → feature_list.json                         │
│                                                              │
│  Phase 2: Feature Loop (per feature)                         │
│  ┌────────────────────────────────────────────────┐          │
│  │  for each feature in feature_list:             │          │
│  │    for iteration in 1..max_iterations:         │          │
│  │      ┌─────────┐                               │          │
│  │      │  Coder  │  Claude Code SDK              │          │
│  │      │implement│  picks feature, writes code,  │          │
│  │      │  + test │  runs tests, commits          │          │
│  │      └────┬────┘                               │          │
│  │           │                                    │          │
│  │      ┌────▼─────┐                              │          │
│  │      │ Reviewer │  Codex CLI (local)           │          │
│  │      │  review  │  codex exec review --base    │          │
│  │      └────┬─────┘                              │          │
│  │           │                                    │          │
│  │      findings? ──no──▶ mark passes, next feature          │
│  │           │yes                                 │          │
│  │      feed findings back to Coder (next iteration)         │
│  │                                                │          │
│  │    if max_iterations reached:                  │          │
│  │      mark feature, move on                     │          │
│  └────────────────────────────────────────────────┘          │
│                                                              │
│  Phase 3: Cloud Review (Coordinator orchestrates directly)    │
│  ├── Coordinator (Python): push branch, create PR (gh CLI)   │
│  ├── Coordinator (Python): poll for Codex comment (gh api)   │
│  ├── If findings:                                            │
│  │   ├── Spawn Coder + Reviewer cluster (same as Phase 2)    │
│  │   ├── Cluster fixes issues locally                        │
│  │   ├── Coordinator pushes → polls again (max N loops)      │
│  │   └── Repeat until clean or max loops exhausted           │
│  └── Final status: CLEAN / FIXED / ATTENTION                 │
└──────────────────────────────────────────────────────────────┘
```

## Component 1: Inner Loop (Coder + Reviewer per Feature)

The core change to `harness/agent.py`. For each feature:

```
1. Coder agent session (Claude Code SDK):
   - Receives feature description + any previous review findings
   - Implements the feature, writes tests, runs tests, commits
   - First iteration: fresh implementation
   - Subsequent iterations: "fix these review findings: [...]"

2. Reviewer step (Codex CLI, NOT an SDK session):
   - Runs: codex exec review --base main --model gpt-5.2-codex --full-auto
   - Captures output to .codex-reviews/latest.md
   - Parses findings (grep for severity, file paths, descriptions)

3. Decision:
   - No findings or all LOW → mark feature passes, move to next
   - Has findings → feed them to Coder on next iteration
   - Max iterations reached → mark feature with remaining issues, move on
```

**Important**: The Reviewer step is a direct `codex exec review` CLI call from
the coordinator Python code (via subprocess), NOT a Claude Code SDK session.
Codex CLI is the reviewer tool, not an SDK agent.

## Component 2: Cloud Review Loop (Coordinator-Driven)

Runs after all features are complete. The Coordinator handles GitHub operations
directly as Python subprocess calls (not an SDK agent session). Only the fix
step spawns actual agents.

```
Coordinator (Python, not an agent):
│
├── 1. git push -u origin <branch>
├── 2. gh pr create --title "..." --body "..."
│      (or gh pr view if PR already exists)
├── 3. Poll: gh api repos/{owner}/{repo}/issues/{pr}/comments
│      Look for "## Codex Code Review" comment
│      Timeout: configurable (default 5 min), poll every 30s
├── 4. Parse findings from formatted markdown comment
│
├── 5. If findings:
│      ┌──────────────────────────────────────────┐
│      │ Spawn Coder + Reviewer cluster           │
│      │ (same inner loop as Phase 2)             │
│      │ Coder (Claude SDK) fixes → Codex reviews │
│      │ Repeat locally until clean               │
│      └──────────────────────────────────────────┘
│      Coordinator pushes fixes
│      Coordinator polls for new cloud review
│      (max relay-loops, default 2)
│
└── 6. Report final status:
       CLEAN     — cloud review found no issues
       FIXED     — cloud review found issues, all resolved
       ATTENTION — CRITICAL/HIGH issues remain after max loops
```

**Key**: The Coordinator is a thin orchestration layer — `git push`, `gh pr create`,
`gh api` are all direct subprocess calls in `review.py`. No SDK session needed for
the GitHub plumbing. Only the fix step spawns the Coder + Reviewer agent cluster.

## Component 3: `gh` Subcommand Validator

Added to `harness/security.py`. Allowlist-only approach:

**Allowed:**

| Command                                           | Purpose                         |
| ------------------------------------------------- | ------------------------------- |
| `gh pr create`                                    | Create a pull request           |
| `gh pr view`                                      | Check existing PR status/number |
| `gh pr list`                                      | List PRs for the current branch |
| `gh api repos/.../issues/.../comments` (GET only) | Read PR comments                |
| `gh auth status`                                  | Verify authentication           |

**Blocked** (anything not in allowlist, especially):

- `gh pr close` / `gh pr merge` — no destructive PR operations
- `gh issue close` / `gh issue delete` — no issue modification
- `gh repo delete` / `gh repo archive` — no repo-level operations
- `gh api -X DELETE` / `-X PUT` / `-X PATCH` — no write/delete API calls
- `gh release` — no release operations

**Implementation**: `validate_gh_command(command: str) -> bool` in `security.py`.

## Component 4: Prompts

### Coder prompt changes (`harness/prompts/coding_prompt.md`)

Add a section for handling review feedback. On iterations after the first, the
prompt includes:

```
## Review Findings from Previous Iteration

The following issues were found by the code reviewer. For each finding:
- Read the file and understand the issue in context
- Fix the issue with minimal changes
- Run tests to verify the fix doesn't break anything
- If a finding is a false positive, skip it (explain why)
- If a finding requires redesign beyond this feature, flag it

[findings injected here]
```

### Reviewer prompt (`harness/prompts/reviewer_prompt.md`)

Instructions for the Claude Code session spawned by the Coordinator when
fixing cloud Codex findings. Same approach as inner loop — Coder fixes,
local Codex reviews — but with cloud review findings as the initial input.

## Component 5: Coordinator Changes

**File**: `harness/autonomous_agent_demo.py`

CLI flags:

| Flag                | Default     | Purpose                                                   |
| ------------------- | ----------- | --------------------------------------------------------- |
| `--max-iterations`  | 5           | Per-feature iteration budget (code → review → fix cycles) |
| `--review-timeout`  | 300 (5 min) | Max seconds to wait for cloud Codex review                |
| `--max-relay-loops` | 2           | Max cloud review-fix cycles in Phase 3                    |
| `--skip-review`     | false       | Skip local Codex review (Phase 2 inner loop)              |
| `--skip-relay`      | false       | Skip the Relay phase entirely (Phase 3)                   |

**Note**: `--max-iterations` semantics CHANGE from current behavior. Currently it's
a global iteration count. New behavior: per-feature budget. This is a breaking change
but aligns with standard harness engineering practices.

## Component 6: Review Module

**File**: `harness/review.py`

Python module containing:

- `run_local_review(base_branch: str) -> dict` — runs `codex exec review --base`,
  captures output, parses findings, returns structured result
- `push_and_create_pr(branch: str) -> int` — push branch, create or find PR
- `poll_for_cloud_review(pr_number: int, timeout: int) -> dict | None` — poll
  `gh api` for Codex comment, parse findings
- `parse_review_findings(raw_output: str) -> list[dict]` — extract findings from
  either local CLI output or cloud comment markdown

## File Changes Summary

| File                                 | Action | Purpose                                                      |
| ------------------------------------ | ------ | ------------------------------------------------------------ |
| `harness/review.py`                  | Create | Local + cloud review: run Codex CLI, poll gh, parse findings |
| `harness/prompts/reviewer_prompt.md` | Create | Claude prompt for cloud review fix session                   |
| `harness/prompts/coding_prompt.md`   | Edit   | Add review findings section for iteration > 1                |
| `harness/agent.py`                   | Edit   | Inner loop: Coder + Reviewer per feature, multi-iteration    |
| `harness/autonomous_agent_demo.py`   | Edit   | New CLI flags, Phase 3 cloud review, iteration semantics     |
| `harness/security.py`                | Edit   | Add `gh` allowlist with subcommand validator                 |
| `harness/client.py`                  | Edit   | Agent client factory for review fix cluster                  |
| `harness/CLAUDE.md`                  | Edit   | Document three-phase workflow (post-implementation)          |

## Future Phases (Out of Scope)

1. **Review quality scoring**: Track Codex review accuracy over time
2. **Auto-merge**: If cloud review is clean and tests pass, auto-merge the PR
3. **Parallel feature execution**: Multiple Coder+Reviewer pairs on independent features
4. **Configurable reviewer**: Swap Codex for another review tool (e.g., Claude review agent)

## Dependencies

- Codex CLI installed locally (`npm i -g @openai/codex`)
- `OPENAI_API_KEY` environment variable (for local Codex CLI)
- `gh` CLI installed and authenticated (`gh auth login`)
- `OPENAI_API_KEY` GitHub secret (for cloud Codex Action)
- Codex review workflow on `main` (already merged)
- `ANTHROPIC_API_KEY` for Claude Code SDK (already required by harness)
