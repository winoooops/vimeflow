---
id: persisted-state-invariants
category: correctness
created: 2026-06-08
last_updated: 2026-07-09
ref_count: 8
---

# Persisted State Invariants

## Summary

Durable user-facing state (workspace shapes, caches, settings files) can be malformed by crashes, partial writes, migration gaps, or manual edits. Code that reads this state must validate runtime invariants before acting on them — never assume that a successfully-deserialized record satisfies every invariant the in-memory model requires. A single bad record should be skipped with a diagnostic, not allowed to abort the entire restore or poison downstream state.

## Findings

### 1. Zero-pane persisted session can abort the entire workspace restore

- **Source:** github-claude | PR #396 round 1 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `src/features/sessions/utils/groupSessionsFromInfos.ts`
- **Finding:** `buildStoreSession` assumed every persisted session had at least one pane. When `shape.panes` was empty, `activePane` evaluated to `undefined` and `activePane.agentType` threw. The exception was caught by `useSessionRestore`'s broad catch, causing the entire restore to fall back to an empty workspace and silently discarding otherwise valid sessions.
- **Fix:** In `reconstructWorkspace`, filter out zero-pane store sessions before calling `buildStoreSession`, logging a warning with the bad session id. Valid store sessions and unreferenced live PTYs continue to restore normally. Added a regression test pinning the skip behavior.
- **Commit:** same commit as this entry

### 2. storePresent stays true for an all-zero-pane store

- **Source:** github-claude | PR #396 round 2 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionRestore.ts`
- **Finding:** `reconstructWorkspace` filters zero-pane persisted sessions before rebuilding, but `storeAuthoritative` was computed from the raw `storeShape.sessions.length`. If a crash or migration leaves only zero-pane records, restore falls back to live PTYs while `onRestore` is told to skip the legacy browser-pane cache, so cached browser panes can disappear.
- **Fix:** Compute `storeAuthoritative` from the same usable-session invariant as reconstruction: `storeShape.sessions.some((session) => session.panes.length > 0)`.
- **Commit:** same commit as this entry

### 3. activate returns even when optional onActivePersisted did not run

- **Source:** github-claude | PR #396 round 2 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionRestore.ts`
- **Finding:** `activate` called `onActivePersistedRef.current?.(activeStoreId)` and then unconditionally returned. The exported hook declares `onActivePersisted` optional; any caller that omits it while restoring an active store session skips both PTY-based activation and fallback activation, leaving no selected session.
- **Fix:** Guard the callback invocation and return: only return after persisted activation when `onActivePersistedRef.current` exists and was invoked; otherwise fall through to the existing PTY/fallback activation paths.
- **Commit:** same commit as this entry

### 4. Brand-new browser pane with no live tabs blocked the whole durable write

- **Source:** github-claude | PR #404 round 2 | 2026-06-08
- **Severity:** HIGH
- **File:** `electron/workspace-layout-writer.ts`
- **Finding:** `WorkspaceLayoutWriter.assemble()` returned `null` whenever any browser pane lacked live, remembered, or preserved tabs. A newly-created browser pane can enter the renderer shape before its main-side `WebContentsView` exists, so a close during that gap made `flush()` fail and skipped persistence of the latest workspace shape.
- **Fix:** Treat a pane with no live, remembered, removed, or preserved source as a brand-new pane and persist `tabs: []`; Rust repair seeds the default tab if that snapshot is restored. Kept the removed-and-readded guard returning `null`, and added writer tests for both cases plus close-flush persistence.
- **Commit:** same commit as this entry

### 5. Browser-tab cache and assembled snapshots need separate cloned objects

- **Source:** github-claude | PR #404 final review | 2026-06-08
- **Severity:** LOW
- **File:** `electron/workspace-layout-writer.ts`
- **Finding:** `tabsForBrowserPane` cloned live or preserved tabs, stored that clone in `lastTabsByBrowserPane`, then cloned the clone for the assembled store. That extra pass obscured the real invariant: the writer cache and returned snapshot should be separate cloned objects so callers cannot mutate the cached durable fallback.
- **Fix:** Clone the original live or preserved tabs separately for the cache and the assembled store, avoiding clone-of-clone work while preserving object isolation between the cache and the returned snapshot.
- **Commit:** same commit as this entry

### 6. Reappearing browser pane keys must clear removed-state before flush

- **Source:** github-claude | PR #404 final review | 2026-06-08
- **Severity:** HIGH
- **File:** `electron/workspace-layout-writer.ts`
- **Finding:** `noteBrowserPaneShape` added disappearing browser pane keys to `removedBrowserPaneKeys` but did not clear that set when a key reappeared. A pane that briefly disappeared and then reappeared before its live view was capturable caused `tabsForBrowserPane` to return `null`, making teardown flush skip persistence.
- **Fix:** Clear `removedBrowserPaneKeys` for every key present in the next shape. Updated assemble and flush coverage so a reappearing pane with no live capture persists as `tabs: []` rather than blocking the save.
- **Commit:** same commit as this entry

