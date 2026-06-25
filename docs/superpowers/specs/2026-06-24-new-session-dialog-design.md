# New Session Dialog — Design Spec

**Date:** 2026-06-24
**Status:** Codex-reviewed
**Topic:** Configurable multi-pane session creation via a modal dialog

---

## 1. Overview, Goals & Scope

**Feature:** A "New Session" modal dialog — opened from the left-sidebar
`NewSessionButton` and the ⌘N shortcut — that collects a session **name**, a
**working directory** (native OS folder picker), a **layout**, and a **per-pane
starting command**, then creates one multi-pane session. It ports the approved
design handoff — copied into the repo at
`docs/design/archive/2026-06-24-new-session-dialog/` (`README.md`,
`new-session-dialog.jsx`, `new-session-dialog.html`; the scaffolding
`design-canvas.jsx` is intentionally excluded) — onto Vimeflow's existing
component primitives and theme tokens.

### Goals

1. Replace the current instant-create (`createSession()` → a single shell pane
   in `~`) with a deliberate, configurable creation flow that faithfully
   reproduces the handoff's inner content, spacing, and interactions using the
   existing theme tokens. Fidelity governs the dialog's content; the house
   `Dialog` style governs the outer panel surface where the two differ (see
   §3.1).
2. Let the user pick any of the layouts the dialog offers (see scope) and
   select a starting command per pane before the session opens. "Select" is
   deliberate: v1 records the choice and applies it as pane kind + label; it
   does not spawn an agent CLI (see Non-goals).
3. Add a real native folder picker (the app currently has none).
4. **The chosen directory becomes the session's fixed baseline CWD.** Every pane
   created with the session spawns in that directory, and every pane added later
   inherits it. `addPane` already spawns from `session.workingDirectory`
   (`useSessionManager.ts:1413`, which deliberately ignores the active pane's
   live cwd), so this requires only that `createSession` sets `workingDirectory`
   to the chosen path and spawns the initial panes there.

### In scope (v1)

- The dialog UI built on the real `Dialog` primitive plus the public `Menu`
  primitive for the floating sub-popups (the "More layouts" list and the
  per-pane command picker). Feature code composes `Menu` — it must **not** import
  the `useFloatingSurface` substrate directly (the repo's floating-surface
  boundary confines that to `src/components/base/floating/**`; see
  `eslint.config.js:333`).
- Native Electron `dialog.showOpenDialog({ properties: ['openDirectory'] })`
  exposed via a new IPC channel + preload bridge + a thin frontend wrapper.
- `createSession({ name?, cwd?, layout?, panes? })` — assembles a multi-pane
  session honoring the chosen layout, with `cwd` fixed as the session baseline
  (Goal 4). `panes?` carries the per-pane **command selection** (not just a
  pane kind), so the creation logic can derive each pane's `kind` (`browser` vs
  `shell`) **and** its `userLabel` from the selected command. The no-argument
  call remains backwards-compatible. (Exact `panes?` shape is specified in the
  session-creation API section.)
- `NewSessionButton` and the ⌘N shortcut both open the dialog, replacing the
  instant-create behavior.
- Overlay registration (`plane: 'dialog'`, `nativeOcclusion: 'global'`) so the
  modal correctly occludes native browser panes.

### Non-goals (v1) — deliberate simplifications

- **No agent-CLI auto-launch.** The per-pane command picker records a selection;
  in v1 its only *executed* effects are the pane's `kind` and its label — no CLI
  is spawned. Picking Claude / Codex / Kimi / opencode creates a plain
  `kind: 'shell'` pane (`agentType: 'generic'`; the existing reactive agent
  detection is unchanged) with `userLabel` set to the command's display name so
  the choice is visible in the pane header. Only `Browser` maps to a different
  pane kind (`kind: 'browser'`). The picker is built at full fidelity so a future
  v2 can wire actual launch (`spawn shell:<cli>` + `write()`) with no UI change.
- **No recent-folders list.** The working directory is chosen via Browse…
  (native picker) only; the field shows a read-only path crumb (not a text
  input), pre-filled with a default path = the active session's
  `workingDirectory`, else `~`.
