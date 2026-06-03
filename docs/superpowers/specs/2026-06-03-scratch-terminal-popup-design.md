# Scratch Terminal Popup — Design Spec

> **Status:** DRAFT — per-section codex iteration in progress.
> **Tracking:** Linear VIM-53.
> **Visual contract:** `docs/design/scratch-terminal-popup/scratch-terminal-handoff/` (`SCRATCH-TERMINAL-HANDOFF.md` authoritative for layout/states; `Scratch Terminal Popup.html` the approved mockup).

## 1. Summary

An ephemeral, throwaway **scratch terminal** that opens as a centered popup over the workspace — same overlay family as the command palette — so a user can run ad-hoc commands (`npm run dev`, file search, package installs) **without** hijacking a pane's agent PTY and **without** consuming one of the ≤4 layout slots. One scratch shell per pane (≤4), shown one at a time (the focused pane's). Hide ≠ kill; cwd-isolated; never persisted; toggled by the chord `Mod+;` (Ctrl/Cmd+;) then `` ` ``.

Delivered as the 3 stacked PRs from VIM-53:

- **PR1** — per-session scratch popup (one shell for the session).
- **PR2** — one scratch shell per pane (≤4), per-pane keying + cwd inheritance.
- **PR3** — pane-bound lifecycle (scratch dies with its host pane; reconcile self-exit).

The backend persistence change (§3) is the **first commit of PR1** — the UI cannot be non-persisting without it.

## 2. Non-negotiable invariants

1. A scratch shell is a **separate PTY** associated with a pane but **never a `Pane`** in `Session.panes` — so it never consumes layout capacity (`SplitView/layouts.ts`) and never enters the frontend session graph.
2. Spawned with `ephemeral: true` (§3) **and** `enableAgentBridge: false` — no `sessions.json` entry, no `.vimeflow/sessions/<uuid>/` bridge dir.
3. **Never persisted, reaped on reload** — absent from `sessions.json`/`session_order`; the sidecar tracks ephemeral ptyIds in memory and reaps them on renderer boot (§3.4), so a scratch shell never returns as a ghost tab and is reaped after a renderer reload or graceful quit. (A hard _sidecar_ crash loses the in-memory set and can orphan a scratch child exactly as it already orphans a normal pane shell — see §3.4; this feature does not make it worse.)
4. **Hide ≠ kill** — dismissing the popup hides it; the PTY and its child processes keep running (until the host pane closes, or a renderer reload reaps it per §3.4).
5. **cwd isolated** — inherits the host pane's `cwd` on first open; `cd` inside never calls `updatePaneCwd`, so pane/session cwd is untouched.
6. Each scratch shell has its **own ptyId**, distinct from the host pane's main-shell ptyId (the `terminalCache` at `Body.tsx:86` is 1:1 per ptyId).

## 3. Backend: non-persisting scratch PTY

> **Decision under codex verification.** Chosen approach: Option A (an `ephemeral` flag on the existing `spawn_pty`). Verify the claim and the completeness of the "nothing else re-persists" argument against the real backend before we build PR1 on it.

### 3.1 Problem

`spawn_pty_inner` writes the session cache **unconditionally** at `crates/backend/src/terminal/commands.rs:382-410`: a `cache.mutate(...)` closure inserts a `CachedSession` and pushes the id onto `session_order`. `SessionCache::mutate` flushes `sessions.json` to disk synchronously under the same lock (`cache.rs:146-188`, flush at `:212-225`). The cache is keyed by **ptyId** (the wire `sessionId`). On launch, `list_sessions` rebuilds the frontend session list from this cache, so any spawned PTY reappears as a tab (Alive → re-attach, Exited → "Restart" affordance). There is **no existing flag** to skip the write. A scratch PTY spawned the normal way would therefore survive into `session_order` and return as a **ghost "Restart" tab** on next launch — and graceful-exit cache clearing cannot be relied upon (SIGKILL / OOM / crash skip it; the shutdown-hook trap).

### 3.2 Decision (Option A)

Add `ephemeral: bool` (`#[serde(default)]`, default `false`) to `SpawnPtyRequest` (`crates/backend/src/terminal/types.rs`) and the matching optional `ephemeral?: boolean` to `PTYSpawnParams` (`src/features/terminal/types/index.ts`), defaulted in `DesktopTerminalService.spawn`. When `ephemeral == true`, `spawn_pty_inner` **skips the `cache.mutate` block** (`commands.rs:381-410`) in its entirety. `ephemeral` is additionally a **backend-enforced no-bridge**: it also skips the bridge-file generation (`commands.rs:169-199`) _regardless of_ `enableAgentBridge`, so invariant 2's "no `.vimeflow/sessions/<uuid>/` dir" holds even if a caller passes `enableAgentBridge: true` (scratch callers still pass `false` for clarity, but the backend no longer depends on caller discipline). Everything else is unchanged: PTY creation, the background read loop, the per-session `RingBuffer`, and `write_pty` / `resize_pty` / `kill_pty`.