### 7. Transient multi-active pane snapshot restarts background shell instead of normalized browser pane

- **Source:** github-codex-connector (P2) | PR #443 cycle 1 | 2026-06-13
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionRestore.ts`
- **Finding:** `findActiveStoreShell` searched the active session for any active shell pane. After a graceful quit, a mixed browser+shell workspace could briefly persist with both panes marked active. Restore then restarted the shell even though `reconstructWorkspace` normalized the active pane to the browser, causing a background shell to spawn in an otherwise browser-active workspace.
- **Fix:** Sort panes by `paneIndex`, pick the first flagged pane as the normalized active pane (matching `buildStoreSession`), and only restart when that normalized pane is a shell. Added a regression test with a browser pane at index 0 and a shell pane at index 1 both marked active.
- **Commit:** same commit as this entry

### 8. `Exited` PTY records treated as live sessions, skipping restart

- **Source:** github-codex-connector (P1) | PR #443 cycle 1 | 2026-06-13
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionRestore.ts`
- **Finding:** `restartPersistedActiveShell` used `liveSessions.length > 0` as the "session is live" guard. The backend's lazy-reconciliation path can return a non-empty `listSessions()` result where every row has `status.kind === 'Exited'`. The guard treated this as a live restore and skipped restarting the persisted active shell, leaving a `completed` placeholder and forcing auto-create to open a second terminal.
- **Fix:** Replace the length check with `liveSessions.some((session) => session.status.kind === 'Alive')` so only actually alive PTYs block the restart path. Added a regression test where `listSessions()` returns a single `Exited` record.
- **Commit:** same commit as this entry

### 9. Rust `valid_layout_tracks` accepts whitespace-only track IDs

- **Source:** github-claude | PR #542 round 1 | 2026-06-19
- **Severity:** LOW
- **File:** `crates/backend/src/terminal/workspace_layout.rs`
- **Finding:** `valid_layout_tracks` only checked `!track.id.is_empty()`, so a hand-crafted persisted layout with a whitespace-only track id (e.g., `" "`) passed validation. The resulting CSS grid track name would be invisible and produce no diagnostics.
- **Fix:** Changed the guard to `!track.id.trim().is_empty()` so whitespace-only ids are rejected, matching the TypeScript validation.
- **Commit:** same commit as this entry

### 10. Custom slot ids can collide after grid-area sanitization

- **Source:** github-codex-connector | PR #542 round 1 | 2026-06-19
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/layout-registry/layoutDefinition.ts`
- **Finding:** `gridAreaNameForSlotId` replaces non-alphanumeric characters with `-`, so distinct ids such as `slot:a b` and `slot:a-b` map to the same CSS grid-area name. A persisted custom layout passing validation could therefore place multiple panes in one grid area, causing overlap or an invalid grid template at runtime.
- **Fix:** Added `duplicate-grid-area` validation in `validateSlots` that rejects layouts whose sanitized slot ids produce colliding grid-area names.
- **Commit:** same commit as this entry

### 11. `SessionCache` derived `app_data_dir` implicitly from its cache-file parent

- **Source:** github-claude | PR #563 cycle 1 | 2026-06-19
- **Severity:** MEDIUM
- **File:** `crates/backend/src/terminal/cache.rs` L87-89 (original)
- **Finding:** `SessionCache::app_data_dir()` derived the Vimeflow data root by calling `.parent()` on `self.path` (`sessions.json`). The invariant that the cache file is always a direct child of `app_data_dir` was established by convention in `BackendState::new` and not enforced by the type system. Moving the cache path (e.g., `db/sessions.json`) would silently write bridge/status files under the wrong parent with no compile-time or runtime warning.
- **Fix:** Stored `app_data_dir: PathBuf` explicitly in `SessionCache`, initialized it in `SessionCache::new`/`with_path`, and added `BackendState::with_app_data_dir` so the root is pinned once at construction rather than inferred from the cache path. `spawn_pty_inner` now uses the explicit field instead of `cache.app_data_dir()`.
- **Commit:** same commit as this entry

### 12. Durable layout repair coerced opencode panes to generic

- **Source:** github-codex-connector | PR #584 round 1 | 2026-06-20
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/terminal/workspace_layout.rs`
- **Finding:** The frontend type contract allowed `agentType: "opencode"` and workspace-shape persistence could write that value, but Rust layout repair still treated only the older agent set as known. Restarting from a durable layout would coerce opencode panes to `generic` until detection ran again.
- **Fix:** Added `opencode` to the repair allowlist and added a regression test proving `repair_workspace_layout` preserves the opencode agent type.
- **Commit:** same commit as this entry

