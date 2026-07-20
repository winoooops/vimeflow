# Vimeflow — Unified Design Spec

> **Authoritative & code-grounded.** This spec is derived from the shipped
> frontend on `main` (verified against `src/` as of #442/#443). It is the single
> source of truth for Vimeflow UI. Superseded handoffs, migration briefs, and
> first-draft Google Stitch mockups now live in [`archive/`](archive/) —
> reference only, never derive new work from them. When this file conflicts with
> anything in `archive/`, **this file wins**; when this file is silent on an exact
> value, the code in `src/` and the runtime tokens in `src/theme/themes/*.ts` are
> the truth.

It extends the foundation in [`DESIGN.md`](DESIGN.md) (The Lens philosophy,
typography, elevation, do/don'ts — still valid) and is consumed in the read
order below.

---

## 1. Read order for agents

1. **This file** — layout, surfaces, the agent-state contract, component contracts, interactions.
2. **`DESIGN.md`** — design philosophy, color/surface theory, typography scale, do/don'ts.
3. **`src/theme/themes/*.ts`** — the runtime token SSoT: **Catppuccin** (dark default, `obsidian-lens.ts`), **Flexoki** (light baseline, `flexoki.ts`), Gruvbox Dark/Light, Tokyo Night, Dracula, Ayu, Eldritch, Kanagawa, Nord, and Rosé Pine. `tokens.css` / `tokens.ts` are kept only for the non-color scales (type/radius/motion/dimensions) and the `SessionState` / `stateToken` / `contextSmiley()` contract — **not** color values.
4. **`archive/`** — first-draft Stitch screens + prototypes, visual reference only. This file always wins.

---

## 2. The shell — three zones on two planes

The workspace is **three outer zones** in a CSS grid (`grid-template-columns: auto 1fr auto`), with the status bar living **inside** the main column. There is **no icon rail** (removed in VIM-76).

```
┌─────────┬────────────────────────────────────┬──────────┐
│         │ top chrome · session island · layouts│          │
│         ├────────────────────────────────────┤          │
│ Sidebar │   SplitView terminal canvas         │ Activity │
│ (chrome)│   (1–4 panes)                       │  panel   │
│         ├────────────────────────────────────┤ (canvas) │
│         │   DockPanel: Editor / Diff          │          │
│         ├────────────────────────────────────┤          │
│         │   Status bar (24px)                 │          │
└─────────┴────────────────────────────────────┴──────────┘
```

| Zone                     | Width                                            | Surface                              | Notes                                                                                                                                      |
| ------------------------ | ------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Left sidebar**         | `272px`, resizable `272–384`, collapsible to `0` | **`surface-container-low`** (chrome) | Sessions + Files tabs. The only zone on the distinct-chrome tone.                                                                          |
| **Main canvas**          | flex (`1fr`)                                     | **`surface`** (canvas)               | Hosts the 44px top-chrome, the `SplitView`, the `DockPanel`, and the status bar. Rounded **left** corners (16px) when the sidebar is open. |
| **Right activity panel** | `280px` ↔ `44px` (rail), collapsible             | **`surface`** (canvas)               | Live agent observability, scoped to the active pane. Co-planar with the main canvas.                                                       |
| **Status bar**           | `24px` tall                                      | **`surface`** (canvas)               | Inside the main column, pinned bottom. Global readouts + actions.                                                                          |

### 2.1 The surface model (the "two planes")

Separation is **tonal-first** with two planes:

- **Canvas = `surface`** — main canvas, terminal/SplitView, panes, the `DockPanel` (Editor/Diff), the 44px top-chrome banner, the 24px status bar, **and** the right activity panel. All co-planar.
- **Distinct chrome = `surface-container-low`** — the left sidebar + the grid backdrop only. It is one step off the canvas: by M3 tonal behavior it renders **lighter than the canvas in dark** (`#1a1a2a` vs `#121221`) and **darker in light** (`#e6e4d9` vs `#fffcf0`) — same token, correct contrast in both themes.
- **Edges** —
  - **Left (sidebar ↔ canvas):** carried by the tonal step + the main canvas's **16px rounded-left corner** (collapses to `0`). **No drop shadow.**
  - **Right (canvas ↔ activity panel):** a single **1px `outline-variant`/25 hairline** (`border-l`). This is a _co-planar seam_ — two zones sharing one surface — and is the one sanctioned exception to the No-Line Rule (see `DESIGN.md`).
  - The top-chrome (`border-b`) and status bar (`border-t`) carry the same `outline-variant` ghost hairline (~20–25% alpha).

### 2.2 Collapse & responsive

- **Sidebar collapse** (`Ctrl+Shift+B` / `Cmd+B`): animates width `272 ↔ 0` over `220ms ease-pane` (`cubic-bezier(0.32,0.72,0,1)`); the grid `auto` track follows so there's no gutter. The **collapse toggle is root-anchored at a fixed coordinate** (`z-40`), never moving as the sidebar slides. Width is driven by the `--workspace-sidebar-width` CSS var during drag (no per-frame React re-render). Auto-collapses if the main canvas would drop below ~36% of the workspace.
- **Activity panel collapse:** `280px ↔ 44px` rail, `220ms`, persisted per session (`activityPanelCollapsed`).
- **Compact viewport (`≤899px`):** grid collapses to a single `1fr`; the sidebar becomes an absolute `z-30` overlay over a `z-20` scrim; the activity panel is hidden.

---

## 3. Main canvas surfaces

### 3.1 Terminal & SplitView (the primary surface)

`SplitView` renders the active session's `panes[]` into one of **5 grid layouts** (insertion order **is** the `Ctrl/Cmd+\` cycle):

| Layout       | Capacity | Shape                         |
| ------------ | -------- | ----------------------------- |
| `single`     | 1        | one pane                      |
| `vsplit`     | 2        | side-by-side                  |
| `hsplit`     | 2        | stacked                       |
| `threeRight` | 3        | wide left + two stacked right |
| `quad`       | 4        | 2×2                           |

- **Grid invariant:** every track is `minmax(0,1fr)`, never `1fr` — the `minmax(0,…)` floor lets panes shrink below terminal intrinsic widths so the grid never overflows. `resolveGrid` injects an **8px divider track** between fr-pairs (both fr tracks always sum to 1).
- **Dividers:** `SplitDividers` overlays draggable + keyboard-resizable `ResizeHandle`s (elastic, clamped 15–85%, commit-on-end; `Arrow`/`Home`/`End`, 20px / Shift 100px steps).
- **Empty capacity slots** render an `EmptySlot` add-pane card (dashed `outline-variant`/35 border) → add a **Shell** or **Browser** pane.

**`TerminalPane`** — a self-contained card (`bg-surface`, `radius 10`), `flex-col`:

- **Header** (`font-mono` 10.5px, `border-b outline-variant/[0.18]`): agent chip (glyph + short name, `accentDim` bg / `accentSoft` border / `accent` text) · truncating title (`userLabel ?? agentTitle ?? session.name`) · metadata (`GitRefChip` · `+added/−removed` · relative time) · `HeaderActions` (burner sync/placement/toggle · collapse · close, 22×22). Focused header gets an `accentDim` gradient wash.
- **Body:** native Ghostty (`libghostty-spm` parented `NSView`) on packaged macOS arm64; xterm.js for Linux/dev fallback and native-load failure; or `RestartAffordance` ("Session exited." + Restart) when the PTY exited.
- **Footer** (`font-mono` 11px, `border-t outline-variant/20`): click-to-focus prompt line (`>` in `accent` + state-aware placeholder).
- **Focus ring:** absolute `inset-0` span — resting `1px outline-variant/22`; focused `2px agent.accent` border + `6px accentDim` glow.
- Keyed by `pane.ptyId` (clean remount on PTY restart); slot wrapper keyed by `pane.id`.

### 3.2 Dock (Editor / Diff)

`DockPanel` (`bg-surface`, `z-30`) docks to one of four edges (`bottom` default). The `dock-canvas-wrapper`'s flex-direction is `column` (top/bottom) or `row` (left/right); render order flips so top/left sit before the terminal, bottom/right after. Sized in px via **two independent `useElasticContainer`s** (separate vertical & horizontal sizes preserved across position changes). Separating edge = `<edge> border-outline-variant/30`.

- **`DockTab`** — 34px header strip (`bg-surface-container-lowest`, `border-b outline-variant/25`): segmented **Diff Viewer** (`difference`, `Mod+G`) / **Editor** (`code`, `Mod+E`) buttons + a right actions cluster (collapses to a `more_horiz` menu under ~420px).
- **`DockSwitcher`** — four 22×26 edge buttons (top/bottom/left/right).
- **`ViewModeToggle`** — Reading ⇄ Source, for markdown.
- **Closed state renders nothing** — there is **no peek bar**; reopen via the status-bar dock toggle (`Mod+0`) or `Mod+E`/`Mod+G`.

### 3.3 Editor (Dock)

CodeMirror 6 + vim for source, react-markdown reading view for `.md`. The buffer is owned externally by **`useEditorBuffer`** (single owning content string per dock scope, last-write-wins, `dirty = current !== original`) — `CodeEditor`/`MarkdownReadingView` are presentational (this killed a double-read dirty-state race).

- **`CodeEditor`** — CM6 theme paints `bg-surface`; gutters `surface-container-low`; mono font `'Ioskeley Mono','JetBrains Mono'`; syntax via `--color-syn-*`; clipboard (`Mod-c/x/a`) + right-click `ContextMenu`.
- **`VimStatusBar`** (`h-7`, ~24.5px at the 14px root): `primary-container` `-- MODE --` pill + `primary` `[+]` dirty marker. **`EditorStatusBar`** (`h-6`, ~21px, global): mode · git branch · sync ↕ · filename · encoding.
- **`MarkdownReadingView`** — focusable region; reading styles via **`useReadingStyle`** store: `Compact` 16px/1.6/78ch · `Comfortable` 18.5px/1.65/75ch (default) · `Spacious` 20px/1.7/72ch, chosen in the `ReadingStyleMenu` gear.
- **`ExplorerPane` / `FileTree`** — collapsible left nav (role=tree), extension-mapped icons, git-status tints.

### 3.4 Diff (Dock)

The **live** diff surface is **`DiffPanelContent`** (git status + `useFileDiff` wrapping Pierre's `@pierre/diffs` `MultiFileDiff`). Two-column: a ~210px (`w-60` = 15rem at the 14px root) `ChangedFilesList` (`border-r wash-subtle`, `+ins/−del` in `vcs-added/vcs-deleted`) + a right pane that stacks a glass **`DiffChipToolbar`** over a scrolling Pierre diff body (split / unified).

- **`DiffChipToolbar`** (`surface-container-low/[0.88]` + `backdrop-blur-xl`, `outline-variant/15` hairline, `role=toolbar`) uses **PriorityPlus** overflow: `Segmented` (split/unified) · `FilePill` (file nav, wrap-around) · `ChangeStepper` (hunk nav) · `ToolWell` (stage `add_box` / unstage / discard `backspace` / discard-all `delete_sweep` + confirm popover) · `ViewSettingsDropdown` (line numbers, bg tint, file header, sticky, indicators/overflow).
- **Inline review:** hover a line → Pierre `+` gutter → `ReviewCommentComposer` (Enter submit / Shift+Enter newline / Esc cancel); `ReviewCommentRow` (edit/delete); `useFeedbackBatch` (Map keyed by `cwd/path/staged`, 50-comment soft cap) → `FinishFeedbackPopover` routes the batch to the target agent.
- **States:** loading (gated so `~`/`.` never spins forever) · status error · empty ("No changes to review") · populated · too-narrow (`DiffNarrowPlaceholder`).
- ⚠️ **`CommitInfoPanel`, `DiffLegend`, and `useDiffKeyboard` are unwired** (mockup-derived, no live import) — do not document as shipped.

### 3.5 Browser pane

A pane can host a **`BrowserPane`** (native web view) instead of a terminal: an Arc-style horizontal tab strip (`WEB` chip + capsule tabs + new-tab/close) over a toolbar (back/fwd/reload + address command bar + open-external). Identity accent = **cyan `agent-browser` (`#4fc8d6`)**, distinct from the agent accents. `Ctrl/Cmd+L` focuses the address bar (Enter submits a normalized URL, Esc cancels). Native views are occluded when any overlay is up (drag, palette, burner, rename, dialog).

### 3.6 Burner terminal

On packaged macOS native Ghostty, each terminal pane can own one nested secondary burner terminal. It defaults to the **bottom** edge and retains its own per-pane placement; the compact header pill cycles it clockwise through **bottom → left → top → right** with one icon button. The native AppKit divider follows the selected axis and remains resizable. **Hide ≠ kill** — hiding the secondary view keeps its ephemeral shell alive.

The xterm fallback remains the centered **`BurnerTerminalPopup`** (`role=dialog`, `z-100`, `760×600`): a full-screen scrim (`surface-container-lowest/55` + `blur(14px)`) behind a glass panel (`surface-container/90` + `blur(24px) saturate(160%)`, **shell-amber** (`agent-shell-accent`) tinted border + glow). Header: dashed `BURNER` pill + optional align/sync button (amber when out-of-sync) + hide; footer: `↵ run` / `⌃C cancel` chips + amber "esc hides — shell keeps running".

---

## 4. Agent session states — the contract

Users return _hours later_ and must answer "what happened?" at a glance. The five states are the contract; shipped surfaces now signal them with status text, relative timestamps, active-action cards, and contextual chrome. Standalone status dots were removed in VIM-126 and should not be reintroduced.

| State       | Meaning                                                               | `stateToken` contract               | Shipped cue                                    |
| ----------- | --------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------- |
| `running`   | Agent is working.                                                     | `success`, solid, glow, 2s pulse    | live action / running text + relative duration |
| `awaiting`  | **Blocked on the user** — needs input; must read louder than running. | `tertiary`, solid, glow, 1.4s pulse | approval/action surface                        |
| `completed` | Done; diff ready.                                                     | `success-muted`, hollow ring        | "Done" status text + relative time             |
| `errored`   | Broke; stacktrace in the activity panel.                              | `error`, solid                      | error text/details in activity surfaces        |
| `idle`      | Fresh / pure-shell pane, no activity.                                 | `on-surface-muted`, hollow ring     | idle/shell text state                          |

- The canonical visual map is `tokens.ts::stateToken` (color · solid/hollow · pulse · glow · label tone); `SessionState` is its union. It remains the semantic source for state coloring, but no shipped component renders standalone state pips.
- `SessionCard` shows status as a flat **text label** + tone (`STATUS_TEXT`, e.g. `completed → "Done"`) — no dot, no border, no accent bar.
- **Labels are always relative** (`running · 2m 14s`, `awaits you · 4h 12m`, `done · 7h ago`); absolute timestamps appear only on hover.
- The sidebar **Sessions** tab groups **Active** (any non-terminal pane — `running` / `awaiting` / `idle`, reorderable, first) above **Recent** (terminal — `completed` / `errored`).

---

## 5. Component contracts

The canonical surfaces and their key contracts. Full props live in the code; this records intent, dimensions, and invariants.

### 5.1 Sidebar & sessions

- **`Sidebar`** — slotted shell (`topBar / header / content / optional resizable bottomPane / footer`), `bg-surface-container-low`, full height.
- **`SidebarTopBar`** (42px) — drag region + Electron window-control reservation; **no bottom divider**; hosts the persistent collapse toggle slot.
- **`AgentStatusCard`** (header, **fixed 125px** across agent/shell states so the list never reflows): supports Claude Code, Codex CLI, and Kimi Code; renders agent title + context badge + turn pill + `RateLimitBar` body; `isShell` (derived: no agent/model/usage) renders `ShellBody` (terminal-icon empty state + cheatsheet link). For **kimi** (`isKimi`), the body is the **`KimiUsageGate`** instead of the plain bars: kimi's plan usage is fetched over the network (sends the api_key), so it is **opt-in** — five states share the fixed body height (OFF opt-in CTA → LOADING skeleton → ON two **peach** `RateLimitBar`s + a hover revoke → ERROR retry/turn-off, inferred from a timeout since there's no backend error event). Consent is global + persisted (`get/set_kimi_usage_consent` IPC); the **reset-time subline is a shared follow-up (VIM-123)**, not kimi-only.
- **`SidebarTabs`** — segmented control with a sliding lavender thumb; the app uses **Sessions** + **Files**.
- **`SessionCard`** — flat soft fills (active `primary-container/15`, hover/menu `wash-faint`; **no dot, no border, no accent bar**); title + subtitle + a status **text label** (`STATUS_TEXT` + tone, e.g. `completed → "Done"`) + relative time + multi-pane `LayoutGlyph`; hover kebab (Rename / Remove, constant height); double-click / Rename → inline `PaneRenameInput`. Active cards are `Reorder.Item` (Framer Motion drag-reorder).
- **`NewSessionButton`** — flat lavender→deep-purple gradient (`Ctrl/Cmd+N`). **`SidebarSettingsFooter`** (`h-10`, ~35px) — Settings entry (deferred dialog, #252).
- **`SidebarToggle`** — Codex/VS-Code `panel-left` glyph (16-viewBox, stroke 1.3; outline rect + left-rail divider always drawn, `0.28` rail fill only when open); `ghost`/`inset` variants; `aria-expanded`; `Cmd+B` / `Ctrl+Shift+B`. Collapse animates the sidebar shell width to `0` (the grid `auto` track follows — no gutter); the panel goes `inert`/`aria-hidden` and the top-bar controls unmount (the shell stays mounted).

### 5.2 Right activity panel

`AgentStatusPanel` (`280px`, exported `PANEL_WIDTH_PX`) — `bg-surface`, three regions:

1. **Header** — `linear-gradient(180deg, agent.accentDim, transparent 80%)`, 26×26 mono glyph chip, agent short name (13px).
2. **Budget zone** (`p-2`) — **`ContextReservoirCard`** renders the context window as a **reservoir**: a water-drop identity chip (**no emoji**), `CONTEXT` label + big %, a 104px `WaterTank` (depth-graded fill, animated dual-wave meniscus, `{windowSize}`/`0` scale ticks, a value pill riding the waterline) and a `{used} tokens · {headroom} left` footer. Fill color is the continuous **`ctxTone`** seafoam→gold→coral→rose HSL sweep keyed to fill — **interpolated, no tiers** (`utils/contextTone.ts`, shared with the rail); dark/light flips via `resolveContextTone`/`tankChrome`; the waves honor `prefers-reduced-motion`. Then **`TokenCache`** (28px % + `Sparkline` + cached/wrote/fresh `StackBar`, tone `≥70` healthy / `≥40` warming / `<40` cold). The two cards share chrome (radius 10, 135° tone wash, tinted border, no elevation) so they read as one family.
3. **Scroll zone** — `ToolCallSummary` · conditional `LiveActionCard` (the running tool lifted into a **NOW** card — bolt + verb + path + diff + LIVE chip; opens the diff on click) · `ActivityFeed` (`role=feed`, vertical `outline-variant/40` rail, 10 newest + "N earlier", roving-tabindex) · `FilesChanged` · `TestResults`.

`AgentStatusRail` (`44px`, `RAIL_WIDTH_PX`) — expand chevron + vertical `CONTEXT` + `CACHE` `RailMeter` gauges (the `CONTEXT` gauge fills with the same continuous `ctxTone` sweep as the panel reservoir, so collapsed + expanded agree on the context color; `CACHE` keeps its `≥70`/`≥40`/`<40` tones). **`BudgetMetrics`** has three variants: `Subscriber` (5h + Weekly bars), `ApiKey` (Cost / API Time / Tokens), `Fallback` (Tokens only). `CollapsibleSection` is the shared `border-t` section primitive. `PANEL_WIDTH_PX`/`RAIL_WIDTH_PX` are the single source of truth for the shell's width animation.

### 5.3 Command palette

`CommandPalette` — centered overlay (`fixed inset-0 z-100`, `pt-[15vh]`), `max-w-2xl` glass panel (`surface-container/90`, `glass-panel`) over a `surface-container-lowest/40` + `backdrop-blur-sm` (~4px) backdrop. Sections: `CommandInput` (auto-focus, ESC badge) · `CommandResults` (`role=listbox`, selected `primary-container/10`) · `CommandFooter` (`↑↓ navigate · ⏎ select · ? help`).

- **Trigger:** `Ctrl+;` (Win/Linux) / `Cmd+;` (mac) — opens a **500ms leader window**; a non-chord key inside the window opens the palette pre-seeded with `:` + key.
- Hierarchical command tree (parents drill into children); fuzzy match on the verb after `:`; `↑↓` cyclic nav, `⏎` run/drill, `Esc`/`Backspace`-on-empty close.

### 5.4 Status bar

`StatusBar` (`<footer>`, 24px `--status-bar-h`, `font-mono` 10px, `bg-surface`, `border-t` outline-variant ghost). **Left:** icon action buttons — command palette (`Mod+;`) + editor/diff dock toggle (`Mod+0`, icon-color state, not a filled bg). **Right** (`tabular-nums`, `·` separators, labels hidden `<760px`): duration · **`ContextSmiley`** · cache rate · turns · diff `+/−` · burner count. No brand, no version.

- **`ContextSmiley`** (status bar) thresholds: `<50` 😊 `success` · `<75` 😐 `on-surface-variant` · `<90` 😟 `tertiary` · `≥90` 🥵 `error` (`contextPresentation()`). Drives off one `pct`; `null` (≠ 0) suppresses a misleading 0%. The degrading faces now live **only** here — the activity-panel `ContextReservoirCard` dropped its emoji for the continuous `ctxTone` reservoir. **Divergence to note:** `tokens.ts::contextSmiley()` still uses a `60/80/90` set that differs from this bar's `50/75/90` — a remaining code-level inconsistency, not yet unified.
- Cache rate = `round(cached/(cached+wrote+fresh))`, shown only when the denominator > 0.

### 5.5 GitRefChip

A rounded 22px pill in the pane header / session metadata: optional worktree segment (`account_tree` + name + `›`) then branch (`fork_right` + name); `primary-container` tint normally, two-tone coral (`tertiary`/`error`) when detached. On hover it opens a **copy popover** — a 244px `bare interactive` `Tooltip` on the same glass surface as the activity-detail card — with one click-to-copy row per ref fact: worktree (only when set), the full cwd path (only when available), then branch (label reads `detached head` when detached). Each row is a single `<button>`; clicking anywhere on it copies that value and flips the trailing `content_copy` glyph to a `success` check for ~1.3s. The chip's own visuals are unchanged. Props: `branch` (req), `worktreeName`, `cwd?`, `detached?`.

### 5.5.1 Chip

`Chip` lives at `src/components/Chip.tsx`; import via `@/components/Chip`. It is the shared primitive for compact labels, counters, badges, file/git pills, activity kind tags, and toolbar count pills.

```ts
interface ChipProps {
  variant?: 'subtle' | 'tinted' | 'solid'
  tone?:
    | 'neutral'
    | 'primary'
    | 'secondary'
    | 'success'
    | 'error'
    | 'warning'
    | 'tertiary'
    | 'custom'
  radius?: 'chip' | 'pill' | 'md'
  size?: 'xs' | 'sm' | 'md' | 'custom'
  label?: ReactNode
  leading?: ReactNode
  leadingIcon?: string
  trailingCount?: ReactNode
}
```

Rules: use `leadingIcon` for Material Symbols, `trailingCount` for small numeric badges, and `custom` only when preserving a specialized existing chip geometry or dynamic agent/accent colors.

### 5.5.2 ProgressBar

`ProgressBar` lives at `src/components/ProgressBar.tsx`; import via `@/components/ProgressBar`. It owns thin single-fill bars and segmented distribution bars.

```ts
interface ProgressBarProps {
  label: string
  value?: number
  max?: number
  tone?:
    | 'neutral'
    | 'primary'
    | 'secondary'
    | 'success'
    | 'error'
    | 'warning'
    | 'tertiary'
    | 'kimi'
    | 'custom'
  height?: 'thin' | 'sm' | 'md'
  radius?: 'chip' | 'pill'
  gradient?: boolean
  decorative?: boolean
  segments?: readonly ProgressBarSegment[]
}
```

Rules: non-decorative bars expose `role="progressbar"` with clamped `aria-valuenow`; segmented decorative bars are for compact visual distributions such as token-cache buckets and test summaries.

### 5.6 Tooltip

The **only** tooltip in the app — `src/components/Tooltip.tsx`, imported via `@/components/Tooltip`. Native `title=` is banned (`react/forbid-dom-props`); `@floating-ui/react` is restricted to `src/components/`.

- Default **chrome surface** (glassmorphic, `rounded-md`, 320px clamp, optional Zed-style `shortcut` chip) for text labels — never restyle per call site.
- `bare` only for rich interactive hover **cards** (canonical: the activity-details card, `ACTIVITY_CARD_SURFACE`).
- A `disabled` trigger swallows pointer events — wrap it in `<span className="inline-flex">`.

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

> **In-pane tool layers (exception).** Absolutely-positioned surfaces that live
> _inside_ a feature panel's subtree — the diff changed-files overlay (#645) and
> the diff search popup (VIM-252) — are not floating surfaces in this contract's
> sense: they are modeless, non-portaled, anchored to the panel (not a trigger),
> and must stay inside the panel for keyboard-scope containment. They reuse the
> glass recipe tokens directly and never import `@floating-ui`.

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

### 5.9.1 `Dialog`

The app-level viewport modal shell. Lives at `src/components/Dialog.tsx`; import via the alias: `import { Dialog } from '@/components/Dialog'`.

```ts
interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  placement?: 'center' | 'top'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  dismissDisabled?: boolean
  restoreFocus?: boolean
  initialFocusRef?: React.RefObject<HTMLElement | null>
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  testId?: string
  backdropTestId?: string
  children: ReactNode
}

// Optional structure helpers:
// <Dialog.Header>...</Dialog.Header>
// <Dialog.Body>...</Dialog.Body>
// <Dialog.Footer>...</Dialog.Footer>
```

Rules:

- Use `Dialog` for full-screen app modal shells that block workspace interaction, such as unsaved-change confirmation and command-palette style overlays.
- Do **not** use `Dialog` for anchored or cursor-positioned surfaces. Use `Popover`, `Menu`, or `Dropdown` for those; they stay on `base/floating`.
- `Dialog` owns the fixed viewport overlay, `z-[100]` stacking, backdrop, Lens glass panel, focus trap, focus restore, Escape/backdrop dismissal, and `aria-modal`.
- Consumer code owns domain content and callbacks. The primitive must not know about save/discard, command palette selection, terminal focus, or settings state.
- `dismissDisabled` locks Escape and backdrop dismissal for in-flight actions. Direct child buttons may still call their feature callbacks.
- `Dialog.Header` / `Body` / `Footer` provide the standard confirmation-dialog spacing and dividers. More complex bodies may render custom layout inside the panel.

### 5.10 `Button`

The text/primary foundation. Lives at `src/components/Button.tsx`; import via the alias: `import { Button } from '@/components/Button'`.

```ts
interface ButtonProps
  extends
    Pick<ButtonVariantProps, 'variant' | 'size'>,
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  leadingIcon?: string // optional Material Symbol ligature
  className?: string // layout/positioning only
  children: ReactNode // the label
  ref?: React.Ref<HTMLButtonElement>
}
```

Rules:

- Import via `@/components/Button`; never import from `src/components/base/**` directly (`base/` is package-private).
- Variant styling is a single `tailwind-variants` `tv()` definition in the package-private `base/button` substrate (`buttonVariants` + `BaseButton`); the five public variants are `ghost | default | toolbar | primary | danger`, plus `size` and `shape`. Prop types fall out of `VariantProps`, `Pick`ed to `variant`/`size` — `shape` is fixed per primitive (`pill` here), never a consumer prop.
- `variant` defaults to `'default'`, `size` to `'md'`; use `variant="primary"` for the accent gradient/shadow CTA and `variant="danger"` for destructive actions.
- Renders `BaseButton` (`shape="pill"`) with an optional leading icon span (`material-symbols-outlined`, `aria-hidden`) and `children` as the label.
- `className` is for layout/positioning only — never restyle the variant tokens per call site.

### 5.11 `IconButton`

Icon-only. Required `label` is both the accessible name and the Tooltip text. Lives at `src/components/IconButton.tsx`; import via the alias: `import { IconButton } from '@/components/IconButton'`.

```ts
interface IconButtonProps
  extends
    Pick<ButtonVariantProps, 'variant' | 'size'>,
    Omit<
      React.ButtonHTMLAttributes<HTMLButtonElement>,
      'className' | 'aria-label'
    > {
  icon: string // Material Symbol ligature
  label: string // REQUIRED — sets aria-label AND the Tooltip content
  pressed?: boolean // aria-pressed toggle state (standalone toggles / Popover anchors)
  shortcut?: ShortcutInput // optional Zed-style key chip in the Tooltip
  tooltipPlacement?: Placement // default 'bottom'
  showTooltip?: boolean // default true; off when the trigger already has a disclosure affordance
  className?: string // layout/positioning only
  ref?: React.Ref<HTMLButtonElement>
}
```

Rules:

- Import via `@/components/IconButton`; never import from `src/components/base/**` directly (`base/` is package-private).
- `label` is **required** — it is the accessible name (`aria-label`) and the Tooltip content. An icon-only `<button>` must always have an accessible name; `showTooltip={false}` suppresses only the hover affordance, never the `aria-label`.
- `variant` defaults to `'ghost'`; use `variant="danger"` for destructive icon actions.
- Active state is **attribute-driven**: pass `pressed` for standalone toggles / `Popover` anchors (it sets `aria-pressed`); as a `Menu`/`Dropdown` trigger the open tint comes from the injected `aria-expanded` (no `pressed` prop). `BaseButton` keys both `aria-pressed:` and `aria-expanded:` variants off the same tint.
- Icon geometry is square with `rounded-chip` radius. `BrowserToolbar` nav (`rounded-lg`) and `PriorityPlus` (`rounded-full` circle) are documented `className` radius exceptions.
- `ref` + `...rest` forward to the `<button>`, so it composes as a `Menu`/`Dropdown` trigger or `Popover` anchor — `Tooltip` merges the injected ref/handlers (`useMergeRefs` + `cloneElement`). `Placement` / `ShortcutInput` come from the existing re-export points (`@/components/base/floating/glassSurface` / `../lib/formatShortcut`).

### 5.12 `ToolbarButton`

Icon + visible label pill — the diff-toolbar trigger shape. Lives at `src/components/ToolbarButton.tsx`; import via the alias: `import { ToolbarButton } from '@/components/ToolbarButton'`.

```ts
interface ToolbarButtonProps
  extends
    Pick<ButtonVariantProps, 'variant' | 'size'>,
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  label: string // visible text
  icon?: string // optional leading Material Symbol
  trailingIcon?: string // optional trailing symbol (e.g. 'expand_more' caret)
  pressed?: boolean // aria-pressed; for Menu triggers the open tint comes from injected aria-expanded
  className?: string // layout/positioning only
  ref?: React.Ref<HTMLButtonElement>
}
```

Rules:

- Import via `@/components/ToolbarButton`; never import from `src/components/base/**` directly (`base/` is package-private).
- `variant` defaults to `'toolbar'`; `shape` is fixed `pill`.
- Renders `BaseButton` with a leading icon (if any), the visible label, and an optional trailing caret. Forwards `ref` + `...rest`, so it serves as a `Menu` `trigger` (open tint via injected `aria-expanded`) or a `Popover` anchor (`pressed={open}`, consumer owns `open`) — active state is attribute-driven, same as `IconButton`.
- `className` is for layout/positioning only.

### 5.13 `SegmentedControl` / `Toggle`

Grouped selection primitives from VIM-125. `SegmentedControl` covers mutually-exclusive pickers (`SidebarTabs`, `DockSwitcher`, `DockTab`, `LayoutSwitcher`, `ViewModeToggle`, diff split/unified); `Toggle` covers chip-style booleans in the diff toolbar.

```ts
interface SegmentedControlOption<T extends string | number> {
  value: T
  label: string
  ariaLabel?: string
  icon?: string
  tooltip?: ReactNode
  shortcut?: ShortcutInput
}

interface ToggleProps {
  label: string
  value?: boolean
  onChange: (next: boolean) => void
}
```

Rules:

- Import via `@/components/SegmentedControl` and `@/components/Toggle`; feature-local wrappers may exist only to preserve older prop shapes.
- `SegmentedControl` uses `role="group"` + per-button `aria-pressed`; it implements roving `tabIndex` and arrow/Home/End key movement. Use `skipActiveReselect` when the active option must not fire callbacks (for example `LayoutSwitcher`).
- Visual variants are `pill`, `dock`, `framed`, `toolbar`, `toolbarInline`, and `sidebar`; they are a `tailwind-variants` matrix, matching the Button substrate approach.
- `IconButton` is still the right primitive for icon-only controls embedded inside tab strips. VIM-125 consumes the VIM-124 grouped-control ratchet: no `-- VIM-125: grouped control` disables should remain.

### 5.14 `SessionIsland`

Centered open-session navigation in the 44px main-canvas top chrome. It is additive to the sidebar and right-aligned `LayoutSwitcher`; it never replaces either.

- Source/order: `sessions.filter(isOpenSession)`, exactly matching the sidebar Active section. Recent/completed sessions have no indicators.
- Batch: at most 10, automatically following the selected open session (1–10, 11–20, ...). A Recent selection keeps the last valid batch with no active capsule.
- Geometry: 28px-high, 18px-radius themed glass capsule; 16px inactive circles; 48px active capsule; active-label mode grows to at most 160px. The island is mathematically centered with `left: 50%` / `translateX(-50%)` and has no shadow.
- Color: active = `primary`; indicators to its left = full `secondary`; indicators to its right = `secondary`/55. With no selected open session all use the right/upcoming treatment. These positions are navigation context, not agent/session state.
- Motion: width/color/opacity transition over `222.222ms cubic-bezier(.333333,1,.666667,1)`; reduced motion uses 1ms.
- Display setting: `sessionIslandDisplay` is `dots` (default), `numbers` (global Active position), or `labels` (active name only).
- Accessibility: `nav[aria-label="Open sessions"]`; every indicator is a named button with `aria-current="page"` only on the selected open session and uses the shared `Tooltip`.
- Responsive: below a 700px main-column width, the layout pillar yields space by collapsing to the active layout readout plus its configuration menu. The session island remains centered.
- Notifications: the quiet outline-bell placeholder is absent unless `VITE_SESSION_ISLAND_NOTIFICATIONS=1`; notification state/badges are deferred.

---

## 6. Interactions & keyboard shortcuts

- **Streaming:** terminal output is raw PTY. Agent structured output prefixes `∴` in `primary-container`; one event every ~1.3–2s while `running`, stopping the instant state leaves `running`.
- **Shortcuts:** `Mod+1–4` focus panes · `Mod+\` cycle layout · `Mod+Z` toggle active-pane focus · `Mod+E` Editor · `Mod+G` Diff · `Mod+0` toggle dock · `Mod+B` (mac) / `Ctrl+Shift+B` toggle sidebar · `Mod+R` toggle agent activity panel · `Ctrl/Cmd+;` command palette · `Ctrl/Cmd+L` browser address bar · `Esc` closes overlays.
- **Shortcut registry invariant:** Settings edits resolve through one catalog snapshot shared by the shell renderer, embedded browser views, and native Ghostty views. Native surfaces do not maintain a separate shortcut allowlist; focus-scoped commands remain with their owning renderer context.
- **Approval:** `awaiting` surfaces an approval card (Approve gradient / Deny ghost); approving snaps to `running` and prepends a `user` event.
- **Focus model:** `activeContainerId` routes shortcuts to the terminal vs the dock; the sidebar toggle has a focus guard so compact-close never drops focus to `<body>`.

---

## 7. Density

Density is **scoped, not a global mode** (there is no shell-level comfortable/compact switch):

- **Markdown reading styles** — `Compact` / `Comfortable` / `Spacious` (font + line-height + measure), in the editor dock only.
- **DockTab compact toggle** — the dock header collapses its actions cluster to an overflow menu under ~420px.
- **Status bar** — hides labels/segments under `760px`.

If more density is needed, tighten _content_ (abbreviate, collapse), not the tokens.

---

## 8. Anti-patterns (do not recreate)

- ❌ **An icon rail / 4th–5th outer zone** — the shell is three zones; the rail was removed (VIM-76).
- ❌ **A top navigation bar spanning the window** — the only top bar is the 44px in-canvas top-chrome.
- ❌ **A "Status: Running" string with a dot** — standalone status dots are removed; show semantic status text, relative time, and the relevant activity surface.
- ❌ **Absolute timestamps as first-class data** — always relative; absolute only on hover.
- ❌ **Emoji as iconography** — Material Symbols Outlined only; emoji is reserved for the `ContextSmiley`.
- ❌ **Pure `#000`/`#fff`** — always a `surface-*` / `on-surface` token.
- ❌ **A dock "peek" bar when closed** — closed dock renders nothing; reopen via the status-bar toggle.
- ❌ **Solid 1px divider lines for sectioning** — tonal-first; a `outline-variant` ghost hairline is allowed **only** for a co-planar seam (see `DESIGN.md`).
- ❌ **Re-pinning surface tokens to dark-only hex** — use semantic tokens; values live in `src/theme`.

---

## 9. Tokens & theming

The token system is **multi-theme at runtime** (`src/theme/`): TypeScript `ThemeDefinition`s (`ui` / `effects` / `shadows` / `syntax` / `terminal` / `agents`) applied as `--color-*` / `--shadow-*` CSS variables on `documentElement`. The shipped themes are **Catppuccin** (dark default — file/id `obsidian-lens`, on the Catppuccin Mocha palette), **Flexoki** (light baseline — file/id `flexoki`), **Gruvbox Dark**, **Gruvbox Light**, **Tokyo Night**, **Dracula**, **Ayu**, **Eldritch**, **Kanagawa**, **Nord**, and **Rosé Pine**, all exposing identical token keys so `bg-surface` etc. resolve per active theme. The default dark theme's file/id keeps the legacy `obsidian-lens` slug; its display `label` is `Catppuccin`. `themeService.apply(id)` writes the vars, sets `data-theme` + `colorScheme`, persists to `localStorage`, and notifies subscribers; terminal renderers consume the same terminal token bridge (native Ghostty on macOS, xterm canvas fallback elsewhere).

- **The runtime SSoT is `src/theme/themes/*.ts`** — not the dark-only tables in `DESIGN.md` / `tokens.css`. `theme.css` mirrors the Catppuccin (`obsidian-lens`) defaults (kept in sync by `themeCss.test.ts`; regenerate via `scripts/generate-theme-css.ts`).
- `tokens.ts` / `tokens.css` remain for: the `SessionState` union + `stateToken` map + `contextSmiley()` breakpoints, and the non-color scales (type, radius `xl/lg/md/sm/full`, motion `ease-pane` + durations, layout dims). Treat their color tables as a historical snapshot.

---

## 10. Reference

The runnable prototype is hosted in the Claude Design project (not in-repo); open it via the `claude-in-chrome` MCP — see `CLAUDE.md` → "Viewing Prototypes". Superseded in-repo handoffs/mockups are in [`archive/`](archive/) as visual reference only.