This is the minimal change that closes the leak exactly where it originates, with no new _spawn_ path and no parallel PTY registry. It does add one small reap IPC for renderer-reload orphans (§3.4).

### 3.3 Why nothing else re-persists an ephemeral PTY

- **`kill_pty_inner`** (`commands.rs:529`) _removes_ the id from the cache + `session_order` → a no-op when the id was never inserted.
- **`read_pty_output` EOF** (`commands.rs:825`) sets `exited=true` on the cached entry → a no-op when the entry is absent.
- **`update_session_cwd` / `set_active_session` / `reorder_sessions`** (`commands.rs:777 / 696 / 729`) are only invoked by the frontend for real `Session`s / `Pane`s. A scratch shell is never a `Pane` (invariant 1, §4), so the frontend never calls these for its ptyId.
- **`list_sessions`** (`commands.rs:590-662`) iterates the cache; an ephemeral PTY is absent → never surfaced as a tab, never counted in tab order or active-session rotation.
- **`set_session_activity_panel_collapsed`** (`commands.rs:790`) mutates an existing entry's `activity_panel_collapsed` field → a no-op when absent, and only ever called for a real session.

These are the complete set of `sessions.json` mutators (verified against `commands.rs` + `cache.rs`): `clear_all` only wipes the whole cache, and none of the mutators _reinserts_ an absent id — so an ephemeral PTY that was never inserted stays absent for its entire life.

### 3.4 Reaping on renderer reload (no orphaned children)

Skipping the cache write keeps the PTY out of `sessions.json`, but the live PTY still sits in the sidecar's `PtyState`, and the **Rust sidecar survives a renderer reload** (Cmd+R, a renderer crash, or a dev HMR full reload) — only the renderer restarts. After such a reload the frontend's in-memory scratch map is gone and `list_sessions` cannot resurface the PTY (it is absent from the cache), so without reaping it becomes an **invisible, unkillable live child** (e.g. an orphaned `npm run dev`) until the sidecar exits.

Mitigation has two layers, because **nothing currently kills PTY children on shutdown** — `BackendState::shutdown()` (`state.rs:76-80`) only clears the cache, and portable_pty's `Child::Drop` does not kill the process (`commands.rs:360-363`); children are reaped only on explicit `kill_pty` or spawn-failure rollback. So normal pane shells already orphan on a hard quit, and ephemeral scratch shells would too. We add:

