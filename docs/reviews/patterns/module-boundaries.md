---
id: module-boundaries
category: code-quality
created: 2026-04-30
last_updated: 2026-06-12
ref_count: 3
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
- **Fix:** Promoted the test-only `CodexAdapter::with_home(pid, pty_start, codex_home)` to `pub(crate)` so the adapter accepts the same `codex_home` that the outer `CompositeLocator` used. `for_attach` now computes `codex_home` once and clones it into both. Lesson: when refactoring a self-contained constructor (`CodexAdapter::new`) into a multi-site wiring (`for_attach`), every value the original constructor _derived_ internally needs to flow through the new wiring as a single source of truth — not be re-derived at each call site.
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
- **Fix:** Promoted `default_codex_home()` from a module-private `fn` to `pub(crate) fn` and replaced the `ok_or_else(|| LocatorFatal(...))` with `unwrap_or_else(default_codex_home)`. Renamed the test from `..._errors_locator_fatal` to `..._falls_back_to_default_home`. Updated `error.rs`'s module doc to mark `AttachError` infallible at the `for_attach` site (variants reserved for D'). Lesson: refactors that hoist a `fn`'s body into a new module shape must preserve _every_ observable behavior that body encapsulated — not just the happy path. Convert "what does the old code do when its inputs are degenerate?" into a checklist item in the refactor design pass.
- **Commit:** _(PR #261 round 1 `/lifeline:upsource-review` cycle 1)_

---

### 7. DRY-consolidation missed sibling call sites in transitional façade code

- **Source:** github-claude | PR #261 round 2 | 2026-05-24
- **Severity:** LOW
- **File:** `crates/backend/src/agent/adapter/claude_code/mod.rs` (and the matching duplicate in `codex/mod.rs`)
- **Finding:** Cycle-1 fix for finding #5 above (the triplicated `StatusSnapshot → AgentStatusEvent` 8-field mapping) extracted `types::stamp_snapshot` and migrated three call sites (`base/watcher_runtime::compose_event`, `claude_code/statusline::snapshot_to_event`, `codex/parser::snapshot_to_event` test-only). But the transitional `AgentAdapter::parse_status` impls for `ClaudeCodeAdapter` (line 106-120) and `CodexAdapter` (line 138-152) still built `AgentStatusEvent` with manual struct literals — those two sites are also `StatusSnapshot → AgentStatusEvent` stamps, only on the deprecated façade path. Production code uses `decoder.decode()` + `compose_event()` exclusively (so no runtime bug today), but a future optional field on `AgentStatusEvent` would compile cleanly while the two façade paths silently miss the field. Same finding-class as #5; the cycle-1 migration was incomplete.
- **Fix:** Imported `stamp_snapshot` in both adapter modules. Replaced the manual literal in each `parse_status` with `event: stamp_snapshot(session_id, snapshot)`. Lesson: when extracting a helper for a duplicated mapping, search for _every_ site implementing the same shape — not just the obvious "watcher path" trio. `git grep "session_id: session_id.to_string()"` (or the unique signature line for the mapping) catches façade copies that pattern-matching by file name misses. Add this grep to the refactor's local-verification checklist.
- **Commit:** _(PR #261 round 2 `/lifeline:upsource-review` cycle 2; follows-up #5 above)_

---

### 8. Single-line wrapper around an extracted helper is readability tax, not abstraction

- **Source:** github-claude | PR #261 round 3 | 2026-05-24
- **Severity:** LOW
- **File:** `crates/backend/src/agent/adapter/base/watcher_runtime.rs`
- **Finding:** Cycle 1's fix for #5 above (extract `stamp_snapshot` from the triplicated 8-field mapping) introduced a private `compose_event(session_id, snapshot) -> AgentStatusEvent` in `watcher_runtime.rs` that did nothing except call `crate::agent::adapter::types::stamp_snapshot` via a fully-qualified path. Three call sites went through it. The wrapper was intended to name the R2.2 "runtime stamps the session id" moment locally, but it added an extra grep hop (find `compose_event` → find `stamp_snapshot` → find the mapping), used non-idiomatic fully-qualified paths instead of imported names, and risked becoming a missed second-change-site if `stamp_snapshot`'s signature ever evolved.
- **Fix:** Deleted `compose_event`. Added `stamp_snapshot` to the module's `use crate::agent::adapter::types::{...}` block. Three call sites now call `stamp_snapshot(&sid_for_cb, snapshot)` directly — self-documenting without indirection. Dropped the unused `use crate::agent::types::AgentStatusEvent` import that the wrapper kept alive. Lesson: a thin wrapper around an extracted helper is justified ONLY when it adds (a) a new name worth introducing because callers need a domain-meaningful verb, (b) a side effect the helper doesn't have (logging, metric emission), or (c) a parameter transformation. None of those applied here — the wrapper was "documentation by indirection," which is worse than direct calls + a one-line doc-comment. Pair this with the rest of the pattern's lesson: when you find such a wrapper in review, prefer deletion over keeping it for narrative reasons.
- **Commit:** _(PR #261 round 3 `/lifeline:upsource-review` cycle 3; follows-up #5 / #7 above)_

---

### 9. Two structs satisfying overlapping trait surfaces with byte-for-byte identical bodies

- **Source:** github-claude | PR #261 round 4 | 2026-05-24
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/mod.rs` + `crates/backend/src/agent/adapter/claude_code/mod.rs`
- **Finding:** Step B' introduced `ClaudeStatusFileLocator` (a stateless `pub(crate) struct` consumed by `AgentBindings.locator`) alongside the existing `ClaudeCodeAdapter`, both implementing `StatusSourceLocator::locate`. The two `locate` bodies were byte-for-byte identical — the same `cwd.join(".vimeflow").join("sessions")...` chain. A future Claude session-path schema change (e.g., `.vimeflow` renamed, sub-directory added) updated in one struct but not the other would compile cleanly and silently produce divergent paths from the watcher path vs the façade `AgentAdapter::located_status_source` path. Same finding-class as #1/#3/#5/#7 — two type surfaces hosting the same shape with no shared anchor. The transitional context (façade still alive in B', `ClaudeStatusFileLocator` is the future steady-state) doesn't excuse the duplication; the divergence risk applies for the whole B' → B'' → D' lifetime.
- **Fix:** Extracted `pub(super) fn claude_status_path(cwd: &Path, session_id: &str) -> LocatedStatusSource` next to `ClaudeCodeAdapter` in `claude_code/mod.rs`. Both `StatusSourceLocator` impls now route through it: `ClaudeCodeAdapter::locate` calls `claude_status_path(cwd, session_id)` directly, `ClaudeStatusFileLocator::locate` calls `claude_code::claude_status_path(cwd, session_id)`. Future schema changes are now single-site edits. Lesson: when a refactor spins out a new type that needs the same construction logic as an existing type, the construction logic must live as a free function (or shared helper struct) BEFORE the new type lands — not "we'll dedupe later when one of them is removed." The dedupe is the prerequisite, not the cleanup. `pub(super)` visibility is the right scope because the helper is internal to one provider's module tree.
- **Commit:** _(PR #261 round 4 `/lifeline:upsource-review` cycle 4)_

---

### 10. Statusline shim `snapshot_to_event` — same anti-pattern as #8 in a sibling file

- **Source:** github-claude | PR #261 round 4 | 2026-05-24
- **Severity:** LOW
- **File:** `crates/backend/src/agent/adapter/claude_code/statusline.rs`
- **Finding:** Cycle 3's #8 fix removed `compose_event` from `watcher_runtime.rs` but left the parallel `snapshot_to_event` shim in `claude_code/statusline.rs` — a single-expression forwarder to `stamp_snapshot` with one caller (`parse_statusline`). Pattern recurs: a "name the R2.2 boundary at every producer" instinct produces a trivial wrapper at each site. The grep-and-sweep heuristic in #5's fix (`git grep "session_id: session_id.to_string()"`) caught the _literal stamping copies_ but not these single-forwarders, which take a different syntactic shape.
- **Fix:** Inlined `stamp_snapshot(session_id, snapshot)` at `parse_statusline`'s call site, deleted the shim. `stamp_snapshot` was already imported at the top of the file (added by cycle 1's F5 fix). Lesson: when applying #8's "delete the thin wrapper" lesson, also grep for `fn snapshot_to_event` / `fn stamp_*` / any `pub fn` that's a one-expression call. Single-forwarders are easy to miss because they don't visually pattern-match the original duplicated literal.
- **Commit:** _(PR #261 round 4 `/lifeline:upsource-review` cycle 4; sibling of #8 above)_

---

### 11. Production caller dropped during refactor, parked module marked dead-code "to be re-wired later" — the re-wire step was forgotten until a reviewer caught a user-visible regression

- **Source:** github-codex-connector | PR #302 round 1 | 2026-05-29
- **Severity:** MEDIUM (P2)
- **File:** `crates/backend/src/agent/adapter/codex/mod.rs` L153 (consumer site of dropped wire-up), `crates/backend/src/agent/adapter/codex/session_index.rs` (parked module), `crates/backend/src/agent/events.rs` (parked emit)
- **Finding:** The agent-adapter v4-frozen refactor moved Codex transcript orchestration from `base::start_for` into `SessionLifecycle`'s verb sequence. The pre-refactor `tail_transcript` had attached a Codex `session_index::spawn_watch` thread that emitted `agent-session-title` events as `thread_name` rows landed in `~/.codex/session_index.jsonl`; the new streamer only started the rollout tail. `session_index.rs` was annotated `#![allow(dead_code)]` with a `TODO(epic→main reconciliation): RE-WIRE it into the SessionLifecycle flow` comment, `events.rs` carried the parallel TODO on `AGENT_SESSION_TITLE` / `emit_agent_session_title`, and the rename IPC in `state.rs` still called `record_user_rename` for Codex — so the producer (record-rename) and the data file (`session_index.jsonl`) were live in production but the watcher that linked them to frontend `agent-session-title` events was never re-spawned. Frontend pane titles stopped updating for `/rename` and AI-generated `thread_name` for every Codex session, with no error surface. The TODOs documented the gap accurately but no mechanism enforced their resolution before merge — and the symptom was invisible until a reviewer cross-referenced the dropped wire site against the listening frontend.
- **Fix:** Wired the codex title-sync into the watcher runtime (the natural lifecycle boundary). Surfaced the Codex `thread_id` through `LocatedStatusSource.agent_session_id` (`Option<String>`, `Some(_)` for codex, `None` for Claude / NoOp). `start_watching` captures `bindings.agent_type` before destructuring and, for `agent_type == Codex && located.agent_session_id.is_some()`, spawns `codex::session_index::spawn_watch` with stop+join attached to the returned `WatcherHandle`. `Drop` signals stop and joins the title-sync thread alongside the existing polling-fallback join — so the title-sync lifetime is bound 1:1 to the statusline watcher's lifetime with no separate teardown ceremony. Removed `#![allow(dead_code)]` from `session_index.rs` and the parallel `#[allow(dead_code)]` markers on `AGENT_SESSION_TITLE` / `emit_agent_session_title` in `events.rs`; deleted the resolved TODO comment blocks. Code-review heuristic: when a refactor moves orchestration from module A to module B, and module B's first cut omits a feature module A had, do NOT mark the dropped module `#[allow(dead_code)]` with a TODO and ship — instead either (a) re-wire in the same PR, (b) gate the refactor behind a feature flag that disables the user-facing entry point too, or (c) delete the parked module if the re-wire is genuinely deferred to a separate spec. `#[allow(dead_code)]` + TODO is a silent feature regression waiting for a reviewer to spot it months later.
- **Commit:** _(PR #302 upsource cycle 1 fix commit)_

---

### 12. Sibling refactor drop: `tail_loop` → `TranscriptTailService` extraction kept the three core line-type arms but dropped two feature arms (`ai-title` / `custom-title`) and their helper, session-ID filter, and 8 tests with no replacement

- **Source:** github-claude (HIGH, 97%) + github-codex-connector (P2) | PR #302 round 2 | 2026-05-30
- **Severity:** HIGH
- **File:** `crates/backend/src/agent/adapter/claude_code/transcript.rs` L285-311 (consumer dispatch), `crates/backend/src/agent/adapter/claude_code/transcript_dto.rs` (DTO field set)
- **Finding:** PR #287 extracted the per-provider Claude `tail_loop` into the shared `TranscriptTailService` engine + a new `ClaudeTranscriptDecoder` whose `decode_line(&mut self, line: &str)` signature could no longer take the `claude_agent_session_id: &str` parameter the title-emit arms needed. The extraction ported the three core arms (`assistant`, `user`, `tool_result`) but silently dropped `ai-title` and `custom-title` — along with the `emit_title` helper, the per-tail `last_title_memo`, and 8 covering tests — because re-plumbing the session-id parameter as a decoder field was deferred. The drop sat behind acknowledgment comments at `types.rs:54` and `locator.rs:802` ("Claude title-sync parked") with no tracking issue or timeline. Effect: every Claude pane silently stopped receiving `agent-session-title` events for AI-generated and `/rename` titles. The asymmetry with Codex (whose title-sync was independently re-wired in PR #302 cycle 1 F5) made the bug user-visible only after the Codex side started working again. Same finding-class as #11 — a refactor that "moves orchestration" drops a feature arm because the new signature couldn't carry one of its parameters; deferring the re-plumbing without a hard tracker is the silent-regression vector.
- **Fix:** Restored the pre-#287 contract by re-plumbing the missing parameters as decoder state. Added `claude_agent_session_id: String` and `last_title_memo: Option<String>` fields to `ClaudeTranscriptDecoder`; `start_tailing` derives `claude_agent_session_id` from `transcript_path.file_stem()` (Claude's JSONL file IS named after its agent session id) and passes it to `ClaudeTranscriptDecoder::new`. `decode_line` forwards both as references to a wider `process_line` signature (now `#[allow(clippy::too_many_arguments)]`-ed). Added the `ai-title` / `custom-title` match arms gated on `dto.session_id_field == Some(claude_agent_session_id)` — per-session isolation, never leak another Claude session's title through this tail thread. Restored the `emit_title` helper with the same dedup contract from PR #265 (`ai-generated` dedups against the memo; `user-renamed` always emits because `/rename` is user-initiated and the round-trip is itself the confirmation signal). Extended `ClaudeTranscriptLineDto` with three new lenient-string fields (`session_id_field` / `ai_title` / `custom_title`) so the same DTO covers title lines without a separate parse pass. Added 4 regression tests pinning: matching session-id → emit, custom-title bypasses memo, mismatched session-id is dropped, ai-title dedups. Code-review heuristic for refactors that change a function's signature: BEFORE deleting any caller's `else if`/match arm, enumerate every parameter the dropped arms read; if a parameter is "no longer wired" in the new signature, the right move is to (a) re-plumb it as state on the new decoder/struct, (b) keep the arm gated behind a `cfg(...)` or feature flag, or (c) explicitly document the regression in the PR description with a tracker, NOT a code comment. Single-PR refactors of orchestration are HIGH-risk for this class of silent drop; the test coverage of the dropped arms is the canary — if a refactor diff deletes test files, audit what production code the tests pinned.
- **Commit:** _(PR #302 upsource cycle 2 fix commit)_

### 13. Callback API carried unused restore metadata with no consumer

- **Source:** github-claude | PR #404 final review | 2026-06-08
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionRestore.ts`, `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** `UseSessionRestoreOptions.onRestore` exposed a `context.storePresent` parameter and `useSessionRestore` computed `storeAuthoritative`, but the only consumer ignored the second argument. The public hook contract implied downstream behavior that did not exist.
- **Fix:** Remove the unused context parameter, delete the `storeAuthoritative` calculation, and call `onRestore(restored)` with the API shape that callers actually consume.
- **Commit:** same commit as this entry

### 14. `AppSettingsCache` exposes two identical accessor names for one concept

- **Source:** github-claude | PR #430 round 1 | 2026-06-12
- **Severity:** LOW
- **File:** `crates/backend/src/settings/app_settings.rs` L109-122
- **Finding:** `current()` and `get()` were both `#[allow(dead_code)]` accessors returning the in-memory mirror; `get()` simply delegated to `current()`. Follow-up panes would arbitrarily pick one name, leaving the other permanently dead and creating a small but real API-surface drift risk.
- **Fix:** Removed the `get()` alias and its `#[allow(dead_code)]` marker. Only `current()` remains as the single mirror accessor, so future callers have one obvious name and the compiler will enforce usage once the renderer-facing IPC path is wired.
- **Commit:** same commit as this entry
