# 2026-05-20 — Icon Rail trim design

## 1. Summary

The icon rail (`src/features/workspace/components/IconRail.tsx`) currently
renders three placeholder area-switcher buttons — **Dashboard**, **Source
Control**, **Debugger** — sourced from `src/features/workspace/data/
mockNavigation.ts`. None of them navigate anywhere (each `onClick` is an
empty comment, see `mockNavigation.ts:9-11, 18-20, 27-29`); they predate
the dock + session-tabs layout and have been pending a design pass.

The handoff at `docs/design/rail/CHANGES.md` is that design pass. The
handoff narrates removal of "Files / Editor / Diff / Context Bucket"
icons — that terminology describes the **prototype's** intermediate
state inside the Claude Design project, not this repo's current
placeholders. Either way, the destination is the same: drop every
area-switcher from the rail body and reshape the rail around identity +
global utilities:

- **Identity** moves to the top of the rail (user avatar where the `V`
  brand mark used to live).
- **Global utilities** — Command Palette and Settings — consolidate at
  the bottom.
- Files / Editor / Diff / Context icons are removed; those views live
  in the session tabs and dock, not the rail.

This spec covers the rail trim, a small `CommandPalette` refactor needed
to wire the rail's command button into the existing palette without
synthesising keyboard events, and a deferred-feature stub for the
Settings gear. The full Settings dialog — also part of the handoff at
`prototype/src/settings.jsx` — is **deferred** to a separate
brainstorming session; this spec ships only the gear button (rendered
disabled with a tooltip pointing at the follow-up issue) so the rail's
visual shape matches the handoff while the dialog is designed.

## 2. Scope

In scope:

- Refactor `IconRail.tsx`: render identity slot (top), spacer,
  command-palette button + settings button (bottom). The bottom
  buttons' icon, label, and tooltip text are **hardcoded inside
  `IconRail`'s JSX** — they are not driven by any prop. Add three
  optional callback / data props. Note: "backward compat" in this
  spec means the **old prop names (`items`, `settingsItem`) do
  not disappear**, so `import { IconRailProps } from '.'` and any
  external type references keep resolving. The existing call site
  in `WorkspaceView.tsx:753` **must still be updated in this PR**
  to pass the new required `settingsIssueNumber` prop (see below);
  there is no path where an unchanged call site compiles after
  the migration.
  - `onCommand?: () => void` — fires when the command-palette
    button is clicked. Defaults to a no-op when omitted (button is
    still rendered but does nothing — useful for tests that don't
    care about the open path).
  - `onSettings?: () => void` — fires when the settings button is
    clicked, **but is short-circuited while the button is in its
    `aria-disabled` deferred-feature state** (see below). Defaults
    to a no-op when omitted.
  - `identity?: IconRailIdentity` — forward-compat seat for a
    future account-linking feature; defaults to a static `'w'`
    avatar when omitted. The type is intentionally minimal for
    this PR:

    ```ts
    export interface IconRailIdentity {
      // Single grapheme rendered inside the gradient circle.
      // The render path uses `Array.from(initial)[0]` so the
      // first surrogate-paired character (emoji, CJK extension
      // plane) survives intact. Full ZWJ-grapheme handling
      // (e.g. flags, family emoji) is deferred until the real
      // identity provider lands; for the static `'w'` default
      // this is a non-issue.
      initial: string
      // Accessible name; falls back to "Account" when omitted
      // OR when the caller explicitly passes an empty string,
      // so the rendered `aria-label` is never `""`. The render
      // path uses `||` (not `??`) for this reason.
      ariaLabel?: string
    }
    ```

    Gradient colours and the 30px circle dimensions are **not**
    on this prop — they are hardcoded in `IconRail`'s JSX to keep
    the visual contract centralised. When a real identity system
    lands, additional fields (e.g. `avatarUrl?: string`,
    `onClick?: () => void`) can be added additively without
    breaking existing callers.

- Required prop for the gear's tooltip:
  - `settingsIssueNumber: number` — the GitHub issue number for
    the deferred Settings dialog. **Required, not optional.** The
    tooltip is unconditional ("Settings panel coming — see issue
    #N"), so making the prop optional would let a missing
    substitution silently ship a tooltip without a number.
    Tests render the rail with a fixed placeholder (e.g. `1` or
    a sentinel `9999`). In `WorkspaceView`, the value reads from
    a module-level constant initialised to `0` so a forgotten
    pre-merge substitution renders the conspicuously-wrong
    "see issue #0" instead of disappearing silently (§7.3).
- Keep the existing `items?: NavigationItem[]` and
  `settingsItem?: NavigationItem` props on `IconRailProps` for one
  cycle. **Both become optional and ignored by the new rail
  body** — `items` renders nothing when empty, and `settingsItem`
  is never consulted because the rail's settings button is
  hardcoded. A follow-up cleanup PR removes both props after the
  Settings dialog lands. Note: "backward compat" here means
  **the old prop names do not disappear** — `WorkspaceView`'s
  existing call site **does** need to be updated in this PR to
  pass the new required prop (`settingsIssueNumber`), since the
  rail without that prop would render a tooltip with a missing
  issue number.
- Hoist `useCommandPalette(commands)` from inside `CommandPalette.tsx`
  up to `WorkspaceView.tsx`. `CommandPalette` becomes a controlled
  render component, accepting `state` / `filteredResults` /
  `clampedSelectedIndex` / `close` / `setQuery` / `selectIndex` as
  props.
- `WorkspaceView` passes the hoisted `open` callback into `IconRail`
  as `onCommand`, and the hoisted `state` / handlers into
  `CommandPalette` as props.
- `mockNavigationItems` (in
  `src/features/workspace/data/mockNavigation.ts`) becomes `[]`.
  `mockSettingsItem` is left as-is but no longer reaches the DOM
  via the rail.
- Settings gear button: render with `aria-disabled="true"` plus a
  visually-muted style and an unconditional `<Tooltip>` reading
  "Settings panel coming — see issue #N" (the `#N` placeholder is
  the runtime-resolved `settingsIssueNumber` prop, bumped before
  merge). The button is **not** `disabled={true}` at the DOM
  level (so the Tooltip still fires on hover and the button is
  still focusable). The short-circuit lives inside the rail's
  click handler, which inspects its **own internal
  `ariaDisabled` prop** (the same value passed to the JSX
  `aria-disabled` attribute) and returns before calling
  `onSettings`. Reading the prop, not the DOM attribute, keeps the
  click path synchronous and avoids a `getAttribute` round-trip
  through the rendered element.
- Update `docs/design/UNIFIED.md` in four places so UNIFIED stays
  the accurate post-merge source of truth for the rail + palette
  shortcut. All four edits are the same in spirit (replace
  `⌘K` / `⌘K / Ctrl+K` with `Ctrl+:`, the binding actually
  implemented by `useCommandPalette.ts:20`):
  - **§2 line 47** (rail row of the 5-zone table): rewrite to
    "User avatar at top. Palette + Settings at bottom. No area
    switchers — Files lives in the sidebar Files tab; Editor and
    Diff live in the dock; Context arrives with the deferred
    Settings dialog."
  - **§2 line 51** (status-bar row): change the
    keyboard-shortcut hint from `⌘K` to `Ctrl+:`.
  - **§5.4 line 193** (CommandPalette contract): change the
    "globally" toggle line from "⌘K / Ctrl+K toggle, globally"
    to "Ctrl+: toggle, globally".
  - **§6 line 212** (interaction rules): change the
    `⌘K palette` fragment in the "Keyboard shortcuts" bullet to
    `Ctrl+: palette`. The other shortcuts on that line
    (editor / diff / files / terminal) are out of scope for this
    PR — they belong to a separate audit.

  UNIFIED's `⌘K` was aspirational copy that has never matched
  the implementation; bringing all four lines in sync here closes
  the inconsistency codex would otherwise re-flag forever.

- Token sweep: replace every inline-style hex/rgba in the prototype
  with the closest existing Tailwind semantic token from
  `tailwind.config.js`. Inline styles remain only for values that
  Tailwind cannot express cleanly (e.g. the gradient avatar).
- Update co-located tests: `IconRail.test.tsx`,
  `CommandPalette.test.tsx`, the relevant `WorkspaceView.*.test.tsx`
  files for the new controlled palette shape, and
  `src/features/workspace/data/mockNavigation.test.ts` — the
  existing assertions there hard-code Dashboard / Source Control /
  Debugger and will fail once `mockNavigationItems` becomes `[]`.
  The mockNavigation suite is rewritten to assert the new
  empty-array contract (or deleted outright if the cleanup PR is
  imminent; the spec leans rewrite-not-delete so the empty-array
  invariant has explicit coverage during the deprecation cycle).
- Author the GitHub issue body for the follow-up Settings dialog —
  pasted into the PR description so we can file the issue and update
  the tooltip's `#N` placeholder before merge.

Out of scope:

- The Settings dialog itself, its primitives (`Row`, `PaneTitle`,
  `Toggle`, `Select`, `GhostButton`, `TextInput`), and any of its 14
  category panes.
- AppearancePane and the live theme-switching infrastructure — these
  belong to a separate spec when the theming layer is real.
- Sidebar / dock changes to absorb the dropped Files / Editor / Diff
  rail icons. Those destinations are already in their new homes per
  the handoff; this spec only removes rail entries that pointed at
  them.
- Deletion of `mockNavigation.ts` — it stays as the
  empty-`items`-array seam for one cycle.

## 3. Non-goals

- Re-architecting the workspace 5-zone layout —
  `docs/design/UNIFIED.md` §2 keeps the rail's role (48px-wide
  leftmost zone) unchanged; only the contents listed on line 47
  change.
