# Vimeflow -- Unified Design Spec

> **Authoritative.** When this document conflicts with any Stitch-generated `code.html` under `docs/design/<screen>/`, **this document wins.** The Stitch screens were exploratory and drifted; this spec reconciles them.

This spec extends the foundation in `DESIGN.md` (tokens, surface hierarchy, typography, do's/don'ts -- still valid) with three things that were missing or contradicted across Stitch patches:

1. **A canonical layout** (§2) -- resolves the 4-zone / 5-zone / DockPanel drift.
2. **A full agent-state contract** (§4) -- so users can tell what happened hours later.
3. **Concrete component contracts** (§5) -- the API agents must honor when implementing.

For quick cross-reference, use the in-repo handoff prototype under `docs/design/handoff/prototype/` first. The older Claude Design project is historical/contextual and is described in `docs/design/CLAUDE.md`. Tokens are exported as code at `docs/design/tokens.css` and `docs/design/tokens.ts`.

---

## 1. Read order for agents

When implementing any UI, read in this order and stop when you have what you need:

1. **This file** -- layout, component contracts, interaction rules.
2. **`docs/design/DESIGN.md`** -- full token tables, surface theory, typography scale.
3. **`docs/design/tokens.css` / `tokens.ts`** -- copy-pasteable values.
4. **`docs/design/<screen>/code.html`** -- Stitch reference. Treat as illustration of intent, not as source of truth.

If a value appears in both this file and a Stitch `code.html`, use the value here.

---

## 2. The Current Shell Layout

The original `DESIGN.md` specified a 4-zone layout. Later Stitch screens added a top navigation bar, a bookmark rail, and a bottom drawer, producing incompatible shells. **Resolution:** the production shell has five outer zones (rail · sidebar · main canvas · activity panel · status bar), no top nav, and a dockable Editor/Diff `DockPanel` _inside_ the main canvas. Session tabs and the layout toolbar are sub-rows of the main canvas -- they are not peer zones.

```
┌──┬─────────┬────────────────────────────────────┬──────────┐
│  │         │  Session tabs                         │          │
│R │         ├────────────────────────────────────┤          │
│a │ Sidebar │  Layout toolbar (when sessions)    │ Activity │
│i │         ├────────────────────────────────────┤  panel   │
│l │         │                                    │          │
│  │         │   SplitView terminal canvas       │          │
│  │         ├────────────────────────────────────┤          │
│  │         │   DockPanel: Editor / Diff         │          │
│  │         ├────────────────────────────────────┴──────────┤
│  │         │   Status bar (global)                          │
└──┴─────────┴────────────────────────────────────────────────┘
```

| Zone               | Width              | Surface                      | Purpose                                                                                                                                                                                          |
| ------------------ | ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Icon rail**      | `48px`             | `--surface-container-lowest` | User avatar at top. Palette + Settings at bottom. No area switchers — Files lives in the sidebar Files tab; Editor and Diff live in the dock; Context arrives with the deferred Settings dialog. |
| **Sidebar**        | `272px` resizable  | `--surface-container-low`    | **Sessions** and **Files** tabs. Shows session rows and file tree scoped to the active pane cwd. Context arrives with the deferred Settings dialog.                                              |
| **Main canvas**    | flex               | `--surface`                  | Hosts session tabs, layout switcher, `SplitView` terminal panes, and the dockable Editor/Diff `DockPanel`.                                                                                       |
| **Activity panel** | auto / collapsible | `--surface-container-low`    | Status dot, meters (context, 5h usage, turns), current action, activity feed. Scoped to the active pane's PTY.                                                                                   |
| **Status bar**     | `24px tall`        | `--surface-container-lowest` | Global: `vimeflow` - version - context smiley - turn count - `Ctrl+:` hint.                                                                                                                      |

### Rules

- **No floating brand header.** The brand mark lives at the top of the icon rail only. Rail, not banner.
- **Session tabs and layout controls are scoped to the main region.** They do NOT span the full header width; the sidebar sits flush against them.
- **DockPanel is inside the main canvas.** The old `BottomDrawer` component is gone. Editor and Diff mount in `DockPanel`, which can dock bottom / top / left / right and resize elastically. Files remains a sidebar tab in the current app.
- **No persistent chat pane.** Agent interaction happens in the **Terminal** view.

---

## 3. Main Canvas Surfaces

