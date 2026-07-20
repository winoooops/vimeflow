# Session Switching Shortcuts — Design

> **2026-07-18 implementation addendum:** packaged-app e2e surfaced two
> settlement-window races in the switcher. (1) The overlay's _displayed_ order is
> the switchable set in MRU order with the currently active session hoisted to
> the front — identical once settlement completes (the active id is then
> MRU[0]), and correct during the optimistic window while an activation's IPC
> has not yet committed (`orderSwitcherSessionIds`). (2) §5's "dialog defer
> except its own overlay" explicitly includes the switcher's own dialog while it
> plays its exit animation — the closed-state guard excludes it by test id so a
> rapid re-open is not swallowed; foreign dialogs still defer. The §4
> committed-MRU contract is untouched by both.

**Status:** Accepted (codex APPROVE on round 7, 2026-07-18; rounds 1–6 findings applied.
Implemented on `feat/session-switching-keymap`).

**Linear:** not yet filed (Sessions component project).

**Related:** VIM-328 keymap unification (#698), Keybinding Engine spec
(`2026-06-15-keybinding-engine-design.md`, incl. the 2026-07-15 snapshot-transport addendum),
`agent/pane-directional-navigation` (Ctrl+Arrow pane focus, unmerged at time of writing).

---

## 1. Context & Problem

A Vimeflow **session** is the workspace unit — it owns a layout, panes, and a working
directory. Sessions render in the **sidebar sessions view** (`SessionsView` → `List`,
`src/features/sessions/components/List.tsx`); the former top tab strip is retired
(`Tabs.tsx` survives only in tests, and a top-chrome regression test asserts no tab strip
renders). The sidebar shows **two groups**: open sessions, then closed "Recent" sessions.

This design deliberately scopes to the **switchable set** —
`getVisibleSessions(sessions, activeSessionId)`, i.e. open sessions plus the active
session even if it is no longer open. Recent (closed) rows are **not** switcher or
successor targets: activating one means _resuming_ it, a heavier action that stays with
the sidebar and palette. The switchable set is therefore intentionally narrower than what
the sidebar displays, and the spec never equates the two.

Today's session switching is limited to sequential cycling (`session-prev` /
`session-next` on `⌘[` / `⌘]`, Linux `Ctrl+Shift+[` / `]`), sidebar clicks, and palette
commands. Compared to VS Code / Zed there is no **MRU switching** (Ctrl+Tab) and no
**close shortcut**. The approved direction (Approach A) is additive: keep `Mod+1..9` on
pane focus (which mirrors VS Code's editor-group digits) and add the missing session
layer. Every new shortcut is a catalog command so the Settings → Keymap pane can rebind
it (`KeymapPane.tsx` renders rows straight from `CATALOG`).

## 2. Goals & Non-Goals

**Goals**

1. MRU session switcher on `Ctrl+Tab` / `Ctrl+Shift+Tab` with VS Code hold-overlay
   semantics (release commits; quick tap bounces to the last session).
2. Close the active session on `Mod+W` (macOS) / `Ctrl+Shift+W` (Linux) with the
   sidebar's guard and focus behavior, successor drawn from the switchable set (§1).
3. Both rebindable from Settings → Keymap, grouped under a new **Sessions** group, and
   functional — visible and focusable — from every input surface (app renderer, Ghostty
   native panes, browser `WebContentsView` panes).

**Non-Goals**

- **Direct digit jump to session N** — dropped from v1 after review; the full analysis of
  why no viable default chord tier exists is preserved in §8.
- Fuzzy session picker (the command palette already reaches sessions by name).
- MRU persistence across relaunch (v1 is in-memory).
- Session reordering shortcuts.
- Keyup transport through the native input bridges (§5 defines fallbacks instead).
- Dynamic macOS menu accelerator rebuilds on rebind (the mac File menu stops advertising
  an accelerator instead — §6).

## 3. New Catalog Commands

All entries: `context: 'global'`, `matchPolicy: 'exact'`, `rebindable: true`, group
`'Sessions'`. Every default satisfies the exactly-one-super invariant (`Mod` xor `Ctrl`) —
which also guarantees any bound chord has a hold-able modifier, so the switcher's
release-to-commit phase always exists (no modifier-less degradation case).

| Command id            | Default (macOS)   | Default (Linux)  | Action                                    |
| --------------------- | ----------------- | ---------------- | ----------------------------------------- |
| `session-switch-next` | `⌃⇥` (`Ctrl+Tab`) | `Ctrl+Tab`       | Open MRU switcher / advance selection     |
| `session-switch-prev` | `⌃⇧⇥`             | `Ctrl+Shift+Tab` | Open MRU switcher / move selection back   |
| `session-close`       | `⌘W`              | `Ctrl+Shift+W`   | Close active session (sidebar-equivalent) |

Chord literals: `c('Tab', 'Ctrl')`, `c('Tab', 'Ctrl', 'Shift')`, and `session-close` as a
platform function `(isMac) => isMac ? c('KeyW', 'Mod') : c('KeyW', 'Mod', 'Shift')` — the
same shape `new-session` uses.

`Ctrl` is deliberately literal (not `Mod`) for the switcher on both platforms: VS Code and
Zed use physical Ctrl+Tab on macOS too, since `⌘Tab` belongs to the OS app switcher.
Precedent for literal-Ctrl chords in the catalog: `burner-toggle` (`Ctrl+Backquote`) and
the `focus-pane-*` arrows. `Tab` carries no meaning for a PTY under these modifiers, and
CodeMirror's Tab handling is modifier-less — no focus-scoped owner competes.

**Group migration:** `new-session`, `session-prev`, and `session-next` move from group
`'Global'` to `'Sessions'`. Grouping is cosmetic for dispatch — persisted overrides key
off the command id — but **two** settings allowlists must learn the group (§7).

## 4. MRU Model

A recency list of session ids, most-recent-first.

**Reorder records only successful activations.** Observing `activeSessionId` is not
enough: `useActiveSessionController` writes it optimistically and rolls it back in
`catch`, and an observer cannot tell optimistic, committed, and rollback values apart —
a failed activation would corrupt the order (e.g. `[A,C,B]` → optimistic `B` → rollback
leaves `[A,B,C]`, not the original). Instead:

- **Reorder point:** a single semantic **"activation committed"** notification exposed by
  the controller and raised on _every_ branch that finalizes an activation — resolved
  live-shell IPC **and** the immediate no-IPC branches (browser-only sessions,
  dead-shell placeholders, which deliberately skip PTY IPC). Raw activation writes
  (`setActiveSessionIdRaw`) never raise the notification — they are covered by the seed
  and the raw-write barrier below. A failed activation records nothing.
- **Serialized settlement (total commit order).** Today the controller launches
  activation IPC without awaiting it, so settlements can arrive in any order and no
  per-completion rule can reconcile them (review rounds 4–5 each found a diverging
  interleaving). The controller instead **serializes dispatch**: at most one activation
  request is in flight; requests arriving meanwhile **coalesce into a single pending
  target** (newest wins — coalesced-away requests are never dispatched and record
  nothing); when the in-flight request settles, the pending one dispatches. The no-IPC
  branches settle through the same queue (synchronously, in order). Settlement order now
  equals request order by construction — the inverted interleavings cannot occur.
- **Settlement rules.** The controller tracks `lastCommittedId`, seeded by restore-time
  raw activation. The optimistic UI behavior is unchanged (the UI shows the newest
  requested id immediately). On each settlement, in dispatch order:
  - **Success:** `lastCommittedId` = the settled id; raise the committed notification
    (MRU reorder). A dispatched intermediate during rapid cycling may transiently head
    the MRU — the backend genuinely visited it, and the final settlement corrects it.
  - **Failure with a newer request pending:** record nothing, do not touch the UI — the
    pending dispatch is about to supersede the failed one.
  - **Failure with nothing pending:** roll the UI back to `lastCommittedId`, reclaim
    focus, and raise the committed notification for the restored id. UI, backend,
    baseline, and MRU head converge on the last id the backend actually accepted.
- **Raw writes are queue barriers.** `setActiveSessionIdRaw` is not restore-only:
  removing the final session writes raw `null` in production. A raw write bumps the
  queue **generation**: the pending target is dropped, any in-flight settlement is
  invalidated (a settlement from an older generation applies **nothing** — no baseline
  update, no notification, no rollback), and `lastCommittedId` becomes the raw value. A
  `null` baseline never raises a committed notification. Nothing can resurrect a removed
  session in the baseline, UI, or MRU.
- **Membership reconciliation:** an effect observing the committed `sessions` array
  drops ids that left it (prunes only after a removal actually commits — a failed
  removal never touches the MRU) and appends never-seen ids at the back (restore-time
  additions that were never activated).
- **Seed:** first pass yields the visible session order with the restored active session
  at front.
- **Storage:** in-memory only (state/ref colocated with `useSessionManager` state). No
  backend or settings persistence.
- **Read surface:** the switcher receives `mruSessionIds` plus the session summaries it
  needs (id, title, agent) via existing session context — no new IPC.

## 5. MRU Switcher Overlay

### Interaction contract

1. `session-switch-next` keydown while closed → overlay opens listing the **switchable
   set** (§1) in MRU order, selection on index 1 (the previous session); with a
   single session the overlay still opens with index 0 selected (harmless, matches VS
   Code). Zero sessions: the hook no-ops. `session-switch-prev` opens with the last entry
   selected.
2. While open, further `session-switch-next` / `session-switch-prev` chords — autorepeat
   included (`event.repeat` advances; do **not** early-return on repeat like the nav hooks
   do) — move the selection with wraparound.
3. **Commit on modifier release:** when the modifiers of the _resolved_ opening chord are
   all released, commit the activation once (through the controller path, §4), close, and
   restore focus (contract below). A quick tap therefore lands on MRU[1] — the "bounce to
   last session" idiom.
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
  registrations (`src/features/workspace/overlays/OverlayStackProvider.tsx`,
  `WorkspaceOverlayRegistrations.tsx`) — the switcher registers there like the palette
  and dialogs do.
- **Ghostty native panes (packaged macOS):** existing global dialogs render through the
  dedicated native-overlay window. That path has **two halves**, and both must learn the
  new payload: the renderer payload/host
  (`src/components/base/floating/nativeOverlay.ts`, `NativeOverlayHost.tsx`) **and** the
  Electron main-process schema/validator (`electron/native-overlay.ts`), which currently
  accepts only the `command-palette` and `new-session` dialog discriminants and rejects
  anything else as `invalid-payload` — a renderer-only extension would silently fall back
  to the DOM overlay that Ghostty occludes. Extend both, with payload-validation and
  bounds tests.
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

The sidebar `List` already wraps removal with the complete keyboard-safe behavior
(`List.tsx` `handleRemoveSession`): pick the visible successor via
`pickNextVisibleSessionId` **before** removing, call the guarded close callback
(`WorkspaceView` supplies it; it checks unsaved editor buffers and can cancel via the
`didRemove === false` sentinel), then activate the successor and restore focus. The
manager's raw `removeSession` has none of these guards, and `WorkspaceView`'s bare
callback alone would leave successor selection to the manager's full-array fallback —
which can pick a non-visible session.

**Design:** hoist the `List` wrapper into a shared helper (sessions feature) consumed by
both the sidebar and the new `useSessionCloseShortcut`, so keyboard close is
behavior-identical to clicking the sidebar close button — guard, successor, focus. The
shortcut targets the active session; no active session → no-op. (The shortcut's focus
lands on the successor's pane via the same activation path, not on a sidebar button —
the helper takes the focus-restore strategy as an input.) The successor domain is the
switchable set (§1), matching `pickNextVisibleSessionId` semantics — closing an
active-but-no-longer-open session hands off to the next _open_ session, which may not be
the visually adjacent sidebar row (Recent rows are never close-successor targets).

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

Two allowlists gate a catalog group's presence in Settings, and both need `'Sessions'`:

1. `GROUP_ORDER` in `KeymapPane.tsx` — renders the group's rows (after `'Global'`).
2. `KEYMAP_TARGET_GROUPS` in `src/features/settings/sections.ts` — generates the
   searchable/navigable settings targets (`SETTINGS_TARGETS` filters the catalog by this
   set); without it the new commands render but are undiscoverable via settings search.

Resulting Sessions group (6 rows): `new-session`, `session-prev`, `session-next`,
`session-switch-next`, `session-switch-prev`, `session-close`. Rebind UI and conflict
detection are the existing machinery — no changes.

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
contract. MRU switching, `session-prev/next`, sidebar clicks, and the palette cover the
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
- **Activation IPC failure on switcher commit:** the controller rolls back state and
  reclaims focus (§4); nothing was recorded in the MRU; the overlay is already closed —
  the user observes the original session, unchanged order.
- **Rapid cycling (B then C requested before B's IPC resolves):** serialization (§4)
  holds C until B settles; each settlement applies in order, so the MRU head always
  reflects the final selection and UI/backend never diverge. Requests coalesced away
  before dispatch (B→C→D faster than settlement) are never sent and record nothing.
- **Closing the last session while an activation is in flight:** the raw `null` write is
  a queue barrier (§4) — the in-flight settlement is generation-invalidated and any
  pending target dropped; the removed session cannot reappear in baseline or MRU.
- **Close guard cancellation:** the shared helper's `didRemove === false` sentinel stops
  successor activation — identical to cancelling from the sidebar.
- **Non-US layouts:** unaffected — no digit-tier chords ship (§8), and `Tab`/`KeyW` are
  physical `event.code` matches.

## 10. Testing

- **Catalog:** new entries, group membership, one-super invariant, exact policies
  (`catalog.test.ts`, `resolve.test.ts`); explicit assertion that pane-digit rows remain
  `tolerant` (regression guard for §8.1).
- **MRU unit tests:** success-only reorder (a rejected activation with a **nontrivial
  permutation** — e.g. `[A,C,B]` — leaves the order untouched), commit notification on
  the no-IPC branches (browser-only session activation reorders), serialization (a
  second request never dispatches before the first settles; rapid B→C→D coalesces to D),
  the settlement matrix (`B✓C✓` final C; `B✓C✗` all channels land on B; `B✗C✓` final C
  with no intermediate rollback flash; `B✗C✗` all land on A), restore-time raw
  activation seeds `lastCommittedId`, raw-write barrier (raw `null` during an in-flight
  activation — with and without a pending target — drops the pending dispatch, the
  invalidated settlement applies nothing, and no notification fires for `null`; a
  post-barrier request still waits for the physically unresolved stale IPC before
  dispatching — one in flight always),
  prune-on-committed-removal only, restore-time append, seeding incl. a PTY-restored
  active session seeding first; controller rollback reclaims terminal focus (focused
  element asserted after rejection).
- **Switcher hook/component:** open/advance (incl. autorepeat), keyup commit,
  modifier-absent fallback, Escape / outside-click / blur cancel, single-session,
  list mutation while open, statically-mounted listener (no open-effect race).
- **Close:** shared helper used by both sidebar `List` and the shortcut (successor
  choice, guard sentinel, focus restore asserted once, in the helper's tests); shortcut
  guard matrix mirrors `useSessionNavShortcut.test.ts`.
- **Overlay stacking:** overlay-stack registration test (browser occlusion);
  native-overlay payload tests on **both** halves — renderer payload/renderer and
  `electron/native-overlay.ts` validation (new discriminant accepted, unknown still
  rejected, bounds behavior).
- **Settings:** Sessions group renders (KeymapPane) **and** its targets appear in the
  settings search index (`sections.ts` target tests).
- **Electron/e2e:** `keymap-bindings.spec.ts` — Ctrl+Tab commit-on-release to last
  session, Mod+W confirm flow, press/hold/release originating from browser and Ghostty
  panes where the runner allows; browser-pane forwarding test for the new ids; mac menu
  template test asserting no `⌘W` accelerator remains.

## 11. Touch List

| Area                                                                      | Change                                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/features/keymap/catalog.ts`                                          | +3 commands, Sessions group moves (pane digits untouched)                                        |
| `src/features/settings/components/panes/KeymapPane.tsx`                   | `GROUP_ORDER` + `'Sessions'`                                                                     |
| `src/features/settings/sections.ts`                                       | `KEYMAP_TARGET_GROUPS` + `'Sessions'` (+ target-index tests)                                     |
| `src/features/sessions/hooks/` (new)                                      | MRU state (controller-success reorder + membership reconciliation)                               |
| `src/features/sessions/hooks/useActiveSessionController.ts`               | serialized settlement queue + raw-write barrier; committed notification; baseline; focus reclaim |
| new `src/features/sessions/components/SessionSwitcher*`                   | overlay component + owning hook                                                                  |
| `src/features/sessions/` (shared close helper)                            | hoisted `List.tsx` close wrapper (guard, successor, focus strategy)                              |
| `src/features/sessions/components/List.tsx`                               | consume the shared close helper                                                                  |
| `src/features/workspace/WorkspaceView.tsx`                                | mount switcher, focus-restore (`claimTerminal`) + close-shortcut wiring                          |
| `src/features/workspace/overlays/WorkspaceOverlayRegistrations.tsx`       | switcher overlay-stack registration                                                              |
| `src/components/base/floating/nativeOverlay.ts` + `NativeOverlayHost.tsx` | session-switcher native-overlay payload/renderer                                                 |
| `electron/native-overlay.ts`                                              | payload schema/validator + bounds for the new discriminant                                       |
| `electron/edit-menu.ts`                                                   | explicit File submenu, accelerator-less Close (macOS)                                            |
| `electron/browser-pane.ts`                                                | forward-set += `session-switch-next/prev`, `session-close`                                       |
| `electron/ghostty-native-parent.ts`                                       | `shouldRefocus` switcher bit (verify snapshot auto-propagation)                                  |
| tests + `tests/e2e/terminal/specs/keymap-bindings.spec.ts`                | per §10                                                                                          |