### 13. Opencode pid locator trusted stale append-only index rows

- **Source:** github-codex-connector | PR #586 round 1 | 2026-06-20
- **Severity:** P1 / HIGH
- **File:** `crates/backend/src/agent/adapter/opencode/locator.rs`
- **Finding:** The opencode locator treated any row with `pid == agent_pid` as authoritative before applying the existing freshness gate. Because the bridge index is append-only, OS PID reuse could make an old row for the same pid bind a new opencode process to a previous session's transcript instead of returning the startup-window retry signal.
- **Fix:** Applied the `pty_start - SLACK` freshness floor to pid matches as well as cwd fallback matches, preserving pid-first disambiguation only for fresh rows. Added a reused-PID regression test proving stale pid rows return the not-ready error.
- **Commit:** same commit as this entry

### 14. Exited-only PTY cache masked durable restore failure

- **Source:** github-claude | PR #613 round 1 | 2026-06-23
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionRestore.ts`
- **Finding:** The store-load failure guard treated any non-empty PTY cache as a usable fallback. If the durable workspace layout was unreadable and `listSessions()` returned only `Exited` rows, restore reconstructed stale completed sessions and called `onRestore` instead of taking the intended failure path.
- **Fix:** Changed the fallback eligibility check to require at least one `Alive` PTY row before suppressing the store-load failure. Added a regression test proving an exited-only cache after store-load failure does not call `onRestore` and still releases hydration.
- **Commit:** same commit as this entry

### 15. Appearance controls updated local state without persisting settings

- **Source:** github-codex-connector | PR #672 round 1 | 2026-07-08
- **Severity:** P2 / MEDIUM
- **File:** `src/features/settings/components/panes/AppearancePane.tsx`
- **Finding:** Appearance controls for scheme, accent hue, density, and fonts
  mutated component-local state instead of the settings provider. The UI appeared
  to accept the change, but reloads discarded it and other settings consumers did
  not observe the update.
- **Fix:** Bind those controls directly to provider settings and call
  `update(...)` for every change. Added a regression test asserting the controls
  invoke persisted settings updates.
- **Commit:** same commit as this entry

### 16. Stored keymap overrides collided with fixed shortcuts

- **Source:** github-claude | PR #672 round 2 | 2026-07-09
- **Severity:** HIGH
- **File:** `src/features/keymap/conflicts.ts`
- **Finding:** `resolveBindings` skipped commands marked
  `preserveStoredOverrides` when checking whether another stored override
  collided with fixed shortcuts such as Settings or browser-location. A
  hand-edited or migrated settings file could therefore load two commands with
  the same chord.
- **Fix:** Removed the broad skip so fixed commands remain collision obstacles
  for other overrides, while intentional shadow pairs still bypass the check.
  Added regression coverage for settings and browser shortcut collisions.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 17. Pre-load settings patches must replay after load failure

- **Source:** github-claude | PR #672 round 3 | 2026-07-09
- **Severity:** MEDIUM
- **File:** `src/features/settings/SettingsProvider.tsx`
- **Finding:** Settings changes made before the initial load resolved were
  queued for the success path only. If loading settings failed, the UI could
  show the optimistic edit while the queued patch was never saved or synced.
- **Fix:** Share pending-patch replay across the success and failure paths. On
  failure, merge the queued patch onto `DEFAULT_SETTINGS`, sync the main
  snapshot, and persist it.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 18. Renderer-only settings save queues can lose the latest window-scoped edit

- **Source:** github-codex-connector | PR #672 round 3 | 2026-07-09
- **Severity:** P2 / MEDIUM
- **File:** `src/features/settings/SettingsProvider.tsx`
- **Finding:** Settings saves were chained in a renderer-owned promise queue. A
  rapid later edit could remain queued behind an earlier save when the native
  settings window closed, destroying the renderer before the latest `bridge.save`
  call reached the main process.
- **Fix:** Remove the renderer-only save queue and send each save IPC
  immediately after updating state, while keeping the existing main snapshot
  sync for close-time decisions.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 19. Renderer-only alias save queues can lose latest edits on window close

- **Source:** github-claude | PR #672 round 4 | 2026-07-09
- **Severity:** HIGH
- **File:** `src/features/settings/components/panes/AgentsPane.tsx`
- **Finding:** Agent alias saves were chained behind a renderer-owned promise
  queue. Rapid alias edits could leave the final `bridge.aliases.save(...)`
  call waiting behind an earlier save when the native settings window closed,
  with no main-process snapshot fallback for aliases.
- **Fix:** Removed the alias save queue and issued each alias save IPC
  immediately after updating local state. Added regression coverage proving a
  later alias edit calls `save` even while the previous save promise remains
  unresolved.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
