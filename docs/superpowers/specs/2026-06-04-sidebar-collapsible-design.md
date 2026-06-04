# Collapsible Left Sidebar + Fused Agent Status Card — Design

> **Status:** design converged via a live UI spike on `feat/vim-66-sidebar-collapsible` (validated in the running app), then captured here. Closes **VIM-66**.
> **Design inputs:** `docs/design/sidebar-toggle-handoff/SIDEBAR-TOGGLE-HANDOFF.md` and `…/AGENT-STATUS-CARD-HANDOFF.md` (authoritative for this feature), reconciled to the real TS architecture and design system (`docs/design/UNIFIED.md`).

## 1. Problem & scope

The left sidebar (Sessions/Files panel) is resizable but cannot be hidden. The right Activity panel and the bottom Dock are already collapsible; the sidebar should be **as well**, to reclaim horizontal space. While doing so, the sidebar's top header is replaced by a **fused Agent Status Card** that surfaces the active session's live agent state, and the collapse control is integrated as a single toggle with two homes.

### Locked decisions (validated in the spike)

- **Collapse model:** the sidebar **slides shut like a drawer** (animated width `W → 0`) and the main column reclaims the space with **no gutter**. (Handoff said "unmount"; in our CSS grid the equivalent is an `auto` track following a shell that animates to width 0 — see §4.)
- **Toggle, two homes, one control:** when open, the toggle lives **top-left inside the status card** (`inset` variant); when collapsed it lives at the **top of the 48px IconRail**. Only one is visible at a time. Both render at the **same size (28px)** and the **same vertical position** so the glyph reads as one control handing off.
- **State scope:** a single **workspace-global** `sidebarCollapsed` boolean, persisted to `localStorage`. Not per-session.
- **Shortcut:** **⌘B on macOS, Ctrl+⇧B on Linux/Windows** (`Ctrl+B` is reserved by terminals — tmux/readline — so it is not hijacked globally), plus a **`:toggle-sidebar`** command-palette entry.
- **Glyph:** the Codex/VS-Code "panel-left" mark — outline + left-rail divider always drawn; the rail _fill_ present only when open. No new tokens/deps.
- **IconRail cleanup (in scope):** delete the placeholder "W" avatar; remove the `border-r` divider between rail and sidebar (the design system uses tonal depth, not borders).

### Non-goals

- Not per-session sidebar state.
- No change to the right Activity panel or the Dock.
- Not removing the dead `WorkspaceState.sidebarCollapsed` field or the vestigial backend `SetSessionActivityPanelCollapsedRequest` path (separate cleanup).
- No live "current action" subtitle yet — our `AgentStatus` has no such field; the card guards it out (renders nothing) until a feed exists.

## 2. State & persistence

Workspace-global, mirroring `features/editor/utils/readingStyleStore.ts` (a localStorage value + pub/sub backing `useSyncExternalStore`).

- **`src/features/workspace/utils/sidebarCollapsedStore.ts`** — key `vimeflow:workspace:sidebarCollapsed`; `getSidebarCollapsed()`, `setSidebarCollapsed(bool)` (no-op guard → write → notify), `subscribeSidebarCollapsed(fn)`. SSR/quota-safe (falls back to `false`, never throws). Seeded from localStorage at module load.
- **`src/features/workspace/hooks/useSidebarCollapsed.ts`** — `useSyncExternalStore(subscribe, get, get)` → `{ collapsed, toggle, setCollapsed }`. `toggle` flips the store; all consumers (status-card toggle, rail toggle, shortcut, palette command) stay in sync.