- **Layouts limited to the 5 in the handoff:** `single` / `vsplit` / `hsplit`
  (quick), with `threeRight` / `quad` behind "More layouts". `grid3x2` and
  custom layouts are omitted from this dialog.

---

## 2. UX Flow & Component Structure

### 2.1 Files

All under `src/features/sessions/components/NewSessionDialog/`, each with a
co-located `.test.tsx`:

| File | Responsibility |
|------|----------------|
| `NewSessionDialog.tsx` | The modal: `Dialog` (behavior + house panel) wrapping **custom** header / scroll-body / footer regions — not the `Dialog.Header/Body/Footer` helpers (see §3.1); owns dialog-local state; emits `onCreate(opts)` / `onOpenChange`. |
| `LayoutPicker.tsx` | Left column: quick-layout list + "More layouts" `Menu`. |
| `LayoutGlyph.tsx` | Inline-SVG glyph per layout (ported from the handoff, theme-colored). |
| `CommandBoard.tsx` | CSS-grid miniature of the chosen layout; each cell is a pane button opening a per-pane command `Menu`. |
| `WorkingDirectoryField.tsx` | Path crumb + Browse… button (calls the folder-picker wrapper). |
| `PathCrumb.tsx` | Renders a path as colored segments split on a separator-agnostic boundary (`/[/\\]+/`) so native POSIX, Windows-drive, and UNC paths all segment. |
| `commands.ts` | The dialog's command list (claude / codex / kimi / opencode / browser / shell), derived from `src/agents/registry.ts` plus a local `browser` entry; maps each command → `{ id, label, kind: 'shell' \| 'browser', accentVar, glyph, Icon? }`. No pane `agentType` field — v1 panes are always `agentType: 'generic'` (see §4); the command only determines `kind` and, for agent picks, the pane `userLabel`. |

### 2.2 Dialog-local state

Held in `NewSessionDialog`:

- `path: string` — current working directory.
- `name: string` / `nameEdited: boolean` — session name and whether the user
  typed a custom value.
- `layoutId: PaneLayoutId` — selected layout.
- `pinnedLayout: PaneLayoutId | null` — a non-quick layout the user pinned into
  the visible list via "More layouts".
- `assign: CommandId[]` — command per pane index (default
  `['claude', 'shell', 'shell', …]`).

Derived: `layout` (registry `LayoutShape`), `visibleLayouts`, footer summary.

### 2.3 Regions (matching the handoff)

- **Header** — bolt icon + "New session" title + close button.
- **Body** — fixed height `min(600px, 70vh)` with internal scroll (this is what
  keeps the dialog steady). Contents in order: Session name field, Working
  directory field + crumb, then a side-by-side **Layout** (left, fixed width) +
  **Starting command** (right, `CommandBoard`) row carrying a reserved
  `min-height` so it never reflows.
- **Footer** — muted `"<N> panes · <folder>"` summary + Cancel + Create session.

### 2.4 Interactions

- **Name** auto-tracks `deriveSessionName(path)` (§2.6) until the user types;
  once edited, a "reset" pill restores the derived name and clears the edited
  flag. Changing the folder updates the name only while untouched.
- **Browse…** → native folder picker (Section 4); on success sets `path` (and
  `name` if untouched). Cancel is a no-op.
- **Layout select** updates `CommandBoard` + the footer count. **More layouts**
  opens a `Menu` of all 5 layouts; picking a non-quick one pins it into the
  visible list and selects it.
- **Pane click** opens a command `Menu`; selecting assigns that command to the
  pane index. `assign` is a stable array indexed by pane slot whose entries
  persist across layout changes (so toggling layouts never loses a pick); a slot
  that has never been assigned defaults to `shell`. Layout capacity only changes
  which slots are *visible* — on **Create**, only `assign[0..capacity-1]` are
  consumed.
- **Create session** builds `panes` from `assign[0..capacity-1]`, calls
  `onCreate({ name, cwd: path, layout: layoutId, panes })`, then closes.
- **Cancel / close / Esc / backdrop** → `onOpenChange(false)` with no side
  effects.

