---
id: boolean-sentinel-consistency
category: code-quality
created: 2026-06-15
last_updated: 2026-06-28
ref_count: 1
---

# Boolean Sentinel Consistency

## Summary

When a boolean prop must be explicitly set to `false` because the component's
default is `true`, prefer a single shared sentinel over ad-hoc module-level
constants. Scattering `const <name> = true` definitions across a codebase makes
the suppression pattern hard to discover, invites inconsistent naming, and
encourages future contributors to invent yet another name for the same intent.

## Findings

### 1. `showTooltip` suppression uses 12 differently named `true` constants

- **Source:** github-claude | PR #454 round 2 | 2026-06-15
- **Severity:** LOW
- **File:** 10 files, including `src/features/workspace/components/panels/FileExplorer.tsx`, `src/features/diff/components/toolbar/PriorityPlus.tsx`, `src/features/sessions/components/Card.tsx`
- **Finding:** Each `IconButton` that needed `showTooltip={false}` defined its own module-level `const <name> = true`, then passed `showTooltip={!<name>}`. Names mixed casing and rationale (`LABELLED_BY_OUTER_TOOLTIP`, `labelledByOuterTooltip`, `GUTTER_TOOLTIP_SUPPRESSED`, `suppressCopyTooltip`, `menuTriggerHasMenu`, etc.). The double negation and name proliferation made the pattern un-greppable.
- **Fix:** Removed all local constants, introduced a shared `TOOLTIP_SUPPRESSED = false` sentinel in `src/lib/constants.ts`, and imported it at every suppression site. Each call site now passes `showTooltip={TOOLTIP_SUPPRESSED}` with a short inline comment explaining why the outer tooltip owns the label.
- **Commit:** same commit as this entry

### 2. `inputTokens=0` sentinel was implicit in prop contract

- **Source:** github-claude | PR #603 round 1 | 2026-06-22
- **Severity:** LOW
- **File:** `src/features/agent-status/components/ContextReservoirCard.tsx` L8-15
- **Finding:** `inputTokens > 0` intentionally treated zero as "data not yet available" for unknown context windows, but the prop documentation did not state that zero is a sentinel. Future callers could pass `0` expecting a literal `0 tokens` label.
- **Fix:** Documented the zero-sentinel behavior directly on `inputTokens`, keeping the existing render contract and tests unchanged.
- **Commit:** same commit as this entry

### 3. Helper IPC reported enabled for requests it ignored

- **Source:** github-codex-connector | PR #630 round 4 | 2026-06-28
- **Severity:** MEDIUM
- **File:** `electron/ghostty-native-helper.ts`
- **Finding:** The single-pane Ghostty helper returned `{ enabled: true }` for data and focus requests whose pane did not match `currentPane`. Renderer callers treated that as native success, so helper-flag split panes could silently drop output or focus instead of falling back.
- **Fix:** Return `{ enabled: false }` for non-current-pane data and focus requests, preserving the existing fallback contract for panes the helper cannot service.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 4. Native bridge helpers reported success when the API was absent

- **Source:** github-codex-connector | PR #630 round 5 | 2026-06-28
- **Severity:** MEDIUM
- **File:** `src/features/terminal/nativeGhosttyClient.ts`
- **Finding:** The native data and focus helpers used optional chaining, so a missing preload API produced `undefined`. The disabled-result check treated that as success, suppressing xterm fallback while no native bridge call happened.
- **Fix:** Resolve the preload API into a local variable and return `false` immediately when it is absent, matching the existing update helper's fallback contract.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