`WorkspaceView` is the single owner that calls the hook and **threads `sidebarCollapsed` + `onToggleSidebar` as props** to `IconRail` and `AgentStatusCard` (per the handoff — components stay presentational/testable; the spike's self-subscribing IconRail is replaced by props).

## 3. Components

### 3.1 `SidebarToggle` (`components/SidebarToggle.tsx`)

Presentational button rendering the panel-left SVG (viewBox 16, stroke 1.3; outline rect + `M5.9 2.9V13.1` divider always; `x2.2 y3.2 w3.1 h9.6` rail fill only when `!collapsed`). Props: `collapsed`, `onClick`, `size` (default 28), `variant: 'ghost' | 'inset'` (default `ghost`), `data-testid`. `aria-pressed={collapsed}`; `title`/`aria-label` swap on state. `inset` variant = recessed well (`bg rgba(13,13,28,0.45)`, `border rgba(74,68,79,0.35)`, hover border `rgba(203,166,247,0.4)`). **Both homes use `inset` at size 28** (the spike confirmed `ghost` in the rail read as a smaller/different control).

### 3.2 `AgentStatusCard` (`components/AgentStatusCard.tsx`) — fused card

Replaces `SidebarStatusHeader` as the sidebar's `header`. Borderless elevated surface (no 1px border, no gradient stripe): `radial-gradient` state wash in the top-left + `rgba(33,33,51,0.55)` fill, `boxShadow 0 5px 20px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.045)`, `overflow:hidden`, radius 13.

- **Props:** `title`, `state: 'running'|'awaiting'|'completed'|'errored'|'idle'`, `subtitle?`, `elapsed?`, `turns?`, `contextPct?`, `onToggleSidebar`.
- **State → presentation map** (label, label color, wash, dot) per the handoff §2/§A.3. `StatusDot` (animated pulse for running/awaiting; hollow for completed/idle; solid for errored).
- **Header row:** `inset` toggle (top-left, `align-items:flex-start`) + title (single-line ellipsis) + dot/label.
- **Action line:** `subtitle` clamped to 2 lines; rendered only when present.
- **Metrics row:** `schedule`/`forum`/`data_usage` cells, each **individually guarded** (idle collapses the row gracefully); `·` separators except after the last rendered cell.

**Data mapping (real signals, reused from the status bar — all null-guarded, so an idle session never dereferences a missing `cost`/`contextWindow`):** `title` ← active session name; `elapsed`/`turns` ← the status bar's `statusBarSession` (which is `null` when no agent is active; internally `startedAgo` comes from `formatStatusDuration(agentStatus.cost?.totalDurationMs ?? 0)` and `turns` from `agentStatus.numTurns`); `contextPct` ← `statusBarContextPct` (`agentStatus.contextWindow?.usedPercentage ?? null`, rounded). `state` ← `idle` when there is no active session; otherwise `completed`/`errored` taken straight from the pane lifecycle (**not** masked when the agent goes inactive after finishing), `running` only while the agent is active and the pane is running, else `idle`. `awaiting` is supported by the card but **not emitted** by the current data (no signal yet) — same status as `subtitle`.

### 3.3 `IconRail` changes (`components/IconRail.tsx`)

- Delete the "W" avatar `<div>` and its now-dead `initial`/`accountLabel` computation.
- Remove `border-r border-outline-variant/25` (tonal-depth seam, per design system).
- Accept `sidebarCollapsed` + `onToggleSidebar` props; when collapsed, render `<SidebarToggle collapsed variant="inset" size={28} />` at the top, offset so its top aligns with the in-card toggle's top (see §4 alignment).

## 4. Layout & drawer animation (`WorkspaceView`)

Grid columns become **`48px auto 1fr auto`** (was `48px var(--workspace-sidebar-width) 1fr auto`). The sidebar lives in a two-layer structure inside the `auto` track:

- **Shell** (animated): `overflow-hidden`, `style={{ width: collapsed ? 0 : 'var(--workspace-sidebar-width, INITIAL)' }}`, class `transition-[width] duration-[220ms] ease-pane` **disabled while `isDragging`** (so resize stays snappy; only collapse/expand animates). When collapsed it carries **both `aria-hidden` and `inert`** (required, not optional) so the clipped content is hidden from assistive tech AND removed from the tab order.
- **Inner panel** (fixed): `style={{ width: 'var(--workspace-sidebar-width, INITIAL)' }}`, `relative flex h-full`. Keeping the inner panel at full width means the shell **clips** it as it animates → the content **slides** instead of squishing. The `auto` track follows the shell's width, so width 0 = 0 track = no gutter (main reclaims).
- **Resize handle:** rendered only when `!collapsed`; still drives `--workspace-sidebar-width` via the existing `useResizable` (`commit-on-end` + `previewSidebarWidth`).

**Vertical alignment of the two toggles:** in-card toggle top = sidebar header `pt-3` (12px) + card padding-top (13px) = 25px from the column top; IconRail `py-2.5` = 10px, so the rail toggle gets a +15px top offset to match. (Spike used a literal `15px`; production extracts this as a named constant derived from the paddings rather than a magic number.)

## 5. Keyboard shortcut & command palette

- **`src/features/workspace/hooks/useSidebarShortcut.ts`** — a global capture-phase listener mirroring `useDockShortcuts`' guards. Platform split via the existing `preferModifier`: on **meta** platforms `⌘B` toggles (⌘ never reaches the PTY, so it works even with the terminal focused); on **ctrl** platforms **`Ctrl+⇧B`** toggles (bare `Ctrl+B` is left to the terminal — tmux/readline). The shortcut **fires from the terminal and the editor too** (toggle-from-anywhere); it bails only when (a) a dialog is open, (b) focus is in a plain text input/textarea/contenteditable that is **not** the terminal or CodeMirror, or (c) on macOS the dock is focused (so the dock keeps `⌘B` = close-dock). This is what lets acceptance criterion 1 hold from the normal focused surfaces.
- **`buildWorkspaceCommands.ts`** — add `:toggle-sidebar` (`{ id, label: ':toggle-sidebar', description: 'Show or hide the sidebar', icon, execute }`) wired to a new `toggleSidebar` dep.

## 6. Edge cases, failure modes, a11y

- localStorage unavailable / quota / private mode → default `false`, no throw (store guards).
- Reduced motion → dot pulse uses `motion-safe:`; the width transition is short (220ms) and non-essential; honor `prefers-reduced-motion` by gating the transition class.
- Collapsed sidebar content is `aria-hidden` **and `inert`** (see §4) — hidden from assistive tech and removed from the tab order while clipped to width 0.
- Idle session: title + `Idle` + dim hollow dot, empty metric row, no crash.
- Long title → single-line ellipsis; long subtitle → 2-line clamp; card height stays stable across sessions.
- ⌘B coexistence verified: dock-focused ⌘B still closes the dock; elsewhere it toggles the sidebar.

## 7. Testing strategy (TDD, co-located, ≥80%)

- `sidebarCollapsedStore.test.ts` — default false, persist/read, subscribe/notify, unsubscribe, storage-failure fallback.
- `useSidebarCollapsed.test.ts` — reads store, `toggle`/`setCollapsed`, re-render on external change.
- `SidebarToggle.test.tsx` — glyph fill present only when open; `aria-pressed`; label/title swap; ghost vs inset classes; `onClick`.
- `AgentStatusCard.test.tsx` — state→label/dot/wash; metric guards (idle hides all); subtitle clamp render/no-render; toggle click → `onToggleSidebar`.
- `useSidebarShortcut.test.ts` — meta vs ctrl platform; Shift requirement on ctrl platforms; bails in terminal/editor/dialog; toggles otherwise.
- `IconRail.test.tsx` — no avatar; no border; rail toggle only when collapsed; props wired.
- `buildWorkspaceCommands.test.ts` — `:toggle-sidebar` present, calls `toggleSidebar`.
- `WorkspaceView.test.tsx` — collapsed drops the track / main reclaims; resize handle hidden when collapsed; card fed from agent status; shortcut + palette toggle in sync.

## 8. Acceptance criteria

1. Toggle via in-card button, rail button, ⌘B/Ctrl+⇧B, or `:toggle-sidebar` all flip the same persisted flag and stay in sync; reload restores state.
2. Collapse slides the sidebar shut (no squish, no gutter); main reclaims width; resize drags remain instant.
3. Both toggles render identical (28px, `inset`) and on the same vertical line; collapsed shows exactly one (rail) toggle.
4. Fused card is borderless/elevated with a state wash, reflects the active session, and degrades gracefully when idle.
5. No "W" avatar; no rail↔sidebar border.
6. `npm run lint`, `type-check`, `test` green; coverage ≥80%.

<!-- codex-reviewed: 2026-06-04T16:38:03Z -->
