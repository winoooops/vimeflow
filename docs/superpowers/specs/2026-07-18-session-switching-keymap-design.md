# Session Switching Shortcuts — Design

**Status:** Draft (codex round-1 findings applied; round-2 review pending).

**Linear:** not yet filed (Sessions component project).

**Related:** VIM-328 keymap unification (#698), Keybinding Engine spec
(`2026-06-15-keybinding-engine-design.md`, incl. the 2026-07-15 snapshot-transport addendum),
`agent/pane-directional-navigation` (Ctrl+Arrow pane focus, unmerged at time of writing).

---

## 1. Context & Problem

A Vimeflow **session** is the workspace unit — it owns a layout, panes, and a working
directory, and renders in the tab strip (`src/features/sessions/components/Tabs.tsx`).
Today's session switching is limited to sequential cycling (`session-prev` / `session-next`
on `⌘[` / `⌘]`, Linux `Ctrl+Shift+[` / `]`), tab clicks, and palette commands.

Compared to VS Code / Zed there is no **MRU switching** (Ctrl+Tab) and no **close
shortcut**. The approved direction (Approach A) is additive: keep `Mod+1..9` on pane focus
(which mirrors VS Code's editor-group digits) and add the missing session layer. Every new
shortcut is a catalog command so the Settings → Keymap pane can rebind it
(`KeymapPane.tsx` renders rows straight from `CATALOG`).

## 2. Goals & Non-Goals

**Goals**

1. MRU session switcher on `Ctrl+Tab` / `Ctrl+Shift+Tab` with VS Code hold-overlay
   semantics (release commits; quick tap bounces to the last session).
2. Close the active session on `Mod+W` (macOS) / `Ctrl+Shift+W` (Linux) through the
   existing guarded close flow.
3. Both rebindable from Settings → Keymap, grouped under a new **Sessions** group, and
   functional — visible and focusable — from every input surface (app renderer, Ghostty
   native panes, browser `WebContentsView` panes).

**Non-Goals**

- **Direct digit jump to session N** — dropped from v1 after review; the full analysis of
  why no viable default chord tier exists is preserved in §8.
- Fuzzy session picker (the command palette already reaches sessions by name).
- MRU persistence across relaunch (v1 is in-memory).
- Tab reordering shortcuts.
- Keyup transport through the native input bridges (§5 defines fallbacks instead).
- Dynamic macOS menu accelerator rebuilds on rebind (the mac File menu stops advertising
  an accelerator instead — §6).

## 3. New Catalog Commands

All entries: `context: 'global'`, `matchPolicy: 'exact'`, `rebindable: true`, group
`'Sessions'`. Every default satisfies the exactly-one-super invariant (`Mod` xor `Ctrl`) —
which also guarantees any bound chord has a hold-able modifier, so the switcher's
release-to-commit phase always exists (no modifier-less degradation case).

| Command id            | Default (macOS)   | Default (Linux)  | Action                                     |
| --------------------- | ----------------- | ---------------- | ------------------------------------------ |
| `session-switch-next` | `⌃⇥` (`Ctrl+Tab`) | `Ctrl+Tab`       | Open MRU switcher / advance selection      |
| `session-switch-prev` | `⌃⇧⇥`             | `Ctrl+Shift+Tab` | Open MRU switcher / move selection back    |
| `session-close`       | `⌘W`              | `Ctrl+Shift+W`   | Close active session (guarded flow intact) |

Chord literals: `c('Tab', 'Ctrl')`, `c('Tab', 'Ctrl', 'Shift')`, and `session-close` as a
platform function `(isMac) => isMac ? c('KeyW', 'Mod') : c('KeyW', 'Mod', 'Shift')` — the
same shape `new-session` uses.

`Ctrl` is deliberately literal (not `Mod`) for the switcher on both platforms: VS Code and
Zed use physical Ctrl+Tab on macOS too, since `⌘Tab` belongs to the OS app switcher.
Precedent for literal-Ctrl chords in the catalog: `burner-toggle` (`Ctrl+Backquote`) and
the `focus-pane-*` arrows. `Tab` carries no meaning for a PTY under these modifiers, and
CodeMirror's Tab handling is modifier-less — no focus-scoped owner competes.

**Group migration:** `new-session`, `session-prev`, and `session-next` move from group
`'Global'` to `'Sessions'`. Grouping is cosmetic — persisted overrides key off the command
id — but the settings pane must list the new group: add `'Sessions'` to `GROUP_ORDER` in
`KeymapPane.tsx` (after `'Global'`). Resulting Sessions group: 6 rows.

## 4. MRU Model

A recency list of session ids, most-recent-first. **Derived by reconciliation, not by
instrumenting activation call sites** — activation is not a single path
(`useActiveSessionController` writes optimistically and rolls back on IPC failure; restore
uses the raw setter; removal has failure returns before state actually changes), so the
MRU folds over _committed_ state instead:

- **Owner:** a small reconciliation effect colocated with `useSessionManager` state,
  observing committed `activeSessionId` and `sessions`.
- **On committed `activeSessionId` change to a non-null id:** move that id to the front.
  The optimistic-write + rollback sequence is self-healing under this rule: optimistic B
  moves B to front, rollback to A moves A back to front — the pre-failure order returns.
- **On `sessions` change:** drop ids no longer present (prunes only after a removal
  actually commits — a failed removal never touches the MRU); append ids never seen
  before at the back (covers restore-time additions that were never activated).
- **Seed:** first reconciliation pass yields visible tab-strip order with the restored
  active session at front.
- **Storage:** in-memory only (state/ref in the hook). No backend or settings
  persistence.
- **Read surface:** the switcher receives `mruSessionIds` plus the session summaries it
  needs (id, title, agent) via existing session context — no new IPC.

## 5. MRU Switcher Overlay

### Interaction contract

1. `session-switch-next` keydown while closed → overlay opens listing the sessions of the
   visible tab strip in MRU order, selection on index 1 (the previous session); with a
   single session the overlay still opens with index 0 selected (harmless, matches VS
   Code). Zero sessions: the hook no-ops. `session-switch-prev` opens with the last entry
   selected.
2. While open, further `session-switch-next` / `session-switch-prev` chords — autorepeat
   included (`event.repeat` advances; do **not** early-return on repeat like the nav hooks
   do) — move the selection with wraparound.
3. **Commit on modifier release:** when the modifiers of the _resolved_ opening chord are
   all released, commit `setActiveSessionId(selectedId)` once, close, and restore focus
   (contract below). A quick tap therefore lands on MRU[1] — the "bounce to last session"
   idiom.
4. `Escape` cancels — no activation, MRU untouched, focus restored.
5. `Enter` or clicking an entry commits that entry immediately; pointer-down outside the
   overlay cancels.
6. Window blur while open cancels.
7. Session list changes while open (e.g. a session exits): reconcile the list; if the
   selected id disappeared, clamp selection to the nearest entry.
8. No preview switching: activation is a single commit; cancelling never touches session
   state.

### Keyup robustness (no native keyup transport exists)

Both native bridges synthesize **keydown only** (browser forwarding explicitly ignores
non-keyDown input; the Ghostty proxy dispatches a synthesized keydown). The design does
not add keyup transport. Instead:

- The owning hook mounts its capture-phase `keydown` **and** `keyup` document listeners
  **statically** (at workspace mount), gated by an open-state ref — never installed by an
  open-triggered effect, so there is no installation race against a fast release.
- **Lost-keyup fallback:** while open, any observed keyboard event whose live modifier
  state no longer includes the opening chord's modifiers (e.g. `event.ctrlKey === false`
  for the default binding) triggers the commit path, exactly as a keyup would.
