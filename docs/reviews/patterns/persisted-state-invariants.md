---
id: persisted-state-invariants
category: correctness
created: 2026-06-08
last_updated: 2026-06-13
ref_count: 6

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

### 7. "Open settings.json" does nothing on a fresh profile because the file was never created

- **Source:** github-codex-connector | PR #430 round 1 | 2026-06-12
- **Severity:** MEDIUM
- **File:** `electron/main.ts` L452-454
- **Finding:** The `SETTINGS_OPEN_FILE` handler called `shell.openPath` on `userData/settings.json`. On a fresh profile, `load_app_settings` returns defaults without writing them, so the file does not exist and the open action silently fails (the renderer also ignores the returned error string).
- **Fix:** Before opening, the handler checks whether `settings.json` exists; if missing, it asks the sidecar to `load_app_settings` (which returns defaults) and then `save_app_settings` so the default file is materialized on disk. The open is still attempted even if seeding fails, letting the OS surface any residual error.
- **Commit:** same commit as this entry

### 8. Settings version not validated before honoring close behavior

- **Source:** github-codex-connector | PR #432 round 1 | 2026-06-12
- **Severity:** P2 / MEDIUM
- **File:** `electron/main.ts` L528
- **Finding:** The `window-all-closed` handler parsed `onLastWindowClosed` from `settings.json` without validating the persisted `version`. The backend settings store intentionally discards files written by a newer app version and loads defaults on version mismatch, but this direct parse in the main process still honored the field. In a downgrade/unsupported-version scenario such as `{"version":999,"onLastWindowClosed":"quit"}`, the UI/store would behave as platform default while the main process quit on macOS after the last window closed.
- **Fix:** When reading `settings.json` as a fallback (no in-memory snapshot yet), compare `parsed.version` against `DEFAULT_SETTINGS.version` and only honor `onLastWindowClosed` when the versions match. Mismatched versions fall back to the platform default.
- **Commit:** same commit as this entry

### 9. Settings version validation imported a renderer value into Electron main

- **Source:** github-codex-connector | PR #432 round 2 | 2026-06-12
- **Severity:** MEDIUM
- **File:** `electron/main.ts` L15, L551
- **Finding:** Round 1's fix for finding #8 imported `DEFAULT_SETTINGS` from `src/features/settings/store/settingsDefaults` into `electron/main.ts` so the fallback `settings.json` parse could compare `parsed.version === DEFAULT_SETTINGS.version`. That is a runtime value import from a renderer feature tree into the Electron main process. The defaults module is a plain object today, but a future edit can add browser/React-facing imports (e.g., a theme helper, a hook, or a component) without any type-system or build guard to stop Electron main from loading it. When that happens, main-process startup or bundling fails silently until runtime.
- **Fix:** Removed the `DEFAULT_SETTINGS` value import. Added a main-process-local `SETTINGS_SCHEMA_VERSION = 1` constant in `electron/main.ts`, documented as mirroring `DEFAULT_SETTINGS.version` and `CURRENT_APP_SETTINGS_VERSION`. The fallback parse now compares `parsed.version === SETTINGS_SCHEMA_VERSION`. This keeps the version validation behavior identical while severing the runtime dependency on a renderer-owned module. Code-review heuristic: value imports from `src/features/**` into `electron/**` are a process-boundary smell; prefer a local constant, an `electron/`-scoped shared constant, or a type-only import. Type-only imports are erased at compile time and are safe; value imports execute at runtime and couple main-process startup to renderer module graphs.
- **Commit:** same commit as this entry

### 10. Disk fallback omits runtime string check for onLastWindowClosed

- **Source:** github-claude | PR #432 round 4 | 2026-06-12
- **Severity:** LOW
- **File:** `electron/main.ts` L549-567
- **Finding:** The `window-all-closed` disk fallback parsed `onLastWindowClosed` from `settings.json` under a TypeScript assertion (`as { version?: number; onLastWindowClosed?: string }`), which is erased at runtime. A non-string persisted value such as `true` or `42` would be assigned unchecked, pass through `?? 'platform'`, and reach `shouldQuitOnAllWindowsClosed`. On macOS that produced the wrong quit decision because any non-`'darwin'` truthy value evaluates to quit instead of the platform-default stay-alive behavior.
- **Fix:** Mirrored the IPC snapshot validation: the disk fallback now checks `parsed.version === SETTINGS_SCHEMA_VERSION && typeof parsed.onLastWindowClosed === 'string'` before assigning the value. This makes the cold-start fallback symmetric with the renderer-sync path and prevents malformed persisted state from altering close behavior.

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
