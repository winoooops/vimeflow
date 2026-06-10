<!-- cspell:ignore vsplit hsplit multipane reselect reselectable respawn respawns -->

# Browser-Only Sessions + Unified Durable Workspace Restore — Design Spec

**Linear:** VIM-74 (re-scoped from "shell-count close-guard bug" to this feature, after codex review showed the guard was load-bearing — it was the only thing preventing an unsupported _browser-only session_ state).

**Stacks on:** `feat/browser-pane-redesign` (the VIM-56 Arc-chrome browser bundle).

**Depends on:** `dev/session-restore-multipane` (#290) grouping infrastructure — see §7 Dependencies & sequencing.

---

## 1. Overview

### 1.1 Problem

1. **The trapped shell (VIM-74).** A session holding one shell pane + one browser pane cannot close its shell: both `SplitView.canClosePane` and `useSessionManager.removePane` gate shell removal on the count of _shell_ panes, so the last shell is un-closable while a browser pane is present. Closing one of two shells then traps the survivor.
2. **The ghost session.** Relaxing those two guards alone (the foundation commits on this branch) is insufficient and creates a worse state — a _browser-only session_ that the rest of the app does not support:
   - `setActiveSessionId` (`useActiveSessionController.ts:48-51`) returns **before** updating React state when `findBackendSessionPane` finds no shell pane → a browser-only tab cannot be re-selected.
   - Restore rebuilds sessions only from live PTYs (`useSessionRestore` → `listSessions`); a session with no shell PTY is never reconstructed → it vanishes on reload.
3. **The real pain (durability).** "I open a useful doc/issue in a browser pane, close the app, and there's no way to get it back." On a **graceful quit**, the backend PTY cache (`sessions.json`) is wiped by design (`SessionCache::clear_all`, #290 constraint C1, to avoid ghost Restart tabs), and the localStorage browser cache's panes are orphaned without a parent session → the whole workspace is lost.
4. **Two parallel caches.** Shell panes persist via the Rust backend grouping (#290, PTY-keyed, wiped on quit); browser panes persist via localStorage (`vimeflow:browser-panes:v1`, a single lossy `browserUrl` per pane). These should be one unified, durable store.

### 1.2 Goal

A workspace — its sessions, layouts, shell panes (cwd + agent badge), and browser panes (full tab set + per-tab navigation history) — survives **both reload and graceful quit**, restoring as the same sessions. **Browser-only sessions become first-class**: reachable (close the last shell), re-selectable, restorable across quit, and creatable from scratch.

Restore fidelity differs by pane kind and path: **browser panes restore fully** (tabs + history) on both paths; **shell panes reattach live** on reload (the agent keeps running), and on graceful quit return as **restartable placeholders** seeded with their cwd + agent badge — the live process is necessarily gone, so the existing Restart UX respawns a bare shell in that cwd. Auto-relaunching the agent and `--resume` are deferred (§1.3). So "nothing lost" means the workspace shape + browser content survive a quit; shells come back restartable-in-place, not auto-running.

### 1.3 Non-goals (this spec)

- **Agent conversation `--resume`.** The schema **reserves the `agentSessionId` field** now so capturing it later needs no store-format bump; writers fill `null` until the capture + respawn-with-resume work lands (a separate session — #290 Phase E). The field exists; its value is not yet populated.
- **Persisting favicons.** Re-fetched on page load via the L3 favicon resolver; a `data:` URL per tab/entry would bloat the store with re-derivable bytes.
- **Per-pane browser cookie isolation.** Browser panes within one session share a partition (one browsing context per session) — confirmed with the user.
- **Persisting scroll position / form state / per-tab zoom.** Only URL + title + history index are captured.

---

## 2. Data Model

One versioned document, a tree: `sessions → panes → (browser) tabs → history`. Shell and browser panes are a discriminated union on `kind`, so both ride one structure.

```ts
/** The whole persisted document (one Rust-owned file). */
interface WorkspaceLayoutStore {
  version: number
  sessions: WorkspaceSession[]
}

interface WorkspaceSession {
  id: string // workspace UUID (== React Session.id); the partition's sessionId segment
  projectId: string // == Session.projectId; the partition's workspaceId segment
  layout: LayoutId // single | vsplit | hsplit | threeRight | quad
  workingDirectory: string // baseline cwd that addPane spawns new shells from
  active: boolean // restore as the active session?
  panes: WorkspacePane[] // N panes, any mix of shell / browser
}

type WorkspacePane = ShellPane | BrowserPane

/** Common to both variants. */
interface PaneBase {
  paneId: string // session-scoped id, e.g. "p0"
  paneIndex: number // stable order within the session
  active: boolean // the session's active pane?
}

interface ShellPane extends PaneBase {
  kind: 'shell'
  ptyId: string // live PTY handle (reload reattach); stale after quit → respawn seed
  cwd: string // live cwd (drifts via OSC 7)
  agentType: string // free string: 'claude-code'|'codex'|'aider'|'generic'; unknown → 'generic' on repair
  agentSessionId: string | null // reserved now (data only); --resume impl is a later session
}

interface BrowserPane extends PaneBase {
  kind: 'browser'
  tabs: PersistedTab[] // "opened urls" + "active url" live here
}

interface PersistedTab {
  active: boolean // the active tab within this pane
  history: NavEntry[] // back/forward stack, chronological
  historyIndex: number // 0-based current position; current url = history[historyIndex].url
}

interface NavEntry {
  url: string
  title: string | null // persisted as-known; coerced to '' for navigationHistory.restore
}
```

### 2.1 Decisions (rationale)

- **Discriminated union on `kind`.** Shell and browser share `paneId/paneIndex/active`; each carries its own state. Rust side is a `#[serde(tag = "kind")]` enum; `ts-rs` generates the TS union. This is the mechanism that lets one structure hold both.
- **`tabs[]` with per-tab `history[]` + `historyIndex`** (mirrors Electron's `navigationHistory.getAllEntries()` + `getActiveIndex()`). The current url is `history[historyIndex].url` — there is **no separate `url` field** (it would be redundant/denormalized). Restore replays each tab via `webContents.navigationHistory.restore({ index, entries })` (Electron ≥35; project is on 42), so back/forward work immediately after restore.
- **`NavEntry.title` null-handling.** Persisted as `string | null` (a tab may have no title yet), but Electron 42's `NavigationEntry.title` is a non-null `string`; the restore adapter coerces `null → ''` when building the `navigationHistory.restore` payload.
- **No favicon field.** Re-fetched on load (L3 resolver). Persisting `data:` URLs (≈32 KB each) × tabs × history entries is large and re-derivable.
- **No `browserSessionId`.** Its only job was to key the browser partition `persist:vimeflow-browser:${workspaceId}:${sessionId}` (`browser-pane.ts:989`), where today `workspaceId = session.projectId` (`BrowserPane.tsx:241`) and `sessionId = browserSessionId`. Both segments are now persisted on `WorkspaceSession` (`projectId` + `id`), so the partition is reproduced **exactly** across restart → cookie/login continuity. The `sessionId` segment becomes `session.id` directly: `browserSessionIdForSession()` returns `session.id` unconditionally (it no longer reads "first shell's ptyId"), decoupling browser identity from the shell PTY — work browser-only sessions need regardless. The runtime `Session.browserSessionId` field is **also removed** (it was only ever the first shell's ptyId): nothing — persisted store nor `Session` create contract — carries a `browserSessionId`; it is a pure derived value (`= session.id`). No user migration **when shipped atomically with browser panes** (the release gate — §3.4 / §7); if browser panes ship first, the §3.4 read-migrate applies.
- **Multiple browser panes per session** are just multiple `kind:'browser'` entries in `panes[]`, symmetric with multiple shells, distinguished by `paneId`. They **share** the session partition (one cookie/storage context per session) — the user confirmed this is desired.
- **`agentSessionId` reserved now.** Every writer fills `null` until the `--resume` feature lands; capturing the field now avoids a later store-format bump.
- **Persisted shape ≠ runtime shape.** The runtime React `Pane` is **unchanged** by this spec (`kind`, `id`, `ptyId`, `cwd`, `agentType`, `status`, `active`, `browserUrl`) — it has **no `paneIndex`**, and browser panes keep their `browser:<uuid>` pseudo-`ptyId` + `agentType:'generic'`. `paneIndex` is a **persistence** field, assigned from array position when the renderer serializes the shape DTO; the persisted `WorkspacePane` (and the DTO) is a distinct shape from the runtime `Pane`. Restore maps persisted → runtime.
- **Serde tagging & migration.** All store structs carry `#[serde(rename_all = "camelCase")]` so fields serialize as `paneId` / `paneIndex` / `projectId` / `historyIndex` etc. (matching the TS sketch + #290's bindings), not Rust's default snake_case. The pane enum is internally tagged with `#[serde(tag = "kind", rename_all = "lowercase")]` so the discriminator serializes as `"shell"` / `"browser"` (Rust's default would emit the variant names `Shell` / `Browser`). `agentType` is persisted as a **free `String`** holding the runtime kebab value (`"claude-code" | "codex" | "aider" | "generic"`) — exactly like #290's `PaneGrouping.agentType` (a `String`, the frontend `Pane.agentType` verbatim). It is **not** the generated `AgentType` enum binding (which serializes camelCase, e.g. `"claudeCode"`); reusing that enum would mismatch this TS sketch, so the store keeps the kebab string and needs no conversion. Every record we write includes `kind`, so there is no missing-tag decode case. This file is **new** (absent before this feature), so there are no legacy `kind`-less records — #290's "degrade a grouping-less PTY to a single-pane session" back-compat applies to `sessions.json`, not here. Forward migration is gated by the top-level `version` (current writer value **`CURRENT_WORKSPACE_LAYOUT_VERSION = 1`**): a reader accepts only `1` and, on any other value, **discards the store and starts fresh** rather than mis-decoding (a dropped durable store degrades to "no restore," never to corruption).

### 2.2 Load-time invariants & repair

The store is reconstructed **defensively** — a malformed record is repaired, never trusted blindly (the file can be hand-edited or written by an older build).

Decode + repair run **entirely in Rust on load**: the load command **receives the active project's `projectId` + `workingDirectory`** as arguments, so Rust can apply even those defaults and return a **fully strict, repaired** `WorkspaceLayoutStore` — repair stays in one place (Rust), and main and the renderer consume clean data and never re-repair. **Decode is two-stage** so repair can actually run: the file is first parsed into a **lenient raw representation** — `serde_json::Value` (or an all-`Option` intermediate with type-tolerant per-field reads). `#[serde(default)]` alone is **insufficient**: it covers _missing_ fields but still hard-fails on _wrong-typed_ ones, so the raw stage must tolerate both. The raw records are then **repaired into the strict model** below (coercing or dropping bad fields); a record that cannot be repaired (e.g. a session left with zero panes) is dropped, never fatal. `NavEntry.url`s are validated against the **runtime navigation allowlist** (`http(s):` + `about:blank` only — matching the live browser policy, so a hand-edited store cannot bypass it) **before** they reach `navigationHistory.restore`; invalid entries are dropped **and `historyIndex` is remapped** by the count of removed entries before it (if the active entry itself is dropped, the index moves to the nearest surviving entry; a tab emptied of all entries is re-seeded per the rules below):

- **`historyIndex`** is clamped to `[0, history.length - 1]`. A tab with empty `history` is seeded with a single `DEFAULT_BROWSER_URL` entry at index `0`.
- **A browser pane with empty `tabs`** is seeded with one default tab (`DEFAULT_BROWSER_URL`, `active: true`, `history: [{ url: DEFAULT_BROWSER_URL, title: null }]`, `historyIndex: 0`) so the one-active-tab invariant can hold.
- **Exactly one active tab per browser pane** — if none or several are `active`, the first tab (array order) wins.
- **Exactly one active pane per session** — if none or several, the first pane by `paneIndex` (ties broken by array order) wins.
- **At most one active session** — if several are `active: true`, the first in array order wins. The (single) active session is honored **directly** and activated through the **browser-capable** `setActiveSessionId` (§4), so a browser-only session is selectable on restore. Only if **no** session has `active: true` does selection fall back to the PTY-based `onActiveResolved` / `onActiveFallback` order; and if that also yields nothing (an all-browser-only store), the **first session in array order** is activated via the browser-capable `setActiveSessionId` — so there is always a selectable session **when at least one repaired session remains**. If the store is empty or every session was dropped, restore falls back to the normal empty-workspace path (PTY-driven sessions, else `autoCreateOnEmpty`).
- **`paneIndex`** gaps/duplicates are tolerated: panes are sorted by `paneIndex` (a missing/wrong-typed `paneIndex` sorts last, as `+∞`), then re-indexed `0..n`.
- **Invalid `layout`** — an unknown layout id falls back to the smallest layout that fits the pane count (then the capacity rule below may widen it).
- **Duplicate identity** — a duplicate `WorkspaceSession.id` keeps the first occurrence and drops the rest; a duplicate `paneId` within a session keeps the first and drops the rest (the `(sessionId, paneId)` join key must be unique). A duplicate shell `ptyId` likewise keeps the first and drops the rest (restore overlays live PTYs by `ptyId`, which must be unique — else one live PTY would attach twice).
- **Layout capacity** — the layout is widened to fit the pane count (`layoutForPaneCount`), capped at `quad`. The app never creates sessions beyond `quad`'s 4-pane capacity, so a store with >4 panes in one session is malformed: panes beyond the first four (by `paneIndex`) are dropped.
- **Unknown `agentType`** — the store holds a free string; any value outside `'claude-code' | 'codex' | 'aider' | 'generic'` is coerced to `'generic'`.
- **Missing/invalid required scalars** — handled conservatively: a session with no usable `id` (or no valid panes) is dropped; absent `projectId` / `workingDirectory` default to the active project's values (passed into the load command, so Rust applies them); a pane with no `paneId`, a shell pane missing `ptyId` / `cwd`, or any pane with an unrecognized `kind` is dropped.
- **Stale `cwd`** — a shell pane whose saved `cwd` no longer exists on disk falls back to the session `workingDirectory`, else the active project cwd, so a placeholder always restarts in a valid directory (checked at restore, ahead of the spawn).
- **Size caps** (guard startup + atomic writes against huge or hand-edited stores): per-tab `history` is capped (keep the most recent ~100 entries around the active index), per-pane `tabs` and per-session panes are capped, the session count is capped, and `url` / `title` lengths are capped — overflow is truncated (history oldest-first) or dropped.
- A session whose `panes` is empty after repair is **dropped** (a session must keep ≥1 pane — mirrors `applyRemovePane`'s floor).

---

## 3. Storage & Durability

### 3.1 Where it lives

A **Rust-owned durable file**: `app_data_dir/workspace-layouts.json` — the Phase-D "D2 sibling store" #290 designed but did not build. It is **never wiped by `SessionCache::clear_all`** (unlike `sessions.json`), so it survives a graceful quit. It is written atomically (`tempfile.persist`) with an in-memory `Mutex` mirror, mirroring `crates/backend/src/terminal/cache.rs` mechanics. Rust owns the file; the renderer never reads/writes it directly (it goes through IPC) — consistent with "filesystem cache for Rust-owned state, not localStorage."

### 3.2 Data flow & ownership

**Electron main is the single assembler and sole writer** — this removes any Rust-side merge race between independent producers.

- **Renderer → main: shape only.** The renderer owns the React session tree and pushes a **shape-only DTO** to main: sessions, layout, and each pane's `kind` + `paneId` + `paneIndex` + `active`, plus (for shell panes) `ptyId` / `cwd` / `agentType` / `agentSessionId` (the renderer holds the live `ptyId` in React state — it is the restore match key). It carries **no** browser tabs/urls/history. Structural changes (open/close pane, layout, activation) push eagerly; `cwd` (OSC 7 drift) and `agentType` (runtime detection) push debounced.
- **Electron main: assembler + sole writer.** Main holds the latest shape DTO and owns the browser `WebContents` (hence all tab state — existence, active tab, urls, history via `navigationHistory.getAllEntries()` / `getActiveIndex()`). It assembles the **complete** `WorkspaceLayoutStore` (shape ⨝ its own browser tab/history, joined by `(sessionId, paneId)`) and writes it to Rust as **one atomic snapshot**. Write cadence: a **structural** change — pane/layout/active **and** browser tab open/close/active-tab switch — writes **immediately (awaited)** so coarse user actions are durable even across a crash; a browser **navigation** (url change within a tab) or shell `cwd`/`agentType` drift writes **debounced**; window close does a final flush (below). One writer assembling both halves together → no out-of-order _merge_ to reconcile. **Writes are also serialized** so the three cadences can't race: each assembled snapshot carries a monotonic generation and goes through a single in-order write queue — a snapshot older than the last committed is dropped (last-write-wins by generation); the close flush **drains/cancels** any pending debounced write and commits the final snapshot last.
- **Rust: durable file owner.** Receives the assembled store from main, writes `workspace-layouts.json` atomically; returns it on load.

**Tab join.** Within main's assembly a browser pane's `tabs[]` (the full array — each tab's `history` + `historyIndex` + `active`) is attached to its pane by `(sessionId, paneId)` and written wholesale (no per-tab id; the whole array is replaced each snapshot). Because the shape DTO declares which panes exist and main fills their tab contents in the **same** assembly pass, there is no cross-process join to reconcile — a closed pane is simply absent from the next snapshot.

**Restore (renderer-initiated; main-owned browser-pane creation).** Restore is kicked off by the renderer once mounted (it owns active-project state): it calls the load command with the active `projectId` + `workingDirectory`. Rust loads the file and **repairs it with that context** (§2.2), returning a strict, repaired store to main. Main sends the **shape** to the renderer (which builds React state — shape-only, no history; extends `groupSessionsFromInfos`). The renderer then **triggers** each browser pane via `createBrowserPane({ sessionId, paneId, workspaceId: session.projectId, restore: true })`. `BrowserPaneCreateRequest` becomes discriminated: `restore: true` **omits `initialUrl`** (main loads via history instead); a fresh create still requires `initialUrl`. The partition key (`workspaceId`+`sessionId`) derives identically either way. **Main owns the rest** — for each persisted tab it creates a `WebContentsView`, mints a **fresh runtime tab id** (the persisted model has no tab id — ids are runtime, minted on restore), fetches that pane's repaired `tabs` from the **in-memory loaded store** by `(sessionId, paneId)` (`load` returns the whole store — no per-pane fetch IPC), and **before any initial load** calls `navigationHistory.restore({ index, entries })` **instead of** `loadURL` (restore navigates to the active entry; Electron requires restore-before-load), then marks the persisted-active tab active and seeds the pane's `nextTabIndex`. On a **fresh** create (`restore` absent, §6.2) main does the normal `loadURL(initialUrl)`. History is main↔Rust on both write and restore — it **never** transits the renderer, which never calls `navigationHistory.*`.

**Reload reconnect (`Cmd+R`).** On a renderer reload, main's `WebContentsView`s for `(sessionId, paneId)` may still be alive (they are main-process and survive a renderer reload). Restore then **reconnects** to the existing view — rebinding it to the rebuilt pane, keeping its **live** (fresher-than-file) tab state, and **skipping** `navigationHistory.restore` (which would clobber live state with the last saved snapshot). Main creates a new `WebContentsView` + restores history **only** when no live view exists for that key (cold restore / graceful-quit). **This requires the renderer-lifecycle cleanup to NOT dispose browser views (or their owner records) on a renderer reload/crash** — they must survive for reconnect; today's cleanup that removes owner records on renderer failure must be scoped to genuine app teardown, not renderer reload (else renderer-crash restore would fall back to stale file state and lose live tab history — the matrix's "sidecar alive" row depends on this).

**Restore hydration guard.** Main holds the loaded repaired store in memory and **suppresses all persistence writes until restore completes** (every `restore: true` pane created + its history restored). Restore-time shape pushes from the renderer do **not** trigger a write — otherwise the immediate-structural-write cadence would assemble **empty** browser tabs (the `WebContents` don't exist yet) and overwrite the repaired store _before_ history is restored, erasing exactly what this feature preserves. **Restore trigger (renderer side).** A transient restore-pending set of `(sessionId, paneId)` keys (not persisted; held by the restore orchestrator) tells `BrowserPane`'s mount-time create effect to issue `createBrowserPane({ restore: true })` exactly once instead of the fresh-create call (§6.2); the key is removed after creation, so a later remount issues a normal create. This keeps the runtime `Pane` shape unchanged (§2.1) and avoids a double/racing create.

Each pane's restore tabs are served from that in-memory store. Restore is **per-pane best-effort**, and **distinguishes a malformed payload from a load failure**: a malformed/invalid restore payload falls back to a default load, but a **load failure** (`did-fail-load` — offline / TLS / transient) **preserves** the restored URL + history (the tab shows an error/retry, not a reset) and **suppresses the durable overwrite for that pane** until the user acts — so a transient network failure can never erase saved history. Either way, one pane's failure is caught/logged and does not block the others. Hydration completes once every restore-pane creation has **settled** — resolved, rejected, **or hit a per-pane timeout** (a restore that neither resolves nor rejects is treated as timed-out → fallback) — so the guard always clears; a stuck restore can never suppress writes forever. Then the normal write cadence (§3.2 above) resumes.

**Durability flush (the correctness guarantee).** Per-change writes are debounced — an optimization. Correctness comes from an **awaited flush on the main window's `close` event**, which fires before the window + its `WebContents` are destroyed on **every** platform — covering both macOS (where the window survives and quit comes via `before-quit`) and the non-Darwin `window-all-closed → app.quit()` path (`electron/main.ts:396`), where the renderer is already gone by `before-quit`. A **`flushedOnce` guard scoped to one teardown transaction** coordinates both entry points (window `close` and `before-quit`): the **first** to fire runs the flush and sets the flag; the other **skips persistence** (so a `before-quit` firing after a non-Darwin `close → window-all-closed → app.quit()` cannot overwrite the good snapshot with disposed/empty browser state). The guard is **reset when the app keeps running after a non-quit close or a new browser-hosting window opens** (e.g. macOS, where closing a window does not quit) — it is **not** module-lifetime, so every subsequent teardown flushes. The flushing path uses `event.preventDefault()` + re-issue (`win.close()`/`win.destroy()`) so teardown proceeds after the awaited write — no prevent/flush loop. During the flush: main **requests a final shape push from the renderer and awaits the ack with a bounded timeout (~1s)** (draining any pending debounced `cwd`/`agentType`) — on timeout (an unresponsive or crashed renderer) it proceeds with main's last-known shape rather than hanging quit — captures fresh live browser history, assembles, and awaits the Rust write **before** the views and sidecar are disposed (`sidecar.shutdown()` `clear_all`s `sessions.json` but never `workspace-layouts.json`). Whichever path runs the flush does so **before `browserPaneController` disposal** (capturing live history before any view is destroyed); the existing `before-quit` handler is reordered to consult `flushedOnce` and run-or-skip the flush ahead of its disposal step. So **graceful quit / window-close are exact in the normal case** (the rare renderer-ack timeout falls back to last-known shape — see the matrix); only an abrupt crash (no `close` event) falls back to the last debounced write (≤ one debounce-interval lost).

**IPC surface (single-writer model):**

- **Renderer ↔ main** — Electron preload IPC (alongside the existing browser-pane channels), **not** the Rust `backend-methods.ts` allowlist: the renderer's shape-DTO push, and on restore main → renderer shape delivery + browser-pane creation.
- **Main ↔ Rust** — sidecar IPC invoked by Electron **main** (wired `mod.rs` + `runtime/state.rs` + `runtime/ipc.rs`, but **not** `electron/backend-methods.ts`, which is the renderer→Rust allowlist): `workspace-layouts.json` save / load.
- **Main ↔ `WebContents`** — `navigationHistory` capture/restore, pure main.
- The main→renderer `tabs-changed` UI event is unchanged and stays history-free.

### 3.3 Durability matrix

| Path                                                  | `sessions.json` (live PTY cache)                        | `workspace-layouts.json` (this store) | Result                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reload / `Cmd+R` / renderer crash (**sidecar alive**) | intact → reattach live PTYs                             | intact → reconcile shape              | shells **reattach** (agents keep running); browser panes **reconnect** to the still-live views (live tab state wins)                                                                                                                                                               |
| App / sidecar crash (**PTYs die**)                    | intact (crash skips `clear_all`) but PTY processes dead | **survives**                          | shells → **restartable placeholders** (cwd + agent badge); browser tabs + history restored **up to the last completed write** (no `close` flush on a crash, so ≤ one debounce-interval of recent navigation / cwd / agent drift may be lost; structural changes write immediately) |
| **Graceful quit**                                     | wiped (`clear_all`, by design)                          | **survives**                          | shells → **restartable placeholders**; browser tabs + history **exact** in the normal case (window-close flush; only a rare unresponsive-renderer ack-timeout could be slightly stale)                                                                                             |

The two stores **coexist**: `sessions.json` remains the live-reattach path (reload, agents keep running); `workspace-layouts.json` is the durable shape (survives quit). On reload, a pane present in both prefers the live PTY (reattach); the durable store seeds anything the live cache no longer has.

### 3.4 Migration

The legacy localStorage cache (`vimeflow:browser-panes:v1`) is retired. **If this feature ships in the same release as — or before — browser panes reach users** (the expected case; neither is in `main` today), there is no released data to migrate: the read/write code and key are removed outright, and a stale dev-build entry is ignored. **If `feat/browser-pane-redesign` reaches users first** (§7 sequencing), add a one-time **read-migrate**: the **renderer** reads `vimeflow:browser-panes:v1` (its own localStorage — the single, one-time exception to the shape-only-renderer rule, since main cannot read renderer localStorage) and sends a migration payload to main, which folds it into the store; only **then** is the key cleared. Caveat: cookie/login (**partition**) continuity is **not** preserved across the `browserSessionId → session.id` key change — migrated panes may need a one-time re-login. This affects only that unlikely path; in the expected case (shipped together) there is no migration and partitions are continuous from the start. Either way, all new persistence goes to the unified store.

---

## 4. Re-selectable browser-only sessions

The gap: `setActiveSessionId` (`useActiveSessionController.ts:48-51`) resolves the backend pane via `findBackendSessionPane` and **returns before updating React state** when that is `undefined`. For a browser-only session it is always `undefined` (no shell pane), so the tab cannot be activated.

**Fix — resolve a _live_ backend pane, not any shell pane:**

- **A live shell PTY is available** (the active pane is a shell with a live PTY — `status` `running` or `paused`, an idle-but-live PTY — or the session has another such shell) → unchanged: bump the request generation, set React active state, then `service.setActiveSession(ptyId)` (existing IPC-failure rollback, lines 60-73, untouched).
- **No live shell PTY** — a browser-only session, **or** a session whose shells are all restartable placeholders (dead PTYs from a graceful-quit restore) → **bump `activeRequestIdRef`** (so any in-flight prior `setActiveSession` rollback is superseded — `myReq !== activeRequestIdRef.current` — and cannot revert this selection), set React active state, **skip** the PTY IPC, and if the active pane is a browser pane, `focusBrowserPane({ sessionId: session.id, paneId })`.

Key correction vs a naive "any shell pane" check: `findBackendSessionPane`'s `?? shellPanes[0]` fallback can return a **non-running** (placeholder) shell; issuing `setActiveSession` with its stale ptyId would be rejected by the backend, and the rollback would revert React active state. So the resolver **searches all shell panes** for one with a live PTY (`status` `running` or `paused` — not `completed` / `errored`) rather than trusting `findBackendSessionPane`'s `?? shellPanes[0]` fallback (which can return a placeholder while a later shell is live); it issues `setActiveSession` only when such a live shell is found, otherwise taking the skip-IPC branch above. The early-return collapses to "no session found." `removePane`'s active-reselection tail (`useSessionManager.ts:1370-1392`) is already consistent (it no-ops `setActiveSession` when no live shell remains).

---

## 5. Restore reconstruction

Today restore is PTY-driven: `useSessionRestore` builds base sessions from `listSessions()`, then `restoreStoredBrowserPanes` (localStorage) **attaches** browser panes onto PTY-backed sessions — so any session with no live shell PTY (browser-only, **or any session at all after a graceful quit**, which wipes `sessions.json`) is dropped.

**Inversion: the durable store is the authoritative shape; live PTYs are an overlay.** The store holds every session's full pane list (shells + browsers), so reconstruction iterates the **store**, not the PTY list:

1. **The store arrives decoded + repaired** (§2.2 runs in **Rust on load**: lenient decode → strict, repaired — clamp indices, seed empty `tabs`/`history`, validate `NavEntry.url`s, dedupe ids, drop unrepairable records). Every later step consumes the repaired store, so no invalid seed ever reaches `createBrowserPane` / `navigationHistory.restore`.
2. **For each repaired `WorkspaceSession`**, rebuild its panes in `paneIndex` order:
   - **Shell pane** → match its `ptyId` against `listSessions()`. **Alive** (reload) → reattach via the existing replay protocol (agent keeps running). **Absent / Exited** (graceful quit, or a crashed PTY) → a **restartable placeholder** seeded with `cwd` + `agentType` + `agentSessionId` (the existing `completed`/Restart UX respawns a bare shell in `cwd`). **Placeholder restart skips the stale-PTY kill:** the seeded `ptyId` no longer exists (`clear_all` / crash removed it), so the restart path spawns fresh and **treats the absent old PTY as success** — the current spawn-then-kill restart (which treats kill failure as fatal) must no-op the kill when the seed PTY is already gone.
   - **Browser pane** → **main-owned restore creation** (§3.2): the renderer triggers `createBrowserPane({ sessionId, paneId, workspaceId: session.projectId, restore: true })` (no history in the request); main creates the `WebContents`, fetches the repaired `tabs` from the in-memory loaded store by `(sessionId, paneId)`, and `navigationHistory.restore`s **before any load** (skipping the default `loadURL` — Electron requires restore-before-load; avoids an extra default history entry).
3. **Activation:** the persisted `active` session is selected via the browser-capable `setActiveSessionId` (§4).

This uniformly handles **shell-only**, **mixed**, and **browser-only** sessions on **both** reload and graceful quit — the store always supplies the shape; PTY liveness only decides reattach-vs-placeholder. Browser-only sessions are no longer a special "synthesis" case — they are simply sessions whose panes all happen to be `kind:'browser'`.

**Restored session status.** A session with any browser pane **or** any live (`running`/`paused`) shell is `running`; a session with only placeholder (`completed`/`exited`) shells and no browser is `completed` (its panes show Restart). This **requires changing `deriveShellSessionStatus`** (or adding a session-status derivation): today it returns `running` for a browser-only pane set, but when **any** shell exists it derives from shells alone — so `[completed-placeholder shell, running browser]` would wrongly read `completed`. The fix: a live browser pane keeps the session `running` regardless of placeholder shells.

**Live PTYs are never dropped.** The store and the live PTY set are a **union keyed by `ptyId`**: (a) if the store is absent or discarded (unknown `version` / corrupt), reconstruction falls back to #290's PTY-driven `groupSessionsFromInfos` (shells reattach; browser panes are simply absent — they only ever lived in the store); (b) when the store is present, any live PTY in `listSessions()` the store doesn't reference is still reconstructed #290-style (a single-pane session), so a session created since the last store write is never lost.

This **subsumes** #290's PTY-driven `groupSessionsFromInfos` for _shape_: on a reload where both the store and a live `sessions.json` grouping describe the same workspace, the store wins for shape and live PTYs reattach by `ptyId`. The legacy `restoreStoredBrowserPanes` / `readStoredBrowserPanes` / `storedBrowserPanesForSessions` and the localStorage key are deleted (§3.4); `useSessionRestore`'s `onRestore` consumes this store-driven reconstruction instead of "PTY list + localStorage attach."

---

## 6. Reaching & creating browser-only sessions

### 6.1 By closing the last shell (foundation — already committed)

`canClosePane` (`SplitView.tsx`) and `removePane` (`useSessionManager.ts`) no longer gate on shell count (the two foundation commits on this branch); a pane is closable whenever the session keeps ≥1 pane. Closing the last shell of `[shell, browser]` leaves a browser-only session: `applyRemovePane` reselects the browser as active, and the browser-capable `setActiveSessionId` (§4) keeps it selectable; the unified store (§3) persists it across reload + quit.

### 6.2 From scratch (new)

A browser-only session is created with one browser pane and **no** shell PTY:

- **Entry point.** A command-palette command (e.g. `:new-browser`) is the primary, chrome-agnostic entry. The icon-rail / tab-bar chrome is under a separate design pass (`IconRail` is held), so this spec adds **no** tab-bar buttons; a tab-bar affordance can follow once that design lands.
- **Create flow.** A `createBrowserSession()` variant of `createSession` builds a runtime `Session` with `layout:'single'`, `projectId` + `workingDirectory` from the active project (the baseline cwd for any shell added later via `addPane`), and one **runtime** browser `Pane`: `{ kind:'browser', id:'p0', ptyId:'browser:<uuid>', cwd: workingDirectory, agentType:'generic', status:'running', active:true }` — note this is the runtime `Pane` shape (no `paneIndex`, which is added only at serialize time), the `browser:<uuid>` is a pseudo-handle, and there is **no** `browserSessionId` (derived as `session.id`) and crucially **no `service.spawn`** (no PTY). `createBrowserPane({ sessionId: session.id, paneId:'p0', workspaceId: session.projectId, initialUrl: DEFAULT_BROWSER_URL })` makes the `WebContents`; main's first tab snapshot (one tab at `DEFAULT_BROWSER_URL`) flows into the store on the next assembly.
- A later `addPane(sessionId, 'shell')` adds a real shell to a browser-only session normally (it spawns a PTY; the session is then no longer browser-only).

---

## 7. Dependencies & sequencing

This feature extends, and therefore **depends on**, two streams not yet in `main`:

- **#290 (`dev/session-restore-multipane`)** — the backend grouping infra it builds on: `usePushWorkspaceGrouping`, `groupSessionsFromInfos`, the Rust grouping commands, and the `WorkspaceSessionSnapshot` / `WorkspacePaneSnapshot` / `PaneGrouping` / `SessionInfo` types this spec extends with `kind` + browser fields. #290 is merged into `dev/session-restore-multipane` (= `main + 1`), **not `main`**. _Integration note:_ the single-writer model (§3.2) reroutes the shape push from #290's renderer→Rust (`usePushWorkspaceGrouping`) to **renderer→main** — main becomes the sole Rust writer, folding #290's grouping write into its assembly. That is the principal integration touch-point.
- **`feat/browser-pane-redesign`** (browser panes L1–L3) — the browser pane runtime this persists. Also not in `main`.

**Recommended sequencing** (execution-timing is the user's call; it does not change the design):

1. Land **#290 → `main`** (complete + codex-reviewed). This feature extends its types/commands directly, so having it in `main` is the cleanest base.
2. Land **`feat/browser-pane-redesign` → `main`** (the browser-pane bundle). **Migration gate:** if (2) reaches users _before_ this feature, the §3.4 localStorage read-migrate is **required** before the `vimeflow:browser-panes:v1` key is deleted; if they ship together, no migration is needed.
3. Build this feature on a `main` that has both — or, to start sooner, on an integration branch merging both, accepting the merge-management cost.

Until (1)/(2) land, this branch (`feat/browser-only-sessions`) carries only the **foundation** (the two guard-relaxation commits + tests). The durable-store + reconstruction work should not be implemented against a base lacking #290's grouping, or it will be rewritten on merge.

---

## 8. Test plan

TDD, ≥80% coverage, tests co-located (sibling `.test.ts(x)`), explicit `import { test, expect } from 'vitest'`.

**Rust (`crates/backend`):**

- `WorkspaceLayoutStore` serde round-trip: shell + browser + browser-only; `#[serde(tag="kind")]` union; optional/`default` fields; `version`.
- Atomic write/read of `workspace-layouts.json`; load-missing → default/empty; unknown `version` → discarded, fresh.
- `clear_all` wipes `sessions.json` but **leaves `workspace-layouts.json` intact** (the durability invariant).

**Restore reconstruction (Rust repairs on load; renderer builds shape — `groupSessionsFromInfos`, extended):**

- shell-only (existing behavior preserved); mixed shell+browser; **browser-only** (no PTY → session built from the store); a live PTY absent from the store still reconstructs #290-style (never dropped); store absent/discarded → pure PTY-driven fallback.
- **Repair (§2.2 — Rust, on load; returns strict):** empty `tabs` seeded; empty `history` seeded; `historyIndex` clamped; multiple/zero active tab → one; multiple/zero active pane → one; ≤1 active session (else first); duplicate `WorkspaceSession.id` / `paneId` deduped; pane-count > layout capacity → layout widened; `paneIndex` re-indexed; invalid `NavEntry.url` dropped; empty-after-repair session dropped.

**`setActiveSessionId` (`useActiveSessionController`):**

- shell session → unchanged (`setActiveSession(ptyId)`); browser-only → React active set + `focusBrowserPane`, **no** PTY IPC; missing session → early return.

**Create / close:**

- `createBrowserSession()` → browser-only session, **no `service.spawn`**, `createBrowserPane` invoked.
- close-last-shell → browser-only (foundation tests already green: `SplitView.test.tsx` `canClosePane`; `useSessionManager.test.ts` "removePane closes the last shell pane when a browser pane remains").

**Electron main (`browser-pane.test.ts`):**

- the **main→backend persistence push** carries each pane's whole `tabs[]` with `history` + `historyIndex` (the main→renderer `tabs-changed` UI event stays history-free); `navigationHistory.restore({ index, entries })` called on create with a seed (incl. `null`-title → `''` coercion); the **window `close` handler** awaits the durable flush **before** browser-view disposal and `sidecar.shutdown()` (history captured while `WebContents` are alive), including the non-Darwin `window-all-closed` path.

**Round-trip integration:**

- push → write → reload → reconstruct: browser tabs + history survive; browser-only session survives; on graceful quit a shell pane returns as a restartable placeholder (not auto-running).
- legacy `vimeflow:browser-panes:v1` removed/ignored.

<!-- codex-reviewed: 2026-06-06T16:18:35Z -->
