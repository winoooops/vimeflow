---
id: 2026-04-27-pty-reattach-review-cycle
type: retrospective
status: shipped — PR #99 merged as cb0ffa6, Issue #55 closed, 7 follow-ups filed (#100–#106)
date: 2026-04-27
---

# Retrospective: PTY Reattach on Reload — 15-Round Review Cycle

## Context

**Goal:** make Vite HMR full-reload (`vim :w` inside the workspace, manual refresh, error-boundary reset) survive without destroying terminal sessions or orphaning PTY processes (Issue #55).

**Outcome shipped:** PR #99, 77 commits squash-merged, ~3,000 lines of plan + 1 design doc. Final Claude Code Review verdict: ✅ APPROVE (confidence 87%) — "no blocking issues, correctness bar is high". 7 follow-ups filed as separate issues; none are blockers.

**Scale:** 15 review-fix rounds (Codex local + Codex cloud + Claude). Cumulative diff hidden behind a clean squash. Review history surfaced via PR comments and the round-annotated code comments throughout the diff.

This retrospective catalogs the **process** — what worked, what cost time, where new patterns emerged — so the next high-touch PR doesn't re-learn the lessons.

## Architecture decisions that earned their cost

### 1. Pivot to single-source-of-truth in Rust (round 1)

- **What happened:** Initial design (Option C from the IDEA brainstorm) put the session id in localStorage and called a `restore_session(id)` IPC. By the time the harness was kicking off, I had refactored the design twice: first to a Rust filesystem cache (round 0 → Round 1 design v2), then to single-source-of-truth in Rust with the frontend as a pure renderer (Round 1 → v3, the shipped architecture).
- **Why it earned its cost:** every time we considered "what if this state is in the frontend?", a race condition emerged (HMR fires before frontend can persist; localStorage write lags PTY spawn; etc). Moving everything into Rust with `flushSync` for synchronous extraction killed an entire class of bugs that would otherwise have surfaced as multi-round review findings.
- **Lesson:** when state has two writers and one truth, expect race conditions to surface for **every reviewer**. Centralize the writer.

### 2. Listen-before-snapshot ordering (rounds 2–4)

- **What happened:** First implementation called `listSessions()` then `service.onData()`. Codex caught it round 2 — events emitted between the snapshot and the subscribe were lost. We added `await onData` before `listSessions`. Round 3 found the matching frontend bug: even with global buffering, individual panes resubscribing after restore could double-deliver bytes that arrived in the gap. Round 4 closed it with the cursor protocol (offset_start + byte_len + cursorRef advancement).
- **Lesson:** "subscribe + snapshot" is one of those primitives that looks one-line-trivial and is actually three patterns deep. The cursor protocol is now in `feedback_offset_cursor_for_replay.md` (auto-memory).

### 3. Lazy reconciliation over shutdown hooks (rounds 5–7)

- **What happened:** Originally we wiped the cache on `RunEvent::ExitRequested`. Round 5 codex pointed out SIGKILL/OOM/crash skip the hook entirely — the cache stays "thinks PTY is alive" forever. Round 6 added `list_sessions` to flip zombie cache entries to `Exited` on read. Round 7 made the e2e-test feature pre-wipe the cache file at startup because wdio's `deleteSession()` looks like a non-graceful crash.
- **Lesson:** never depend on shutdown hooks for cache correctness. Reconcile on the **next read** instead. Captured in `feedback_lazy_reconciliation_over_shutdown_hooks.md`.

### 4. Spawn-then-kill in restartSession (round 4) + abort on kill failure (round 13)

- **What happened:** Round 4 reordered restartSession to spawn the new PTY first, then kill the old — failed spawn no longer tore down a still-restorable old session. Round 13 codex caught the symmetric bug: if **kill** of the old fails, the new is alive but the cache still has both ids, so the subsequent `reorderSessions` IPC fails the permutation check and on reload the old tab resurrects. Fix: kill the new orphan and abort the restart.
- **Lesson:** every two-step state transition has two failure modes. The first fix earns a second one round later when the symmetric case surfaces.

## Recurring patterns the reviewers kept finding

| Theme                                                                                    | Findings across rounds                                                                                                           | Pattern file                                                                                                          |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Async race conditions (request-token guards, in-flight cancellations)                    | round 9 F2/F3, round 10 F4, round 12 F5, round 13×2, round 14 (Codex P2 last unresolved)                                         | `patterns/async-race-conditions.md` (already at ref_count 5; deserves another bump and several new findings appended) |
| React lifecycle (useState vs useRef, functional updater purity, StrictMode double-mount) | round 9 F6, round 10 F1 (auto-create state), round 12 F2 (restoreData→ref)                                                       | `patterns/react-lifecycle.md`                                                                                         |
| Resource cleanup (orphan kills, bookkeeping teardown, ptySessionMap leakage)             | round 12 F4 (orphan branch teardown), round 14 (`unregisterPtySession`)                                                          | `patterns/resource-cleanup.md`                                                                                        |
| PTY session management (kill ESRCH, lazy reconciliation, generation tokens)              | round 9 F1 (typed KillError), round 14 (kill ESRCH→Ok), round 14 (active-id rotation)                                            | `patterns/pty-session-management.md`                                                                                  |
| Generated artifacts drift                                                                | every round — `cargo test` regenerates `src/bindings/` in raw format that diverges from the prettier-formatted committed version | `patterns/generated-artifacts.md`                                                                                     |

The next time I open a PR that touches PTY lifecycle or async React state, I'll read async-race-conditions.md first and probably save 2–3 review rounds.

## Process hiccups — by cost

### 1. Codex CLI model rejection — wasted ~2 hours of harness wall-clock

- **What happened:** `harness/review.py` and `.github/workflows/codex-review.yml` defaulted to `gpt-5.2-codex`. After several rounds of harness output where Codex was producing nothing, I discovered ChatGPT-account auth rejects 5.2-codex; only API-key mode supports it. Switched to `gpt-5.4`.
- **Cost:** ~2 hours of harness runs producing 0 review output, plus the round where I had to bisect harness vs codex vs auth.
- **Captured:** `feedback_codex_model_for_chatgpt_auth.md` (auto-memory). Project memory says: omit `--model` for Codex CLI under ChatGPT-account auth, or use 5.4/5.5; not 5.2-codex.

### 2. Codex Action OpenAI quota exhaustion — recurrent through rounds 11–15

- **What happened:** After fixing the model issue, the GitHub-side Codex Action started failing with `Quota exceeded. Check your plan and billing details.` Same SHA, same env, just out of OpenAI plan budget. This was the **only failing CI check** on every push from round 11 onward.
- **Cost:** noise floor, not actually blocking — but every CI poll had to filter this out. Each round's "ALL-CHECKS-DONE" line had to be paired with a quick check that the failure was Codex Action specifically and not something I broke.
- **Lesson:** the no-action-needed CI failure is its own category. Future automation should treat OpenAI-quota-exceeded distinct from "real" check failures.

### 3. Bindings drift on every Rust test push

- **What happened:** `cargo test` regenerates `src/bindings/*.ts` in raw ts-rs format. Our committed bindings are prettier-formatted. Every push needed `git restore src/bindings/` between `cargo test` and `git push` — otherwise the lint-staged hook would re-format and the push would carry a no-op bindings churn commit.
- **Cost:** trivially small per occurrence (~5 s) but cumulative across 15 rounds — and easy to forget. Twice I had to amend or chain a "restore bindings" step.
- **Suggested follow-up:** make ts-rs emit prettier-formatted output, OR add a post-cargo-test git hook that restores `src/bindings/` automatically.

### 4. Cherry-pick across worktrees — high-leverage when the loop has fresh state

- **What happened:** Several rounds (12 in particular) dispatched a subagent into a `.claude/worktrees/agent-XXXX/` worktree to fix a focused set of findings without polluting the main checkout. Then I cherry-picked the resulting commits onto the PR branch. Worked well — the subagent had a clean diff to operate on and I got atomic commits to land.
- **Cost:** worked great when used correctly. The one time I tripped: the round-12 subagent had bindings drift (cargo test artifacts) in its worktree, which made `git worktree remove` fail without `--force`. Force-removed since the commits were already merged into the squash.
- **Lesson:** worktree remove + worktree branch delete + `worktree prune` is a 3-step cleanup. `--force` is fine when the branch is already merged or cherry-picked.

### 5. Phantom "race condition" tests — `useTerminal mode=spawn` flake

- **What happened:** Round 8 added a test that asserted `service.spawn` was called inside one `waitFor`, then synchronously asserted `result.current.status === 'running'`. The synchronous assert flaked under load because the status update lagged a microtask behind the spawn IPC. Pre-push hook blocked.
- **Fix:** combined both assertions inside the same `waitFor`.
- **Lesson:** `waitFor` + sync assert is a footgun; if both depend on async state, they both belong inside the wait.

### 6. cspell vocabulary

- **What happened:** Wrote "racey" in a comment. cspell rejected it. Changed to "race-prone".
- **Cost:** trivial. Mentioning it because it's the third or fourth time cspell's enforced an unusual but valid word — the in-tree dictionary is the rate limiter on prose freedom.

### 7. Loading-stuck "Restoring sessions…" — guard-ref + cancel flag interaction

- **What happened:** Initial restore effect used a `ranRestoreRef` to short-circuit StrictMode re-runs. But the first invocation set `cancelled = true` via the cleanup, which then short-circuited `setLoading(false)`. UI stuck on "Restoring sessions…" forever in dev mode.
- **Fix:** removed `ranRestoreRef`, relied on the cancel flag alone.
- **Lesson:** StrictMode-guard refs and async-effect cancel flags do not compose by default. Pick one mechanism per effect.

## What worked well

- **The IDEA framework for designing fixes.** Round 1's three options (A: localStorage flag, B: Rust restore_session, C: Rust filesystem cache + reattach) were each laid out with Intent / Danger / Explain / Alternatives. Picking Option C with the architectural pivot to single-source-of-truth was directly traceable to the IDEA framing — the "Danger" line on each option made the decision obvious. The framework now lives at `rules/common/idea-framework.md` (PR #98).
- **15-round budget cap.** Telling the harness "max 15 rounds" forced explicit scope decisions every round. Round 14's review verdict was already ✅ APPROVE — without the cap, round 15 might have spiraled into perf optimization that belongs in a separate PR.
- **Reply + resolve pattern for review threads.** Every Codex P2 finding got a reply citing the fix commit SHA before the thread was resolved. Future readers (or me, looking at this PR in 6 months) can trace each finding to its fix without grepping commit logs.
- **Cherry-pick from subagent worktree.** Round 12's 5-commit batch from `worktree-agent-ac30a977d8a2ac147` cherry-picked cleanly. Atomic per-finding commits + main agent retains review/integrate role.

## Recommendations

For the next high-touch PR (>10 review rounds expected):

1. **Read the relevant pattern files first.** `async-race-conditions.md`, `react-lifecycle.md`, `pty-session-management.md` for terminal/state work. Bumps `ref_count` and saves rounds.
2. **Draft the architectural pivot decision in IDEA early.** Don't get into round 5 before realizing one of the options is structurally simpler.
3. **Treat shutdown hooks as best-effort, never load-bearing.** Always have a lazy-reconciliation fallback.
4. **Cap rounds explicitly.** "Max N rounds" focuses attention on what matters; without the cap, rounds creep into perf/cleanup work that belongs in follow-ups.
5. **Reply + resolve on every Codex P2/P1.** It's a few seconds per thread and an enormous gift to future-you.
6. **Filed follow-ups beat shipped scope creep.** This PR's 7 follow-ups (#100–#106) are all real, all triaged, all smaller than the work that just landed. Filing them at merge means they don't get lost; deferring them out of the PR means review attention stays on architecture.

## Auto-memory captured during this cycle

- `feedback_filesystem_cache_for_pty.md` — Rust owns PTY state cache, not localStorage
- `feedback_lazy_reconciliation_over_shutdown_hooks.md` — reconcile on next read
- `feedback_offset_cursor_for_replay.md` — 3-part replay protocol
- `feedback_codex_model_for_chatgpt_auth.md` — gpt-5.4/5.5 not 5.2-codex under ChatGPT auth
- `feedback_idea_for_options.md` — pair every option with its own IDEA block

These are now part of the agent's persistent memory for future PRs in this repo.
