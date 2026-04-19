# Vimeflow -- Unified Design Spec

> **Authoritative.** When this document conflicts with any Stitch-generated `code.html` under `docs/design/<screen>/`, **this document wins.** The Stitch screens were exploratory and drifted; this spec reconciles them.

This spec extends the foundation in `DESIGN.md` (tokens, surface hierarchy, typography, do's/don'ts -- still valid) with three things that were missing or contradicted across Stitch patches:

1. **A canonical layout** (§2) -- resolves the 4-zone vs. 5-zone conflict.
2. **A full agent-state contract** (§4) -- so users can tell what happened hours later.
3. **Concrete component contracts** (§5) -- the API agents must honor when implementing.

For quick cross-reference, the runnable prototype lives in the Claude Design project (not mirrored into this repo — view via the `claude-in-chrome` CDP recipe in `docs/design/CLAUDE.md` → "Viewing the Runnable Prototype"). Tokens are exported as code at `docs/design/tokens.css` and `docs/design/tokens.ts`.

---

## 1. Read order for agents

When implementing any UI, read in this order and stop when you have what you need:

1. **This file** -- layout, component contracts, interaction rules.
2. **`docs/design/DESIGN.md`** -- full token tables, surface theory, typography scale.
3. **`docs/design/tokens.css` / `tokens.ts`** -- copy-pasteable values.
4. **`docs/design/<screen>/code.html`** -- Stitch reference. Treat as illustration of intent, not as source of truth.

If a value appears in both this file and a Stitch `code.html`, use the value here.

---

## 2. The Five-Zone Layout

The original `DESIGN.md` specified a 4-zone layout. Later Stitch screens added a top navigation bar, a bookmark rail, and a bottom drawer, producing three incompatible shells. **Resolution:** five zones, no top nav, no bottom drawer.

```
┌──┬─────────┬────────────────────────────────────┬──────────┐
│  │         │  View tabs  (terminal | editor...)   │          │
│R │         ├────────────────────────────────────┤          │
│a │ Sidebar │                                    │ Activity │
│i │         │   Main canvas (current view)       │  panel   │
│l │         │                                    │          │
│  │         │                                    │          │
│  │         ├────────────────────────────────────┴──────────┤
│  │         │   Status bar (global)                          │
└──┴─────────┴────────────────────────────────────────────────┘
```

| Zone               | Width                 | Surface                      | Purpose                                                                                                                                               |
| ------------------ | --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Icon rail**      | `48px`                | `--surface-container-lowest` | Brand mark (V) at top. Area switchers (Agent / Files / Editor / Diff / Context). Palette + settings + user at bottom.                                 |
| **Sidebar**        | `272px` (248 compact) | `--surface-container-low`    | Three tabs: **Sessions**, **Files**, **Context**. Shows project switcher at top.                                                                      |
| **View tabs**      | `40px tall`           | `--surface`                  | Inside main region only. Switches current view: terminal / editor / diff / files.                                                                     |
| **Main canvas**    | flex                  | `--surface`                  | The current view.                                                                                                                                     |
| **Activity panel** | `320px`               | `--surface-container-low`    | Status dot, meters (context, 5h usage, turns), current action, activity feed. Optional -- collapsible on narrow windows, but always visible >=1280px. |
| **Status bar**     | `24px tall`           | `--surface-container-lowest` | Global: `obsidian-cli` - version - context smiley - turn count - `⌘K` hint.                                                                           |

### Rules

- **No floating brand header.** The brand mark lives at the top of the icon rail only. Rail, not banner.
- **View tabs are scoped to the main region.** They switch the _view of the current session_. They do NOT span the full header width; the sidebar sits flush against them.
- **No bottom drawer.** Editor, diff, files, and context all mount in the main canvas, not a drawer. Drawers were a Stitch detour -- they fight the 5-zone layout.
- **No persistent chat pane.** Agent interaction happens in the **Terminal** view. The deprecated `chat_or_main/` directory should not be referenced for new work.