- New visual flourishes beyond the prototype — the gradient avatar
  circle, lavender hover/active accents, and bottom-aligned utility
  group are exactly as `prototype/src/shell.jsx` renders them, mapped
  through our token system.
- Real identity wiring — `identity` is a forward-compat prop with a
  static `'w'` default. The user's account-linking feature (GitHub /
  Google) is a separate effort and provides the real provider later.

## 4. Authoritative references

The handoff and adjacent design docs are read in this order:

1. `docs/design/rail/CHANGES.md` — handoff delta (this migration's
   primary source).
2. `docs/design/rail/prototype/src/shell.jsx` — the new `IconRail`
   reference implementation (lines 4-43).
3. `docs/design/UNIFIED.md` §2 — authoritative 5-zone layout
   contract. UNIFIED currently describes the **pre-handoff** rail
   contents on line 47 ("Brand mark (V) at top. Area switchers
   (Agent / Files / Editor / Diff / Context). Palette + settings
   - user at bottom."), which directly contradicts the handoff.
     This migration **brings UNIFIED into sync with the handoff** as
     part of its in-scope changes (§2). After this migration lands,
     UNIFIED resumes its standing role as the post-merge source of
     truth, and any new conflicts with prototype `code.html` files
     resolve in UNIFIED's favour per `docs/design/CLAUDE.md`.
4. `docs/design/DESIGN.md` — foundational tokens and typography.
5. `tailwind.config.js` + `docs/design/tokens.css` /
   `docs/design/tokens.ts` — token values consumed by the
   token-sweep step.

Memory note acknowledged: prior guidance held the IconRail icon set
for a separate design update. This spec **is** that design update.
After it lands, future PRs may wire the sidebar tabs / dock to the
dropped destinations without contradicting the earlier deferral.

## 5. Current state vs. target state

### 5.1 Rail body (before / after)

```
current rail (src/features/workspace/components/IconRail.tsx,
              mockNavigationItems from data/mockNavigation.ts:3-31)

    ┌────┐
    │ ▦  │  ← mockNavigationItems[0]  (Dashboard,    Material `dashboard`)
    ├────┤
    │ ⌥  │  ← mockNavigationItems[1]  (Source Ctrl,  Material `account_tree`)
    ├────┤
    │ 🐛 │  ← mockNavigationItems[2]  (Debugger,     Material `bug_report`)
    │ .  │
    │ .  │  (items group sits flush top; no spacer between
    │ .  │   items and the bottom settings button)
    ├────┤
    │ ⚙  │  ← mockSettingsItem.onClick (no-op stub; the body of
    └────┘    each onClick is an empty comment per
              mockNavigation.ts:9-11, 18-20, 27-29, 38-40)

target rail (per docs/design/rail/prototype/src/shell.jsx, lines 4-43)

    ┌────┐
    │ w  │  ← identity slot — gradient circle, default 'w'
    │    │
    │ .  │  ← spacer (`flex: 1`) pushes the bottom group down
    │ .  │
    │ .  │
    ├────┤
    │ ⌕  │  ← Command Palette button (Material `search`) → onCommand()
    ├────┤
    │ ⚙  │  ← Settings button (Material `settings`, aria-disabled) —
    └────┘    Tooltip + onSettings() short-circuits while disabled
```

### 5.2 Component graph (CommandPalette open path)

Before:

```
WorkspaceView
└─ <CommandPalette commands={...} />
       └─ useCommandPalette(commands)        ← hook call lives here
              └─ document.addEventListener   ← Ctrl+: listener
                    'keydown', handleKeyDown
```

The rail has no path into the palette. The palette can only be opened
by the global `Ctrl+:` listener that lives inside its own hook.

After:

```
WorkspaceView
├─ const palette = useCommandPalette(commands)  ← hoisted; same Ctrl+: listener
├─ <IconRail onCommand={palette.open} ... />
└─ <CommandPalette state={palette.state}
                   filteredResults={palette.filteredResults}
                   clampedSelectedIndex={palette.clampedSelectedIndex}
                   close={palette.close}
                   setQuery={palette.setQuery}
                   selectIndex={palette.selectIndex} />
```

The `Ctrl+:` listener moves with the hook (it's a `useEffect` keyed off
the hook's lifecycle, not the component's). Keyboard behaviour is
preserved bit-for-bit. The rail's button becomes a second, programmatic
open path that calls `palette.open()` directly.

### 5.3 Surface-area diff (LOC estimate)

| File                                                      | Change                              | Δ LOC (approx)             |
| --------------------------------------------------------- | ----------------------------------- | -------------------------- |
| `src/features/workspace/components/IconRail.tsx`          | rewrite body + new props            | +60 / -25                  |
| `src/features/workspace/components/IconRail.test.tsx`     | new + updated cases                 | +35 / -10                  |
| `src/features/workspace/WorkspaceView.tsx`                | hoist hook + wiring                 | +15 / -2                   |
| `src/features/workspace/WorkspaceView.*.test.tsx`         | adjust mocks for controlled palette | +10 / -5                   |
| `src/features/command-palette/CommandPalette.tsx`         | accept controlled props             | +20 / -15                  |
| `src/features/command-palette/CommandPalette.test.tsx`    | inject props in tests               | +20 / -5                   |
| `src/features/command-palette/hooks/useCommandPalette.ts` | unchanged (caller moves)            | 0 / 0                      |
| `src/features/workspace/data/mockNavigation.ts`           | empty `items`                       | +1 / -10                   |
| `docs/design/UNIFIED.md`                                  | rewrite lines 47, 51, 193, 212      | +4 / -4                    |
| **total**                                                 |                                     | **~+165 / -76 = ~+89 net** |

The token sweep (prototype hex/rgba → Tailwind semantic tokens, §6) is
folded into the IconRail rewrite numbers above.

### 5.4 Behaviours that stay unchanged

- The 5-zone workspace layout
  (`grid-cols-[48px var(--workspace-sidebar-width) 1fr auto]`) is
  unchanged. Rail still occupies 48 px on the left.
- `Ctrl+:` to toggle the command palette still works; the hook's
  keyboard listener moves with it.
- Sidebar / dock content and resize behaviour are untouched. The
  dropped rail icons' destinations are reachable in their existing
  homes: **Files** in the sidebar's Files tab
  (`WorkspaceView.tsx:70-73` defines the sidebar tabs as
  `sessions` + `files`), **Editor** and **Diff** in the dock panel
  (`DockPanel` accepts `dockTab: 'editor' | 'diff'`). **Context**
  has no current home in the codebase — the prototype's Context
  Bucket tab is part of the deferred Settings-dialog work and
  arrives with a future PR. The rail entries are being removed
  because the active destinations already live elsewhere; the
  inactive one (Context) was a forward-looking stub.
- All existing `<Tooltip>` usages on rail buttons keep working.
- `mockSettingsItem` keeps its export shape (`NavigationItem`), so
  any external consumer compiles unchanged for one cycle.

### 5.5 Iconography decisions

The prototype at `docs/design/rail/prototype/src/shell.jsx` line 8
uses Material Symbol `terminal` for the command-palette button.
This spec **diverges** for one concrete reason: the workspace already
has a Terminal zone (`TerminalZone`), so a `terminal`-glyph rail
button reads as "open the terminal" rather than "open the command
palette". Material Symbol options considered:

| Symbol                 | Glyph proxy | Pros                                           | Cons                                                                      |
| ---------------------- | ----------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| `terminal`             | `>_`        | Matches prototype 1:1                          | Conflicts with TerminalZone in this workspace                             |
| `bolt`                 | `⚡`        | Common command-palette glyph (Linear, others)  | Already reserved for Coding Agents in the deferred Settings               |
| `keyboard_command_key` | `⌘`         | Explicit shortcut symbol                       | macOS-coded; weaker affordance on Linux / Windows                         |
| `search`               | `⌕`         | Universal "fuzzy find" affordance; no conflict | Sometimes read as file search (mitigated — file search is in the sidebar) |
| `prompt_suggestion`    | `✦`         | Modern; matches AI-prompt UX                   | Newer Material set; not present in all icon font versions                 |

**Decision: `search`.** Self-explanatory, universal, and the only
candidate that doesn't collide with another rail / settings concept
already in use. The `Ctrl+:` shortcut hint stays in the
`<Tooltip>` so power users still see the binding.

`settings` (Material gear glyph) is used for the bottom button —
unchanged from the prototype.

## 6. Approach: hook-hoist via props

The `CommandPalette` migration is the load-bearing decision in this
spec. The rail simplification is mechanical once the palette has a
programmatic open path. This section unpacks why hoisting
`useCommandPalette` into `WorkspaceView` (rather than dispatching
synthetic events, exposing an imperative ref, or wrapping a Context
provider) is the right shape for this codebase.

### 6.1 What "hoist" means here

Today, `useCommandPalette(commands)` is called inside
`CommandPalette.tsx` (line 23). The hook owns:

1. `state` — `{ isOpen, query, selectedIndex, currentNamespace }`.
2. Derived data — `filteredResults`, `clampedSelectedIndex`.
3. Handlers — `open`, `close`, `setQuery`, `selectIndex`,
   `navigateUp`, `navigateDown`, `executeSelected`.
4. The capture-phase global `keydown` listener that toggles the
   palette on `Ctrl+:` and dispatches arrow / Enter / Escape while
   open (`useCommandPalette.ts:252-311`).

After the hoist, the same hook call happens in `WorkspaceView`. The
return value is fanned out: `open` goes into `IconRail` as
`onCommand`, and `state` + `filteredResults` + `clampedSelectedIndex`

- `close` + `setQuery` + `selectIndex` go into `CommandPalette` as
  props. The hook's internal `useEffect` for the keyboard listener is
  unchanged — it's keyed off the hook's own lifecycle, not the consumer
  component's, so moving the call site doesn't affect when the listener
  attaches or detaches.

### 6.2 Why not the alternatives

**Dispatching a synthetic keyboard event** from the rail
(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ':',
ctrlKey: true }))`) was rejected because it routes through the same
global capture listener the rail itself lives inside, introducing a
re-entrant code path that is hard to reason about under React's
strict-mode double-invocation and brittle if the listener key is ever
rebound away from `Ctrl+:`.

**Imperative ref handle** (`<CommandPalette ref={paletteRef} />` with
`useImperativeHandle({ open })`) was rejected because nothing else in
this codebase reaches for `useImperativeHandle`. Introducing the
pattern only to bridge two siblings is an inconsistent escape hatch.
`UnsavedChangesDialog` next door uses controlled props (`isOpen`,
`onSave`, `onCancel`) and is the precedent this migration follows.

**Context provider** (`<CommandPaletteProvider>` exposing
`useCommandPaletteController`) was rejected for this PR because the
palette has exactly two consumers after the rail trim: the rail
itself, and the `CommandPalette` render component. A Context
boundary for a two-node dataflow adds a layer without earning it. If
a third consumer arrives later (e.g., a sidebar button that opens
the palette in a specific namespace), the Context refactor becomes a
clean follow-up.

**Hook duplication** (`useCommandPalette` called separately in rail
and palette) was rejected because two hook instances mean two
independent state machines for the same UI — the rail's `open()`
call mutates a separate state from the palette's `isOpen` read, and
the palette never opens. Stateful hooks cannot be safely
instantiated more than once for shared UI.

### 6.3 Trade-offs of the chosen shape

What hoist-via-props buys:

- One source of truth for palette state (`WorkspaceView`'s hook
  instance), accessed via the same `useXxx() + props` shape every
  other dialog in this repo uses.
- No new abstractions — drops down to `useState` + props inside
  the hook's existing surface.
- Mechanical refactor with a single before/after diff inside
  `CommandPalette.tsx` (drop internal hook call, accept props),
  one new line at the top of `WorkspaceView`'s render body, and
  one prop on the rail.

What it costs:

- `CommandPalette`'s prop surface grows from `{ commands? }` to
  ~7 props. Tests that previously rendered
  `<CommandPalette commands={...} />` and relied on the internal
  hook for state now inject controlled state or use a small
  `renderPalette()` test helper that wires the hook for them
  (detailed in §9 Testing strategy).
- The hoisted hook now lives inside `WorkspaceView`, which is
  **already 925 LOC — above the project's 800-line cap from
  `rules/CLAUDE.md`**. This migration is not the file that
  introduces the violation, but it does add roughly one more line
  to a file that should be split. §11 Risks lists a follow-up
  `useWorkspaceController` extraction as the right home for the
  hook (and for the existing handler tangle around
  `editorBuffer` / `pendingFilePath`), and recommends opening
  the extraction issue at the same time as the Settings-dialog
  follow-up issue so the queue is visible.

### 6.4 What stays inside `useCommandPalette`

Nothing about the hook's internals changes. The hook is portable
today (no dependency on `CommandPalette`'s render tree), which is
why the refactor reduces to "move the call site". Specifically:

- The capture-phase listener stays inside the hook.
- The state machine stays inside the hook.
- All handlers (`open`, `close`, `navigateUp`, etc.) keep their
  current signatures.
- `Ctrl+:` semantics are byte-identical post-migration.

The hook's existing tests live at `useCommandPalette.test.ts` and
`useCommandPalette.staleClosure.test.ts`. Neither file touches the
consumer component, so both remain green without modification — a
useful signal that the hoist is purely a call-site move, not a
behavioural change.

## 7. Component changes

This section spells out the exact prop shapes, JSX skeletons, and
file-level edits for each touched file. The token sweep referenced
inside the skeletons resolves to the mapping table in §8.

### 7.1 `IconRail.tsx`

New `IconRailProps` (kept backward-compatible with current callers):

```ts
import type { ReactElement } from 'react'
import type { NavigationItem } from '../types'