### 2.5 Steady height / popups

Both popups are `Menu` instances that portal to `document.body`, so they escape
the dialog's scroll container and never change its height — this replaces the
handoff's hand-rolled fixed-position `FloatingMenu` (flip / clamp / dismiss /
focus now come from `Menu`'s substrate). The `min-height` on the
layout+command row reserves space for the tallest state (a pinned extra layout).

### 2.6 Path parsing (cross-platform)

The native picker returns an absolute OS path. A small `pathParts(path)` helper
splits on `/[/\\]+/` and drops empty segments (so leading, trailing, and doubled
separators never produce blanks) — POSIX, Windows-drive (`C:\…`), and UNC
(`\\server\share`) paths all segment correctly. `basename` = the last non-empty
segment — for a UNC path that is the share name (`share` for `\\server\share`),
which is the meaningful folder label (preserving full `server/share` semantics is
out of scope). When there is genuinely no segment (a bare root such as POSIX `/`
or a drive root `C:\`), `basename` falls back to a root label (`/` or the drive
`C:`) for the **crumb display**. A shared `deriveSessionName(cwd)` derives the
auto-tracked session **name**: the basename, falling back to `'session N'` for an
empty basename or a bare root/home token (`/`, a drive root, or `~`). Both the
dialog's name prefill (§2.4) and `createSession` (§4.2) use this one rule, so the
prefilled name and the created session's name always match.
The home-directory collapse and the
`~` display token are POSIX-only and skipped for Windows/UNC paths. The default
path keeps the existing `'~'` convention the backend already resolves, and the
crumb renders `~` as an ordinary first segment (no doubled leading slash).

---

## 3. Modal Shell, Theme Tokens & Styling

### 3.1 Modal shell — decision

The handoff specifies a 560px panel, 14px radius, an accent-tinted border, a
custom shadow, and a fixed-height scrolling body. The house `Dialog` primitive
imposes its own panel chrome and has no 560px size. Options considered:

- **A) Pure `Dialog`** — house chrome, zero new code, but the panel is ~672px
  (`lg`) or 448px (`md`) with no internal-scroll body. Rejected: breaks the
  design's width and steady-height behavior.
- **B) Bespoke modal** (in the style of `LayoutCreatorModal`) — exact handoff
  pixels, but re-implements portal / focus-trap / Esc / backdrop / overlay
  registration. Rejected: duplicates a solved primitive.
- **C) `Dialog` + minimal extension (chosen).** Reuse `Dialog` for behavior and
  accessibility; add an optional `panelClassName?: string` prop appended to the
  panel classes (backwards-compatible — existing callers omit it). This consumer
  pins the width via `panelClassName="w-[min(560px,100%)] max-w-none"`, where
  `max-w-none` neutralizes the size class (Tailwind precedence verified during
  implementation; if `max-w-none` ordering proves unreliable, fall back to a
  dedicated `size` token). Render **custom** header / scroll-body / footer
  `<div>`s as `Dialog` children (not the `Dialog.Header/Body/Footer` helpers, so
  the handoff paddings and the fixed-height `min(600px,70vh)` internal-scroll
  body apply). The panel keeps the **house** surface (`glass-panel`,
  `bg-surface-container`, `rounded-2xl`, `border-outline-variant/30`,
  `shadow-2xl`) instead of the handoff's prototype-specific rgba border/shadow —
  honoring the house "no visible borders / glassmorphism" rule. The residual
  difference is a faint border hue and ~2px of radius, invisible in practice.

`Dialog` already handles portal, backdrop, focus trap, Tab cycling, Esc, and
focus restore, so none of that is re-implemented.

### 3.2 Token map

`--vf-*` (handoff) → real semantic token. The handoff palette is Catppuccin
Mocha; the surface, text, and accent values used by this dialog match the live
`Catppuccin` (file/id `obsidian-lens`) theme. A few semantic tokens in the
broader handoff set differ in hue from the live theme (e.g. `success` / `warning`
and the dimmest text), but this dialog does not use status colors — and where any
token differs, the semantic token wins (theme-consistency outranks matching the
prototype's literal hue). Mapping for the tokens the dialog actually uses:

| Handoff token | Real token / Tailwind utility |
|---|---|
| `surface-0` / `-1` / `-2` / `-3` | `surface-container-lowest` / `surface-container-low` / `surface-container` / `surface-container-high` |
| `bg` | `surface` |
| `text` / `text-1` / `text-2` / `text-3` | `on-surface` / `on-surface-variant` / `on-surface-muted` / dimmest muted token (matched by Catppuccin hue in `obsidian-lens.ts`) |
| `accent` / `accent-bright` | `primary-container` (#cba6f7) / `primary` (#e2c7ff) |
| `outline` | `outline-variant` |
| `agent-claude` / `codex` / `kimi` / `opencode` / **`vbrowser` → `browser`** / `shell` | `--color-agent-{id}-accent` (+ `-dim` / `-soft` / `-on-accent`) |

The handoff's `vbrowser` maps to the real agent id `browser` (there is no
`vbrowser` token). Tokens are role-based: if the active theme changes, semantics
follow the token, not the literal hue.

### 3.3 Alpha & lint compliance

No hex or `rgba()` literals — `vimeflow/no-hardcoded-colors` bans them outside
`src/theme/**`. Every handoff `rgba(R,G,B,a)` becomes
`color-mix(in srgb, var(--color-X) <a·100>%, transparent)` (or a Tailwind `/N`
opacity modifier where the percentage maps cleanly). Agent washes and borders use
the **pre-mixed** named vars (`-dim` ≈16%, `-soft` ≈32%) rather than computing
alpha by hand. The dialog ships zero color literals.

### 3.4 Fonts & icons

- UI text = Inter (default stack); mono (paths, CLI names, pane counts, pills) =
  `font-mono` (JetBrains Mono). Both are already loaded.
- Icons = Material Symbols spans (existing system):
  `bolt, close, edit, folder_open, drive_folder_upload, more_horiz,
  expand_more, expand_less, check`.
- Command chips render `AgentDef.Icon` (brand SVG) when present, else the
  registry `glyph`. The `browser` command (no brand icon) uses a Material Symbol
  (`language`) tinted with the browser accent.
- `fork_right` is dropped (no recents). All tooltips use the `Tooltip`
  component — never the native `title=` attribute.

---

## 4. Session-Creation API & Native Folder Picker

### 4.1 `commands.ts` — dialog command registry

```ts
type CommandId = 'claude' | 'codex' | 'kimi' | 'opencode' | 'browser' | 'shell'
interface CommandDef {
  id: CommandId
  label: string
  kind: 'shell' | 'browser'
  accentVar: string   // e.g. '--color-agent-claude-accent'
  glyph: string
  Icon?: AgentIcon    // brand SVG when present
}
```

The 5 agent entries are derived from `src/agents/registry.ts`; a local `browser`
entry adds `kind: 'browser'`, `--color-agent-browser-accent`, and a `language`
glyph. Display order: `[claude, codex, kimi, opencode, browser, shell]`.

Helper `commandToPane(id) → { kind: PaneKind; userLabel?: string }`:

- `browser` → `{ kind: 'browser' }`
- `shell` → `{ kind: 'shell' }`
- agent (`claude` / `codex` / `kimi` / `opencode`) → `{ kind: 'shell', userLabel: label }`

### 4.2 `createSession` extension (`useSessionManager.ts`)

```ts
type NewPaneSpec = { command: CommandId }
type CreateSessionOptions = {
  name?: string
  cwd?: string
  layout?: PaneLayoutId
  panes?: NewPaneSpec[]
}
createSession(opts?: CreateSessionOptions): void
```

- **Back-compat:** `createSession()` with no args behaves exactly as today
  (single shell pane, `cwd: '~'`, `name: 'session N'`, `layout: 'single'`).
- **With opts:**
  - `cwd = opts.cwd ?? '~'` becomes the **fixed session baseline**
    (`session.workingDirectory`); every initial pane spawns with it, and later
    `addPane`s inherit it (Goal 4 — already true at `useSessionManager.ts:1413`).
  - `layout = opts.layout ?? 'single'`; `capacity = registry.capacityFor(layout)`.
  - `specs` = exactly `capacity` slots: take `opts.panes ?? []`, truncate to
    `capacity`, then pad any remaining slots with `{ command: 'shell' }`. A
    layout request therefore always yields `capacity` panes (e.g. `vsplit` → 2
    panes) even when `panes` is omitted; explicit per-slot commands override the
    shell default. (The dialog always supplies exactly `capacity` specs, so the
    padding only guards programmatic callers; the no-arg path still yields one
    shell pane because `single` has capacity 1.)
  - Each spec resolves via `commandToPane`: **shell / agent** → the same
    `service.spawn({ cwd, env: {}, enableAgentBridge: true })` call the current
    single-pane path uses — `env: {}` supplies no *extra* variables; the backend
    inherits the parent process environment (PATH / HOME / locale), so shells
    launch normally (`agentType: 'generic'`; `userLabel` set for agent picks);
    **browser** → a browser pane via the existing `createBrowserSession` /
    `createBrowserPane` pattern (ptyId `browser:<uuid>`, default URL). Shell PTYs
    are spawned **concurrently and independently** (`Promise.allSettled`, per-pane
    resolution) so one slot's failure does not reject the others; the session is
    assembled after all settle, so it still appears atomically.
  - Assemble one `Session`: `id = crypto.randomUUID()`,
    `name = opts.name ?? deriveSessionName(cwd)` (the shared rule in §2.6 — the
    folder basename, falling back to `'session N'` for an empty basename or a
    bare root/home token like `/`, a drive root, or `~`), `workingDirectory =
    cwd`, `layout`,
    `panes[]` in slot order (first pane active), `placements` omitted (implicit,
    via `panes[]` order + the layout's `addOrder`, matching restore and the
    current single-pane path). One atomic `setSessions` append (`flushSync` as
    today), repeating the existing per-pane bookkeeping (`registerPending` +
    `registerPtySession` + `restoreData`) for each spawned pane. Then
    `setActiveSessionId(newId)`.
  - **Partial failure:** a secondary pane's spawn rejection is logged and that
    slot is skipped; the session is still created if ≥1 pane succeeded; if none
    succeed, no session is created (mirrors today's `try/catch`).
- `applyAddPane` (`utils/paneLifecycle.ts`) may be folded to build
  `panes[]`/placements, or panes may be constructed directly — `applyAddPane`
  does not auto-shrink, so the chosen layout is preserved.

### 4.3 Native folder picker IPC (Electron main, not the Rust sidecar)

- `electron/ipc-channels.ts` — add `DIALOG_PICK_DIRECTORY = 'dialog:pick-directory'`.
- `electron/main.ts` — register:
  ```ts
  ipcMain.handle(DIALOG_PICK_DIRECTORY, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow()
    const r = await dialog.showOpenDialog(win ?? undefined, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose working directory',
    })
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })
  ```
  (add `dialog` to the existing `electron` import).
- `electron/preload.ts` — add a top-level namespace to `exposeInMainWorld`:
  `dialog: { pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(DIALOG_PICK_DIRECTORY) }`.
- `src/types/vimeflow.d.ts` — extend `BackendApi` with
  `dialog?: { pickDirectory(): Promise<string | null> }`.
- Frontend wrapper `NewSessionDialog/pickDirectory.ts`:
  `(await window.vimeflow?.dialog?.pickDirectory()) ?? null`. In non-Electron dev
  (`window.vimeflow?.dialog` undefined) it returns `null`, so Browse… is a no-op
  there and the field keeps its default.

### 4.4 Tests (this section)

- `commands.ts`: registry shape + `commandToPane` mapping for each id.
- `createSession` options: correct pane count / kinds / cwd / layout / `userLabel`;
  the back-compat no-arg path; the partial-failure path — all with a mocked
  terminal service.
- Main-process handler: mock `dialog.showOpenDialog` → canceled vs a path.
- `pickDirectory` wrapper: mock `window.vimeflow` (present + absent).

---

## 5. Wiring, Overlay Registration, Testing & Rollout

### 5.1 Open-state wiring

Add `newSessionDialogOpen` state in `WorkspaceView` (a small `useNewSessionDialog`
hook holding `open` + `defaultCwd`). Re-point the two sidebar entry points:

- `NewSessionButton.onClick` → open the dialog (was `handleCreateSession`).
- ⌘N (`useNewSessionShortcut.onNewSession`) → open the dialog (idempotent: sets
  `open = true`, never toggles). The hook's existing key guards are preserved.
- The dialog's `onCreate(opts)` → `createSession(opts)` + `claimTerminal()` +
  close.
- `defaultCwd` = the active session's `workingDirectory`, else `'~'` (computed in
  `WorkspaceView` from session state and passed to the dialog).

The **other two creation entry points keep instant `createSession()`** (no
dialog), coexisting via the back-compat no-arg signature:

- the command-palette "new session" command (`buildWorkspaceCommands.ts:189`);
- `useAutoCreateOnEmpty` (`:51`), which must not pop a modal on launch.

Only the sidebar button + ⌘N open the dialog.

### 5.2 Overlay registration

Add `newSessionDialogOpen: boolean` to `WorkspaceOverlayRegistrationsProps` and a
registration mirroring `unsaved-changes-dialog`:

```ts
useOverlayRegistration({
  id: 'new-session-dialog',
  plane: 'dialog',
  isOpen: newSessionDialogOpen,
  nativeOcclusion: 'global',
})
```

This makes the modal occlude native browser panes (which paint above the DOM).

### 5.3 Testing

Co-located `.test.tsx` for every new file. Coverage:

- **Dialog interactions:** name auto-track + reset pill; Browse… (mock
  `pickDirectory`) updates path + the untouched name; layout select updates the
  board + footer count; More-layouts pins a non-quick layout; pane command
  assign; Create calls `onCreate` with `{ name, cwd, layout, panes }`; Cancel /
  Esc / backdrop produce no side effects.
- **`createSession` options** (in the `useSessionManager` test, mocked service):
  pane count = `capacity`, kinds / cwd / layout / `userLabel` correct, the
  back-compat no-arg path, the partial-failure path.
- **Electron:** main handler (mock `dialog.showOpenDialog`, canceled vs path);
  preload exposure; `pickDirectory` wrapper (`window.vimeflow` present / absent).
- **Wiring:** button + ⌘N open the dialog; `onCreate` calls `createSession`;
  overlay registration present.
- **Gates (repo-wide, pre-push):**
  `npm run lint && npm run format:check && npm run type-check && npm run test`.
  **No** `generate:bindings` — the folder picker is an Electron-main concern with
  no Rust / ts-rs changes.

### 5.4 Risks

- **R1** `panelClassName` Tailwind precedence (`max-w-none` vs the size class) —
  verify during implementation; fallback is a dedicated `size` token on `Dialog`.
- **R2** Multi-pane bookkeeping (`registerPending` / `registerPtySession` /
  `restoreData` per pane) — generalize carefully from the single-pane path;
  covered by tests.
- **R3** Browser slots in a mixed layout — reuse the proven browser-pane creation
  path (`addPane` kind `'browser'` / `createBrowserPane`). If full up-front
  assembly is awkward for WebContentsView bounds, create the session with shell
  panes then `addPane` the browser slots — both honor the fixed cwd.
- **R4** ⌘N re-press while the dialog is open — `onNewSession` is idempotent.

### 5.5 Rollout

Branch `feat/new-session-dialog` off `origin/main` (worktree). No Rust / bindings
changes. Implementation uses Opus for orchestration + `createSession` / assembly +
the dialog, and Sonnet for parallel component / test build-out; codex reviews the
code before PR (`/lifeline:review` → `/lifeline:request-pr`).

### 5.6 Out of scope / v2

Agent-CLI auto-launch; recent folders; `grid3x2` + custom layouts in the dialog;
an editable path text input; the command palette opening the dialog.

<!-- codex-reviewed: 2026-06-25T04:45:36Z -->
