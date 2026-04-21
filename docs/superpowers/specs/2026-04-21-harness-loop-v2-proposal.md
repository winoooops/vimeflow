# Harness Loop v2 — Workflow Proposal

**Date:** 2026-04-21
**Status:** Proposal — informed by [2026-04-21 Activity Panel retrospective](../../reviews/retrospectives/2026-04-21-activity-panel-harness-session.md)
**Scope:** Changes to `/harness-plugin:loop` skill, the harness Python (`harness/*.py`), the prompt templates (`harness/prompts/*.md`), and the runbook (`harness/CLAUDE.md`).

## 1. Problem summary

The harness successfully runs a long-horizon feature loop, produces clean Git history, and passes all automated checks. But its first real use on a visual-fidelity refactor (activity panel alignment with Claude Design prototype) produced output that was **rejected as "useless / toy project"** despite every feature passing tests, types, and lint.

The retrospective identifies **twelve** concrete issues. This proposal addresses them in three priority tiers:

- **Tier A — fidelity & correctness gaps** (the reason this session failed)
- **Tier B — ergonomic / footgun fixes** (cost time this session, will cost time again)
- **Tier C — docs debt** (low-effort cleanup)

Not every issue in the retrospective needs code; some are documentation-only.

## 2. Tier A — design-fidelity changes

These are the **core changes** that would have prevented the activity-panel rejection.

### A1. Visual verification loop

**The harness currently has no pixel-level check. This is the single biggest gap.**

Proposal: add a new **Visual Reviewer** role alongside the Codex code reviewer. After a feature's Coder session commits, before marking `passes: true`:

1. Start the Vite dev server in the worktree (or reuse running).
2. Drive `claude-in-chrome` MCP (or `chrome-devtools` MCP if the user's Chrome extension isn't available) to:
   - navigate to the component route / Storybook story,
   - screenshot at known viewport,
   - if a reference screenshot exists under `docs/design/<screen>/reference.png`, diff pixels and flag deltas above threshold.
3. If no reference screenshot exists, the Visual Reviewer shells out to Claude for a "does this match the description" one-shot judgment, passing both the current screenshot AND the design-spec snippet.
4. On visual regression: emit findings into the per-feature review file (alongside Codex findings) and return the Coder to iteration.

**Open questions for this proposal:**

- Where do reference screenshots live? I propose `docs/design/<screen>/reference-*.png` mirroring the current Stitch screenshots.
- Diff threshold — start generous (10% pixel delta), tighten later.
- Does every feature need this, or only features tagged `category: "ui"` in `feature_list.json`? I lean toward "only UI features" so backend features aren't blocked on screenshot availability.

### A2. Prototype screenshots as Coder input

Even without the visual reviewer (A1), we can at least **show the coder what the target looks like**. The retrospective §12 noted that prototype screenshots never reached the coder.

Proposal: extend `coding_prompt.md` with a "Visual reference" section. When a feature has `category: "ui"` and `design_ref: { prototype_url, screenshot_paths[] }` in `feature_list.json`, the prompt embeds the screenshots as file references the coder's `Read` tool can actually open (PNGs in repo, not remote URLs). The coder's multimodal read of those images grounds the implementation.

Implementation cost: low. Initializer just needs to populate `design_ref` for UI features based on `app_spec.md` content. Screenshots have to exist somewhere committed.

### A3. Holistic design review as a final feature

The retrospective §11 noted that fine-grained decomposition fragments design coherence. Individual components pass their specs but the composed panel looks bolted-together.

Proposal: the Initializer should always append a final synthetic feature, **"Design coherence pass"**, whose prompt is "walk through every component produced in this phase, compare against the design prototype as a whole (not per-component), and refine spacing / rhythm / depth for visual coherence." This feature runs only after all other features pass.

This is cheaper than making every feature aware of neighbors, and it gives the coder one pass with holistic context.

### A4. Iteration-aware test failure context

The retrospective §7 noted that the coder wasted all 10 iterations on feature 3 because "tests failing" didn't include the specific assertion error. Each iteration got the same blind-spot restart.

Proposal: `coding_prompt.md` Step 3 (verification) should include — in the failure case — the exact failing-test block (file:line, expected, received) from vitest's output, as an explicit **"FIX THIS SPECIFIC FAILURE"** section. Plus a note: "if this is iteration ≥3 and the same test is failing, stop and examine whether the test itself is correct, not just the implementation."

## 3. Tier B — ergonomic fixes

Each of these cost time in this session and will again if not fixed.

### B1. Feature-list freshness validation

**Retro §1.** The stale `feature_list.json` silently aborted the first launch.

Proposal: Initializer writes `{"app_spec_hash": "<sha256 of app_spec.md>", "features": [...]}` into `feature_list.json`. On subsequent runs, harness verifies the hash matches current `app_spec.md` before trusting the file. Mismatch → print "app_spec.md changed since feature list was generated — re-run Initializer? [y/N]" and abort with a clear error instead of silently succeeding.

Bonus safety: refuse to run Phase 2 if every feature is `passes: true` AND `app_spec_hash` mismatches (the "looks like nothing to do" trap).

### B2. Gated Phase 3

**Retro §2.** Phase 3 auto-triggered a push + PR that we later had to close and force-delete.

Proposal: new flag `--phase-3 { auto | confirm | skip }` (default: `confirm`). `auto` is the current behavior, `confirm` prints "Phase 2 complete. Run Phase 3 (push + PR)? [y/N]" and waits on stdin, `skip` is today's `--skip-relay`.

