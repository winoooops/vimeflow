---
id: dead-code
category: code-quality
created: 2026-06-13
last_updated: 2026-06-26
ref_count: 8
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

### 8. Stale dead-code suppression hid active replay summary schema

- **Source:** github-claude | PR #626 round 2 | 2026-06-26
- **Severity:** LOW
- **File:** `crates/backend/src/agent/types.rs`
- **Finding:** `AgentReplaySummaryEvent` kept an obsolete `#[allow(dead_code)]` after the event became exported, emitted, and consumed by the frontend. The suppression made an active schema look provisional and could mask future cleanup mistakes.
- **Fix:** Removed the stale suppression while leaving the exported event schema unchanged.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