- Residual case — release before renderer focus lands and no further input: the overlay
  stays open until the next input event or blur resolves it. Bounded and acceptable;
  integration tests must cover press/hold/release sequences originating from the app
  renderer, a browser pane, and a Ghostty pane (where the runner allows).

### Overlay stacking across native surfaces

A plain DOM modal would render **behind** native surfaces, even while receiving keys:

- **Browser panes:** `WebContentsView` occlusion is driven by explicit overlay-stack
  registrations (`OverlayStackProvider`, `WorkspaceOverlayRegistrations.tsx`) — the
  switcher registers there like the palette and dialogs do.
- **Ghostty native panes (packaged macOS):** existing global dialogs render through the
  dedicated native-overlay window (`nativeOverlay.ts`, `NativeOverlayHost.tsx`), whose
  payload currently supports the command palette and new-session dialogs — extend it with
  a session-switcher payload/renderer following the same pattern.
- The overlay carries the dialog marker `DIALOG_SELECTOR` matches, so sibling
  capture-phase hooks (`useSessionNavShortcut` etc.) defer without per-hook changes.
- The Ghostty forwarding proxy's `shouldRefocus` return must report "do not refocus"
  while the switcher is open, so the native surface does not steal focus back mid-hold.

### Focus restore

`setActiveSessionId` focuses **browser** sessions only; it does not focus terminal panes.
On both commit and cancel the switcher invokes an explicit focus-restoration callback
wired the same way existing workspace navigation restores terminal focus —
`claimTerminal` routing through `TerminalZone`/`SplitView` (`WorkspaceView.tsx`). The
next keystroke after a switch must reach the activated session's pane.

