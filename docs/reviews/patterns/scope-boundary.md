---
id: scope-boundary
category: review-process
created: 2026-04-12
last_updated: 2026-04-12
ref_count: 0
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
