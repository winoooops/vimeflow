---
id: custom-pane-layout-preservation
category: correctness
created: 2026-06-19
last_updated: 2026-06-20
ref_count: 2
---

# Custom Pane Layout Preservation

## Summary

Custom pane layouts can define capacities larger than any builtin layout. When a custom layout is removed, rejected, or replaced with a smaller definition while sessions still depend on it, blindly shrinking those sessions to a builtin layout can silently drop panes on the next durable save/reload. The frontend must preserve the depended-on definition until every session using it can fit within the remaining allowed layouts, or explicitly resolve the excess panes instead of persisting an over-capacity builtin layout.

## Findings

### 1. Removing a large custom layout drops panes beyond builtin capacity

- **Source:** github-codex-connector (P1 / HIGH) | PR #546 round 1 | 2026-06-19
- **Severity:** P1 / HIGH
- **File:** `src/features/terminal/layout-registry/layoutRegistry.ts` L104-106
- **Finding:** `autoShrinkLayoutFor` fell back to `grid3x2` when the current custom layout was no longer registered and `nextPaneCount > 6`. The renderer kept all panes in memory, but the backend durable repair caps non-custom layouts at six panes, so the next save/reload silently dropped panes beyond the sixth.
- **Fix:** In `setCustomPaneLayouts`, validate the incoming definitions first, then preserve any existing custom layout whose id is still used by a session with more panes than `MAX_BUILTIN_PANE_COUNT` and that is absent or under-capacity in the candidate registry. The preserved definition overrides rejected or insufficient replacements, preventing the over-capacity builtin fallback.
- **Commit:** same commit as this entry

### 2. Builtin layout pick allowed for session with more panes than builtin supports

- **Source:** github-codex-connector (P1 / HIGH) | PR #569 round 1 | 2026-06-20
- **Severity:** P1 / HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx` L532-532
- **Finding:** When a custom layout held 7–16 panes, the top-chrome layout switcher still exposed builtin layouts. Selecting a builtin layout persisted the session under a non-custom layout while retaining more panes than any builtin supports. The backend durable repair caps non-custom layouts at six panes, so extra panes were silently dropped on the next restore.
- **Fix:** Added a guard in `handlePickLayout` that rejects builtin layout picks whose capacity is below the active session's pane count. The session stays on its valid custom layout until panes are reduced.
- **Commit:** same commit as this entry

### 3. Imported custom layouts with too many tracks can pass UI validation and throw on Save

- **Source:** github-codex-connector (P1 / HIGH) | PR #569 round 2 | 2026-06-20
- **Severity:** P1 / HIGH
- **File:** `src/features/terminal/components/LayoutCreator/layoutCreatorModel.ts` L212-254 and `src/features/terminal/components/LayoutCreator/LayoutCreatorModal.tsx` L716-884
- **Finding:** `validateDraftLayout` only checked overlap, empty cells, and slot count. A JSON/YAML import with more than `MAX_LAYOUT_TRACKS` columns or rows but 16 or fewer covering slots could produce `validation.ok=true`, enabling Save. `definitionFromDraft` then invoked `validatePaneLayoutDefinition`, which enforced the 24-track cap and threw with no user-facing recovery.
- **Fix:** Added a `trackOverCapacity` flag to `DraftLayoutValidation` and `validateDraftLayout`; it is included in the `ok` predicate and surfaced as a validation message in `LayoutCreatorModal` so Save remains disabled for over-capacity imports.
- **Commit:** same commit as this entry

### 4. Custom layout picks can hide active panes without a capacity guard

- **Source:** github-codex-connector (P2 / LOW) | PR #569 round 2 | 2026-06-20
- **Severity:** P2 / LOW
- **File:** `src/features/workspace/WorkspaceView.tsx` L1246-1262
- **Finding:** `handlePickLayout` only capacity-guarded builtin layouts. The display-menu custom-layout path could apply a custom layout whose capacity was smaller than the active session's pane count, immediately hiding panes without explanation.
- **Fix:** Removed the builtin-only condition and applied the capacity check to all selected layouts via `layoutRegistry.capacityFor(layoutId)`.
- **Commit:** same commit as this entry

### 5. Intentional custom layout delete is undone by preservation guard

- **Source:** github-claude | PR #569 round 3 | 2026-06-20
- **Severity:** HIGH
- **File:** `src/features/sessions/hooks/useSessionManager.ts` L276-366 and `src/features/workspace/WorkspaceView.tsx` L1294-1314
- **Finding:** `handleDeleteCustomLayout` called `setSessionLayout(activeSessionId, 'single')` before calling `setCustomPaneLayouts` to remove the layout. The preservation guard inside `setCustomPaneLayouts` read `sessionsRef.current` before the queued session-layout change had committed, so it still saw the deleted custom layout as needed by an over-capacity session and re-merged it, silently undoing the delete.
- **Fix:** Added a `skipPreservation` option to `setCustomPaneLayouts`. `handleDeleteCustomLayout` passes `{ skipPreservation: true }` so the layout is removed unconditionally; the session migration then moves affected sessions to a fallback layout.
- **Commit:** same commit as this entry