### Dispatch

One hook owns open **and** advance: capture-phase `document` keydown guarded like
`useSessionNavShortcut` (`isKeymapCaptureTarget`, text-entry defer except the terminal
zone, dialog defer _except its own overlay_). `matches(event, id)` comes from
`useKeybindings()` — rebinds apply live. The main-process `before-input-event` palette
matcher is **not** extended; per the 2026-07-15 engine addendum the Ghostty snapshot
transport propagates new global catalog entries without allowlist edits (verify during
implementation), and the browser path needs its explicit id-set additions
(`BROWSER_WORKSPACE_SHORTCUT_IDS_TO_FORWARD`): `session-switch-next`,
`session-switch-prev`, `session-close`.

### UI

A minimal centered list — session title, agent identity, active marker — styled with Lens
theme tokens and the existing modal/glass conventions, consistent with
`docs/design/UNIFIED.md` surface rules. Component details land at implementation.

## 6. `session-close` and the macOS Menu

`session-close` invokes the **same guarded close callback `WorkspaceView` supplies to
`Tabs`** (`handleRemoveSession`) — the path that checks unsaved editor buffers and shows
the confirmation dialog before delegating to the session manager. It does **not** call
the manager's raw `removeSession` (which is unguarded and returns `void`). No active
session → no-op.

**macOS conflict:** `electron/edit-menu.ts` uses `role: 'fileMenu'`, which implicitly
registers Close `⌘W` → today `⌘W` closes the whole window, and a menu accelerator beats
any renderer handler. Change: replace `role: 'fileMenu'` with an explicit File submenu
whose Close Window item **loses its accelerator** (item remains clickable). This follows
the VIM-306 precedent of trimming mac menu accelerators and keeps settings rebinds working
without menu rebuilds.

**Linux:** the non-mac template (devtools/fullscreen only) is untouched. Bare `Ctrl+W`
keeps reaching the PTY as delete-word-backward — which is exactly why the Linux default is
`Ctrl+Shift+W`.

## 7. Settings Integration

Nothing bespoke: `KeymapPane` renders every catalog row per group with rebind UI for
`rebindable` commands. Work is limited to the `'Sessions'` entry in `GROUP_ORDER` and the
group moves from §3. Resulting Sessions group (6 rows): `new-session`, `session-prev`,
`session-next`, `session-switch-next`, `session-switch-prev`, `session-close`. Conflict
detection on rebind is the existing `conflicts.ts` machinery — no changes.

## 8. Deferred: Digit Jump to Session N (and why)

The original draft bound `session-jump-1..9` to `Mod+Shift+1..9`. Review killed every
viable default tier; recorded here so it is not re-derived:

1. **Pane-digit tolerance is a layout contract, not slack.** `focus-pane-1..9`
   (`Mod+Digit1..9`, `matchPolicy: 'tolerant'`) matches through held Shift **and** Alt
   deliberately: AZERTY layouts require Shift to produce digits at all, AltGr layouts
   require Alt (`usePaneShortcuts.test.ts` encodes this; the engine spec documents it).
   Flipping to `exact` breaks non-US pane focus; therefore any chord that is
   `Mod+<secondary>+digit` is permanently shadowed by pane focus.
2. **`intentionalShadowWith` grants no runtime priority.** It only suppresses conflict
   reporting; two capture-phase document listeners both fire (`stopPropagation` does not
   stop same-target listeners), so a "shadowed but still bound" jump would double-execute.
