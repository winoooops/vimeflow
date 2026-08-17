# Session Card Agent Rows — Design

**Date:** 2026-08-05
**Status:** Approved — visual pass applied from the Claude-design handoff
**Linear:** [VIM-423](https://linear.app/vimeflow/issue/VIM-423) (Sessions project)
**Surface:** Sidebar "Sessions" tab (`SessionsView` → `List` → `Card`)
**Visual reference:** `docs/superpowers/specs/2026-08-05-agent-rows-handoff/` (handoff MD + interactive mockup, copied from the design session)

## Goal

Each Active session card in the sidebar Sessions list always shows the coding
agents running inside that session's panes — one row per agent pane, grouped in
a tonal recess panel under the card's existing rows, with a state chip and the
agent's latest task message. Clicking a row jumps to that pane.

## Decisions (from design discussion + design handoff review)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Agent rows are **always on** in v1 — no per-card expand/collapse, no chevron, no avatar stack. A settings toggle plus a compact avatar-stack presentation for the "off" state is **v2**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2   | Per-row message comes from **existing sources** — the latest notification record per `ptyId` (`body ?? title`, newest by `occurredAt`), falling back to the pane label (`userLabel ?? agentTitle`), then to **`working on <cwd dir name>`**. No new `Pane` fields. `session.currentAction` is mock-only and is not used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3   | **Agents only.** Plain shell panes (tests, scripts, builds) and browser panes are excluded from v1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | Row click activates the session **and** focuses the clicked pane.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 5   | No notification-center chrome (mark read / clear all / unread badges) — this is a live status surface, not an inbox.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 6   | _(handoff)_ **Status word + dot removed; right slot removed.** The 22px state chip alone carries state; line 1 is the agent name; the message line gets the full remaining width. No relative time and no progress **bar** in the row — `ProgressBar` is not used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 7   | _(handoff)_ **Agent registry accents are not used in the row.** The chip is a universal, agent-agnostic state vocabulary; the name says _who_, the chip says _what's happening_.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 8   | _(adapted)_ Chip state colors use the semantic tokens **directly** in the component's exhaustive `Record` (`secondary`/`tertiary`/`error`/`success-muted`/`on-surface-muted`) rather than the handoff's `state-*` alias tokens — same theming behavior (themes recolor via semantics), one less indirection layer. Extract `state-*` tokens later iff a second surface adopts the vocabulary. `wash-recess` **is** added as a real token (it has genuinely new per-theme values).                                                                                                                                                                                                                                                                                                                                                                                                               |
| 9   | **Running ring = watcher lifecycle ∪ OSC 9;4 progress.** Verified plumbing: the `usePtyProgress` cache is OSC-only, and the #779 lifecycle-fallback merge happens at the pane-header consumption site, not in either source — so the row computes the union itself. The watcher leg is **`pane.agentPhase === 'running'`**, not bare `pane.status`: restore/spawn/restart paths hardcode `status: 'running'` as a PTY-liveness marker and a stale agent never emits a corrective lifecycle event (found in live review — restored sessions showed every agent as running). A `status: 'running'` pane without a running phase renders **idle**; live OSC progress re-upgrades idle to the running visual; decisive states (`awaiting`/`errored`/`completed`) are never overridden by stray progress. Today agents report only indeterminate progress → the ring spins; a determinate arc is v2. |

## v1 Behavior

### Card anatomy

Active session cards keep their existing three rows (title 13.5 / subtitle
11.5 / meta 10 mono) and gain a **rows recess panel** 6px below the meta row —
`bg-wash-recess rounded-lg p-1`, rows separated by `gap-px`. No borders;
grouping is tonal only. A single-agent card gets the same panel. Recent
(closed) session cards are unchanged; zero-agent cards render no panel.

### Agent row anatomy

33px-tall button, two-column grid `[22px chip | minmax(0,1fr) text]`, flush
with the card's text column so rows indent optically by their own chip:

- **Chip (22px, radius 6):** state fill + state glyph — running shows a
  rotating hairline ring (no glyph), `awaiting` `!`, `errored` `✕`,
  `completed` `✓`, `idle` `◦`. Fills stay ≤16% alpha so no row competes with
  the card-level notification badge, which remains the loud signal.
- **Line 1:** agent name — 11px medium, `text-on-surface-variant`, truncating
  (grid `minmax(0,1fr)` + `min-w-0` are load-bearing).
- **Line 2:** latest task message — 10.5px, `text-on-surface-muted`,
  truncating, full remaining width. Source chain per Decision 2.

Type ladder strictly descends: 13.5 title → 11.5 subtitle → 11 name → 10.5
message.

### State vocabulary

Base state is `pane.status` (live for background panes via the
`agent-lifecycle` listener), with two Decision-9 adjustments: `running`
requires `agentPhase === 'running'` (bare status-running downgrades to idle),
and `idle` renders as running while OSC progress is active. Exhaustive
`Record<SessionStatus, …>`:

| Display state                                                     | Chip                   | Tone (semantic token) |
| ----------------------------------------------------------------- | ---------------------- | --------------------- |
| running (`agentPhase === 'running'`, or idle + live OSC progress) | spinning hairline ring | `secondary`           |
| `awaiting`                                                        | `!`                    | `tertiary`            |
| `errored`                                                         | `✕`                    | `error`               |
| `completed`                                                       | `✓`                    | `success-muted`       |
| `idle`                                                            | `◦`                    | `on-surface-muted`    |

### Motion

Only the running ring animates (`animate-spin`);
`motion-reduce:animate-none` leaves a static ring with the same footprint.
`transition-colors` on row hover; nothing else.

### Interactions & a11y

- Card body click: activates the session (unchanged).
- Agent row click: activates the session and focuses that pane via
  `onFocusPane(sessionId, paneId)` threaded
  `WorkspaceView → SessionsView → List → Card`, wired to
  `handleSetActiveSessionId` + `setSessionActivePane`.
- Rows are buttons with
  `focus-visible:ring-1 focus-visible:ring-primary/45`. Because the visible
  status word was removed, a visually-hidden (`sr-only`) state label sits
  between name and message, so the accessible name reads
  `"<agent name> <state label> <message>"` with state labels running /
  needs you / error / finished / idle. Chip and glyphs are `aria-hidden`.
- The recess panel is `pointer-events-none` (padding and row gaps fall
  through to the card's activation button); each row button opts back in
  with `pointer-events-auto`.

## Data

### `deriveSessionAgents(session)`

Pure helper in `src/features/sessions/utils/` (next to `deriveSessionStatus`),
returning, in pane order:

```ts
{
  ;(paneId, ptyId, agent, status, label)
}
;[]
```

- Includes shell-kind panes whose agent resolves to a real coding agent via
  `agentForPane` (registry key not `shell`); excludes browser panes.
- Duplicates are expected (three Kimi panes yield three rows).
- `label` = `userLabel ?? agentTitle ?? 'working on <cwd dir name>'`.
- No stored rollup on `Session` — arrays derived from `panes` would go stale;
  `session.panes` already reaches `Card` via props.

### Latest record per pane

Pure selector over `notificationRecords` (already passed to `List` for
`sessionUnreadCategory`): newest record by `occurredAt` whose `ptyId` matches
the row's pane. Supplies the message only; `occurredAt` is used solely to pick
the newest.

### Live OSC progress

`usePtyProgress(service, ptyId, enabled)` per row — `getProgress` is a
synchronous ptyId-keyed cache on the terminal service plus one filtered
global subscription. The service is threaded
`WorkspaceView (terminalService) → SessionsView → List → Card → AgentRows` as
an optional `ProgressSource`. The hook is enabled only for `running`/`idle`
rows (the two states the Decision-9 union can affect); terminal states never
subscribe.

## Theme tokens

One new token, `wash-recess` — a darkening inset wash (`wash-faint` et al.
lighten in dark themes, so none of them can express a recess):

| Theme                      | Value                     |
| -------------------------- | ------------------------- |
| obsidian-lens (Catppuccin) | `rgba(0, 0, 0, 0.22)`     |
| gruvbox-dark               | `rgba(0, 0, 0, 0.24)`     |
| tokyo-night                | `rgba(0, 0, 0, 0.2)`      |
| dracula                    | `rgba(0, 0, 0, 0.2)`      |
| flexoki (light)            | `rgba(16, 15, 15, 0.045)` |
| gruvbox-light              | `rgba(16, 15, 15, 0.05)`  |

Added through the standard token pipeline: `types.ts` union → all six
`themes/*.ts` → `derive.ts` (`alpha('#000000', light ? 0.05 : 0.22)`) →
regenerate `theme.css` via `scripts/generate-theme-css.ts`. The guard tests
(`cssGuard` / `themeCss` / `types`) enforce completeness.

## Components

- `Card.tsx` renders the panel. Constraint: the card's activation surface is
  an absolute full-row `<button>` with `pointer-events-none` content, so the
  rows panel must be a _sibling_ of that button (the hover kebab pattern),
  `pointer-events-auto relative`, never nested inside the content wrapper.
- Row list is a co-located `AgentRows.tsx` under
  `src/features/sessions/components/`, kept dumb: props in
  (`session`, `records`, `service`, `onFocusPane`), callbacks out. Semantic
  `<ul>`/`<li>` even though the mockup used divs.
- No height animation: plain conditional render. The active list is a
  framer-motion `Reorder.Group` with `layout="position"`; card height changes
  only when agents appear/disappear.

## Edge cases

- Pane dies: `prunePane` already removes its records; the row disappears on
  the next `panes` update. Empty list removes the panel.
- Records cleared elsewhere: rows degrade to name + label fallback — live
  state chips are unaffected.
- OSC `remove` event: clears the progress cache entry; the ring then follows
  the watcher status alone. (The pane header's #779 ownership rule — "native
  progress owns the turn" — governs _value-bearing_ progress display; for a
  boolean running signal the plain union is the correct simplification, and
  the ring keeps spinning until the lifecycle leaves `running`.)
- All-shell session: no panel; the meta row's pane count still shows pane
  presence.
- Drag reorder: unchanged `Reorder` config; taller cards drag as-is.

## Testing

Co-located, Vitest with explicit imports, `test()` not `it()`:

- `deriveSessionAgents.test.ts` — agent filtering (shell/browser excluded),
  status passthrough, label precedence incl. `working on <dir>` fallback,
  pane ordering, duplicate agents.
- `useNotificationCenter.test.ts` — `latestPaneRecord` newest-wins per
  `ptyId`, missing-record case.
- Theme tests — `wash-recess` present in every theme + generated CSS (guard
  suites cover this once the token is registered).
- `AgentRows.test.tsx` — one row per agent pane, state exposed via accessible
  name, **idle + live progress renders as running / idle without progress
  stays idle**, message precedence chain, click reports
  `(sessionId, paneId)`, null render for zero agents.
- `Card.test.tsx` — rows render on active cards only, row click does not
  activate the card, Recent unchanged.

## v2 (explicitly deferred)

- Settings toggle to turn agent rows off; when off, cards show a compact
  avatar-stack glyph summary instead.
- **Row cap at 3** with a muted "+N more panes" line (handoff density
  recommendation — 4+ rows make the Active group unscannable in a 288px
  rail).
- **Determinate progress arc** on the running chip once agents report
  percentages (today: indeterminate only).
- Optional per-card collapse once the toggle exists.
- `includeShells` flag on the helper if the panel should become a pane
  navigator.
- Richer per-agent detail (model, context window, tool calls) — active-pane
  -only today.

## Out of scope

Island/notification panel changes, Rust backend changes, native-overlay
mirrors, per-row time display and `ProgressBar` (removed by handoff delta),
the `state-*` alias token layer (see Decision 8).