---

## 3. Views (what renders in the main canvas)

All four mount inside the main canvas. Switching is instant -- no page-level transitions.

### 3.1 Terminal (Agent Workspace)

The primary view. Streams an agent narrative.

- **Prompt line:** `{success-muted} path` - `{primary-container} git:(branch)` - `{on-surface} cmd`
- **Agent output:** prefixed with `∴` in `--primary-container` at column 0.
- **Tool invocation:** `⚒ tool-name(args) ● status - detail` -- args in `--syn-variable`, status dot in success/tertiary.
- **Patch block:** inline bordered card, removed lines in `--tertiary`, added in `--success-muted`.
- **Input bar:** pinned bottom, status dot, `>` prompt in `--primary-container`. Placeholder: `send a message or command (:help)`.
- **Streaming behavior:** one event every 1.3-2s while state is `running`; stops immediately the moment state leaves `running` (i.e. on `awaiting`, `completed`, `errored`, or `idle`).

### 3.2 Editor

- Breadcrumb header with `MODIFIED` badge when dirty.
- Gutter: right-aligned line numbers in `--outline-variant`, `tabular-nums`, 40px wide.
- Cursor line: `background: rgba(203,166,247,0.06)` + `border-left: 2px solid --primary-container`.
- Status bar (inside the view, 24px): `TS - Ln X, Col Y - UTF-8 - LF ─── ● agent is editing`.

### 3.3 Diff

- Two-column side-by-side. Left label: `HEAD`. Right label: `WORKING`.
- Changed-files rail on the left (240px): each row with `M|A|D` indicator + `+N / −N`.
- Commit meta strip at top: short SHA chip, commit subject, `author - relative-time`.
- Footer action bar: `Reject` (secondary) + `Stage hunk` (primary gradient).

### 3.4 Files

Full-canvas tree. Git status indicators on modified files: `M` (`#f0c674`), `A` (`--success-muted`), `D` (`--tertiary`). Expanding a file opens the **Editor** view with that file focused.

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

- ⌘K / Ctrl+K toggle, globally.
- Overlay z-index 100. Backdrop: `blur(14px) saturate(120%)` on `rgba(13,13,28,0.55)` -- this is the **Lens Blur** in action.
- Input auto-focuses. ↑/↓ navigate, ⏎ runs, Esc closes.
- Result rows: `icon - :command (mono) - label (body) - hint (muted)`.
- Footer hint strip: `⏎ run - ↑↓ navigate - [project label]`.
- Command syntax: colon-prefixed (`:open`, `:diff`, `:stage`, `:commit`, `:pause`, `:context`, `:settings`, `:session new`).

### 5.5 `ContextSmiley`

Drives off a single integer `pct`. Breakpoints in `tokens.ts::contextSmiley`. Visible in the status bar; also in the Tweaks panel when context pressure is adjustable.

---

## 6. Interaction rules (additions to DESIGN.md §7)

- **Streaming terminal** -- agent output arrives token-by-token. Each new line fades up 4-6px over 180ms. The cursor block (`--primary-container`, `8×15px`) blinks at 1.1s steps when input is active.
- **Status-dot glow** -- the 3-ring outer shadow uses the dot's own color at 40-45% alpha. Do not substitute drop-shadows; they compound poorly against glass.
- **Approval affordance** -- `awaiting` state surfaces two buttons: primary gradient for Approve, ghost for Deny. Approving snaps state to `running` without a page reload; the activity feed prepends a `user` event with the choice.
- **Session switching** -- clicking a session in the sidebar swaps the main canvas content, preserves the current view (terminal stays terminal, editor stays editor), and animates the activity panel contents -- not the panel itself.
- **Keyboard shortcuts** -- ⌘K palette - ⌘⇧E editor - ⌘⇧D diff - ⌘⇧F files - ⌘⇧T terminal - Esc closes overlays. Document discoverable via `:help`.

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
- ❌ **Bottom drawer for the editor** -- editor is a view, not a drawer.
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