export interface IconRailIdentity {
  initial: string
  ariaLabel?: string
}

export interface IconRailProps {
  // REQUIRED. Substituted into the gear's
  // "Settings panel coming — see issue #N" tooltip. Adding this
  // prop means every existing call site (currently just
  // WorkspaceView.tsx:753) MUST be updated in this PR to pass
  // a value. Rendering "#0" is the loud signal that the
  // WorkspaceView constant (§7.3) wasn't bumped before merge.
  settingsIssueNumber: number

  // New optional callbacks/data — tests can render the rail
  // without these; the body falls back to no-ops and a static
  // `'w'` avatar.
  onCommand?: () => void
  onSettings?: () => void
  identity?: IconRailIdentity

  // Existing props, now demoted to optional. The old prop names
  // do not disappear (so existing imports / type-references stay
  // valid), but both are IGNORED by the new rail body —
  // `items` renders nothing, `settingsItem` is never consulted.
  // A follow-up cleanup PR removes both after the Settings
  // dialog lands.
  items?: NavigationItem[]
  settingsItem?: NavigationItem
}
```

Body skeleton (Tailwind utilities mapped from the prototype's
inline styles per §8):

```tsx
export const IconRail = ({
  settingsIssueNumber,
  onCommand,
  onSettings,
  identity,
}: IconRailProps): ReactElement => {
  // Array.from preserves surrogate-paired graphemes (emoji,
  // extended-plane CJK) where .slice(0, 1) would split them.
  // `?? 'w'` covers the (unusual) empty-string case.
  const initial = Array.from(identity?.initial ?? 'w')[0] ?? 'w'
  // `||` (not `??`) so an explicit empty-string ariaLabel still
  // falls back to "Account"; an empty aria-label is worse than
  // a slightly-generic one.
  const accountLabel = identity?.ariaLabel || 'Account'
  const settingsTooltip = `Settings panel coming — see issue #${settingsIssueNumber}`

  return (
    <nav
      data-testid="icon-rail"
      className="
        relative z-[5] flex h-full w-12 flex-col items-center
        bg-surface-container-lowest border-r border-outline-variant/25
        py-2.5
      "
    >
      <Tooltip content={accountLabel} placement="right">
        {/*
          Non-interactive avatar for this PR — `role="img"` plus
          `aria-label` advertise it as a decorative identity
          glyph, not a button. When the real account-linking
          feature lands and an onClick is needed, swap this
          `<div>` for `<button type="button" onClick={onAccount}>`
          and add the `onAccount` callback to IconRailProps.
        */}
        <div
          role="img"
          aria-label={accountLabel}
          className="
            mb-3.5 h-[30px] w-[30px] grid place-items-center
            rounded-full border border-primary/35
            bg-[linear-gradient(135deg,theme(colors.primary-deep),theme(colors.surface-container-low))]
            font-display text-[12px] font-semibold text-primary
            shadow-[0_4px_18px_rgba(203,166,247,0.25)]
          "
        >
          {initial}
        </div>
      </Tooltip>

      <div className="flex-1" aria-hidden="true" />

      <div className="flex flex-col gap-1">
        <RailBtn
          icon="search"
          accessibleName="Command Palette"
          tooltipContent="Command Palette (Ctrl+:)"
          onClick={onCommand}
        />
        <RailBtn
          icon="settings"
          accessibleName="Settings"
          tooltipContent={settingsTooltip}
          ariaDisabled
          onClick={onSettings}
        />
      </div>
    </nav>
  )
}
```

`RailBtn` (private to the file) absorbs the hover and disabled
visuals plus the `aria-disabled` short-circuit logic. **There is
no "active" state** — the new bottom buttons are transient
triggers (open the palette / open settings), not toggles, so the
`active` styling that lived in the old rail's per-area buttons
(prototype/src/shell.jsx lines 44-65) is intentionally dropped:

```tsx
interface RailBtnProps {
  icon: string
  // Stable accessible name used by screen readers. Should not
  // include transient state (e.g., the deferred-issue number) —
  // that lives in `tooltipContent`. AT users hear "Settings"
  // and don't have the long sentence repeated on every focus.
  accessibleName: string
  // Visible tooltip text. May include state (the shortcut hint,
  // the deferred-feature message, etc.).
  tooltipContent: string
  onClick?: () => void
  ariaDisabled?: boolean
}

