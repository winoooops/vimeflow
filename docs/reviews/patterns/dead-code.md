---
id: dead-code
category: code-quality
created: 2026-06-13
last_updated: 2026-08-06
ref_count: 11
---

# Dead Code

## Summary

Unreachable or obsolete code paths add maintenance surface, mislead future
refactors, and can mask API-contract bugs. When every call site satisfies a
stricter precondition, fallback branches that were once necessary become dead
code and should be removed.

## Findings

### 1. Label-matching fallback in actionIdFor is unreachable

- **Source:** github-claude | PR #444 round 1 | 2026-06-13
- **Severity:** LOW
- **File:** `src/features/workspace/components/panels/FileExplorer.tsx`
- **Finding:** All entries in `contextMenuActions` carried explicit `id` fields, so the early `return action.id` made the subsequent `switch (action.label)` block unreachable. The dead code risked misleading maintainers into thinking new actions could rely on label matching.
- **Fix:** Removed the unreachable `switch` fallback; `actionIdFor` now returns `action.id ?? null` directly.
- **Commit:** see `git blame` / `git log` on this line

### 2. `clearAgentStatusRefreshCoordinator` exported but never called

- **Source:** github-claude | PR #459 round 1 | 2026-06-15
- **Severity:** LOW
- **File:** `src/features/agent-status/utils/statusRefreshCoordinator.ts`
- **Finding:** `clearAgentStatusRefreshCoordinator` was exported from the singleton module but had no call sites. Without a comment, a future refactor would likely delete it.
- **Fix:** Added a comment documenting that the export is intentionally reserved for PR4 lifecycle hooks (session close / workspace teardown) and should not be wired to a `useEffect` cleanup today.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 3. Redundant Tailwind padding shorthand alongside explicit overrides

- **Source:** github-claude | PR #464 round 1 | 2026-06-15
- **Severity:** LOW
- **File:** `src/features/agent-status/components/AgentStatusPanel/Header.tsx`
- **Finding:** The header root carried `px-2 pr-2 pl-3.5`. `px-2` set both sides to `0.5rem`, `pr-2` repeated the right value, and `pl-3.5` overrode the left value. The shorthand was a dead no-op that made the cascade harder to reason about.
- **Fix:** Removed `px-2`; kept only `pr-2 pl-3.5`.
- **Commit:** see `git blame` / `git log` on this line

### 4. `gridAreaForSlotIndex` fallback returns a legacy area name that cannot exist

- **Source:** github-claude | PR #542 round 1 | 2026-06-19
- **Severity:** LOW
- **File:** `src/features/terminal/components/SplitView/SplitView.tsx`
- **Finding:** The helper returned `p${slotIndex}` when the index was outside `definition.slots.length`, but every caller is already bounded by `layout.capacity`, which equals `definition.slots.length`. The fallback was unreachable and, once custom non-`p{N}` slot ids are wired, would silently place a pane outside the generated CSS grid.
- **Fix:** Replaced the silent fallback with an explicit out-of-bounds error so any future capacity/slot bookkeeping divergence fails loudly instead of dropping a pane.
- **Commit:** same commit as this entry

### 5. DataTransfer drop fallback is blocked by state-only validation

- **Source:** github-claude | PR #609 round 1 | 2026-06-22
- **Severity:** LOW
- **File:** `src/features/terminal/components/SplitView/SplitView.tsx`
- **Finding:** `handleSlotDrop` recovered a pane id from `dataTransfer` when drag state was lost, but the next `canDropOnSlot` guard returned false whenever `draggingPaneId` was null. The fallback path could never complete a drop, making the resilience comment misleading.
- **Fix:** Let `canDropOnSlot` validate an explicit pane id while retaining its default state-backed behavior for dragover/highlight checks. The drop handler now passes the recovered id into the same accepts and source-slot validation used on the normal path.
- **Commit:** same commit as this entry

### 6. `emitAgentStatus` helper and payload factory are dead code in E2E spec

- **Source:** github-claude | PR #563 round 3 | 2026-06-19
- **Severity:** LOW
- **File:** `tests/e2e/agent/specs/agent-runtime-regressions.spec.ts`
- **Finding:** The `emitAgentStatus` function called `invokeBackend('e2e_emit_agent_status', ...)` but had no call sites in the spec. The `AgentStatusPayload` interface and `createAgentStatusPayload` factory existed only to support it. The dead code implied coverage for a direct-emit status scenario that did not exist.
- **Fix:** Removed the unused `emitAgentStatus` helper, `AgentStatusPayload` interface, and `createAgentStatusPayload` factory from the spec.
- **Commit:** same commit as this entry

### 7. Imported-layout track-cap error was unreachable after normalization

