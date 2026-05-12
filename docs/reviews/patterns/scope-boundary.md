---
id: scope-boundary
category: review-process
created: 2026-04-12
last_updated: 2026-05-12
ref_count: 1
---

# Scope Boundary

## Summary

Reviews must evaluate only what the diff introduced or modified. Flagging
pre-existing bugs in unchanged code, suggesting improvements to adjacent
untouched code, or cascading into related files inflates review cycles and
obscures the PR's actual intent. Out-of-scope observations belong in a
separate follow-up section, not as findings with severity.

## Findings

### 1. CI drift check flagged on pre-existing CI gap, not PR-introduced code

- **Source:** claude-code-review | PR #49 | 2026-04-12
- **Severity:** MEDIUM (should have been OUT-OF-SCOPE)
- **File:** `.github/workflows/ci-checks.yml`
- **Finding:** Review flagged that `git diff --exit-code` doesn't catch untracked files — a pre-existing CI behavior, not introduced by the ts-rs integration PR.
- **Why out of scope:** The CI step existed before the PR. The PR added ts-rs bindings, not the CI verification logic.

### 2. Stale domain types flagged during ts-rs migration

- **Source:** claude-code-review | PR #49 | 2026-04-12
- **Severity:** MEDIUM (should have been OUT-OF-SCOPE)
- **File:** `src/features/terminal/types/index.ts`
- **Finding:** Review flagged stale `PTYExitEvent` with phantom `signal` field. These types pre-dated the PR — the PR replaced their usage but didn't claim to clean them up.
- **Why out of scope:** Cleanup of legacy types is a separate task from adding automated codegen.

### 3. Auto-select useEffect flagged in diff-viewer wiring PR

- **Source:** claude-code-review | PR #47 | 2026-04-12
- **Severity:** HIGH (should have been OUT-OF-SCOPE)
- **File:** `src/features/diff/components/DiffPanelContent.tsx`
- **Finding:** Review flagged that the auto-select useEffect doesn't re-select when a file leaves the list. This was pre-existing behavior in an untouched component.
- **Why out of scope:** The PR wired git state to the bottom drawer — it didn't modify DiffPanelContent's selection logic.

### 4. Review rabbit-hole — 5 rounds of test assertion refinement

- **Source:** claude-code-review | PR #43 | 2026-04-11
- **Severity:** LOW → LOW → LOW → LOW → LOW (should have stopped after round 1)
- **File:** `src/features/editor/hooks/useCodeMirror.test.ts`
- **Finding:** The original PR fixed a CSS flex bug and a vim scroll bug. Reviews then spiraled through 5 rounds of increasingly niche test assertion improvements (loose effect check → missing regression guard → uncovered branch → duck-type false positive). Each round's fix introduced the next round's finding.
- **Why out of scope:** The original tests were sufficient for the PR's goal. The rabbit-hole expanded scope far beyond the flex/scroll fix into CodeMirror internals testing philosophy.
- **Cross-ref:** `testing-gaps.md` findings #5–#8

### 5. Rename parsing bug flagged in code untouched by diff

- **Source:** codex-review | local | 2026-04-12
- **Severity:** P2 (should have been OUT-OF-SCOPE)
- **File:** `src-tauri/src/git/mod.rs`
- **Finding:** Codex flagged porcelain v1 rename parsing bug and MM staged flag — both in `parse_git_status`, which was not part of the diff being reviewed.
- **Why out of scope:** The diff only touched `.gitignore` and deleted venv symlinks. The git parsing code was entirely unchanged.

### 6. Real bug flagged in current diff but fix shape spans 5b spec's Non-goals (multi-pane production)

- **Source:** github-codex-connector | PR #199 cycle 4 | 2026-05-12
- **Severity:** P2 / MEDIUM (deferred to issue #202)
- **File:** `src/features/terminal/components/SplitView/SplitView.tsx` (where the callback wiring is visible) + propagation through `RestartAffordance`/`TerminalPane`/`SplitView`/`TerminalZone`/`WorkspaceView`/`useSessionManager`.
- **Finding:** "Pass pane identity when wiring per-pane restart action" — clicking Restart on an inactive exited pane in a multi-pane session restarts whichever pane is `pane.active`, not the one clicked, because `useSessionManager.restartSession(sessionId)` resolves the target via `getActivePane(oldSession)`. The visible symptom is a real correctness gap. BUT the fix shape (thread `paneId` through six call-sites; manager API gains an optional `paneId`) overlaps directly with 5b's explicit Non-goal #4 ("`addPane`/`removePane` manager mutations — 5c") and three of the touched files are outside 5b's spec-listed modified-files. 5b's production stays single-pane (`createSession` always emits `panes=[1]`), so `getActivePane(session)` returns the only pane and the bug never fires in shipped behavior. The bug only fires via test fixtures hand-building multi-pane sessions and none of 5b's tests simulate the Restart-on-inactive-pane click.
- **Fix:** SKIP — file follow-up issue (#202) for the per-pane restart-targeting refactor (parallel to 5c's manager-API expansion), and land a `TODO(#202)` comment inside `TerminalPane/index.tsx`'s `handleRestart` so future readers (and the eventual 5c author) see the inline deferral without spelunking through the issue tracker. The TODO is the only code change in this cycle. Code-review heuristic: when a review surfaces a real bug whose fix shape spans the SAME work-class as an explicitly-deferred Non-goal in the current spec, the appropriate disposition is "skip with inline TODO + follow-up issue + same-cycle pattern-KB entry", not in-PR resolution. The reviewer should accept this disposition once the rationale (Non-goal alignment + production-reach analysis + follow-up tracking) is on-thread. PR-scope discipline is the constraint that rules here, not "the bug is real, ergo fix it".
- **Commit:** _(see git log for the cycle-4 fix commit on PR #199)_