Retain `--skip-relay` as a backwards-compatible alias for `--phase-3 skip`. The skill's /harness-plugin:loop default should set `--phase-3 confirm` so the user is the final gate on cloud actions.

### B3. `--clean` should not destroy `app_spec.md`

**Retro §4.** `--clean` wipes the user's authored spec.

Proposal: `clean_runtime_files` removes only `feature_list.json` and `claude-progress.txt`. `app_spec.md` is the user's source, not runtime state; it stays. Update the runbook accordingly.

If the user genuinely wants to wipe everything, a new flag `--clean-spec` (destructive) explicitly asks for the spec to be removed too.

### B4. Differentiate session-type error messages

**Retro §3.** "Initializer failed" printed during a Coder failure.

Proposal: centralize the error message string so each session type (`initializer`, `coder`, `reviewer`, `coordinator`) prints its own label. Small refactor in `agent.py` — one enum or string-per-role.

### B5. Launch recipe in the skill doc

**Retro §6.** I wasted time on `nohup python ... &` wrapped in a Bash tool call.

Proposal: `/harness-plugin:loop` Step 4 should explicitly say:

> **Launch the harness via Claude's `run_in_background: true` on the Bash tool. Do NOT use `nohup`, `&`, or any shell wrapper — those create a detached process invisible to Claude's task tracker.**
>
> Correct:
>
> ```bash
> cd harness && exec python3 -u autonomous_agent_demo.py --max-iterations 10 --skip-relay
> ```
>
> With `run_in_background: true` on the Bash tool call.

The `exec` + `-u` (unbuffered) combination ensures Claude sees stream output and can monitor progress.

### B6. Drop `claude-progress.txt` OR fold into feature commits

**Retro §9.** The progress file produces per-feature docs commits that always need squashing.

Two options, pick one:

- **Drop it.** The Git log of feature commits is a perfectly good progress record. Remove Step 8 from `coding_prompt.md` and the Step-9 checkpoint that references it.
- **Fold it.** Keep the cumulative progress file but amend it into the preceding feature commit (via `git commit --amend` or a coordinator post-step), so there's no standalone docs commit.

My recommendation: drop it. Less infrastructure, same outcome.

### B7. Reject phantom feature references in TODO comments

**Retro §8.** Coder shipped `// TODO: ... (Feature #11)` where Feature #11 was something else entirely.

Proposal: Reviewer prompt gets an extra check:

> Grep the coder's diff for `Feature #N` or `feature #N` references. Verify each N exists in `feature_list.json` AND that the referenced feature's description matches the TODO's subject. Otherwise, flag as a finding.

Cheap to add, catches hallucination.

## 4. Tier C — docs debt

### C1. Codex CLI auth section in `harness/CLAUDE.md`

**Retro §5.** Lines 19 and 315 say `OPENAI_API_KEY` is required.

Proposal: rewrite those rows. Codex CLI 0.121+ authenticates via `~/.codex/auth.json` after `codex login`. The env var is optional for SDK-style usage, not required for the CLI.

Add a preflight check that detects Codex CLI availability:

```python
def check_codex_auth() -> bool:
    if not shutil.which("codex"):
        return False
    return (Path.home() / ".codex" / "auth.json").exists() or bool(os.environ.get("OPENAI_API_KEY"))
```

Fail fast with an actionable message ("run `codex login` or export `OPENAI_API_KEY`").

### C2. Worktree launch recipe in runbook

The current runbook in `harness/CLAUDE.md` describes `git worktree add` + `cd` + source env. Add a section making the Claude Code `EnterWorktree` + the above launch recipe (B5) the recommended flow, since it's what the skill drives the user toward.

## 5. Out of scope for this proposal

These are things I considered but rejected:

- **Auto-detect proxy env and unset.** Clash interception hit me on `tauri:dev`, but the harness doesn't run the dev server — the user does. Skill can add a note; harness itself doesn't need to unset.
- **Per-feature worktrees.** User mentioned subagents should work in their own worktrees and I should "merge them back". The harness architecture runs all features in one worktree with linear commits; re-architecting to per-feature worktrees is a much larger change than this proposal. Deferred to a separate spec.
- **Replace Codex reviewer entirely.** Codex worked well for code-level review; the gap is visual fidelity (addressed by A1). Don't throw out a working piece.

## 6. Rollout plan

Proposed sequencing (each shipping as its own PR):

1. **Docs-only** — C1 (Codex auth), B5 + C2 (launch recipe).
2. **Safety fixes** — B1 (feature-list freshness), B3 (`--clean` spec preservation), B4 (error labels).
3. **Gated Phase 3** — B2.
4. **Prompt improvements** — A2 (prototype screenshots as input), A4 (iteration-aware failures), B6 (drop progress file), B7 (phantom feature refs).
5. **Visual verification** — A1 + A3. This is the big one; likely multi-PR itself.

Tiers 1-4 are small and can land in parallel. Tier 5 is its own design effort with more open questions (see A1's "Open questions" list).

## 7. Success criteria

This proposal is successful if the next harness run against a UI refactor of comparable scope:

- **Does not** produce "useless / toy project" output.
- Catches a mis-written test in ≤3 iterations instead of burning all 10.
- Never pushes to a remote without explicit user confirmation.
- Produces 12 features = 12 commits (no squash pass required).
- Fails fast with useful messages when `app_spec.md` is missing, `feature_list.json` is stale, or Codex CLI isn't authenticated.

A follow-up retrospective on the next meaningful run should verify each bullet.