- **Source:** github-claude | PR #610 round 2 | 2026-06-22
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/LayoutCreator/layoutCreatorModel.ts`
- **Finding:** `modelToDraft` normalized imported track units before validation, and `normalizeUnits` caps over-capacity axes to `MAX_LAYOUT_TRACKS`. The later `validation.trackOverCapacity` error branch could never fire for imported 25+ track layouts.
- **Fix:** Reject imported layouts whose raw column or row count exceeds `MAX_LAYOUT_TRACKS` before normalization, then remove the dead post-normalization `trackOverCapacity` branch.
- **Commit:** same commit as this entry

### 8. Settings local-update ref became write-only after queue refactor

- **Source:** github-claude | PR #672 round 3 | 2026-07-09
- **Severity:** LOW
- **File:** `src/features/settings/SettingsProvider.tsx`
- **Finding:** The settings load race fix replaced the old `hasLocalUpdateRef`
  reader with `hasLoadedRef` and `pendingLoadPatchRef`, but the ref and its
  assignment remained. The stale state no longer affected behavior and implied
  a guard that did not exist.
- **Fix:** Removed the obsolete ref and assignment.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 9. Alias config snapshot ref stayed write-only after stale-cache fix

- **Source:** github-claude | PR #693 round 1 | 2026-07-13
- **Severity:** LOW
- **File:** `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** `agentAliasConfigSnapshotRef` was still assigned on every alias
  config load after the cache read path had been removed to avoid stale alias
  launcher decisions. The write-only ref implied caching semantics that no
  longer existed.
- **Fix:** Removed the obsolete snapshot ref and returned the in-flight alias
  config promise result directly.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 10. Keymap capture state accessor exported without a caller

- **Source:** github-claude | PR #698 round 2 | 2026-07-15
- **Severity:** LOW
- **File:** `electron/command-palette-shortcut.ts`
- **Finding:** `isKeymapCaptureActive` exposed `captureActiveByWindow` as a
  public helper, but no Electron, renderer, or test call site used the export.
  The capture state itself was still consumed internally by the command-palette
  shortcut dispatcher, so only the exported accessor was dead surface.
- **Fix:** Removed the unused export while keeping `setKeymapCaptureActive` and
  the existing internal capture guard intact.

### 11. Settings placeholder pane branch became unreachable after availability gating

- **Source:** github-claude | PR #700 round 2 | 2026-07-17
- **Severity:** LOW
- **File:** `src/features/settings/SettingsContent.tsx`
- **Finding:** `hasSettingsPane(section)` and `activeSection` were derived from
  the same available-section source, while every UI path that updates
  `section` also selects from available sections. The fallback
  `PlaceholderPane` render branch could no longer be reached and implied
  unavailable settings sections were still user-selectable.
- **Fix:** Removed the unreachable `PlaceholderPane` import, active-section
  lookup, and fallback render branch so the pane renderer reflects the
  availability contract directly.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 12. SplitView ratio ref stayed write-only after keyboard resize refactor

- **Source:** github-claude | PR #741 round 2 | 2026-07-26
- **Severity:** LOW
- **File:** `src/features/terminal/components/SplitView/SplitView.tsx`
- **Finding:** `ratiosRef` was assigned on every render with a comment claiming
  the keydown handler read it, but the keyboard pane-resize handler had already
  moved to live `nudgeByBoundaryRef` callbacks and no longer read the ref.
- **Fix:** Removed the stale ref and misleading comment so the component only
  carries state used by the active resize path.
- **Commit:** same commit as this entry

### 13. Superseded SplitView track resolver remained exported only for tests

- **Source:** github-claude | PR #741 round 2 | 2026-07-26
- **Severity:** LOW
- **File:** `src/features/terminal/components/SplitView/SplitView.tsx`
- **Finding:** `resolvePaneTrackNudge` had no production caller after the
  span-aware `resolvePaneSpanTrackNudge` replaced it, but the old export and
  dedicated test block remained as a parallel resolver maintained only by tests.
- **Fix:** Removed the obsolete resolver export and its dedicated tests, leaving
  the span-aware resolver as the only boundary-resolution implementation.
- **Commit:** same commit as this entry

### 14. Handoff spec kept an unused slot-count helper

- **Source:** github-claude | PR #746 round 1 | 2026-07-27
- **Severity:** LOW
- **File:** `tests/e2e/terminal/specs/handoff.spec.ts`
- **Finding:** The `slotCount` helper was declared in the opt-in handoff spec
  but had no call sites, leaving a stale diagnostic helper that implied missing
  layout assertions.
- **Fix:** Removed the unused helper so the stage-setter spec only carries
  active setup and diagnostic code.
- **Commit:** same commit as this entry

### 15. Agent attention pipeline was unreachable for every real producer

- **Source:** local-codex | PR #785 fixer cycle | 2026-08-06
- **Severity:** HIGH
- **File:** `src/features/sessions/hooks/useAgentNotificationProducers.ts`, `crates/backend/src/agent/adapter/`
- **Finding:** Claude Code, Codex, and OpenCode emitted `agent-attention`, but the
  renderer rejected that event for all three agent types in favor of the
  normalized `agent-notification` watcher. The dead parallel route retained
  duplicate parsers, bindings, tests, and a second per-session Claude tail.
- **Fix:** Kept `NotificationWatcherService` as the sole semantic-notification
  pipeline and removed the unreachable event contract, producers, renderer
  listener, Claude tail thread, and route-specific tests.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