- **An in-memory ephemeral set in `PtyState`**, populated at spawn — never persisted; its lifetime is exactly the sidecar process.
- **Authoritative reap-on-boot.** On renderer boot/reconcile the frontend calls a backend reap (`kill_ephemeral_ptys`) that kills every PTY in that set, then **scratch spawning is gated until that reap resolves** (so a freshly-spawned scratch can't be caught by its own boot reap). Because the sidecar (and the set) outlive a renderer reload/crash, this catches reload-orphans without any exit hook — it is the load-bearing guarantee for the common case (renderer reload, dev HMR, renderer crash; the sidecar stays alive).
- **Best-effort shutdown kill.** Extend `BackendState::shutdown()` to also kill the ephemeral set on the graceful `shutdown` frame, so a clean quit doesn't leave a stray `npm run dev` reparented to init between sessions. (Best-effort only — a SIGKILLed sidecar skips it, which is why reap-on-boot is the authoritative layer.)
- Cost: one small reap IPC (`mod.rs` inner + `state.rs` method + `ipc.rs` arm + `electron/backend-methods.ts` allowlist) + the `shutdown()` extension — neither touches the spawn/read/write/kill machinery. Lands with the backend slice in PR1.

**Residual gap (accepted).** If the _sidecar itself_ is SIGKILLed or crashes, the in-memory set dies with it and a still-running scratch child is reparented to init with no record for the next boot to reap — identical to how a normal pane shell already orphans on sidecar death. A crash-safe reap (persisting ephemeral PIDs for next-boot cleanup, or a process-group kill) is a broader backend concern, out of scope here.

### 3.5 Test (gates the decision)

Rust test in `crates/backend/src/terminal/` (sibling to existing PTY tests):

- **ephemeral spawn does not persist** — spawn with `ephemeral: true`; assert the cache data has **no entry** for the id, `session_order` **excludes** it, and `list_sessions` **does not** return it; assert the PTY is still live (write succeeds, read sees output).
- **default still persists** — spawn with `ephemeral: false` (the default); assert the entry **is** present (regression guard so the gating change never silently disables normal persistence).
- **ephemeral forces no bridge** — spawn with `ephemeral: true, enableAgentBridge: true`; assert **no** `.vimeflow/sessions/<id>/` directory is created (the backend-enforced no-bridge of §3.2, independent of the caller's `enableAgentBridge`).

### 3.6 Rejected alternative

**Option B — separate `spawn_scratch_pty` IPC + non-cached registry.** Achieves the same exclusion at far higher surface: the new-IPC 4-file checklist (`mod.rs` / `state.rs` / `ipc.rs` / `electron/backend-methods.ts`), duplicated or refactored spawn/read/write/kill plumbing, and two PTY registries to reconcile (which map owns a given ptyId). A scratch PTY is byte-identical to a normal PTY except for persistence, so a parallel code path is redundant.

---

## 4. Frontend state ownership — `useScratchTerminals`

All scratch state lives in a dedicated hook, `useScratchTerminals`, mounted once in `WorkspaceView.tsx` (the same level as `usePaneRenameChord`'s `paneRenameNode`). It owns a **ref-backed** map keyed by a stable pane identity (`${sessionId}:${paneId}` — §6, since the host `ptyId` rotates on restart):

```ts
type ScratchEntry = {
  scratchPtyId: string // own UUID, distinct from the host pane's ptyId
  pid: number
  status: 'running' | 'exited'
  cwd: string // the cwd it was spawned at (host pane's cwd at first open)
}
// keyed by a STABLE pane identity, NOT the host ptyId (which rotates on restart — §6):
// scratchByPaneRef = useRef<Map<string /* `${sessionId}:${paneId}` */, ScratchEntry>>(new Map())
```

The hook returns `{ renderNode, toggle, runningByPane }`:

- `renderNode` — the popup overlay **plus** the mounted (hidden when dismissed) scratch terminals; non-null whenever any **active-session** scratch shell is alive or the popup is open (§5). Mounted in `WorkspaceView` like `paneRenameNode`.
- `toggle(target?: { sessionId: string; paneId: string })` — show/hide the popup for `target`, defaulting to the focused pane when omitted. The chord omits it; the pane-header button passes its **own** pane's identity, which may not be the focused pane (§8).
- `runningByPane: ReadonlyMap<string /* `${sessionId}:${paneId}` */, ScratchStatus>` — drives the live-but-hidden cues (§8) and the pane-switcher pills (§6).

**The hook owns the PTY lifecycle.** It spawns each scratch shell itself — `service.spawn({ cwd, ephemeral: true, enableAgentBridge: false })`, capturing the returned `scratchPtyId` — and kills it via `service.kill({ sessionId: scratchPtyId })` on teardown (§9). It does **not** delegate spawning to the terminal `<Body>`: `<Body>`'s `spawn` mode neither passes `ephemeral` nor matches our hide≠kill lifetime (it disposes its xterm and would kill on unmount — `Body.tsx:909-913`). `<Body>` is used in **`attach` mode only** (§5).

**Teardown = lazy reconciliation, not a `removePane` callback.** Because scratch ids live only in this hook (never on `Pane`/`Session`), the hook receives the live session/pane list and, in an effect, kills + drops (`service.kill` + `dropAllForPty`) any scratch entry whose `${sessionId}:${paneId}` key no longer maps to a live pane. This fires synchronously when `removePane`/`removeSession` mutate the list (so close is effectively immediate) and self-heals without a shutdown hook — covering pane close, session close, and a self-exited child (whose entry flips to `exited` and is dropped on the next reconcile). No `useSessionManager` coupling.

**Why a ref, not `useState` / the `Pane` model:**

- It must **never serialize**. Shell panes persist only via Rust IPC side-effects (no localStorage for shell panes), and the browser-pane localStorage writer is an explicit allow-list — so scratch state in a `useRef` is leak-free by construction (mirrors `restoreDataRef`, documented "not persisted across reload").
- Putting `scratchPtyId` on `Pane` would (a) risk consuming layout capacity (the `addPane` guard counts `Session.panes`) and (b) entangle it with pane serialization. Off-band keying sidesteps both.
- A render-affecting projection (which hosts have a running scratch shell) is mirrored into a small `useState` so the cues/pills re-render; the authoritative handles stay in the ref.

Visibility — which host the popup currently shows, and open/closed — is component state in the popup, seeded by `toggle`.

## 5. Popup rendering — `attach` mode + keep-mounted

The popup renders the **existing terminal `<Body>` in `attach` mode** against the focused pane's `scratchPtyId` — it does not reimplement xterm, and it does **not** use `<Body>`'s `spawn` mode (the hook owns spawn/kill, §4). This reuses, for free:

- the module-level `terminalCache` (1:1 per ptyId, `Body.tsx:86`) — each scratch shell's own ptyId gets its own xterm, no collision with the host pane's main shell;
- the N-subscriber service (`desktopTerminalService` keeps callback arrays; each `onData` filters by `sessionId`), so a popup terminal can attach to any ptyId;
- the **offset-cursor** stream — live `pty-data` events carry `offsetStart`/`byteLen`; the consumer advances by raw bytes and dedupes (`offsetStart >= cursor`).

**Attach needs a snapshot, and the spawn→attach gap must not drop output.** `attach` mode requires `restoredFrom` (`useTerminal.ts:313-317`), normally sourced from `list_sessions` — which a §3 ephemeral PTY is deliberately absent from. A freshly-spawned scratch shell has no prior history, so it attaches with an **empty snapshot** (`replayData: ''`, `replayEndOffset: 0`) — but the shell emits its prompt / rc output between `service.spawn()` returning and `<Body>` subscribing, and that gap has no `list_sessions` replay source. The hook must therefore own buffering across the gap, reusing the cursor-deduped drain rather than inventing one:

1. ensure a `pty-data` producer feeds `bufferEvent` for the new id — **the existing `usePtyBufferDrain` buffer only captures ids its `service.onData` producer is wired to, and that producer is private to the session/restore flow**, so the hook must either confirm that producer is global to _all_ ptyIds or attach its **own** `service.onData → bufferEvent` listener for the `scratchPtyId` before/at spawn;
2. `registerPending(scratchPtyId)` immediately after spawn;
3. pass **`notifyPaneReady`** as the scratch terminal's `onPaneReady` to replay the buffer through the same `offsetStart`-deduped handler on attach;
4. `dropAllForPty(scratchPtyId)` on kill.

**Build-time check:** verify whether the shared `bufferEvent` producer is global before relying on it; otherwise add the scratch-owned listener.

**Hide ≠ unmount — the load-bearing lifecycle decision.** `<Body>` **disposes its xterm and deletes its `terminalCache` entry on unmount** (`Body.tsx:909-913`: "when Body unmounts, the session is closed — free resources"). Combined with the no-`list_sessions`-snapshot fact above, hiding via unmount would lose all scrollback (and any output produced while detached) with no way to replay it. So the popup **keeps each scratch `<Body>` mounted for its shell's whole life** and toggles **CSS visibility** to hide — it never unmounts to hide. The live subscription stays attached, output keeps streaming into the hidden xterm, and re-showing is instant with full scrollback (refit via `fitAddon.fit()` on reveal, since xterm cannot measure a hidden container). A scratch `<Body>` is unmounted (disposed) **only when its shell is killed** (pane close / session close / reap, §9).

Every running scratch shell keeps **one mounted (hidden) `<Body>`** for its whole life, regardless of which session is active — so scrollback survives both pane-switch and session-switch, and the "dispose only on kill" rule above holds without exception. The popup _shows_ the focused pane's (active session); the rest stay mounted-hidden. Count: ≤4 per session, and in practice a small total (scratch shells are user-initiated). If that total ever profiles as too heavy, the `get_pty_replay` escape hatch below lets inactive ones unmount and remount with a real snapshot.

> **Alternative if 4 hidden xterms profile as too heavy:** add a `get_pty_replay(ptyId)` snapshot IPC (reading the per-PTY `RingBuffer`, `commands.rs:590-599`) so the popup can unmount on hide and remount in `attach` mode with a real snapshot. Deferred unless measured.

**cwd-signal suppression:** the scratch `<Body>` must **not** wire the `OSC 7 → updatePaneCwd` path the pane's main `<Body>` uses (`TerminalPane/osc7.ts`); it feeds no cwd signal into the session model (§6).

> **Open implementation question (resolve in build):** whether the popup passes a flag to `<Body>` to opt out of the OSC-7→`updatePaneCwd` wiring, or whether that wiring lives in the `TerminalPane` wrapper and is simply absent when `<Body>` is hosted by the popup. Decide by reading where `updatePaneCwd` is invoked relative to `<Body>`.

## 6. cwd isolation + per-pane keying & switching

**Spawn cwd.** A scratch shell spawns at the **host pane's** current `cwd` (`Pane.cwd`), not `session.workingDirectory`. (Contrast `addPane`, which deliberately uses the stable `session.workingDirectory` at `useSessionManager.ts:1175` to avoid leaking an agent's task cwd; for scratch we _want_ "wherever this pane is now.") Spawn params: `{ cwd: hostPane.cwd, ephemeral: true, enableAgentBridge: false }`.

**cwd stays isolated.** Because the scratch `<Body>` does not feed `updatePaneCwd` (§5), `cd` inside the scratch shell changes only the scratch shell's own working directory — the host `Pane.cwd`, the session, the header location/branch, the file explorer, and the diff root are all untouched (invariant 5).

**Per-pane keying, ownership & restart.** One scratch entry per host pane, keyed by a **stable pane identity** `${sessionId}:${paneId}` — **not** the host `ptyId`, which rotates when a pane is restarted. The map is **global** (spans sessions): scratch shells survive a session switch (hide ≠ kill), so the bound is **≤4 per session**, not ≤4 total. **Restarting a pane's agent keeps its scratch shell alive** (the dev server you started doesn't die because you restarted the agent in that pane); a scratch shell is killed only on pane **close**, session close, or reap (§9). (Pane capacity per layout: `layouts.ts`.)

**The switcher.** The popup shows exactly one shell at a time — the focused pane's, resolved via the same `resolveFocusedPane()` callback `usePaneRenameChord` uses. The header's **pane-switcher pills** (per the handoff) list the active session's panes; a pill's live dot = `runningByPane` has a running entry for that pane. Selecting a pill (or switching the focused pane and reopening) reveals that pane's already-mounted scratch `<Body>` (§5), lazily spawning one if that pane has none yet.

---

## 7. Invocation chord + keystroke ownership

**Invocation.** Toggled by the chord **`Mod+;` (Ctrl+; on Linux/Windows, Cmd+; on macOS) then `` ` `` (backtick)** — the existing palette leader followed by a registered key, exactly the shape of `usePaneRenameChord` (`Mod+;` then `r`). The leader is defined in `shortcutConfig.ts` (`['Mod', ';']`, requires `!shiftKey` + `key === ';'`); the hook calls `registerChord('`', handler)` (`chordRegistry.ts`), and the handler resolves the focused pane (`resolveFocusedPane()`) and toggles the popup. Secondary entry: the pane-header ghost button (§8) calls `toggle({ sessionId, paneId })` for its **own** pane.

> **Note — corrects the handoff.** The handoff/mock footer and VIM-53 write the chord as "`⌃: ` `" / "`Ctrl+:`". That keystroke is physically Ctrl+Shift+; and **cannot fire** the palette leader, which requires `event.key === ';'`with`!shiftKey` (`shortcutConfig.ts`, plus the Electron `before-input-event`override in`electron/command-palette-shortcut.ts`). The real, consistent gesture is **Mod+; then backtick**. The handoff footer and VIM-53 should be updated to match.

**Keystroke ownership needs no suppression.** The global shortcut layer partitions by _specificity, not focus_ — this is verified against how pane xterms already coexist with it:

- the command-palette `document` capture listener (`useCommandPalette.ts`, mounted once at `WorkspaceView`) consumes **only** the `Mod+;` toggle, leader follow-ups during the 500 ms window, and (when the palette is open) its own arrow/Enter/Escape nav — _every other key falls through untouched_, with no "is focus in a terminal" guard;
- the Electron `before-input-event` override (`electron/command-palette-shortcut.ts`) intercepts **only** `Mod+;` and re-dispatches it via IPC — the backtick follow-up and all ordinary keys are never targeted;
- so the focused scratch xterm receives ordinary input through the **same path pane terminals use** — xterm `onData → service.write`, with `attachCustomKeyEventHandler` passing everything except the clipboard combos (`useTerminalClipboard.ts`). Typing `;`, backtick, etc. into the scratch shell just works.

Because the chord is a `chordRegistry` entry (not a bare global hotkey), it only fires inside the post-leader window, so it never collides with a literal backtick typed into the shell. The same handler **toggles**: `Mod+;` `` ` `` opens when hidden and hides when shown (the rename chord proves leader→chord works from a focused terminal). `Esc` and the header `✕` also hide. Hiding never kills (§1 invariant 4).

## 8. Live-but-hidden cues

When a scratch shell is running but its popup is dismissed, the workspace must signal it (so a backgrounded `npm run dev` isn't forgotten). All cues read from the hook's `runningByPane` (§4); any count is its running size.

**Primary — pane-header ghost button (`.scratch-btn`).** A secondary, low-key ghost icon button (Material Symbols `terminal`) added to the **existing** pane header's utility cluster, beside collapse/close (`TerminalPane/Header.tsx` + `HeaderActions.tsx`) — the established header order (agent chip · status dot · title · worktree›branch · diff · reltime · utility icons) is **not** restructured. It is the click affordance to open this pane's scratch shell (the chord is primary); clicking it focuses that pane and calls `toggle({ sessionId, paneId })` for **its own** pane, not whatever was previously focused (§7). When this pane has a running scratch shell while the popup is dismissed, the button gains a **faint amber tint** (`#f0c674`) + a small **mint live-dot** (`--success`).

**Tooltip (`.scratch-tip`).** Hover/focus on the button shows (via the shared `Tooltip` primitive): a `SCRATCH · pane N` header, a **mint dot + relative-time** status line, one compact hint (`Throwaway shell · cd stays local · gone on restart`), and the chord hint. Per UNIFIED §8 anti-patterns, the status is a **dot + reltime**, never a `Status: Running` label.

> The running-command label in the mock's status line (`running · npm run dev · 1m 12s`) is **best-effort** — v1 may show only the mint dot + reltime, or the last command typed; live PTY foreground-command introspection is out of scope.

**Secondary cue.** `● scratch ×N` in the global status bar (`bottom-status-bar`), `N` = total running scratch shells **across all sessions**, derived from `runningByPane` (so a shell backgrounded in another session isn't forgotten). (An amber count badge on the icon rail's terminal icon is **deferred**: the IconRail is held for a separate design pass, so v1 does not modify the rail.)

---

## 9. PR breakdown & sequencing

Three stacked PRs (VIM-53), each a shippable vertical slice, landing on the `feat/scratch-terminal` integration branch; the integration branch opens the final PR to `main` (stacked-PR convention — `Refs VIM-53` on child PRs, `Closes VIM-53` on the final). Within PR1 the backend slice (§3) is the **first commit** — the UI cannot be non-persisting without it.

**PR1 — per-session scratch popup (foundation).**

- _Backend (first commit):_ `ephemeral` flag on `SpawnPtyRequest` + `PTYSpawnParams` (skips the cache write §3.2 **and** bridge generation); ephemeral-ptyId set in `PtyState`; `kill_ephemeral_ptys` reap IPC (the 4-file checklist, §3.4); extend `BackendState::shutdown()` to kill the set. Rust tests per §3.5.
- _Frontend:_ `useScratchTerminals` owning a **single session-scoped** scratch shell, spawned lazily at `session.workingDirectory` with `{ ephemeral: true, enableAgentBridge: false }`; the popup overlay (command-palette sibling) rendering `<Body>` in attach mode, **keep-mounted-hidden** (§5) with the `registerPending` / `notifyPaneReady` drain; the `Mod+;` `` ` `` chord (§7); an **awaited** reap-on-boot on app init that **gates the first scratch spawn** (§3.4); lazy-reconciliation teardown on session close (§4).
- Maps to VIM-53 PR1 acceptance criteria.

**PR2 — one scratch shell per pane.**

- Generalize the key from session to `${sessionId}:${paneId}` (§6); spawn at the **host `Pane.cwd`** (not `workingDirectory`); ≤4 per session; the header **pane-switcher pills** (§6); cwd isolation — no `updatePaneCwd` wiring (§5/§6).
- The **live-but-hidden cues** (§8): pane-header ghost button + amber tint + mint live-dot + tooltip; status-bar `● scratch ×N`.
- Maps to VIM-53 PR2 acceptance criteria.

**PR3 — pane-bound lifecycle.**

- **Lazy reconciliation** in `useScratchTerminals` (§4): when a `${sessionId}:${paneId}` key no longer maps to a live pane — pane close (`removePane`) or session close (`removeSession`) — the hook kills + drops that scratch entry (`service.kill` + `dropAllForPty`). A pane **restart keeps** its scratch shell (the key is stable across ptyId rotation, §6); a self-exited child is dropped on the next reconcile/open. No `useSessionManager` coupling — the hook observes the session/pane list.
- Maps to VIM-53 PR3 acceptance criteria.

## 10. Testing strategy

**Backend (Rust, `crates/backend/src/terminal/`).**

- The §3.5 trio: ephemeral spawn does not persist; default still persists; `ephemeral` forces no bridge dir.
- Reap: `kill_ephemeral_ptys` kills exactly the ephemeral set and leaves non-ephemeral PTYs untouched; `shutdown()` kills the ephemeral set.
- The reap IPC must be wired across all four layers (`mod.rs` inner + `state.rs` + `ipc.rs` arm + `electron/backend-methods.ts`) — **omitting the `ipc.rs` arm passes unit tests but silently fails at runtime**, so add a test that drives it through the IPC router, not just the inner fn.

**Frontend (Vitest, co-located `*.test.tsx`, ≥80% per feature; every test file explicitly `import { test, expect, vi } from 'vitest'`).**

- `useScratchTerminals`: spawn passes `{ ephemeral: true, enableAgentBridge: false }` at the right cwd (`workingDirectory` in PR1, `Pane.cwd` in PR2); `toggle` open/hide; **hide does not call `service.kill`** (hide ≠ kill); reopen re-reveals the same shell; `cd` does **not** call `updatePaneCwd`; per-pane keying (switch pane → different shell); ≤4 per session; reap-on-boot calls `kill_ephemeral_ptys`; `removePane` / `removeSession` kill the scratch ptyId; a pane **restart keeps** the scratch entry (stable key).
- Popup component: renders `<Body>` in `attach` mode for the `scratchPtyId`; **stays mounted when dismissed** (assert the node is hidden, not unmounted); the `Mod+;` `` ` `` chord toggles; `Esc` hides; ordinary keys reach the xterm (no palette suppression added).
- Cues (§8): pane button shows amber tint + mint live-dot only while a scratch shell runs & the popup is dismissed; tooltip content; status-bar `● scratch ×N` count.
- **Material Symbols ligature trap:** the `terminal` glyph renders as a real icon only with a valid ligature name — verify it in a browser, since `textContent` tests pass even on an invalid name.

**Manual / E2E (the behaviors unit tests can't prove).**

- Hide ≠ kill: start `npm run dev` in the scratch shell, hide the popup, confirm the dev server keeps serving, reopen and see continued output.
- Renderer reload reaps: start a scratch shell, reload the renderer (Cmd+R), confirm no orphaned child lingers (and no ghost tab).
- cwd isolation: `cd` in the scratch shell, confirm the pane header location/branch, file explorer, and diff root are unchanged.
