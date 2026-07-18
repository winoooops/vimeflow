# Session Switching Shortcuts — Design

**Status:** Draft (codex review pending).

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

Compared to VS Code / Zed there is no **MRU switching** (Ctrl+Tab), no **direct index
jump**, and no **close shortcut**. The approved direction (Approach A) is additive: keep
`Mod+1..9` on pane focus (which mirrors VS Code's editor-group digits) and add the missing
session layer. Every new shortcut is a catalog command so the Settings → Keymap pane can
rebind it (`KeymapPane.tsx` renders rows straight from `CATALOG`).

## 2. Goals & Non-Goals

**Goals**

1. MRU session switcher on `Ctrl+Tab` / `Ctrl+Shift+Tab` with VS Code hold-overlay
   semantics (release commits; quick tap bounces to the last session).
2. Direct jump to session N in tab-strip order on `Mod+Shift+1..9`.
3. Close the active session on `Mod+W` (macOS) / `Ctrl+Shift+W` (Linux) through the
   existing confirm flow.
4. All of the above rebindable from Settings → Keymap, grouped under a new **Sessions**
   group, and functional from every input surface (app renderer, Ghostty native panes,
   browser `WebContentsView` panes).

**Non-Goals**

- Fuzzy session picker (the command palette already reaches sessions by name).
- MRU persistence across relaunch (v1 is in-memory).
- Tab reordering shortcuts; jumping past index 9.
- Dynamic macOS menu accelerator rebuilds on rebind (the mac File menu stops advertising
  an accelerator instead — §7).

## 3. New Catalog Commands

All entries: `context: 'global'`, `matchPolicy: 'exact'`, `rebindable: true`, group
`'Sessions'`. Every default satisfies the exactly-one-super invariant (`Mod` xor `Ctrl`).

| Command id                          | Default (macOS)   | Default (Linux)   | Action                                     |
| ----------------------------------- | ----------------- | ----------------- | ------------------------------------------ |
| `session-switch-next`               | `⌃⇥` (`Ctrl+Tab`) | `Ctrl+Tab`        | Open MRU switcher / advance selection      |
| `session-switch-prev`               | `⌃⇧⇥`             | `Ctrl+Shift+Tab`  | Open MRU switcher / move selection back    |
| `session-jump-1` … `session-jump-9` | `⌘⇧1..9`          | `Ctrl+Shift+1..9` | Activate Nth session in tab-strip order    |
| `session-close`                     | `⌘W`              | `Ctrl+Shift+W`    | Close active session (confirm flow intact) |

Chord literals: `c('Tab', 'Ctrl')`, `c('Tab', 'Ctrl', 'Shift')`, `c('DigitN', 'Mod',
'Shift')`, and `session-close` as a platform function `(isMac) => isMac ? c('KeyW', 'Mod')
: c('KeyW', 'Mod', 'Shift')` — the same shape `new-session` uses.

`Ctrl` is deliberately literal (not `Mod`) for the switcher on both platforms: VS Code and
Zed use physical Ctrl+Tab on macOS too, since `⌘Tab` belongs to the OS app switcher.
Precedent for literal-Ctrl chords in the catalog: `burner-toggle` (`Ctrl+Backquote`) and
the `focus-pane-*` arrows.

**Group migration:** `new-session`, `session-prev`, and `session-next` move from group
`'Global'` to `'Sessions'`. Grouping is cosmetic — persisted overrides key off the command
id — but the settings pane must list the new group: add `'Sessions'` to `GROUP_ORDER` in
`KeymapPane.tsx` (after `'Global'`).

## 4. Prerequisite: `focus-pane-1..9` Flip `tolerant` → `exact`

`match.ts` treats non-required modifiers as _ignored_ under `tolerant` — a held Shift does
not disqualify the match. Consequently `Mod+Shift+Digit1` **already fires `focus-pane-1`
today**, and would shadow `session-jump-1`.

There is no alternative digit tier on Linux: `Mod` resolves to Ctrl (so `Ctrl+digit` _is_
pane focus), and a bare-`Alt` chord violates the one-super invariant. `Mod+Shift+digit` is
the only consistent cross-platform choice, so the pane digits flip to `matchPolicy:
'exact'`.

- `dock-toggle` (`Mod+Digit0`) stays `tolerant` — no session command claims `Digit0`.
- The remaining `tolerant` rows (`focus-pane-left/down/up/right`, `cycle-layout`) are
  untouched — no new chord is a modifier-superset of them.
- **Implementation gate:** `git blame` the original tolerant choice before flipping; the
  conflict detector (`conflicts.ts`) and `resolve.test.ts` must pass with the flip, and the
  existing pane-digit e2e specs must stay green. If tolerance turns out to protect a real
  behavior (e.g. a layout quirk), the fallback is declaring
  `intentionalShadowWith` pairs — but exact-flip is the intended outcome.

## 5. MRU Model

A recency list of session ids, most-recent-first:

- **Owner:** `useSessionManager`, alongside `activeSessionId` — the move-to-front update
  happens inside the same code path that commits `setActiveSessionId`, so _every_
  activation route (tab click, palette, prev/next cycling, digit jump, switcher commit,
  session creation) maintains it. No secondary writer.
- **Prune:** on session close/removal, drop the id.
- **Seed:** on startup, visible tab-strip order with the restored active session moved to
  front. (Sessions restore across relaunch; the MRU refinement of that order does not.)
- **Storage:** in-memory only (state/ref in the hook). No backend or settings persistence.
- **Read surface:** the switcher receives `mruSessionIds` plus the session summaries it
  needs (id, title, agent) via existing session context — no new IPC.

## 6. MRU Switcher Overlay

### Interaction contract

1. `session-switch-next` keydown while closed → overlay opens listing open sessions in MRU
   order, selection on index 1 (the previous session); with a single session the overlay
   still opens with index 0 selected (harmless, matches VS Code). `session-switch-prev`
   opens with the last entry selected.
2. While open, further `session-switch-next` / `session-switch-prev` chords — autorepeat
   included (`event.repeat` advances; do **not** early-return on repeat like the nav hooks
   do) — move the selection with wraparound.
3. **Commit on modifier release:** when the modifiers of the _resolved_ opening chord are
   all released (`keyup` tracking installed only while open), commit
   `setActiveSessionId(selectedId)` once, close, and restore focus to the active pane.
   A quick tap therefore lands on MRU[1] — the "bounce to last session" idiom.
4. `Escape` cancels — no activation, MRU untouched, focus restored.
5. `Enter` / clicking an entry commits that entry immediately.
6. Window blur while open cancels (a missed keyup must never leave a stuck overlay).
7. Session list changes while open (e.g. a session exits): reconcile the list; if the
   selected id disappeared, clamp selection to the nearest entry.
8. **Rebind degradation:** if the user rebinds the switcher to a modifier-less chord,
   there is no "hold" phase — commit MRU[1] immediately on keydown (documented in the
   settings pane description string, not a hard error).
9. No preview switching: activation is a single commit; cancelling never touches session
   state.

### Mechanics

- The overlay is a **focus-stealing modal** rendered in the workspace root, carrying the
  same dialog marker `DIALOG_SELECTOR` matches — sibling capture-phase hooks
  (`useSessionNavShortcut` etc.) already defer to open dialogs, so no per-hook changes.
- One hook owns open **and** advance: a capture-phase `document` keydown listener guarded
  like `useSessionNavShortcut` (`isKeymapCaptureTarget`, text-entry defer except the
  terminal zone, dialog defer _except its own overlay_). Advancing is handled there rather
  than in overlay-local listeners so the capture-phase order stays deterministic.
- `matches(event, id)` comes from `useKeybindings()` — rebinds apply live.

### Cross-surface focus mechanics

- **Ghostty native panes:** per the 2026-07-15 engine addendum, native layers match the
  versioned snapshot directly — a new global catalog entry propagates without allowlist
  edits (verify during implementation). The forwarding path
  (`forwardShortcutToAppRenderer`, `electron/ghostty-native-parent.ts`) already calls
  `win.webContents.focus()` before dispatching the synthesized keydown, so the moment the
  overlay opens and takes DOM focus, subsequent Tab keydowns and the Ctrl keyup arrive in
  the renderer natively. The proxy's `shouldRefocus` return must report "do not refocus"
  while the overlay is open, so the native surface does not steal focus back mid-hold;
  focus returns to the pane on commit/cancel via the normal restore path.
- **Browser panes:** `BROWSER_WORKSPACE_SHORTCUT_IDS_TO_FORWARD`
  (`electron/browser-pane.ts`) is an explicit id set — add `session-switch-next`,
  `session-switch-prev`, `session-jump-1..9`, and `session-close`. Same focus argument
  applies once the overlay is open.
- The main-process `before-input-event` palette matcher is **not** extended; renderer DOM
  dispatch plus the existing forwarding paths cover all surfaces.

### UI

A minimal centered list — session title, agent identity, active marker — styled with Lens
theme tokens and the existing modal/glass conventions. Small enough to not need its own
design doc; component details land at implementation, consistent with
`docs/design/UNIFIED.md` surface rules.

## 7. `session-close` and the macOS Menu

`session-close` calls the existing `removeSession(activeSessionId)` flow
(`SessionCloseResult`), i.e. exactly what the tab close button does — running-agent
confirmation included. No active session → no-op.

**macOS conflict:** `electron/edit-menu.ts` uses `role: 'fileMenu'`, which implicitly
registers Close `⌘W` → today `⌘W` closes the whole window, and a menu accelerator beats
any renderer handler. Change: replace `role: 'fileMenu'` with an explicit File submenu
whose Close Window item **loses its accelerator** (item remains clickable). This follows
the VIM-306 precedent of trimming mac menu accelerators and keeps settings rebinds working
without menu rebuilds.

**Linux:** the non-mac template (devtools/fullscreen only) is untouched. Bare `Ctrl+W`
keeps reaching the PTY as delete-word-backward — which is exactly why the Linux default is
`Ctrl+Shift+W`.

## 8. `session-jump-N`

Index = 1-based position in the visible tab-strip order (`getVisibleSessions()`, open
sessions only) — the same order the user sees. `N` beyond the session count: no-op.
Activation goes through `setActiveSessionId`, so MRU updates for free. Guards mirror the
pane-digit hook (fires from terminal and chrome; defers to text entry outside the
terminal zone and to open dialogs).

## 9. Settings Integration

Nothing bespoke: `KeymapPane` renders every catalog row per group with rebind UI for
`rebindable` commands. Work is limited to the `'Sessions'` entry in `GROUP_ORDER` and the
group moves from §3. Resulting Sessions group (15 rows): `new-session`, `session-prev`,
`session-next`, `session-switch-next`, `session-switch-prev`, `session-jump-1..9`,
`session-close`. Conflict detection on rebind is the existing `conflicts.ts` machinery —
no changes.

## 10. Edge Cases

- **Zero / one session:** switcher opens inert (single entry) or not at all (zero —
  guard); jump and close no-op safely.
- **Held Ctrl + repeated Tab autorepeat:** advances selection (contract §6.2).
- **Chord rebound to conflict:** caught at rebind time by existing conflict detection;
  the catalog additions themselves introduce no default-chord conflicts once §4 lands
  (verified by `conflicts.ts` fixpoint in `resolve.test`).
- **Overlay open + session self-exits:** reconcile + clamp (contract §6.7).
- **Missed keyup (window blur, focus theft):** cancel on blur (contract §6.6).
- **CodeMirror / inputs:** `Ctrl+Tab` and `Mod+Shift+digit` carry no editor meaning; the
  standard text-entry guard still defers outside the terminal zone for consistency.

## 11. Testing

- **Catalog:** entries, group membership, one-super invariant, exact policies, and the
  §4 flip (`catalog.test.ts`, `resolve.test.ts`, `match.test.ts`).
- **MRU unit tests:** activation reorder, close pruning, seeding, new-session front
  insertion.
- **Switcher hook/component:** open/advance (incl. autorepeat), keyup commit, Escape and
  blur cancel, single-session, list mutation while open, modifier-less degradation.
- **Jump + close hooks:** mirror `useSessionNavShortcut.test.ts` guard matrix.
- **Settings:** Sessions group renders with all 15 rows.
- **Electron/e2e:** `keymap-bindings.spec.ts` — Ctrl+Tab commit-on-release to last
  session, Mod+Shift+digit jump, Mod+W confirm flow; browser-pane forwarding test for the
  new ids; mac menu template test asserting no `⌘W` accelerator remains.

## 12. Touch List

| Area                                                       | Change                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| `src/features/keymap/catalog.ts`                           | +12 commands, Sessions group moves, pane-digit `exact` flip    |
| `src/features/settings/components/panes/KeymapPane.tsx`    | `GROUP_ORDER` + `'Sessions'`                                   |
| `src/features/sessions/hooks/useSessionManager.ts`         | MRU list + move-to-front in the activation path                |
| new `src/features/sessions/components/SessionSwitcher*`    | overlay component + owning hook                                |
| `src/features/workspace/hooks/` (new)                      | `useSessionJumpShortcut`, `useSessionCloseShortcut`            |
| `src/features/workspace/WorkspaceView.tsx`                 | mount switcher + hooks                                         |
| `electron/edit-menu.ts`                                    | explicit File submenu, accelerator-less Close (macOS)          |
| `electron/browser-pane.ts`                                 | forward-set additions                                          |
| `electron/ghostty-native-parent.ts`                        | `shouldRefocus` overlay bit (verify snapshot auto-propagation) |
| tests + `tests/e2e/terminal/specs/keymap-bindings.spec.ts` | per §11                                                        |
