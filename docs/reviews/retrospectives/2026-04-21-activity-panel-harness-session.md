---
id: 2026-04-21-activity-panel-harness-session
type: retrospective
status: abandoned — output didn't meet design bar; branch + PR #75 removed
date: 2026-04-21
---

# Retrospective: Activity Panel UNIFIED.md Refactor — Harness Session

## Context

Goal: refactor the agent activity panel to match `docs/design/UNIFIED.md` §4.4 + §5.2 using the autonomous harness (`/harness-plugin:loop`). 12 features decomposed from the spec. Expected a clean, design-aligned refactor landable in a single PR.

**Outcome:** 12/12 features technically passing (tests, types, lint all clean), 1,390 tests green, net −651 lines. **But the user rejected the output** — "useless, looks like a toy project" — because visual fidelity to the Claude Design prototype was absent even though every feature's JSDoc claims alignment. PR #75 was closed, branch deleted, work abandoned.

This retrospective catalogs the hiccups so the follow-up proposal can address them concretely.

## Hiccups — by cost

### 1. Stale `feature_list.json` silently aborted the first launch

- **What happened:** The worktree root had a pre-existing `feature_list.json` with 20 null-named features all marked `passes: true` (a fixture from an unrelated prior run). The harness read it, saw everything "done", exited with an empty log. I spent ~10 min rebuilding the wrapper before realizing the file was stale.
- **Root cause:** harness accepts whatever `feature_list.json` is at the project root. No validation that the feature list actually matches the current `app_spec.md`.
- **Cost:** ~10 min, two spurious re-launches.

### 2. Phase 3 pushed + opened PR #75 without user confirmation

- **What happened:** After feature 3 exhausted its iteration budget in the first run, the harness auto-triggered Phase 3, pushed the branch, and opened PR #75 on GitHub. User had said "full Phase 2 + Phase 3" — which was interpreted as blanket authorization — but later clarified Phase 3 should only start after user confirmation of feature completion.
- **Root cause:** no gating between Phase 2 completion and Phase 3 cloud push. `--skip-relay` is the only off switch; there's no "pause before push" mode.
- **Cost:** had to later close a PR, force-delete a remote branch.

### 3. Misleading error: "Initializer failed" during Coder failure

- **What happened:** Feature 3's coder session errored out mid-iteration (lint-fix attempt). The log printed `Error during session: / Initializer failed. Check logs and retry.` — but this was the **Coder** session, not the Initializer. I wasted time reading initializer-specific code paths.
- **Root cause:** a shared error-handler string in `agent.py` (or similar) that doesn't discriminate between session types.
- **Cost:** ~5 min of chasing the wrong signal.

### 4. `--clean` destroys user-authored `app_spec.md`