The main canvas is terminal-first. Session tabs select the active session; `SplitView` renders the active session's terminal panes; `DockPanel` hosts Editor / Diff when open. Files live in the sidebar.

### 3.1 Terminal (Agent Workspace)

The primary surface. It renders 1-4 xterm.js panes for the active session using `single`, `vsplit`, `hsplit`, `threeRight`, or `quad`.

- **Prompt line:** `{success-muted} path` - `{primary-container} git:(branch)` - `{on-surface} cmd`
- **Agent output:** prefixed with `∴` in `--primary-container` at column 0.
- **Tool invocation:** `⚒ tool-name(args) ● status - detail` -- args in `--syn-variable`, status dot in success/tertiary.
- **Patch block:** inline bordered card, removed lines in `--tertiary`, added in `--success-muted`.
- **Input bar:** pinned bottom, status dot, `>` prompt in `--primary-container`. Placeholder: `send a message or command (:help)`.
- **Streaming behavior:** one event every 1.3-2s while state is `running`; stops immediately the moment state leaves `running` (i.e. on `awaiting`, `completed`, `errored`, or `idle`).

### 3.2 Editor (DockPanel)

- Breadcrumb header with `MODIFIED` badge when dirty.
- Gutter: right-aligned line numbers in `--outline-variant`, `tabular-nums`, 40px wide.
- Cursor line: `background: rgba(203,166,247,0.06)` + `border-left: 2px solid --primary-container`.
- Status bar (inside the view, 24px): `TS - Ln X, Col Y - UTF-8 - LF ─── ● agent is editing`.

### 3.3 Diff (DockPanel)

- Two-column side-by-side. Left label: `HEAD`. Right label: `WORKING`.
- Changed-files rail on the left (240px): each row with `M|A|D` indicator + `+N / −N`.
- Commit meta strip at top: short SHA chip, commit subject, `author - relative-time`.
- Footer action bar: `Reject` (secondary) + `Stage hunk` (primary gradient).

### 3.4 Files (Sidebar)

Sidebar tree. Git status indicators on modified files: `M` (`#f0c674`), `A` (`--success-muted`), `D` (`--tertiary`). Selecting a file opens it in the Editor dock surface with dirty-file guards.

---

## 4. Agent session states -- the full contract

This is the most important addition. Users come back _hours later_ and need to answer: "what happened?" Every session must answer that at a glance.

### 4.1 The five states

| State       | Dot                                 | Pulse              | Label tone | Meaning                                                      |
| ----------- | ----------------------------------- | ------------------ | ---------- | ------------------------------------------------------------ |
| `running`   | `--success` solid + glow            | yes (`2s` cycle)   | success    | Agent is currently working.                                  |
| `awaiting`  | `--tertiary` solid + glow           | yes (`1.4s` cycle) | warn       | Agent is **blocked on the user** -- needs a yes/no or input. |
| `completed` | `--success-muted` **hollow ring**   | no                 | primary    | Done. Diff is ready to review.                               |
| `errored`   | `--error` solid                     | no                 | error      | Something broke. Stacktrace surfaced in activity panel.      |
| `idle`      | `--outline-variant` **hollow ring** | no                 | neutral    | Fresh session, no activity yet.                              |

The dot is produced by the `StatusDot` component (see §5.3). Glow is a 3-ring outer shadow at ~45% alpha of the dot color.

### 4.2 What every session card MUST show

A session card needs three pieces of information the user can scan in under a second:

1. **State dot** -- tells them _what's happening now_.
2. **Title + one-line subtitle** -- tells them _what it's working on_.
3. **Relative timestamp label** -- tells them _how long ago it happened_.

Use the state-label pattern:

```
• running - 2m 14s
• awaits you - 4h 12m
• done - 7h ago
• errored - 1d ago
• idle
```

Not "started 14:32" -- **always relative.** Absolute timestamps only appear on hover, as tooltips.

### 4.3 Cross-session scanning

The sidebar's **Sessions** tab groups sessions:

- **Active** -- anything `running` or `awaiting`. These appear first. `awaiting` sessions MUST be visually louder than `running` ones (coral vs mint -- the user's attention is needed).
- **Recent** -- `completed`, `errored`, `idle`, sorted by updated time.

### 4.4 Activity panel, per state

When the selected session is `awaiting`, the activity panel shows an **approval card** with the blocking question and two buttons (Approve primary, Deny secondary). When `errored`, the panel shows the error as a mono-font red block above the activity feed. When `completed`, the meter block and activity feed fill the panel -- no action prompt. When `idle`, meters show `--` placeholders.

---

## 5. Component contracts

These are the canonical APIs. Every Vimeflow component should implement at least these props; screens consume them without inventing local variants.

### 5.1 `SessionCard`

```ts
interface SessionCardProps {
  id: string
  title: string // "auth middleware refactor"
  subtitle: string // one-line, 60 chars max
  state: SessionState // see tokens.ts
  startedAgo: string // relative, pre-formatted: "2m 14s"
  updated: string // relative: "now" | "7h ago"
  turns: number
  tokens: { used: number; max: number } // context window
  usage: { used: number; max: number } // 5h limit
  changes: { added: number; removed: number }
  branch: string
  active?: boolean // currently selected in sidebar
  compact?: boolean // density toggle
  waitingOn?: string // required iff state === 'awaiting'
  error?: string // required iff state === 'errored'
  onClick(): void
}
```

### 5.2 `ActivityPanel`

Must render, in order: session header -> meters block (context %, 5h usage, turns) -> **conditional state card** (awaiting approval / error block / live action) -> activity feed.

The activity feed is a vertical timeline with left-aligned icon nodes on a `rgba(74,68,79,0.4)` 1px rail. Each event has a type (`edit` / `bash` / `read` / `think` / `user`), a body, and a relative timestamp. Never use absolute timestamps in the feed header.

### 5.3 `StatusDot`

```ts
interface StatusDotProps {
  state: SessionState
  size?: number // default 8
  glow?: boolean // default true
}
```

Implementation must match §4.1 exactly. If a new state is added, extend `SessionState` in `tokens.ts` AND this table AND the component -- all three, or none.

### 5.4 `CommandPalette`

- Ctrl+: toggle, globally.
- Overlay z-index 100. Backdrop: `blur(14px) saturate(120%)` on `rgba(13,13,28,0.55)` -- this is the **Lens Blur** in action.
- Input auto-focuses. ↑/↓ navigate, ⏎ runs, Esc closes.
- Result rows: `icon - :command (mono) - label (body) - hint (muted)`.
- Footer hint strip: `⏎ run - ↑↓ navigate - [project label]`.
- Command syntax: colon-prefixed (`:open`, `:diff`, `:stage`, `:commit`, `:pause`, `:context`, `:settings`, `:session new`).

### 5.5 `ContextSmiley`

Drives off a single integer `pct`. Breakpoints in `tokens.ts::contextSmiley`. Visible in the status bar; also in the Tweaks panel when context pressure is adjustable.

### 5.6 `Tooltip`

The only tooltip in the app. Lives at `src/components/Tooltip.tsx`; import via the alias: `import { Tooltip } from '@/components/Tooltip'`.

```ts
interface TooltipProps {
  content: ReactNode // null / false / '' disables the tooltip entirely
  children: ReactElement // single trigger element; receives the floating ref
  placement?: Placement // default 'top'; flips automatically near edges
  delayMs?: number // open delay, default 250
  disabled?: boolean
  shortcut?: ShortcutInput // Zed-style key chip, e.g. ['Mod', 'E'] — chrome surface only
  maxWidth?: number // default 320 — chrome surface only
  bare?: boolean // consumer owns the whole surface — rich hover cards only
  interactive?: boolean // pointer may enter the surface; requires ariaLabel
  ariaLabel?: string // required iff interactive
}
```

Rules:

- Native `title=` on DOM elements is **banned** (`react/forbid-dom-props`). Every hover label goes through this component.
- The default chrome surface (glassmorphic, `rounded-md`, 320px clamp, optional shortcut chip) is the answer for text labels — never restyle it per call site.
- `bare` is reserved for rich interactive hover **cards** that define a complete surface of their own (canonical consumer: the activity-details card via `ACTIVITY_CARD_SURFACE`). Never use it for plain labels.
- Icon-only triggers keep their `aria-label` — the tooltip is hover/focus-only and is not an accessible-name substitute.
- Features must not hand-roll floating surfaces: `@floating-ui/react` is confined to `src/components/base/floating/**` (the substrate) and the grandfathered `src/components/Tooltip.tsx`. Features compose `Dropdown`, `Menu`, or `Popover` instead.
- A trigger that is `disabled` swallows pointer events in Chromium — wrap it in a `<span className="inline-flex">` and let the span be the Tooltip child.

### 5.7 `Dropdown`

A controlled select surface. Lives at `src/components/Dropdown.tsx`; import via the alias: `import { Dropdown } from '@/components/Dropdown'`.

```ts
interface DropdownProps<T extends string | number> {
  value: T
  options: readonly DropdownOption<T>[] // { value, label, description? }
  onChange: (next: T) => void
  placement?: Placement // default 'bottom-start'
  width?: number
  label?: string // built-in select trigger
  leadingIcon?: string // Material Symbol ligature name for the trigger icon
  renderTrigger?: (a: {
    ref: React.Ref<HTMLElement>
    props: React.HTMLAttributes<HTMLElement>
    open: boolean
    current: DropdownOption<T> | undefined
  }) => React.ReactElement // custom trigger; omit to use the built-in label trigger
}
```

Rules:

- Import via `@/components/Dropdown`; never import from `src/components/base/**` directly (`base/` is package-private).
- Built on the package-private `base/floating` substrate (`useFloatingSurface` + `SurfacePanel`). Do not hand-roll a select surface.
- Keeps `role="menu"` / `menuitem` (the current diff toolbar behaviour is preserved; `role="listbox"` is a deferred a11y improvement).
- Use `renderTrigger` when the default label-chip trigger does not fit the call site; it receives a typed ref + merged props so the trigger stays keyboard-accessible.
- `DropdownOption` is re-exported from `@/components/Dropdown` — import it from there, never from `@/components/base/OptionList`.

### 5.8 `Menu`

A generic compound menu (click-anchored or cursor-anchored context-menu mode). Lives at `src/components/Menu.tsx`; import via the alias: `import { Menu } from '@/components/Menu'`.

```ts
// Anchored (click trigger) — trigger element toggles open:
interface MenuProps {
  trigger: ReactElement // cloned with floating ref + interaction props
  placement?: Placement // default 'bottom-start'
  width?: number
  middleware?: { ancestorScroll?: boolean } // opt out of scroll-dismiss where needed
  'aria-label'?: string
  children: ReactNode
}

// Controlled cursor-anchored context menu:
interface MenuContextMenuProps {
  position: { x: number; y: number }
  open: boolean
  onOpenChange: (open: boolean) => void
  'aria-label': string // required — non-modal focus; no implicit accessible name
  children: ReactNode
}

// Row subcomponents:
// <Menu.Section label?={string}>…</Menu.Section>
// <Menu.Item icon?={string} shortcut?={ShortcutInput} disabled?={boolean} onSelect={() => void}>…</Menu.Item>
// <Menu.Checkbox icon?={string} checked={boolean} onChange={(next: boolean) => void}>…</Menu.Checkbox>
// <Menu.Submenu label={string} icon?={string} value options onChange /> // shares base/OptionList with Dropdown
```

Rules:

- Import via `@/components/Menu`; never import from `src/components/base/**` directly (`base/` is package-private).
- Built on the package-private `base/floating` substrate (`useFloatingSurface` + `SurfacePanel`). Do not hand-roll a menu surface.
- `Menu.Context` bakes the context-menu substrate defaults (`offset: 0`, flip fallbacks, `autoUpdate: false`, `ancestorScroll: false`, `openOnArrowKeyDown: false`, non-modal focus) — consumers pass only `position`/`open`/items.
- Rows must form a static set registered with `FloatingList` so each row's index is DOM-ordered; dynamic row sets are unsupported.
- Keyboard focus and roving `tabIndex` are handled by the primitive via `useListNavigation`; rows must not manage their own `tabIndex`.
- `Menu` owns one-open-submenu state: opening a submenu closes any other; an outside-press inside an open submenu does not close the parent (`Menu.Submenu` registers its portal root with the parent's `dismissWhen` predicate).
- `Menu.Submenu` does not embed a public `Dropdown`; both share `base/OptionList` while `Menu` owns submenu lifecycle and dismissal.

### 5.9 `Popover`

An arbitrary-content dialog card. Lives at `src/components/Popover.tsx`; import via the alias: `import { Popover } from '@/components/Popover'`.

```ts
interface PopoverProps {
  anchor: HTMLElement | null // element the panel positions against
  open: boolean
  onOpenChange: (open: boolean) => void
  placement?: Placement // default 'bottom-start'
  width?: number
  middleware?: { ancestorScroll?: boolean } // { ancestorScroll: false } for plain-dismiss confirm dialogs
  'aria-label': string // required — role="dialog" needs an accessible name
  children: ReactNode // consumer owns the body; rendered on GLASS_SURFACE, focus-managed (modal)
}
```

Rules:

- Import via `@/components/Popover`; never import from `src/components/base/**` directly (`base/` is package-private).
- Built on the package-private `base/floating` substrate (`useFloatingSurface` + `SurfacePanel`). Do not hand-roll a dialog card.
- `role="dialog"` — `aria-label` is required and must be meaningful (it is the dialog's accessible name).
- Focus is modal (`initialFocus: 0`): focus lands on the first tabbable child on open and `modal: true` engages the focus trap; the consumer's body content is navigable by tab.
- Pass `middleware={{ ancestorScroll: false }}` for confirm dialogs that should dismiss only on outside-press or Escape, not on scroll.
- Consumer owns the body layout; the primitive supplies the glass chrome and focus management only.

---

## 6. Interaction rules (additions to DESIGN.md §7)

- **Streaming terminal** -- agent output arrives token-by-token. Each new line fades up 4-6px over 180ms. The cursor block (`--primary-container`, `8×15px`) blinks at 1.1s steps when input is active.
- **Status-dot glow** -- the 3-ring outer shadow uses the dot's own color at 40-45% alpha. Do not substitute drop-shadows; they compound poorly against glass.
- **Approval affordance** -- `awaiting` state surfaces two buttons: primary gradient for Approve, ghost for Deny. Approving snaps state to `running` without a page reload; the activity feed prepends a `user` event with the choice.
- **Session switching** -- clicking a session in the sidebar swaps the active session tab and terminal canvas, preserving open dock state where possible, and animates the activity panel contents -- not the panel itself.
- **Keyboard shortcuts** -- `Mod+1-4` focuses panes, `Mod+\` cycles layout, `Mod+E` opens/focuses Editor, `Mod+G` opens/focuses Diff, `Mod+B` returns focus to Terminal, `Ctrl+:` toggles the command palette, Esc closes overlays. Issue #225 tracks the remaining in-UI discovery surface for `Mod+\` and `Mod+B`.

---

## 7. Density modes

Two modes, toggled at the shell level and cascaded via CSS custom properties or a React context:

- **Comfortable** (default) -- sidebar `272px`, card padding `10-11px`, body text `13-13.5px`, subtitles visible.
- **Compact** -- sidebar `248px`, card padding `8-9px`, subtitles hidden, card meta compressed. Font sizes shrink by ~10%.

Do not invent a third density. If a user asks for more density, tighten the _content_ (abbreviate timestamps, collapse metadata) not the tokens.

---

## 8. Anti-patterns (things Stitch drifted into -- do not recreate)

- ❌ **Top navigation bar spanning the full window** -- violates the 5-zone layout.
- ❌ **Bookmark-style icon rail with rounded 64px tiles** -- the rail is 48px, icons are 18-22px.
- ❌ **Legacy BottomDrawer** -- use the current `DockPanel` pattern for Editor/Diff; do not reintroduce the old bottom-only drawer.
- ❌ **Emoji as primary iconography** -- use Material Symbols Outlined. Emoji is reserved for the context smiley only.
- ❌ **Pure `#000` backgrounds** -- always use a `--surface-*` token. The terminal view is `--surface` (`#121221`), never black.
- ❌ **1px borders for sectioning** -- tonal shift only. Use `outline-variant` at <=15% alpha if you truly must.
- ❌ **"Status: Running" text with a green dot** -- just show the dot + a relative timestamp. The state is semantic, not a string to print.
- ❌ **Absolute timestamps as first-class data** -- "14:32:04" tells the user nothing. Use `RelTime`.

---

## 9. Reference prototype

The prototype is hosted in the Claude Design project, not in this repo. Open it through the `claude-in-chrome` MCP — see `docs/design/CLAUDE.md` → "Viewing the Runnable Prototype" for the exact recipe (navigate, get_page_text, take_screenshot). Use it to:

- Visually verify a new screen matches system language.
- Copy interaction patterns (streaming, state transitions, command palette entry).
- Cross-check token values against `tokens.css` / `tokens.ts` (the prototype's internal `src/tokens.js` is a snapshot of the same data).

When the prototype diverges from `tokens.css` / `tokens.ts`, the files in this repo win — they're the values shipping to production.