const RailBtn = ({
  icon,
  accessibleName,
  tooltipContent,
  onClick,
  ariaDisabled = false,
}: RailBtnProps): ReactElement => (
  <Tooltip content={tooltipContent} placement="right">
    <button
      type="button"
      aria-label={accessibleName}
      aria-disabled={ariaDisabled || undefined}
      onClick={(): void => {
        if (ariaDisabled) {
          return
        }
        onClick?.()
      }}
      className={`
        flex h-[34px] w-[34px] items-center justify-center rounded-lg
        border border-transparent transition-colors duration-150 ease-out
        ${
          ariaDisabled
            ? 'cursor-not-allowed text-on-surface-muted/60'
            : 'cursor-pointer text-on-surface-muted hover:bg-primary/[0.06] hover:text-primary'
        }
      `}
    >
      {/*
        aria-hidden so assistive tech reads the button's stable
        `aria-label` ("Settings", "Command Palette") instead of
        the icon glyph name ("settings", "search").
      */}
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-[18px]"
      >
        {icon}
      </span>
    </button>
  </Tooltip>
)
```

Notes:

- The bottom group's `gap-1` (4 px) matches the prototype's
  `gap: 4`.
- The `border-r border-outline-variant/25` replaces the prototype's
  literal `1px solid rgba(74,68,79,0.25)` — `outline-variant`
  (`#4a444f`) plus the `/25` alpha utility composes the same colour.
- `bg-surface-container-lowest` (`#0d0d1c`) matches the rail
  background the prototype hardcodes; the same token already appears
  on the status bar per UNIFIED §2 so the two zones share a surface
  tier.
- The `material-symbols-outlined` class is already in use elsewhere
  in this codebase (the pre-migration `IconRail.tsx` line 28), so
  no new font-loading work is required.