- **What happened:** I nearly re-ran with `--clean` (per the skill's suggested flag) to reset the stale `feature_list.json`. Reading `harness/CLAUDE.md:270-275` first saved me: `--clean` deletes `feature_list.json`, `claude-progress.txt`, **and `app_spec.md`** from the project root. My spec would have been replaced by the default VIBM template.
- **Root cause:** `clean_runtime_files` doesn't differentiate harness-owned runtime state from user-authored input.
- **Cost:** avoided by docs-reading; would have cost ~15 min + re-writing the spec if triggered.

### 5. Codex CLI auth docs are stale

- **What happened:** `harness/CLAUDE.md` lines 19 and 315 say `OPENAI_API_KEY` is required for local Codex review. The code (`review.py`) doesn't reference this env var — Codex CLI authenticates via `~/.codex/auth.json`. User confirmed this during the pre-flight. Without them confirming, the default skill flow would have asked them to export a key they don't need.
- **Root cause:** docs predate the Codex CLI's auth-file transition.
- **Cost:** recoverable via user correction, but any new contributor following the docs blind would block.

### 6. Background-launch mechanics tripped me up twice

- **What happened:** My first attempt used `cd harness && nohup python3 autonomous_agent_demo.py ... > ../harness-run.log 2>&1 &` inside a Bash wrapper with `run_in_background: true`. The wrapper appeared to exit, but the Python child held fds to the log, invisible to me. Deleting the log to "reset" left the python writing to an unlinked inode. Eventually switched to `python3 -u autonomous_agent_demo.py` directly with Claude's `run_in_background: true` — clean.
- **Root cause:** mixing shell-level backgrounding with Claude's task runner is always wrong.
- **Cost:** ~10 min of confusion + the need to kill a zombie process.

### 7. Subagent's test typo the reviewer couldn't self-fix

- **What happened:** Feature 3's coder wrote `<StatusDot state="running"  />` (no `glow={false}`) but the assertion said `expect(dot.style.boxShadow).toBe('none')`. 10 iterations of "tests failing" didn't surface the specific assertion-vs-prop mismatch clearly enough for the coder to spot. I had to hand-fix in the integrator role.
- **Root cause:** the per-iteration prompt tells the coder "tests failed, try again" but doesn't include the vitest failure's line-pointer and expected-vs-actual diff verbatim. The coder kept editing blind.
- **Cost:** 10 wasted iterations on feature 3, plus a manual integrator touch.

### 8. Subagent invented phantom feature numbers

- **What happened:** `AgentActivity.tsx` shipped with `// TODO: Wire up to actual approval handler (Feature #11)`. Feature #11 in our `feature_list.json` was "Replace ToolCalls with ActivityFeed" — totally unrelated to approval handlers. The subagent hallucinated a feature number that matched its mental model but not the actual list.
- **Root cause:** no prompt-level verification that TODO references to feature numbers actually map to real features.
- **Cost:** misleading comments in final code; caught in integrator walkthrough but easy to miss.

### 9. `claude-progress.txt` commits pollute history

- **What happened:** Step 8 of `coding_prompt.md` tells each subagent to append to `claude-progress.txt` after completing a feature. This produces separate docs-only commits (`docs: update progress for feature #X`) alongside the feature commits. History went 12 features → 16 commits; I squashed with a non-interactive rebase.
- **Root cause:** `claude-progress.txt` is treated as a cumulative artifact; prompt template instructs one commit per update.
- **Cost:** mandatory squash pass before any meaningful review.

### 10. Output quality doesn't match design fidelity — the core failure

- **What happened:** Every component passed UNIFIED.md text-spec checks (correct tokens, correct state matrix, correct component contracts). But side-by-side against the Claude Design prototype screenshots I captured earlier, the output lacks the glassmorphism, the proper spacing rhythm, the depth. It's "functionally correct but visually toy". This is why the whole refactor got thrown out.
- **Root cause:** the harness has **no visual verification loop**. Codex reviewer looks at code; the coder's only feedback is test + lint + type-check output. Nothing in the loop ever compares rendered pixels against the design prototype. Design fidelity degrades silently.
- **Cost:** the entire 12-feature run, ~3 hours of harness wall-clock time, plus all my integrator verification.

### 11. Fine-grained feature decomposition fragmented design coherence

- **What happened:** I chose "fine-grained (6-8 features)" granularity. The initializer split that further into 12 features, each a standalone component. Each passed isolated review, but the cumulative panel looks bolted-together rather than cohesively designed — each component was styled in isolation without regard to how it composes with its neighbors.
- **Root cause:** fine-grain optimizes for individual review but prevents the coder from making holistic design decisions across components.
- **Cost:** the cumulative look doesn't match the design prototype even though each component individually passes its spec checks.

### 12. The subagent never saw the prototype screenshots I captured

- **What happened:** I used `claude-in-chrome` during brainstorming to capture 4 state screenshots from the Claude Design prototype. I referenced visual details from those captures in my spec doc and app_spec.md prose. But the subagent only sees text — the prototype URL isn't in its prompt, and no image references get passed through. It interpreted "bordered card with primary-gradient approve button" from the text but never saw what that actually looks like in the prototype.
- **Root cause:** no channel for visual ground-truth to reach the coder.
- **Cost:** impossible to match visual fidelity when the visual reference isn't available to the implementer.

### 13. Harness skill puts the main agent in a worktree — against project rules

- **What happened:** `/harness-plugin:loop` Step 0a told me to call `EnterWorktree` before launching the harness, and I did. But `rules/common/worktrees.md` §Principles is explicit: _"Main agent works on a feature branch in the primary checkout — the interactive Claude Code agent checks out `feat/<name>` (or `fix/`, `refactor/`, etc.) in the primary checkout and commits there. It does **not** create a worktree for itself."_ Line 48 drives the point home: _"Do not run `EnterWorktree` reflexively at the start of an interactive task."_ The rule exists because the user runs the Vimeflow dev server from the primary checkout and watches the diff viewer live — edits inside `.claude/worktrees/` are invisible to that view.
- **Impact in this session:** when the user ran `npm run tauri:dev` from the primary checkout (as they always do), they saw the unchanged `main` branch, not the refactor. They had to be redirected into the worktree to see what had actually been built. And as they later told me, the intended flow was _"only subagents work on git worktree, you will be merging them in the harness-activity-panel-refactor branch"_ — which is exactly what `rules/common/worktrees.md` already codifies.
- **Root cause:** the `/harness-plugin:loop` skill predates or ignores `rules/common/worktrees.md`. The skill's Step 0a tells the main agent to enter a worktree; the project rule says the main agent must never enter one. The two are in direct conflict, and the skill silently wins because agents read the skill before reading the rules.
- **Cost:** user confusion when verification didn't show the changes; structural rule violation that had to be recovered from during cleanup (`ExitWorktree` with `remove`).

## What went right

Noting these so the proposal doesn't throw out working pieces.

- **Initializer decomposition was solid.** It turned my 8-feature app_spec.md into 12 iteratable features with sensible phase ordering. The only grief was at the granularity-choice level, not the initializer itself.
- **Phase 2 Coder + Reviewer loop produced clean Git history** once the progress commits were squashed. Commit messages were conventional-commit compliant, changes were atomic, tests co-located.
- **Harness exit-cleanly discipline.** When the harness exited, no rogue processes, no uncommitted mid-edit state. Easy to resume by re-running.
- **Recovery was practical.** Manually fixing one test + committing unblocked the whole rest of the loop without restarting from scratch. The feature_list.json state is edit-safe.

## Follow-up

- Proposal for addressing these: `docs/superpowers/specs/2026-04-21-harness-loop-v2-proposal.md` (paired file).
- `ref/toolcalling-ui` branch exists for the hand-crafted per-component redo against Claude Design. The harness is not used for that one — each component gets individual design attention without the harness's iteration pressure.