3. **macOS reserves `Cmd+Shift+3/4/5` (and `6` on Touch Bar Macs) for screenshots**,
   intercepted before Electron sees the event.
4. **Linux has no second super:** `Mod` resolves to Ctrl, so every Ctrl-based digit chord
   is a modifier-superset of pane focus; bare `Alt+digit` violates the one-super
   invariant.

Digit jump returns only if one of these changes: a runtime-precedence dispatcher, a
per-platform tier that is genuinely free (none found), or relaxing the layout-tolerance
contract. MRU switching, `session-prev/next`, tab clicks, and the palette cover the
switching story in v1.

## 9. Edge Cases

- **Zero / one session:** switcher no-ops / opens inert with a single entry; close
  no-ops without an active session.
- **Held Ctrl + Tab autorepeat:** advances selection (contract §5.2).
- **Rebind conflicts:** caught at rebind time by existing `conflicts.ts` fixpoint; the
  three new defaults introduce no default-chord conflicts (`Tab` is otherwise unbound;
  `KeyW` chords are free in the catalog).
- **Overlay open + session self-exits:** reconcile + clamp (contract §5.7).
- **Missed keyup:** modifier-absent fallback, pointer-down-outside cancel, window-blur
  cancel (§5); no path leaves a stuck overlay past the next input event.
- **Activation IPC failure mid-switch:** `useActiveSessionController` rolls back; the MRU
  reconciliation self-heals (§4); the overlay is already closed — no special handling.
- **Non-US layouts:** unaffected — no digit-tier chords ship (§8), and `Tab`/`KeyW` are
  physical `event.code` matches.

## 10. Testing

- **Catalog:** new entries, group membership, one-super invariant, exact policies
  (`catalog.test.ts`, `resolve.test.ts`); explicit assertion that pane-digit rows remain
  `tolerant` (regression guard for §8.1).
- **MRU reconciliation unit tests:** committed-activation reorder, optimistic-rollback
  self-heal, prune-on-committed-removal only, restore-time append, seeding.
- **Switcher hook/component:** open/advance (incl. autorepeat), keyup commit,
  modifier-absent fallback, Escape / outside-click / blur cancel, single-session,
  list mutation while open, statically-mounted listener (no open-effect race).
- **Close hook:** invokes the guarded `WorkspaceView` callback (not raw
  `removeSession`); unsaved-buffer confirmation still appears; guard matrix mirrors
  `useSessionNavShortcut.test.ts`.
- **Overlay stacking:** overlay-stack registration test (browser occlusion) and
  native-overlay payload test for the new switcher renderer.
- **Settings:** Sessions group renders with all 6 rows.
- **Electron/e2e:** `keymap-bindings.spec.ts` — Ctrl+Tab commit-on-release to last
  session, Mod+W confirm flow, press/hold/release originating from browser and Ghostty
  panes where the runner allows; browser-pane forwarding test for the new ids; mac menu
  template test asserting no `⌘W` accelerator remains.

## 11. Touch List

| Area                                                                      | Change                                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/features/keymap/catalog.ts`                                          | +3 commands, Sessions group moves (pane digits untouched)              |
| `src/features/settings/components/panes/KeymapPane.tsx`                   | `GROUP_ORDER` + `'Sessions'`                                           |
| `src/features/sessions/hooks/` (new)                                      | MRU reconciliation hook                                                |
| new `src/features/sessions/components/SessionSwitcher*`                   | overlay component + owning hook                                        |
| `src/features/workspace/WorkspaceView.tsx`                                | mount switcher, focus-restore (`claimTerminal`) + guarded-close wiring |
| `src/features/workspace/WorkspaceOverlayRegistrations.tsx`                | switcher overlay-stack registration                                    |
| `src/components/base/floating/nativeOverlay.ts` + `NativeOverlayHost.tsx` | session-switcher native-overlay payload/renderer                       |
| `electron/edit-menu.ts`                                                   | explicit File submenu, accelerator-less Close (macOS)                  |
| `electron/browser-pane.ts`                                                | forward-set += `session-switch-next/prev`, `session-close`             |
| `electron/ghostty-native-parent.ts`                                       | `shouldRefocus` switcher bit (verify snapshot auto-propagation)        |
| tests + `tests/e2e/terminal/specs/keymap-bindings.spec.ts`                | per §10                                                                |