- The avatar's `shadow-[0_4px_18px_rgba(203,166,247,0.25)]` is the
  one **documented token-sweep exception** in §7.1. Tailwind's
  shadow plugin cannot compose a single arbitrary-rgba glow from
  the existing semantic tokens (`primary` resolves to a hex, not
  the rgba(203,166,247,0.25) value the prototype's glow needs). A
  potential refactor adds a `shadow-avatar-glow` token to
  `tailwind.config.js`, but that's a one-off for a single use site —
  the inline arbitrary value is the smaller change and the §8
  token-mapping table lists it explicitly in the "exceptions"
  row.

### 7.2 `CommandPalette.tsx`

Controlled-props shape:

```tsx
import type { ReactElement } from 'react'
import type { Command, CommandPaletteState } from './registry/types'

export interface CommandPaletteProps {
  state: CommandPaletteState
  filteredResults: Command[]
  clampedSelectedIndex: number
  close: () => void
  setQuery: (query: string) => void
  selectIndex: (index: number) => void
}

export const CommandPalette = ({
  state,
  filteredResults,
  clampedSelectedIndex,
  close,
  setQuery,
  selectIndex,
}: CommandPaletteProps): ReactElement | null => {
  // ...existing AnimatePresence + motion.div body, unchanged
  // except for swapping the local `useCommandPalette` call for
  // the destructured props above.
}
```

The internal `useCommandPalette(commands)` line is deleted; the
optional `commands?: Command[]` prop is removed (the hook now lives
in `WorkspaceView` and receives commands from there).

**What's intentionally NOT on `CommandPaletteProps`:** `navigateUp`,
`navigateDown`, `executeSelected`, and `open` are returned by
`useCommandPalette` but never consumed by `CommandPalette.tsx`'s
render body (they're called from inside the hook's own keydown
`useEffect`; see `useCommandPalette.ts:252-311`). They stay
encapsulated in the hook. The 6 props listed above are exactly
what the existing component destructures today —
`CommandPalette.tsx:16-23` — so the controlled-mode signature is
a 1:1 prop projection of the current destructure block.

### 7.3 `WorkspaceView.tsx`

Inside `WorkspaceView` (between the existing `workspaceCommands`
memo and the activity-detection effect):

```tsx
const commandPalette = useCommandPalette(workspaceCommands)
```

At the JSX level, two changes — the rail call gains new props, and
the palette call switches to controlled mode:

```tsx
;<IconRail
  onCommand={commandPalette.open}
  // onSettings intentionally omitted — gear is aria-disabled,
  // tooltip-only, no destination yet
  settingsIssueNumber={SETTINGS_FOLLOWUP_ISSUE_NUMBER}
  items={mockNavigationItems} // empty array; kept for one cycle
  settingsItem={mockSettingsItem} // ignored by the rail body
/>
{
  /* ...sidebar + main + activity panel... */
}
;<CommandPalette
  state={commandPalette.state}
  filteredResults={commandPalette.filteredResults}
  clampedSelectedIndex={commandPalette.clampedSelectedIndex}
  close={commandPalette.close}
  setQuery={commandPalette.setQuery}
  selectIndex={commandPalette.selectIndex}
/>
```

`SETTINGS_FOLLOWUP_ISSUE_NUMBER` is a module-level constant declared
near the top of the file:

```tsx
// Filed before merge — see PR description §10 for the issue body.
const SETTINGS_FOLLOWUP_ISSUE_NUMBER = 0 // placeholder; bumped before merge
```

Mechanics: `0` is intentionally an obvious placeholder so a missed
substitution at merge time is loud. A pre-merge checklist item in
the PR description requires bumping this value once the issue is
filed.

### 7.4 `mockNavigation.ts`

The `NavigationItem` export type stays. The data shrinks to the
no-op shape:

```ts
import type { NavigationItem } from '../types'

// Kept for one cycle so external callers compile. The rail body
// no longer iterates this array — see
// docs/superpowers/specs/2026-05-20-icon-rail-trim-design.md §7.1.
// A follow-up cleanup PR removes both exports once the Settings
// dialog lands.
export const mockNavigationItems: NavigationItem[] = []

export const mockSettingsItem: NavigationItem = {
  id: 'settings',
  name: 'Settings',
  icon: 'settings',
  color: 'bg-indigo-500',
  onClick: (): void => {
    // No-op; the rail's settings button is aria-disabled and
    // does not consult this handler.
  },
}
```

The companion `mockNavigation.test.ts` is rewritten to assert the
empty-array contract; see §9 for the test plan.

### 7.5 `docs/design/UNIFIED.md`

Four single-line replacements (cross-referenced from §2's
in-scope list):

```
- Icon rail row (line 47, old):
  "Brand mark (V) at top. Area switchers (Agent / Files / Editor /
   Diff / Context). Palette + settings + user at bottom."

- Icon rail row (line 47, new):
  "User avatar at top. Palette + Settings at bottom. No area
   switchers — Files lives in the sidebar Files tab; Editor and
   Diff live in the dock; Context arrives with the deferred
   Settings dialog."
```

```
- Status bar row (line 51, old):
  "Global: `vimeflow` - version - context smiley - turn count -
   `⌘K` hint."

- Status bar row (line 51, new):
  "Global: `vimeflow` - version - context smiley - turn count -
   `Ctrl+:` hint."
```

```
- §5.4 CommandPalette contract (line 193, old):
  "- ⌘K / Ctrl+K toggle, globally."

- §5.4 CommandPalette contract (line 193, new):
  "- Ctrl+: toggle, globally."
```

```
- §6 interaction rules (line 212, old):
  "**Keyboard shortcuts** -- ⌘K palette - ⌘⇧E editor - ⌘⇧D diff -
   ⌘⇧F files - ⌘⇧T terminal - Esc closes overlays..."

- §6 interaction rules (line 212, new):
  "**Keyboard shortcuts** -- Ctrl+: palette - ⌘⇧E editor - ⌘⇧D
   diff - ⌘⇧F files - ⌘⇧T terminal - Esc closes overlays..."
```

The four edits above are the complete UNIFIED scope for this PR.
The other shortcuts on line 212 (`⌘⇧E editor`, `⌘⇧D diff`,
`⌘⇧F files`, `⌘⇧T terminal`) are left alone — they require a
separate audit against the implementation that is out of scope
here.

## 8. Token mapping

Every hex / rgba value the prototype hardcodes maps to an existing
semantic Tailwind token from `tailwind.config.js`. The new
`IconRail.tsx` consumes utilities, not raw colours. Exceptions are
called out explicitly in §8.2.

### 8.1 Mapping table

| Prototype value                           | Where                           | Tailwind utility / theme reference                                                            | Hex source                |
| ----------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------- |
| `#0d0d1c`                                 | rail background                 | `bg-surface-container-lowest`                                                                 | tailwind.config.js:34     |
| `rgba(74,68,79,0.25)`                     | rail right border               | `border-outline-variant/25` (composes `#4a444f` + 25% alpha)                                  | tailwind.config.js:63     |
| `linear-gradient(135deg,#57377f,#1a1a2a)` | avatar background gradient      | `bg-[linear-gradient(135deg,theme(colors.primary-deep),theme(colors.surface-container-low))]` | tailwind.config.js:79, 35 |
| `rgba(226,199,255,0.35)`                  | avatar border                   | `border-primary/35` (`primary` = `#e2c7ff`)                                                   | tailwind.config.js:9      |
| `#e2c7ff`                                 | avatar text + button hover icon | `text-primary`                                                                                | tailwind.config.js:9      |
| `#8a8299`                                 | idle bottom-button icon         | `text-on-surface-muted`                                                                       | tailwind.config.js:80     |
| `rgba(226,199,255,0.06)`                  | bottom-button hover background  | `bg-primary/[0.06]` (arbitrary alpha — Tailwind ships 5/10/15 but not 6)                      | tailwind.config.js:9      |
| `'Instrument Sans', system-ui`            | avatar letter typeface          | `font-display`                                                                                | tailwind.config.js:102    |
| `4 px` gap between bottom buttons         | bottom group spacing            | `gap-1`                                                                                       | Tailwind default          |
| `34 px` square button                     | rail button size                | `h-[34px] w-[34px]` (no preset matches; see §8.2)                                             | n/a                       |
| `30 px` circle                            | avatar size                     | `h-[30px] w-[30px]` (no preset matches; see §8.2)                                             | n/a                       |
| `48 px` rail width                        | nav width                       | `w-12`                                                                                        | Tailwind default          |

### 8.2 Documented exceptions (inline values that remain)

Three values escape the token sweep because Tailwind cannot express
them cleanly with the current config:

1. **Avatar glow shadow** —
   `shadow-[0_4px_18px_rgba(203,166,247,0.25)]`. The
   `rgba(203,166,247,0.25)` channel is the prototype's exact
   primary-container glow. Tailwind's shadow plugin accepts named
   colour tokens or arbitrary string values, not alpha-composed
   semantic tokens, so `shadow-primary/[0.25]`-style utilities
   don't work here. Adding a `shadow-avatar-glow` token to
   `tailwind.config.js` for a single use site is overkill; the
   inline arbitrary value is the smaller change and is the only
   shadow exception in the rail body.
2. **Sub-preset `34 px` and `30 px` button/avatar sizes** —
   Tailwind's `h-9` (36 px) and `h-8` (32 px) presets don't match
   the prototype's exact `34` and `30` values, and `h-[34px]
w-[34px]` plus `h-[30px] w-[30px]` keep the visual contract
   with the 48 px rail width in `UNIFIED.md` §2.
3. **Gradient stops via `theme(colors.<token>)`** — Tailwind's
   `bg-[linear-gradient(...)]` arbitrary-value path accepts the
   `theme()` function to reference named colours, but the result
   is still a syntactically arbitrary value, not a semantic token.
   This is the canonical workaround for "gradient with token
   colours" and is the only way to keep the gradient theme-aware
   without adding a custom plugin.

### 8.3 Verification

After the rail rewrite lands, a quick visual diff against the
prototype confirms the mapping:

1. Run the dev server (`npm run dev`).
2. Open the Claude Design prototype iframe per
   `docs/design/CLAUDE.md` ("Viewing the Runnable Prototype").
3. Side-by-side the local rail vs. the prototype. The four
   touchpoints to verify are: rail background hue, border
   colour, avatar gradient, and hover-state alpha on the
   bottom buttons.

A pixel-perfect diff isn't required (the prototype is
implementation-illustrative, not normative); the goal is
"indistinguishable to the eye at normal zoom". UNIFIED.md is the
binding contract, not the prototype's exact CSS.

## 9. Testing strategy

`rules/CLAUDE.md` requires 80 % coverage and co-located test files
per `.tsx` / `.ts`. The migration touches five test files and adds
a single shared test helper; the section names each new / modified
case explicitly so the implementation has no judgement calls left.

`rules/typescript/testing/CLAUDE.md` is binding for the cases
below: Vitest `test()` (not `it()`), Testing Library query
priority (`getByRole` > `getByLabelText` > ... >
`getByTestId` last resort), inline test data over named
variables, and `aria-hidden="true"` on Material Symbol icon
spans queried via the parent's `getByRole`.

### 9.1 `IconRail.test.tsx`

Rewritten from scratch — the existing file asserts the `items[]`
loop renders three Material Symbols, which is irrelevant after
the trim. New cases (Testing Library + Vitest):

- **Renders the identity slot with default `'w'`** when no
  `identity` prop is passed
  (`getByRole('img', { name: 'Account' })` finds the avatar
  element, text content includes `'w'`).
- **Renders a custom initial when `identity.initial` is provided**
  (`<IconRail identity={{ initial: 'M' }} ... />` → avatar text
  `'M'`).
- **Truncates `identity.initial` to one grapheme** — a two-char
  initial like `'AB'` renders `'A'`; an emoji like `'🚀'` renders
  the full emoji (validates the `Array.from(...)[0]` path, not
  `.slice(0, 1)`).
- **Falls back to `'Account'` when `ariaLabel` is an empty
  string** (`<IconRail identity={{ initial: 'w', ariaLabel: '' }} />`
  → avatar `aria-label="Account"`, not `aria-label=""`).
- **Renders the command-palette button with stable
  `aria-label="Command Palette"`** and tooltip content
  `"Command Palette (Ctrl+:)"`. The icon glyph span has
  `aria-hidden="true"`.
- **Fires `onCommand` once when the command-palette button is
  clicked** — `vi.fn()` spy.
- **Renders the settings button with `aria-disabled="true"`** and
  the tooltip content interpolates `settingsIssueNumber`
  (`<IconRail settingsIssueNumber={42} />` → tooltip
  `"Settings panel coming — see issue #42"`).
- **Does NOT fire `onSettings` when the disabled settings button
  is clicked** — `vi.fn()` spy,
  `expect(spy).not.toHaveBeenCalled()`.
- **Ignores `items` and `settingsItem` props** — passing the old
  `mockNavigationItems` / `mockSettingsItem` shape renders no
  per-area icons (`queryAllByRole('button')` returns exactly the
  command + settings buttons; the avatar is `role="img"`).

The existing test file is replaced wholesale; the rewrite is
mechanical because there is no shared test scaffolding to
preserve.

### 9.2 `CommandPalette.test.tsx`

Updated for the controlled-mode signature. A small test helper
keeps the boilerplate manageable:

```tsx
// src/features/command-palette/CommandPalette.testUtils.tsx
// Co-located with the file it supports — the project does not
// use separate `__test-helpers__` directories.
import { render } from '@testing-library/react'
import { CommandPalette } from './CommandPalette'
import type { CommandPaletteState, Command } from './registry/types'

export interface RenderPaletteOptions {
  state?: Partial<CommandPaletteState>
  filteredResults?: Command[]
  clampedSelectedIndex?: number
}

const defaultState: CommandPaletteState = {
  isOpen: true,
  query: ':',
  selectedIndex: 0,
  currentNamespace: null,
}

export const renderPalette = (
  options: RenderPaletteOptions = {}
): {
  close: ReturnType<typeof vi.fn>
  setQuery: ReturnType<typeof vi.fn>
  selectIndex: ReturnType<typeof vi.fn>
  utils: ReturnType<typeof render>
} => {
  const close = vi.fn()
  const setQuery = vi.fn()
  const selectIndex = vi.fn()
  const utils = render(
    <CommandPalette
      state={{ ...defaultState, ...options.state }}
      filteredResults={options.filteredResults ?? []}
      clampedSelectedIndex={options.clampedSelectedIndex ?? -1}
      close={close}
      setQuery={setQuery}
      selectIndex={selectIndex}
    />
  )
  return { close, setQuery, selectIndex, utils }
}
```

Cases that change:

- All existing "palette is open / closed" cases switch from
  asserting against the internal hook to passing
  `state.isOpen` through the helper.
- New: **calling `close` from the backdrop click** — the
  helper's `close` spy is invoked when the backdrop is clicked.
- New: **`setQuery` fires when the input changes** — same spy
  assertion.

Cases that disappear: any test that depends on the internal hook
binding the global `Ctrl+:` listener. Those move to
`useCommandPalette.test.ts` (§9.4), which already covers them.

### 9.3 `WorkspaceView.*.test.tsx`

The existing `WorkspaceView.command-palette.test.tsx` already
exercises the palette open path through `Ctrl+:`. After the hoist
the same test should still pass because the keyboard listener
moves with the hook. One addition:

- **`WorkspaceView.command-palette.test.tsx`** — new case: **rail's
  command button opens the palette**. Find the command-palette
  button by `aria-label="Command Palette"`, click it, assert the
  palette dialog (`role="dialog"`) is in the DOM.

The other `WorkspaceView.*.test.tsx` files
(`elastic.test.tsx`, `integration.test.tsx`, `notifyInfo.test.tsx`,
`subscription.test.tsx`, `test.tsx`, `verification.test.tsx`,
`visual.test.tsx`) need a mechanical update only: any snapshot
or DOM assertion that walked over the old rail's three per-area
buttons must drop those assertions (the rail now renders only
identity + 2 bottom buttons).

### 9.4 `useCommandPalette.test.ts` and `useCommandPalette.staleClosure.test.ts`

**Unchanged.** Both files exercise the hook directly without
mounting `CommandPalette`. The hoist doesn't touch the hook's
internals, so both files stay green and serve as the regression
contract for the keyboard listener and stale-closure behaviour.

### 9.5 `mockNavigation.test.ts`

Rewritten to assert the post-migration contract:

```ts
import { describe, test, expect } from 'vitest'
import { mockNavigationItems, mockSettingsItem } from './mockNavigation'

describe('mockNavigation', () => {
  test('mockNavigationItems is empty during the deprecation cycle', () => {
    expect(mockNavigationItems).toHaveLength(0)
  })

  test('mockSettingsItem keeps its shape for backward-compat callers', () => {
    expect(mockSettingsItem).toMatchObject({
      id: 'settings',
      name: 'Settings',
      icon: 'settings',
      color: 'bg-indigo-500',
    })
    expect(typeof mockSettingsItem.onClick).toBe('function')
  })
})
```

The empty-array assertion is intentionally explicit so a future
contributor restoring items trips a CI failure and is prompted to
read this spec.

### 9.6 a11y assertions (cross-cutting)

Three a11y invariants are tested in `IconRail.test.tsx` and
verified during code review:

| Invariant                                                              | Where tested                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| Settings button has `aria-disabled="true"` and no `disabled` attribute | `IconRail.test.tsx` — disabled-button case          |
| Material Symbol icon spans have `aria-hidden="true"`                   | `IconRail.test.tsx` — accessible-name case          |
| Avatar element has `role="img"` and a non-empty `aria-label`           | `IconRail.test.tsx` — empty-ariaLabel fallback case |

Coverage requirement from `rules/CLAUDE.md` is 80 %; the rewritten
`IconRail.test.tsx` plus the additions in §9.1-§9.3 keep the
touched files above that threshold.

## 10. Follow-up issue: Settings dialog (paste-ready body)

The rail trim ships the gear button as an `aria-disabled` stub
with the tooltip `"Settings panel coming — see issue #N"`. The
following GitHub issue body lands the day this PR opens so the
`#N` placeholder has a real number to bind to. The body is
intentionally complete — anyone picking up the dialog work after
this lands should be able to spec and execute without consulting
this design document.

---

### Title

`feat(settings): add Settings dialog (Zed-style modal with 14 categories)`

### Labels

`design`, `frontend`, `enhancement`, `blocked-by-#<this-pr>`

### Body (Markdown, paste-ready)

```markdown
## Background

This issue tracks the **Settings dialog** that the icon-rail trim
([spec](docs/superpowers/specs/2026-05-20-icon-rail-trim-design.md),
PR #<this-pr>) deliberately deferred. The rail's gear button is
currently rendered with `aria-disabled="true"` and a tooltip
pointing here.

The dialog design is fully specified in the handoff bundle:

- `docs/design/rail/CHANGES.md` §"What's new — Settings dialog" —
  modal architecture, sidebar / header / pane regions,
  primitives, and per-category scope.
- `docs/design/rail/prototype/src/settings.jsx` — reference
  implementation in JSX. All 14 categories, the wired panes, and
  the reusable primitives are in this file.

This issue is the entry point for porting that handoff into the
real codebase as a feature spec + PRs.

## Scope

### In scope

- Add `src/features/settings/` with co-located components, types,
  tests.
- Implement the modal shell:
  - 920 × 640 panel (responsive to `95vw` / `90vh`).
  - Backdrop with `blur(14px) saturate(120%)`.
  - `⌘,` / `Ctrl+,` keyboard shortcut to toggle open.
  - Escape closes; backdrop click closes.
  - Title bar with a single close (`✕`) button on the right.
- Extract reusable primitives (exported from
  `src/features/settings/components/primitives/`):
  - `<Row label hint last>`
  - `<PaneTitle title sub />`
  - `<Toggle on onChange />`
  - `<Select value options onChange width />`
  - `<GhostButton onClick>...</GhostButton>`
  - `<TextInput value onChange placeholder mono width />`
- Sidebar with search + 14 categories:
  - General · Appearance · Keymap · Coding Agents · Editor ·
    Terminal · Languages & Tools · Search & Files ·
    Window & Layout · Panels · Version Control · Collaboration ·
    AI · Network
  - Active row gets the lavender left accent bar.
  - Search filters categories by label.
- Header with scope tabs (`User` / `vimeflow`) and an
  `Edit in settings.json` ghost button.
- **Three wired panes** (matches the prototype's 4 wired panes
  minus AppearancePane — see "Out of scope" below):
  - **General** — close-behaviour selectors, system-prompt
    toggles, redact-private-values toggle, CLI default-open
    selector.
  - **Keymap** — preset selector + bindings table with `<Kbd>`
    chips per row + edit pencil + Reset / Import / Export.
  - **Coding Agents** — alias-management toggle + editable table
    (alias / agent / model / extra flags). Aliases are injected
    via the PTY env at session creation; `~/.bashrc` /
    `~/.zshrc` are NEVER written. Info note references
    `~/.config/vimeflow/aliases.toml`.
- **Eleven placeholder panes** (Appearance + the other 10
  prototype categories): dashed "coming soon" card per pane,
  matching the prototype's placeholder shape so the
  information architecture is visible.
- Pre-merge: update `WorkspaceView.tsx`'s
  `SETTINGS_FOLLOWUP_ISSUE_NUMBER` const to this issue's
  number; remove `aria-disabled` from the gear button.
- Update `docs/design/UNIFIED.md` with the dialog contract once
  the shape is finalised (separate from the rail-trim UNIFIED
  edits in PR #<this-pr>).

### Out of scope

- **AppearancePane and the live theme-switching infrastructure.**
  The prototype's W.W. Navigator / Editorial / Dense / Obsidian
  Lens swatch grid drives a theme system the codebase doesn't
  yet have. Live re-theming requires moving the static hex
  tokens in `tailwind.config.js` into CSS variables keyed off a
  `data-theme` attribute, plus four token sets, plus a token
  sweep across every existing surface. File a separate issue
  when ready.
- Real implementation of any of the 10 other placeholder panes.
- `~/.config/vimeflow/aliases.toml` file format and IPC for
  reading / writing it (subset of the Coding Agents pane work;
  can be split out if scope creeps).

## Dependencies

- Blocked by PR #<this-pr> (rail trim — establishes the
  `settingsIssueNumber` prop and gear stub).
- Independent of: AppearancePane / theming spec (cross-link
  once that issue exists).

## Acceptance criteria

- [ ] `⌘,` opens the dialog; `Escape` closes it.
- [ ] Gear button in the rail is no longer `aria-disabled`; the
      tooltip drops the "coming" wording.
- [ ] Sidebar search filters categories by label.
- [ ] All 14 categories render (3 wired, 11 placeholders).
- [ ] Coding Agents pane writes / reads
      `~/.config/vimeflow/aliases.toml` and injects aliases into
      new PTY environments without touching shell rc files.
- [ ] Tests:
  - `SettingsDialog.test.tsx` covers keyboard shortcuts, scope
    tabs, search filter, and the wired panes.
  - Each primitive (`Row`, `Toggle`, `Select`, `GhostButton`,
    `TextInput`, `PaneTitle`) has its own test file.
  - Coverage >= 80 % for `src/features/settings/`.
- [ ] `docs/design/UNIFIED.md` extended with the dialog contract.
- [ ] `WorkspaceView.tsx` const `SETTINGS_FOLLOWUP_ISSUE_NUMBER`
      is removed (gear no longer needs an issue link).

## Risks

- `WorkspaceView.tsx` is already over the 800-LOC cap. Adding the
  dialog mount + the `⌘,` keyboard hook pushes it further. The
  rail-trim spec calls out a follow-up `useWorkspaceController`
  extraction; this dialog work either lands after that
  extraction, or files its own extraction issue first.
- The `Edit in settings.json` button implies a
  `~/.config/vimeflow/settings.json` file. That file format and
  read / write IPC don't exist yet — the button can ship as
  `aria-disabled` for the first cut, mirroring the pattern used
  by the rail-trim PR.
```

## 11. PR plan & risks

### 11.1 Commit sequence (single PR)

Per Approach 1 (selected in Step 3), the migration lands as one
PR with four commits so reviewers can audit each concern in
isolation. Commits in order:

1. **`refactor(command-palette): hoist useCommandPalette into WorkspaceView`**
   - Move `useCommandPalette(commands)` call from
     `CommandPalette.tsx` into `WorkspaceView.tsx`.
   - Refactor `CommandPalette.tsx` to accept controlled props
     (`state`, `filteredResults`, `clampedSelectedIndex`,
     `close`, `setQuery`, `selectIndex`).
   - Add `renderPalette()` test helper at
     `src/features/command-palette/CommandPalette.testUtils.tsx`.
   - Update `CommandPalette.test.tsx` to use the helper.
   - `useCommandPalette.test.ts` and
     `useCommandPalette.staleClosure.test.ts` remain untouched.
   - Verification: `Ctrl+:` keyboard shortcut still toggles the
     palette; tests pass.
2. **`refactor(workspace): trim icon rail to identity + bottom utilities`**
   - Rewrite `IconRail.tsx` per §7.1 (identity slot, spacer,
     command + settings buttons; hardcoded icons + tooltips;
     new optional props).
   - Empty `mockNavigationItems` array; preserve
     `mockSettingsItem` export shape (§7.4).
   - Rewrite `mockNavigation.test.ts` (§9.5).
   - Rewrite `IconRail.test.tsx` per §9.1.
   - Mechanical sweep of `WorkspaceView.*.test.tsx` siblings to
     drop dropped-icon assertions (§9.3).
3. **`feat(workspace): wire rail command button to palette + settings stub`**
   - Update `WorkspaceView.tsx` to:
     - Call the hoisted hook
       (`const commandPalette = useCommandPalette(workspaceCommands)`).
     - Pass `commandPalette.open` to `IconRail` as `onCommand`.
     - Pass the controlled props to `CommandPalette`.
     - Declare `SETTINGS_FOLLOWUP_ISSUE_NUMBER = 0` constant.
   - Add the "rail's command button opens the palette" case to
     `WorkspaceView.command-palette.test.tsx` (§9.3).
4. **`docs(design): bring UNIFIED in sync with rail trim`**
   - Apply the four UNIFIED edits per §7.5 (lines 47, 51, 193,
     212 — rail row, status-bar shortcut, palette contract,
     interaction-rules shortcut).
   - This commit is doc-only.

The handoff-files import (`docs/design/rail/`) landed earlier in
the branch as `docs(design): import icon rail handoff from claude
design` (`dc9ef03`); that commit predates this sequence.

### 11.2 PR description structure

```
## Summary

Trims the icon rail to identity + global utilities per the rail
handoff at `docs/design/rail/CHANGES.md`. The full Settings dialog
is deferred to a follow-up issue (see §10 below); this PR ships
the rail visuals and an `aria-disabled` gear button pointing at
that issue.

Design spec: docs/superpowers/specs/2026-05-20-icon-rail-trim-design.md

## Test plan

- [ ] `npm run test` passes locally (covers all five touched test
      files + the controlled palette + the hoisted hook).
- [ ] `npm run dev` — open the workspace, confirm:
  - [ ] Rail renders avatar (`w`) on top, search + settings on
        bottom.
  - [ ] `Ctrl+:` opens the palette.
  - [ ] Clicking the search button opens the palette.
  - [ ] Hovering the gear shows the
        "Settings panel coming — see issue #<N>" tooltip.
  - [ ] Clicking the gear does nothing (no banner, no console
        warning, no error).
- [ ] Visual diff against the Claude Design prototype iframe
      (§8.3) — rail background, border, avatar gradient, hover
      alpha indistinguishable to the eye.

## Follow-up issue

Paste the body from §10 of the spec into a new GitHub issue after
the PR opens, then bump `SETTINGS_FOLLOWUP_ISSUE_NUMBER`.

## Pre-merge checklist

- [ ] File the follow-up issue using §10's body.
- [ ] Bump `SETTINGS_FOLLOWUP_ISSUE_NUMBER` in
      `WorkspaceView.tsx` to the issue's number.
- [ ] Verify the gear tooltip renders the real issue number, not
      `#0`.
- [ ] Confirm the four UNIFIED edits landed (lines 47, 51, 193,
      212).
```

### 11.3 Risks and mitigations

| Risk                                                                                                    | Severity | Mitigation                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkspaceView.tsx` is already over the 800-LOC cap; this PR adds ~15 more lines.                       | Medium   | Spec calls out a `useWorkspaceController` extraction follow-up. Do not gate this PR on the extraction. If the file grows further before the Settings dialog ships, file the extraction issue at that point.                                        |
| Palette refactor leaks behaviour (e.g., `Ctrl+:` listener attached twice, focus lost).                  | Medium   | The `useCommandPalette.test.ts` and `useCommandPalette.staleClosure.test.ts` files are untouched and exercise the listener directly — they're the canary. PR sequencing puts the palette refactor in commit 1 so it can be reverted independently. |
| `SETTINGS_FOLLOWUP_ISSUE_NUMBER = 0` ships unbumped.                                                    | Medium   | Tooltip renders the loud `#0` so any reviewer pulling the branch sees the placeholder. Pre-merge checklist requires bumping it.                                                                                                                    |
| Optional `items` / `settingsItem` props look like dead code on review.                                  | Low      | §2 + §7.1 explicitly call out the one-cycle deprecation. The cleanup PR removes them once the Settings dialog lands. Comment in the props interface points at this spec.                                                                           |
| UNIFIED's other `⌘⇧E` / `⌘⇧D` / `⌘⇧F` / `⌘⇧T` shortcut lines remain stale post-merge.                   | Low      | Explicitly out of scope (§7.5). File a separate UNIFIED-vs-implementation audit issue if those start being misleading; this PR's UNIFIED edits cover only the rail + palette shortcut.                                                             |
| Token sweep misses a hex value when the prototype is re-rendered by Claude Design.                      | Low      | §8 mapping table is exhaustive against the current prototype source committed at `docs/design/rail/prototype/`. If Claude Design regenerates the prototype, re-run the §8.3 verification step; do not re-derive tokens from the regenerated HTML.  |
| Tooltip library (`src/components/Tooltip.tsx`) doesn't fire when the wrapped button is `aria-disabled`. | Low      | The button is NOT `disabled={true}` at the DOM level — only `aria-disabled="true"`. Tooltip wraps and fires on hover regardless. §9.1 has an explicit test case for this; if it fails, the implementation is wrong and the spec is right.          |

### 11.4 Rollback

Every commit in §11.1 is local-file-only — no IPC schema changes,
no Rust sidecar changes, no Electron preload changes. Rollback is
a clean `git revert <commit>` per commit. If the palette refactor
(commit 1) misbehaves in production, reverting just that commit
restores the previous behaviour without touching the rail trim
(commits 2-4 still work, the rail's command button silently
no-ops if `onCommand` becomes `undefined`).

## 12. Open questions

None at spec-write time. All Q1-Q6 forks from Step 2 of the
planner are resolved; the only conditional left is the runtime
value of `SETTINGS_FOLLOWUP_ISSUE_NUMBER`, which is substituted
pre-merge per §11.2.
