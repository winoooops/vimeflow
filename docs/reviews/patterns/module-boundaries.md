---
id: module-boundaries
category: code-quality
created: 2026-04-30
last_updated: 2026-05-24
ref_count: 1
---

# Module Boundaries

## Summary

Reusable utilities (formatters, helpers, pure functions) belong in dedicated
`utils/` modules — not in component files that happen to export them. When a
component file becomes a de-facto host for a utility, refactoring that
component (rename, split, extract sub-component) silently breaks every
external importer with no type-system warning until runtime.

The fix is preventive: when a second component needs a utility currently
defined in a sibling component file, **promote** the utility to a sibling
`utils/<name>.ts` and update the original component to import from there.
Don't widen the coupling by adding a second importer.

## Findings

### 1. `formatTokens` imported across components from a sibling component file

- **Source:** github-claude | PR #115 round 1 | 2026-04-30
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/TokenCache.tsx`
- **Finding:** `TokenCache.tsx:9` imported `formatTokens` from `./BudgetMetrics`, a sibling presentational component file that happens to export the helper at line 11. This coupled two unrelated components at the module level — refactoring `BudgetMetrics.tsx` (splitting, renaming, extracting `MetricCell`) would have silently broken `TokenCache` with no compiler warning. The PR had already created `src/features/agent-status/utils/cacheRate.ts` for the cache-specific math; the natural home for a generic display formatter was a sibling `utils/format.ts`.
- **Fix:** Created `src/features/agent-status/utils/format.ts` with a single `formatTokens` export. Updated `BudgetMetrics.tsx`, `BudgetMetrics.test.tsx`, and `TokenCache.tsx` to import from the new module. Left `ContextBucket.tsx`'s own M-aware `formatTokens` (different implementation) alone — consolidating those two formatters would change ContextBucket's display behavior and is out of scope for the review-fix cycle.
- **Commit:** `570d225 fix(agent-status): address Claude review on TokenCache (PR #115 round 1)`

---

### 2. Dual-form module exports (named + default) drift from sibling components' convention

- **Source:** github-claude | PR #173 round 1 | 2026-05-06
- **Severity:** LOW
- **File:** `src/features/workspace/components/StatusBar.tsx`
- **Finding:** New `StatusBar.tsx` shipped with both `export const StatusBar` and `export default StatusBar` — the latter was dead code (the sole consumer `WorkspaceView.tsx` uses the named import) and inconsistent with sibling components in the same directory: `IconRail` and `Sidebar` are named-only, while `BottomDrawer` is default-only. Adding both forms invites future contributors to follow either convention, multiplying the inconsistency over time. Some bundler tree-shaking paths also treat re-exported defaults differently, so the dual form has a small additional cost. Note (1-line stretch): this fits the broader "module boundaries" theme — what a file exports is part of its module shape, and shape inconsistency across siblings is a coupling smell similar to #1's cross-component utility import.
- **Fix:** Dropped `export default StatusBar`. Pattern is now: workspace-level chrome (`IconRail`, `Sidebar`, `StatusBar`) ships named-only; legacy components like `BottomDrawer` keep their default export until a future migration normalises. Code-review heuristic: when a new file lands in a directory, scan sibling files for export shape and match — not "support both forms defensively."
- **Commit:** _(see git log for the cycle-1 fix commit on PR #173)_

### 3. `TerminalZone` re-implemented `getVisibleSessions`'s open-status check inline instead of importing the canonical predicate

- **Source:** github-claude | PR #174 round 17 | 2026-05-07
- **Severity:** MEDIUM
- **File:** `src/features/workspace/components/TerminalZone.tsx`
- **Finding:** `TerminalZone` decided whether to wire `aria-labelledby` on each panel by recomputing `isActive || status === 'running' || status === 'paused'` inline. The exact same predicate (modulo the `isActive` half) lives in `pickNextVisibleSessionId.ts` as `isOpenSessionStatus`, which `Sidebar` and `SessionTabs` both consume. Today the two are equivalent, but the moment `isOpenSessionStatus` is widened (e.g. to admit a future `suspended` status), `TerminalZone`'s `hasVisibleTab` would silently lag — panels for the new status would emit `aria-labelledby={undefined}` even though `SessionTabs` would render a visible tab for them, breaking the WAI-ARIA tablist↔tabpanel linkage with no build error and no test failure. Same finding-class as #2 above (sibling-shape mismatch is a coupling smell) but the consequence here is functional, not stylistic.
- **Fix:** Imported `isOpenSessionStatus` from `../utils/pickNextVisibleSessionId`. Replaced the inline three-line OR with `isActive || isOpenSessionStatus(session.status)`. Updated the comment to state the canonical-predicate consumption rationale ("a future non-open status auto-flows into both visibility surfaces without TerminalZone needing a separate update"). Code-review heuristic: when two files in the same feature directory implement the same predicate inline, ONE of them should host the helper and the other(s) should consume it — and reviewers should flag the duplicate the moment the second copy lands, not after a status-set extension surfaces the drift.
- **Commit:** _(see git log for the cycle-17 fix commit on PR #174)_

---

### 4. Refactor splits a constructor — internal `codex_home` derivation desyncs between adapter and outer locator

- **Source:** github-claude | PR #261 round 1 | 2026-05-24
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/bindings.rs`
- **Finding:** Step B' of the agent-adapter refactor moved `CompositeLocator` construction out of `CodexAdapter::new` and into `AgentBindings::for_attach`, but kept `CodexAdapter::new(pid, pty_start)` as the way to build the transitional `adapter_for_transcript_state`. `for_attach` derived `codex_home` from `ctx.provider_home`, then constructed two locators with potentially different homes: `bindings.locator = CompositeLocator::new(codex_home, ...)` and (inside `CodexAdapter::new`) a second `CompositeLocator::new(default_codex_home(), ...)`. Whenever `ctx.provider_home != default_codex_home()` (any test passing a custom home, or a future build-time override), `adapter.located_status_source()` would silently use the wrong root. Latent in B' (no live caller reached that path) but B''/D' migrations would inherit the mismatch unnoticed.
- **Fix:** Promoted the test-only `CodexAdapter::with_home(pid, pty_start, codex_home)` to `pub(crate)` so the adapter accepts the same `codex_home` that the outer `CompositeLocator` used. `for_attach` now computes `codex_home` once and clones it into both. Lesson: when refactoring a self-contained constructor (`CodexAdapter::new`) into a multi-site wiring (`for_attach`), every value the original constructor *derived* internally needs to flow through the new wiring as a single source of truth — not be re-derived at each call site.
- **Commit:** _(PR #261 round 1 `/lifeline:upsource-review` cycle 1)_

---

### 5. Triplicated `StatusSnapshot → AgentStatusEvent` 8-field mapping across three modules

- **Source:** github-claude | PR #261 round 1 | 2026-05-24
- **Severity:** LOW
- **File:** `crates/backend/src/agent/adapter/base/watcher_runtime.rs` (and the duplicates in `claude_code/statusline.rs` + `codex/parser.rs`)
- **Finding:** Three byte-for-byte identical 8-field mappings of `(session_id, StatusSnapshot) → AgentStatusEvent` lived in `base/watcher_runtime::compose_event`, `claude_code/statusline::snapshot_to_event`, and the test-only `codex/parser::snapshot_to_event`. Required-field additions to `AgentStatusEvent` would compile-error at all three sites (struct-literal syntax), but an optional-field addition could silently drift if only the watcher path was updated. Triple-duplication is the canonical cross-module DRY violation that this pattern was built for (cf. #1 and #3).
- **Fix:** Promoted the mapping to `pub(crate) fn stamp_snapshot(session_id, StatusSnapshot) -> AgentStatusEvent` next to `StatusSnapshot` in `crate::agent::adapter::types`. All three call sites now delegate to it. Lesson: when a refactor extracts a session-id-free intermediate type (`StatusSnapshot`) deliberately to invert composition, the inverse stamping must be centralized too — otherwise every downstream call site re-implements the inversion and they drift on the next field addition.
- **Commit:** _(PR #261 round 1 `/lifeline:upsource-review` cycle 1)_

---

### 6. Refactor surfaces what the old code absorbed — `dirs::home_dir() == None` becomes a hard-fail

- **Source:** github-codex-connector | PR #261 round 1 | 2026-05-24
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/bindings.rs`
- **Finding:** Step B' moved `codex_home` derivation from `CodexAdapter::new` (which absorbed `dirs::home_dir() == None` via a `.codex` relative fallback) into `AgentBindings::for_attach`, which expected the typed `ctx.provider_home`. When that was `None`, `for_attach` returned `AttachError::LocatorFatal("Codex AttachContext has no provider_home")` rather than absorbing it. But `provider_home` is set via `dirs::home_dir().map(...)` in the central config registry — so it's `None` whenever the underlying call returns `None` (headless / service sessions with no resolvable `$HOME` / `/etc/passwd` entry). The refactor silently turned "works with relative `.codex`" into "Codex watcher fails to attach", a behavioral regression that disables status/transcript updates entirely in those environments. The reviewer's framing: "make sure the new wiring preserves the fallback the old constructor encapsulated, not just the happy path."
- **Fix:** Promoted `default_codex_home()` from a module-private `fn` to `pub(crate) fn` and replaced the `ok_or_else(|| LocatorFatal(...))` with `unwrap_or_else(default_codex_home)`. Renamed the test from `..._errors_locator_fatal` to `..._falls_back_to_default_home`. Updated `error.rs`'s module doc to mark `AttachError` infallible at the `for_attach` site (variants reserved for D'). Lesson: refactors that hoist a `fn`'s body into a new module shape must preserve *every* observable behavior that body encapsulated — not just the happy path. Convert "what does the old code do when its inputs are degenerate?" into a checklist item in the refactor design pass.
- **Commit:** _(PR #261 round 1 `/lifeline:upsource-review` cycle 1)_

---

### 7. DRY-consolidation missed sibling call sites in transitional façade code

- **Source:** github-claude | PR #261 round 2 | 2026-05-24
- **Severity:** LOW
- **File:** `crates/backend/src/agent/adapter/claude_code/mod.rs` (and the matching duplicate in `codex/mod.rs`)
- **Finding:** Cycle-1 fix for finding #5 above (the triplicated `StatusSnapshot → AgentStatusEvent` 8-field mapping) extracted `types::stamp_snapshot` and migrated three call sites (`base/watcher_runtime::compose_event`, `claude_code/statusline::snapshot_to_event`, `codex/parser::snapshot_to_event` test-only). But the transitional `AgentAdapter::parse_status` impls for `ClaudeCodeAdapter` (line 106-120) and `CodexAdapter` (line 138-152) still built `AgentStatusEvent` with manual struct literals — those two sites are also `StatusSnapshot → AgentStatusEvent` stamps, only on the deprecated façade path. Production code uses `decoder.decode()` + `compose_event()` exclusively (so no runtime bug today), but a future optional field on `AgentStatusEvent` would compile cleanly while the two façade paths silently miss the field. Same finding-class as #5; the cycle-1 migration was incomplete.
- **Fix:** Imported `stamp_snapshot` in both adapter modules. Replaced the manual literal in each `parse_status` with `event: stamp_snapshot(session_id, snapshot)`. Lesson: when extracting a helper for a duplicated mapping, search for *every* site implementing the same shape — not just the obvious "watcher path" trio. `git grep "session_id: session_id.to_string()"` (or the unique signature line for the mapping) catches façade copies that pattern-matching by file name misses. Add this grep to the refactor's local-verification checklist.
- **Commit:** _(PR #261 round 2 `/lifeline:upsource-review` cycle 2; follows-up #5 above)_

---

### 8. Single-line wrapper around an extracted helper is readability tax, not abstraction

- **Source:** github-claude | PR #261 round 3 | 2026-05-24
- **Severity:** LOW
- **File:** `crates/backend/src/agent/adapter/base/watcher_runtime.rs`
- **Finding:** Cycle 1's fix for #5 above (extract `stamp_snapshot` from the triplicated 8-field mapping) introduced a private `compose_event(session_id, snapshot) -> AgentStatusEvent` in `watcher_runtime.rs` that did nothing except call `crate::agent::adapter::types::stamp_snapshot` via a fully-qualified path. Three call sites went through it. The wrapper was intended to name the R2.2 "runtime stamps the session id" moment locally, but it added an extra grep hop (find `compose_event` → find `stamp_snapshot` → find the mapping), used non-idiomatic fully-qualified paths instead of imported names, and risked becoming a missed second-change-site if `stamp_snapshot`'s signature ever evolved.
- **Fix:** Deleted `compose_event`. Added `stamp_snapshot` to the module's `use crate::agent::adapter::types::{...}` block. Three call sites now call `stamp_snapshot(&sid_for_cb, snapshot)` directly — self-documenting without indirection. Dropped the unused `use crate::agent::types::AgentStatusEvent` import that the wrapper kept alive. Lesson: a thin wrapper around an extracted helper is justified ONLY when it adds (a) a new name worth introducing because callers need a domain-meaningful verb, (b) a side effect the helper doesn't have (logging, metric emission), or (c) a parameter transformation. None of those applied here — the wrapper was "documentation by indirection," which is worse than direct calls + a one-line doc-comment. Pair this with the rest of the pattern's lesson: when you find such a wrapper in review, prefer deletion over keeping it for narrative reasons.
- **Commit:** _(PR #261 round 3 `/lifeline:upsource-review` cycle 3; follows-up #5 / #7 above)_
