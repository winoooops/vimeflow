# Agent Status Panel — Collapsible Header & Rail

**Date:** 2026-05-20
**Authors:** Will (with Claude planner)
**Status:** Draft (per-section iteration)

---

## 1. Overview & User Flows

### Goal

Add a header to the right-side activity panel and make the whole panel
collapsible to a 36 px rail. Persist the collapsed state per session in the
existing `sessions.json` cache so each session remembers its preference across
reloads.

### Why now

`docs/design/UNIFIED.md` §2 already declares the activity panel "auto /
collapsible" and §5.2 specifies a session header should sit above the
meters/feed — but the current `AgentStatusPanel` has neither.
`docs/design/agent_activity_panel/CHANGES.md` is the agreed handoff design.
This spec wires the two together.

### Scope (what we will build)

- A new `<Header/>` sub-component inside `AgentStatusPanel/` showing: agent
  glyph chip on accent-dim wash · agent short label (`CLAUDE`/`CODEX`,
  with `SHELL` as the fallback short for unmapped agents) · `StatusDot` ·
  chevron-right collapse button. **No vendor mark in the header** — the
  glyph + accent wash carry the agent identity at expanded width; vendor
  marks are rail-only chrome (the rail has less space for an explicit short
  label, so the mark earns its real estate there).
- A new `<AgentStatusRail/>` sibling component (36 px wide) shown when
  collapsed: chevron-left expand button · vendor mark (Anthropic / OpenAI)
  · agent glyph chip · vertical context-meter bar · rotated `% ctx` mono
  label · pulsing accent dot when running. Gemini's Google mark is deferred
  until the backend detector emits a `gemini` `agentType`.
- Persistence: extend `CachedSession` in
  `crates/backend/src/terminal/cache.rs` with
  `activity_panel_collapsed: Option<bool>` and a new IPC mutator. Frontend
  reads the value off the existing `SessionInfo` payload and writes it via
  the mutator. **Ownership model:** the cache is keyed by **PTY id** (= the
  string the backend assigns to each `spawn_pty` request and the same
  identifier the frontend stores as `Pane.ptyId`). The collapse preference
  is therefore keyed **per pane's PTY**, not per React `Session.id`. For
  the typical one-pane session this looks identical to "per session" from
  the user's perspective. For multi-pane sessions, each pane carries its
  own collapse preference; the panel always reflects the focused pane's
  PTY's value. This choice matches the existing data model: React
  `Session.id` is not stable across reloads (a freshly created
  randomUUID-based id is replaced by the PTY id on restore via
  `sessionFromInfo`), but PTY ids are.
- A small `agentTypeToRegistryKey()` helper that maps the values
  `AgentStatus.agentType` can actually take (`claude-code | codex | aider |
generic | null`) onto the `AGENTS` registry keys we currently support:
  - `claude-code` → `claude`
  - `codex` → `codex`
  - `aider | generic | null` → `shell` (no vendor mark; generic placeholder
    glyph). Gemini and a proper `aider` mapping land when the backend
    detector adds them — see §5 (Edge cases) for the explicit forward path.
- Vendor SVG assets for Anthropic and OpenAI — bundled under
  `src/assets/vendor-icons/`. Google/Gemini is deferred to a follow-up since
  there is no `gemini` value in the current `agentType` union.
- **Read path note:** the IPC contract for surfacing
  `activity_panel_collapsed` to the frontend is defined in §3 (Data model &
  wiring). §1 only states the user-visible behavior; §3 specifies the wire
  shape and read/write IPC.

### Out of scope

- Redesigning the body sections (ContextBucket, TokenCache, ActivityFeed,
  FilesChanged, TestResults, ActivityFooter). They render unchanged inside the
  expanded panel.
- Adopting the prototype's expanded-body design (its custom Meters block,
  CacheBlock with sparkline, history bars, etc.). Tracked as a follow-up.
- A general "tweaks" preferences store. We add exactly one persisted bool now
  and refactor when a second UI pref appears (YAGNI).
- Animation polish beyond a single width transition. No `framer-motion` /
  `@starting-style` work.

### User flows

1. **Toggle to collapse.** User clicks the chevron in the expanded header →
   the panel snaps from 280 px to 36 px (with a 220 ms width transition); the
   rail renders with the same agent's vendor+glyph and a live `% ctx`.
   Backend persists `activity_panel_collapsed = true` on the active session in
   `sessions.json`.
2. **Toggle to expand.** User clicks the chevron in the rail → the panel
   transitions back to 280 px; the header renders. Backend persists
   `activity_panel_collapsed = false`.
3. **Session switch.** User clicks a different session in the sidebar →
   `WorkspaceView` reads that session's `activity_panel_collapsed` from cache
   and renders accordingly. Each session keeps its own preference.
4. **Reload.** App restarts → `sessions.json` loads the cached field → the
   panel honors each session's prior state from first paint.
5. **First-time vs no-agent — kept independent.** Two orthogonal axes:
   - _Collapse state_ (from cache): if `activity_panel_collapsed` is `None`
     on a session, default to expanded. Otherwise honor the cached value —
     including for sessions where no agent is detected. A user who collapsed
     the panel for a shell-only session must see it stay collapsed.
   - _Header content_ (from `agentStatus.agentType`): when `agentType` is
     `null` or `aider`/`generic`, map to the `shell` registry entry
     (`$` glyph, gold accent). When mapped to a real agent (`claude` or
     `codex`), render that agent's glyph + accent wash; the vendor mark is
     rendered on the rail only, not in the expanded header. The header
     `StatusDot` uses the existing `SessionStatus` enum (`running | paused |
completed | errored`) — derived from `agentStatus.isActive` as a v1
     stand-in (`isActive ? 'running' : 'paused'`); a richer agent-state
     feed is tracked separately, see §5.

### Success criteria

- Toggle round-trips through `sessions.json` (a unit test on the Rust side +
  an integration test on the frontend prove this).
- Switching sessions shows the right collapse state without a flicker.
- The collapsed rail visibly identifies which vendor/agent is attached
  (Claude vs Codex; shell fallback for `aider`/`generic`/none) at a glance.
  Gemini support is deferred until the backend detector emits it.
- No regression in existing **body sub-component** tests (`ContextBucket`,
  `TokenCache`, `ToolCallSummary`, `ActivityFeed`, `FilesChanged`,
  `TestResults`, `ActivityFooter`) — those continue to pass unchanged
  because their props and rendering are not touched. The
  `AgentStatusPanel` (now `AgentStatusPanel/index.tsx`) test file gains
  fixture updates for the three new required props (`agent`, `status`,
  `onCollapse`) and a small new `Header.test.tsx`, but its assertions about
  body region rendering stay identical.
- Type checking + ESLint + Vitest all pass.

---

## 2. Component Contracts & File Layout

### File layout

```
src/features/agent-status/components/
├── AgentStatusPanel/                # was AgentStatusPanel.tsx — promote to folder
│   ├── index.tsx                    # composes Header + existing body
│   ├── Header.tsx                   # NEW — expanded-state header
│   ├── Header.test.tsx
│   └── index.test.tsx               # was AgentStatusPanel.test.tsx
├── AgentStatusRail.tsx              # NEW — collapsed-state rail (sibling)
├── AgentStatusRail.test.tsx
├── ContextBucket.tsx                # unchanged
├── TokenCache.tsx                   # unchanged
├── ToolCallSummary.tsx              # unchanged
├── ActivityFeed.tsx                 # unchanged
├── FilesChanged.tsx                 # unchanged
├── TestResults.tsx                  # unchanged
├── ActivityFooter.tsx               # unchanged
└── … (other existing siblings unchanged)
```

`AgentStatusPanel.tsx` and `AgentStatusPanel.test.tsx` are **moved** (not
copied) — git tracks the rename. **External importers** (anything outside
the `AgentStatusPanel/` folder) continue to resolve `./AgentStatusPanel`
because Vite/TS resolve folder `index.tsx`. **The moved test's own internal
relative import** must be rewritten — `import { AgentStatusPanel } from
'./AgentStatusPanel'` (worked from the old flat location) becomes
`import { AgentStatusPanel } from '.'` (resolves to `index.tsx`) once the
file lives at `AgentStatusPanel/index.test.tsx`. Same change applies to any
other internal-to-folder imports that the test currently uses (e.g.
`./types`, `./hooks/useActivityEvents` — those stay parent-folder relative
and need to gain an extra `../` segment).

No `Body.tsx` is introduced; the body composition is already 7 pure
presentational children stitched directly in `index.tsx` — wrapping them in
a passthrough `Body` would add a layer with no behavior to encapsulate.

### Props

```ts
// src/features/agent-status/components/AgentStatusPanel/Header.tsx
interface AgentStatusPanelHeaderProps {
  agent: Agent // resolved AGENTS[agentTypeToRegistryKey(...)]
  status: SessionStatus // 'running' | 'paused' | 'completed' | 'errored'
  onCollapse: () => void
}
// Pure presentational. No data fetching, no state.

// src/features/agent-status/components/AgentStatusRail.tsx
interface AgentStatusRailProps {
  agent: Agent
  contextUsedPercentage: number | null // 0-100, null when unknown
  isRunning: boolean
  onExpand: () => void
}
// Pure presentational. 36 px fixed width.

// src/features/agent-status/components/AgentStatusPanel/index.tsx
interface AgentStatusPanelProps {
  // Existing — unchanged:
  agentStatus: AgentStatus
  cwd: string
  onOpenDiff: (file: ChangedFile) => void
  onOpenFile?: (path: string) => void
  gitStatus?: UseGitStatusReturn
  // NEW — added:
  agent: Agent // resolved by WorkspaceView, passed down to Header
  status: SessionStatus // resolved by WorkspaceView, passed down to Header
  onCollapse: () => void // fired by Header chevron
}
// Body composition is unchanged. The new <Header agent status onCollapse/>
// sits above the existing two-region body (`gap-2 p-2` block + `thin-scrollbar`
// block + ActivityFooter).
```

### Header JSX skeleton

```tsx
// AgentStatusPanel/Header.tsx (~35 lines including the interface)
export const AgentStatusPanelHeader = ({
  agent,
  status,
  onCollapse,
}: AgentStatusPanelHeaderProps): ReactElement => (
  <div
    data-testid="agent-status-panel-header"
    className="flex items-center gap-2.5 px-3 py-2.5"
    style={{
      background: `linear-gradient(180deg, ${agent.accentDim}, transparent 80%)`,
    }}
  >
    <div
      data-testid="agent-glyph-chip"
      className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md font-mono text-[13px] font-bold"
      style={{ background: agent.accentDim, color: agent.accent }}
    >
      {agent.glyph}
    </div>
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="font-headline text-[13px] font-semibold text-on-surface">
        {agent.short}
      </span>
      <StatusDot status={status} size={6} aria-label={`agent ${status}`} />
    </div>
    <button
      type="button"
      onClick={onCollapse}
      aria-label="Collapse activity panel"
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
    >
      <span className="material-symbols-outlined text-base">chevron_right</span>
    </button>
  </div>
)
```

`agent.accentDim` and `agent.accent` are dynamic per-agent values from the
`AGENTS` registry, so the gradient + chip background/foreground must be
inline styles. Everything else is Tailwind tokens already defined in
`tailwind.config.js` (`--surface-container-high`, `--on-surface`, `--outline`).
`chevron_right` is a Material Symbols glyph — the project already loads the
Material Symbols Outlined variable font (see `src/index.css`).

### Helper module additions

```ts
// src/agents/registry.ts — add to existing file
import type { AgentStatus } from '../features/agent-status/types'
import type { SessionStatus } from '../features/sessions/types'

export const agentTypeToRegistryKey = (
  agentType: AgentStatus['agentType'] // 'claude-code' | 'codex' | 'aider' | 'generic' | null
): AgentId => {
  switch (agentType) {
    case 'claude-code':
      return 'claude'
    case 'codex':
      return 'codex'
    // aider | generic | null → shell fallback (no vendor mark)
    default:
      return 'shell'
  }
}

export const agentStatusToSessionStatus = (
  agentStatus: AgentStatus
): SessionStatus => (agentStatus.isActive ? 'running' : 'paused')
// v1 derivation; replaced when a real agent-state feed lands — tracked in §5.
```

Both helpers are pure functions and ship with unit tests in
`src/agents/registry.test.ts` (already exists for `AGENTS`; extended).

### Vendor icon contract

```
src/assets/vendor-icons/
├── anthropic.svg     # Anthropic mark, monochrome currentColor, 14×14 viewport
└── openai.svg        # OpenAI mark, monochrome currentColor, 14×14 viewport
```

A small `vendorMarkFor(agentId): string | null` helper (also in
`src/agents/registry.ts`) maps:

- `claude` → imported `anthropic.svg` URL
- `codex` → imported `openai.svg` URL
- `gemini` → `null` (deferred until Google brand asset + `agentType`
  detection both land; the registry key exists but no mark today)
- `shell` → `null` (no vendor)

The rail renders the mark as a tinted **`<span>` mask**, not an `<img>` —
external SVGs loaded through `<img src>` do not inherit `currentColor` from
their surrounding element, so the tint must come from a CSS mask:

```tsx
<span
  aria-hidden
  className="block h-3.5 w-3.5 bg-current text-outline-variant"
  style={{
    maskImage: `url(${mark})`,
    maskRepeat: 'no-repeat',
    maskSize: 'contain',
    maskPosition: 'center',
    WebkitMaskImage: `url(${mark})`,
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
    WebkitMaskPosition: 'center',
  }}
/>
```

The span itself paints `currentColor` (= `text-outline-variant`) and the
SVG mask clips it to the vendor shape, so the mark inherits the surrounding
text color cleanly. SVG files must be monochrome with a single filled path
so the alpha mask reads correctly.

### Why two new props on `AgentStatusPanel` instead of computing internally

`WorkspaceView` already resolves the same `agent` and `status` values for
`AgentStatusRail` (the collapsed case). Computing once in the parent and
passing down to both children avoids duplicate logic and keeps both leaves
pure presentational — easier to snapshot-test and to swap registry contents
later. The trade-off is that `AgentStatusPanel` grows three required props
(`agent`, `status`, `onCollapse`); accepted because the body sub-components
already require parent-derived inputs (`gitStatus`, `cwd`, callbacks), so
this fits the existing pattern.

---

## 3. Data Model & Wiring

This section defines the end-to-end path of the collapse boolean: where it
lives in the Rust cache, how it crosses the IPC boundary in both directions,
how the frontend reads/writes it, and how `WorkspaceView` ties it together.

### 3.1 Rust — `CachedSession` extension

```rust
// crates/backend/src/terminal/cache.rs
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CachedSession {
    pub cwd: String,
    pub created_at: String,
    pub exited: bool,
    pub last_exit_code: Option<i32>,

    // NEW: per-session UI preference for the right activity panel.
    // None  → user has never toggled; UI treats it as expanded.
    // Some(true)  → collapsed (36 px rail).
    // Some(false) → explicitly expanded (280 px panel).
    #[serde(default)]
    pub activity_panel_collapsed: Option<bool>,
}
```

`#[serde(default)]` keeps the field optional in the JSON file — existing
`sessions.json` files written before this change deserialize cleanly with
the field set to `None`. No schema-version bump is required for this
strictly additive change; the existing `SCHEMA_VERSION = 1` constant stays
at 1.

### 3.2 Rust — IPC command

Add one new method to the IPC surface, alongside the existing
`set_active_session`, `reorder_sessions`, `update_session_cwd`. **The `id`
in the request is a PTY id**, not a React `Session.id` — same convention as
`SetActiveSessionRequest`.

```rust
// crates/backend/src/terminal/types.rs
#[derive(Debug, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct SetSessionActivityPanelCollapsedRequest {
    /// PTY id (same value passed in `SetActiveSessionRequest::id`).
    pub id: String,
    pub collapsed: bool,
}
```

```rust
// crates/backend/src/terminal/commands.rs (inner)
pub fn set_session_activity_panel_collapsed_inner(
    cache: &SessionCache,
    request: SetSessionActivityPanelCollapsedRequest,
) -> Result<(), String> {
    cache.mutate(|d| {
        let session = d
            .sessions
            .get_mut(&request.id)
            .ok_or_else(|| format!("session not found: {}", request.id))?;
        session.activity_panel_collapsed = Some(request.collapsed);
        Ok(())
    })
}
```

```rust
// crates/backend/src/runtime/state.rs (BackendState impl)
pub fn set_session_activity_panel_collapsed(
    &self,
    request: SetSessionActivityPanelCollapsedRequest,
) -> Result<(), String> {
    // `self.sessions` is the Arc<SessionCache> field on BackendState — same
    // field the existing set_active_session / reorder_sessions / update_session_cwd
    // wrappers delegate to.
    crate::terminal::commands::set_session_activity_panel_collapsed_inner(
        &self.sessions,
        request,
    )
}
```

```rust
// crates/backend/src/runtime/ipc.rs (router branch)
"set_session_activity_panel_collapsed" => {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct P {
        request: crate::terminal::types::SetSessionActivityPanelCollapsedRequest,
    }
    let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
    state.set_session_activity_panel_collapsed(p.request)?;
    Ok(Value::Null)
}
```

Frontend invokes it as
`invoke('set_session_activity_panel_collapsed', { request: { id: ptyId, collapsed: true } })`
— matching the existing `{ request: ... }` envelope used by every other
session mutator.

### 3.3 Rust — `SessionInfo` extension (read path)

`list_sessions` already returns `SessionList { active_session_id, sessions:
Vec<SessionInfo> }`. Extend `SessionInfo` with the new field so the frontend
reads it inline with the existing session snapshot — no separate
`get_session_activity_panel_collapsed` IPC needed.

```rust
// crates/backend/src/terminal/types.rs
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,                            // PTY id
    pub cwd: String,
    pub status: SessionStatus,
    // NEW: mirrored from CachedSession.activity_panel_collapsed.
    // Serialized as `activityPanelCollapsed: boolean | null` over IPC.
    // Do NOT use `#[ts(optional)]` — that would generate an optional TS
    // property, but serde always emits the field with `null` when None.
    // The runtime wire shape is `boolean | null`, not "absent".
    pub activity_panel_collapsed: Option<bool>,
}
```

The translation in `commands::list_sessions_inner` copies the cached field
through; sessions present only in PTY state but not in cache (a degraded
path) get `None`.

### 3.4 Frontend — bindings

ts-rs runs under `cargo test`. After the Rust changes land, regenerating
TS bindings updates:

- `src/bindings/SessionInfo.ts` — gains
  `activityPanelCollapsed: boolean | null`.
- `src/bindings/SetSessionActivityPanelCollapsedRequest.ts` — new file.
- `src/bindings/index.ts` — new export line.

ts-rs renders Rust `Option<T>` as `T | null` in the generated `.ts` file (the
project already relies on this for `SessionList::activeSessionId` and other
Option fields). The runtime wire format matches — serde emits an explicit
`null` rather than omitting the key. Treat the field as `boolean | null` in
all TypeScript code paths. Do **not** add `#[ts(optional)]` upstream; that
would generate `activityPanelCollapsed?: boolean | undefined` and
mis-represent the wire shape (which always carries an explicit `null`).

### 3.5 Frontend — extend `useSessionManager`

There is no standalone hook. The collapse preference is part of session
state and belongs in the same owner that already manages `Session[]`,
`activeSessionId`, `updatePaneCwd`, `setSessionLayout`, etc. — namely
`useSessionManager`.

**Type changes** (`src/features/sessions/types/index.ts`):

```ts
export interface Pane {
  id: string
  ptyId: string
  cwd: string
  agentType: 'claude-code' | 'codex' | 'aider' | 'generic'
  status: SessionStatus
  restoreData?: RestoreData
  pid?: number
  active: boolean
  // NEW: per-pane collapse preference for the activity panel.
  // null when the cache has never recorded a value (treated as expanded).
  activityPanelCollapsed: boolean | null
}
```

**Initialization contract.** `Pane.activityPanelCollapsed` is required
(typed `boolean | null`, no `?`), so every site that constructs a `Pane`
must initialize it explicitly. The construction sites:

| Site                           | File                               | Initial value                                                            |
| ------------------------------ | ---------------------------------- | ------------------------------------------------------------------------ |
| Session restore (first pane)   | `sessionFromInfo.ts`               | `info.activityPanelCollapsed ?? null`                                    |
| New session creation           | `useSessionManager.createSession`  | `null`                                                                   |
| Pane addition within a session | `useSessionManager.addPane`        | `null`                                                                   |
| Pane restart after PTY exit    | `useSessionManager.restartSession` | `null` (preference does NOT survive restart — new PTY id, new cache row) |

A `null` value is the "no preference yet" sentinel; the UI renders the
panel as expanded in that state. Existing test fixtures that build `Pane`
objects must add the field — the spec scope acknowledges this; see §6.

**Mutator** (added to `useSessionManager`):

```ts
// Mirrors the existing setSessionActivePane / updatePaneCwd shape.
setPaneActivityPanelCollapsed: (
  sessionId: string,
  paneId: string,
  collapsed: boolean
) => Promise<void>
```

The mutator:

1. Optimistically updates the matching `Pane.activityPanelCollapsed` via
   `setSessions(prev => ...)` — same pattern as `updatePaneCwd`.
2. Invokes
   `invoke('set_session_activity_panel_collapsed', { request: { id: ptyId, collapsed } })`
   (resolving `ptyId` from the targeted pane).
3. On IPC failure: reverts the optimistic update **only if no superseding
   call has run in the meantime**, then rejects the returned Promise with
   the IPC error message. The race-safe revert rule:
   - At call time, capture the target value `next`.
   - On IPC failure, run a `setSessions(prev => ...)` that finds the
     matching pane and **revert only if `pane.activityPanelCollapsed ===
next`** (i.e., this call's optimistic write is still the current
     state). If a later call has set a different value, leave it alone —
     the newer state is the user's latest intent.
   - This makes rapid toggle correct under any IPC ordering: see §5.2.

   The mutator does NOT call `notifyInfo` directly — `useSessionManager`
   does not own that channel. The caller (`WorkspaceView`) wraps the
   invocation in `try/catch` and surfaces the error via its own
   `notifyInfo` injection point (the same `notifyInfo` already used for
   command-palette feedback — see `WorkspaceView.notifyInfo.test.tsx`).

```ts
// WorkspaceView (excerpt — error plumbing for the wrapped handleCollapse)
const handleCollapse = useCallback(
  async (next: boolean): Promise<void> => {
    if (!activeSessionId || !focusedPane) return
    try {
      await setPaneActivityPanelCollapsed(activeSessionId, focusedPane.id, next)
    } catch (err) {
      notifyInfo(`Couldn't update activity panel: ${(err as Error).message}`)
    }
  },
  [activeSessionId, focusedPane?.id, setPaneActivityPanelCollapsed, notifyInfo]
)
```

**Why a `Pane` field, not a `Session` field**: the cache is keyed by PTY id
(= `Pane.ptyId`). Putting the preference on `Pane` keeps frontend types in
lock-step with backend persistence: one cached entry, one pane, one
preference. Sessions that hold multiple panes naturally support
per-pane preferences without an additional indirection layer.

### 3.6 Frontend — `WorkspaceView` wiring

`WorkspaceView` already resolves the focused pane and its PTY id via the
existing focus-resolution chain. Add three derivations:

```ts
// inside WorkspaceView — these all reuse data already in scope
const focusedPane = findActivePaneIn(activeSession)
const collapsed = focusedPane?.activityPanelCollapsed ?? false

const agent = useMemo(
  () => AGENTS[agentTypeToRegistryKey(agentStatus.agentType)],
  [agentStatus.agentType]
)
// agentStatusToSessionStatus reads `agentStatus.isActive` only. Listing the
// whole `agentStatus` object in the dep array (rather than just `.isActive`)
// satisfies react-hooks/exhaustive-deps without overrunning the helper's
// real inputs. The helper recomputes only when the object identity changes,
// which happens on every status event — cheap.
const status = useMemo(
  () => agentStatusToSessionStatus(agentStatus),
  [agentStatus]
)

const handleCollapse = useCallback(
  async (next: boolean): Promise<void> => {
    if (!activeSessionId || !focusedPane) return
    try {
      await setPaneActivityPanelCollapsed(activeSessionId, focusedPane.id, next)
    } catch (err) {
      // useSessionManager's mutator rejects on IPC failure; WorkspaceView owns
      // notifyInfo (see §3.5). Optimistic-update revert happens inside the
      // mutator before the rejection — see §5.2 for the rapid-toggle guard.
      notifyInfo(`Couldn't update activity panel: ${(err as Error).message}`)
    }
  },
  [activeSessionId, focusedPane?.id, setPaneActivityPanelCollapsed, notifyInfo]
)

// Render — replaces the current unconditional <AgentStatusPanel/> call.
// A *stable wrapper div* owns the width + transition; the branch swap
// happens inside it. Without this wrapper, React would unmount one branch
// and mount the other at its target width, so the 220 ms width animation
// would never play (the new root just appears at its final size).
<div
  data-testid="activity-panel-shell"
  className="h-full shrink-0 overflow-hidden transition-[width] duration-[220ms] ease-pane"
  style={{ width: collapsed ? 36 : 280 }}
>
  {collapsed ? (
    <AgentStatusRail
      agent={agent}
      contextUsedPercentage={agentStatus.contextWindow?.usedPercentage ?? null}
      isRunning={agentStatus.isActive}
      onExpand={() => handleCollapse(false)}
    />
  ) : (
    <AgentStatusPanel
      agentStatus={agentStatus}
      cwd={activeCwd}
      gitStatus={gitStatus}
      onOpenDiff={handleOpenDiff}
      onOpenFile={handleOpenTestFile}
      agent={agent}
      status={status}
      onCollapse={() => handleCollapse(true)}
    />
  )}
</div>
```

The outer grid template (`gridTemplateColumns: '48px var(...) 1fr auto'`)
already uses `auto` for the activity panel column, so the wrapper's
36 px ↔ 280 px width swap propagates without any grid changes. `overflow-hidden`
on the wrapper produces a wipe-reveal effect during the transition: the
newly mounted branch is rendered at its natural width (36 px for the rail,
280 px for the panel) from frame 0, and the wrapper clips it to the
in-transit visible width until the animation completes.

**Pane width contract for child components.** With a stable wrapper owning
width, `AgentStatusRail` and `AgentStatusPanel/index.tsx` each render at
their **natural** width — `36 px` and `280 px` respectively, as inline
`width` styles on their root elements. They do NOT fill the wrapper
(`w-full`); they own their target width directly. The wrapper just clips
during the transition.

### 3.7 Why `SessionInfo` is the read path (not a new IPC)

Three alternatives were considered:

1. **Extend `SessionInfo`** (chosen). The sessions cache already
   round-trips through `list_sessions`; frontend gets the field for free on
   every refresh and via the existing subscription.
2. **New `get_session_ui_state` IPC.** Pure overhead — the frontend would
   call it on every session switch in addition to the existing
   `list_sessions`. Two reads for one piece of data.
3. **Emit a separate event when collapse changes.** Inverts the contract
   (everything else is pull, not push) and risks the rail flashing the
   wrong state until the first event arrives.

(1) keeps the read path symmetric with how `cwd`, `status`, and `id` are
already surfaced. The mutator
(`set_session_activity_panel_collapsed`) itself never emits an event — the
frontend's optimistic update via `useSessionManager` makes `list_sessions`
re-reads unnecessary in the steady state, and the next mount-time
`useSessionRestore` call picks up the canonical value on reload.

---

## 4. Visual Details

This section pins the visual contract — dimensions, tokens, motion — so the
implementation diff has no design ambiguity to negotiate.

### 4.1 Expanded header (full 280 px panel)

```
┌─────────────────────────────────────────┐  ← top of panel
│ ▓▓▓ accent-dim → transparent (180°) ▓▓ │  gradient wash, 80% fade-out
│  ┌──┐                                   │
│  │∴ │  CLAUDE  ●                    ▶  │
│  └──┘                                   │
└─────────────────────────────────────────┘
  px-3 py-2.5 · gap-2.5 between flex items
```

**Dimensions & tokens.**

| Element         | Spec                                                                 |
| --------------- | -------------------------------------------------------------------- |
| Header padding  | `px-3 py-2.5` (12 px horizontal, 10 px vertical)                     |
| Flex gap        | `gap-2.5` (10 px) between glyph chip / label cluster / chevron       |
| Glyph chip      | `26 × 26 px`, `rounded-md`, font: `font-mono text-[13px] font-bold`  |
| Glyph chip bg   | `agent.accentDim` (inline style — dynamic per agent)                 |
| Glyph chip fg   | `agent.accent` (inline style)                                        |
| Header gradient | `linear-gradient(180deg, agent.accentDim, transparent 80%)` (inline) |
| Short label     | `font-headline text-[13px] font-semibold text-on-surface`            |
| StatusDot size  | `6` (matches existing terminal-pane header convention)               |
| Chevron button  | `24 × 24 px`, `rounded-md`, `text-outline`                           |
| Chevron hover   | `hover:bg-surface-container-high hover:text-on-surface`              |
| Chevron glyph   | Material Symbols `chevron_right`, `text-base` (16 px)                |

**Header has no bottom border.** The gradient wash naturally fades into the
body's `bg-surface-container` at its 80% stop. A 1 px divider would break
the "no visible borders — tonal depth only" rule from `DESIGN.md`.

### 4.2 Collapsed rail (36 px column)

```
┌──┐  ← top
│▶ │   chevron-left (expand)
│  │
│██│   vendor mark (Anthropic / OpenAI / none)
│  │
│∴ │   agent glyph chip (24×24)
│  │
│┃ │
│┃ │   vertical context-meter bar (4×64px)
│┃ │   fill = tokens.used / tokens.max %
│┃ │
│  │
│74│   rotated "% ctx" mono label
│% │
│  │
│  │   spacer (flex-1)
│  │
│● │   pulsing accent dot (only when isRunning)
└──┘  ← bottom
  py-2.5 · gap-2.5 vertical · items-center
```

**Dimensions & tokens.**

| Element           | Spec                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rail width        | `36 px` (fixed, not flex)                                                                                                                                                                                                                                                                                                                                      |
| Outer container   | `flex h-full flex-col items-center py-2.5 gap-2.5 bg-surface-container`                                                                                                                                                                                                                                                                                        |
| Chevron button    | `26 × 26 px`, `rounded-md`, `text-outline` hover→`text-on-surface`                                                                                                                                                                                                                                                                                             |
| Vendor mark       | `14 × 14 px` masked span (see §4.3); `text-outline-variant`                                                                                                                                                                                                                                                                                                    |
| Glyph chip        | `24 × 24 px`, `rounded-md` (smaller than header's 26 px), same colors as the header chip                                                                                                                                                                                                                                                                       |
| Context bar track | `w-1 h-16` (4 × 64 px), `rounded-full`, `bg-outline/30`                                                                                                                                                                                                                                                                                                        |
| Context bar fill  | absolute, `bottom-0 left-0 right-0`, height = `${contextUsedPercentage ?? 0}%`, **inline** `style={{ background: warning ? 'var(--color-error)' : agent.accent }}` (agent accents are runtime hex values — same inline-style rule from §2 for the glyph chip applies here)                                                                                     |
| Warning threshold | `warning = (contextUsedPercentage ?? 0) > 85` — single-prop computation matching the `AgentStatusRailProps` contract in §2. The `var(--color-error)` reference resolves to the project's coral token via the Tailwind-generated CSS variable; the runtime read keeps the warning color token-aware without losing inline-style flexibility for the accent path |
| `% ctx` label     | rotated `writing-mode: vertical-rl; transform: rotate(180deg)`, `font-mono text-[9px] text-on-surface-muted tracking-[0.08em]`                                                                                                                                                                                                                                 |
| Spacer            | `flex-1` between label and the running dot                                                                                                                                                                                                                                                                                                                     |
| Running dot       | `6 × 6 px`, `rounded-full`, `bg-{agent.accent}`, `box-shadow: 0 0 8px agent.accent`, `animate-pulse` (Tailwind built-in)                                                                                                                                                                                                                                       |

The rail does NOT render a context bar when `contextUsedPercentage === null`
— it shows the track only. The `% ctx` label renders `--` in that case.

### 4.3 Vendor icon rendering

```tsx
<span
  aria-hidden
  className="block h-3.5 w-3.5 bg-current text-outline-variant"
  style={{
    maskImage: `url(${mark})`,
    maskRepeat: 'no-repeat',
    maskSize: 'contain',
    maskPosition: 'center',
    WebkitMaskImage: `url(${mark})`,
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
    WebkitMaskPosition: 'center',
  }}
/>
```

- `mark` is an imported SVG URL (Vite static asset import).
- The span paints `currentColor` (= `text-outline-variant`) and the SVG mask
  clips it to the vendor shape, so the mark inherits the surrounding text
  color cleanly.
- SVG files MUST be monochrome with a single filled path (or be unioned at
  export time) — multi-color SVGs lose their interior detail when used as a
  mask. The two assets we ship (`anthropic.svg`, `openai.svg`) are sourced
  as monochrome from the official brand pages, then exported with no fill
  color (so the mask uses pure alpha).
- WebKit prefixes are required — Safari/older Chromium versions still need
  `-webkit-mask-*`. Both forms are set inline together to avoid a CSS file
  for two properties.

### 4.4 Motion

| Transition           | Property                   | Duration    | Easing                                            | Owner                                                                            |
| -------------------- | -------------------------- | ----------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Panel collapse       | `width`                    | `220 ms`    | `ease-pane` (already in tailwind config)          | **stable wrapper** `<div data-testid="activity-panel-shell">` in `WorkspaceView` |
| Header chevron hover | `background, color`        | `150 ms`    | `ease-out` (default Tailwind `transition-colors`) | chevron button                                                                   |
| Status dot pulse     | (Tailwind `animate-pulse`) | `2 s` cycle | (built-in)                                        | `<StatusDot status='running' />` and the rail running dot                        |

**The width transition lives on a stable wrapper div** owned by
`WorkspaceView` (see §3.6), not on the rendered branch itself. The wrapper
stays mounted across collapse-state changes; only its `width` style
animates. The inner `<AgentStatusRail/>` or `<AgentStatusPanel/>` mounts at
its natural width (36 px / 280 px) and is clipped by the wrapper's
`overflow-hidden` while the wrapper's width catches up. This avoids the
typical React pitfall where animating `width` across a `ternary` mount/
unmount yields no transition because the new component mounts at its
target width from frame 0.

**Reuses `ease-pane`** instead of the prototype's `cubic-bezier(.2, .8, .2, 1)`.
The two curves are visually close; reusing the existing token keeps the panel
collapse aligned with the existing pane-resize easing across the workspace.

**No opacity fade during the transition** — the wrapper's `overflow-hidden`
clipping (the wipe-reveal mechanism from §3.6) is the only visual change
besides width. There is no `opacity` transition on the inner branches; each
mounts fully opaque at its target width and is **intentionally clipped** by
the wrapper while the wrapper's width animates to match. This is the
deliberate departure from the prototype's `opacity 120ms` fade — the wipe
is the entire motion, and content visibility is binary at any given frame
(fully visible inside the wrapper's clip rect, hidden outside it).

---

## 5. Edge Cases & Failure Modes

Each case below names the trigger, the expected behavior, and what proves
it works.

### 5.1 Agent type changes mid-session

**Trigger.** User runs `claude` in a previously `null`/`shell` pane —
`agentStatus.agentType` flips from `null` → `'claude-code'` while the pane
keeps its PTY id.

**Behavior.** The collapse preference is unchanged (still keyed on PTY id).
The header/rail re-renders with the new agent's glyph + accent (and the
rail's vendor mark appears). No flicker — the wrapper width does not
change.

**Proof.** A frontend integration test toggles `agentStatus.agentType`
between `null` and `'claude-code'` on a stable PTY id and asserts the
collapse boolean is preserved across the transition while the rendered
agent identity updates.

### 5.2 Rapid toggle (race)

**Trigger.** User clicks the chevron several times in quick succession; or
clicks resolve before the IPC roundtrip for the previous click finishes.

**Behavior.** The Rust side serializes through `cache.mutate()` (one
in-flight mutator at a time, lock held through the disk flush — see the
existing "mutate_holds_lock_through_flush" test). On the frontend, each
click triggers an optimistic update + IPC. Two correctness properties:

- _Persisted state_ matches the **last submitted IPC**, regardless of
  arrival order at the OS level. This is guaranteed by the Rust mutex.
- _Optimistic local state_ matches the **last click**, regardless of how
  IPC failures resolve. This is guaranteed by the §3.5 race-safe revert:
  on IPC failure, the mutator reverts **only if the optimistic value it
  wrote is still the current state**. A later click that wrote a different
  value bypasses the revert (the newer write is preserved).

The combined invariant: **the user sees the panel match their last click,
and on reload the panel matches the last successful persist**. The two
match when all IPCs succeed; they diverge only when an IPC fails and the
user did not re-click — in which case the next-launch state reflects the
prior successful value, surfaced via `notifyInfo` so the user knows the
last toggle didn't stick.

**Proof.**

- A test fires two rapid `setPaneActivityPanelCollapsed` calls
  (`true`, then `false`) and asserts `Pane.activityPanelCollapsed === false`
  after both resolve, regardless of which IPC resolves first.
- A second test arranges for the first IPC to reject **after** the second
  succeeds, and asserts the revert does NOT run (because the optimistic
  value the first call wrote has already been superseded).

### 5.3 Disk write failure (cache flush degraded)

**Trigger.** `flush_to_disk` inside `cache.mutate()` returns Err (read-only
FS, ENOSPC, transient I/O error).

**Behavior.** Existing infrastructure handles this: the in-memory mirror
is updated regardless; the disk write is best-effort and logs a warning.
The collapse state survives for the running session — the IPC call returns
Ok, the frontend trusts that, and the panel stays in the new state.
**On the next launch**, `sessions.json` will reload the pre-failure value,
and the user sees the panel revert. This is consistent with how
`updateSessionCwd` and other cache mutators behave today.

**Proof.** Existing `cache.rs` tests already cover the "flush failure does
not block in-memory update" invariant. We add no new test for this — the
new mutator inherits the guarantee via `cache.mutate()`.

### 5.4 Session deletion (kill_pty)

**Trigger.** User closes a session — `kill_pty` removes the entry from
`data.sessions` and `data.session_order`.

**Behavior.** The collapse preference is dropped with the cache entry.
The session no longer exists in the UI either, so there's nothing to
restore. No special handling required.

**Proof.** Existing `kill_pty` tests already cover entry removal; no new
test needed.

### 5.5 PTY restart preserves Session, drops PTY id

**Trigger.** User restarts a session via `restartSession`. The React
`Session.id` is preserved, but the underlying PTY gets a fresh id (and a
fresh `CachedSession` entry). The old cache entry is removed when
`kill_pty` cleans up the prior PTY.

**Behavior.** The new PTY has no preference (`Pane.activityPanelCollapsed
= null` per the §3.5 init contract for `restartSession`). The panel renders
as expanded on first paint after the restart, **even if** the user had
collapsed the panel for the prior PTY in the same React Session. This is
an accepted degradation — preserving across restarts would require keying
on a stable identifier the backend doesn't currently track.

**Proof.** A frontend test triggers `restartSession` on a previously
collapsed pane and asserts the new pane renders expanded.

### 5.6 Multi-pane sessions

**Trigger.** A session adds a second pane via `addPane`. Each pane has its
own PTY id, hence its own cache entry, hence its own collapse preference.

**Behavior.** Switching the focused pane within a session swaps the
activity-panel state to that pane's preference. The wrapper's width
transition runs on the swap (since the wrapper stays mounted, only its
`width` style changes). The wipe-reveal effect from §3.6 applies.

**Proof.** A test creates a 2-pane session, collapses the panel while pane
A is focused, switches focus to pane B, and asserts the panel renders
expanded; on switching back to A, it renders collapsed.

### 5.7 New agent type added upstream

**Trigger.** Backend adds a new `AgentType` value (e.g. `'codeium'`) to the
detector.

**Behavior.** `agentTypeToRegistryKey`'s switch falls through to its
`default` arm → `shell` registry entry. The header/rail renders with the
`shell` glyph/accent and no vendor mark, the panel still functions. No
crash, no missing-glyph state. Adding a real registry entry is a follow-up.

**Proof.** A unit test on the helper passes an unknown string at runtime
(via `as unknown as AgentStatus['agentType']`) and asserts the return is
`'shell'`.

### 5.8 v1 status feed limitations

**Trigger.** The header `StatusDot` is currently derived as
`isActive ? 'running' : 'paused'`. Real agent states (mid-output, awaiting
approval, completed, errored) are NOT distinguished beyond `isActive`.

**Behavior.** Until a richer agent-state feed lands, the dot only flips
between `running` and `paused`. `completed` and `errored` from the
`SessionStatus` enum are unreachable through the v1 derivation. This is
documented; consumers reading the spec must not assume the dot conveys
finer state.

**Forward path.** A future spec defines a proper agent-state event source
(beyond `isActive`); the `agentStatusToSessionStatus` helper gains real
branches and the test suite's status-coverage expectations widen. Tracked
as out-of-scope here.

---

## 6. Testing Strategy & Implementation Order

### 6.1 Layered test plan

| Layer                             | File(s)                                                               | Asserts                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust cache (struct round-trip)    | `crates/backend/src/terminal/cache.rs` (existing tests)               | `CachedSession` with `activity_panel_collapsed: Some(true)` round-trips through `mutate` → `flush_to_disk` → `load`. Existing `mutate_then_load_round_trips` test gains an assertion on the new field.                                                                                                                                                                                                                        |
| Rust cache (default)              | same file                                                             | A legacy `sessions.json` written before this change (without the new field) loads cleanly with `activity_panel_collapsed: None`.                                                                                                                                                                                                                                                                                              |
| Rust command (happy path)         | `crates/backend/src/terminal/commands.rs`                             | `set_session_activity_panel_collapsed_inner(&cache, request)` updates the in-memory mirror and persists to disk.                                                                                                                                                                                                                                                                                                              |
| Rust command (missing session)    | same file                                                             | Returns `Err("session not found: …")` when the id isn't in `data.sessions`. No mutation occurs.                                                                                                                                                                                                                                                                                                                               |
| Rust IPC router                   | `crates/backend/src/runtime/ipc.rs` (existing dispatch tests)         | The `set_session_activity_panel_collapsed` branch parses `{ request: { id, collapsed } }`, calls `state.set_session_activity_panel_collapsed`, returns `Value::Null` on success and a structured error on failure.                                                                                                                                                                                                            |
| Rust list_sessions                | `crates/backend/src/terminal/commands.rs`                             | `list_sessions_inner` surfaces `activity_panel_collapsed` on `SessionInfo`. Sessions known to PtyState but missing from cache get `None`.                                                                                                                                                                                                                                                                                     |
| Frontend helper (registry)        | `src/agents/registry.test.ts`                                         | `agentTypeToRegistryKey('claude-code') === 'claude'`, `agentTypeToRegistryKey('codex') === 'codex'`, `agentTypeToRegistryKey('aider' \| 'generic' \| null) === 'shell'`, and a fallback case via `as unknown as` (covered by §5.7). `vendorMarkFor('claude')` returns a truthy URL; `vendorMarkFor('shell') === null`. `agentStatusToSessionStatus(activeStatus) === 'running'`; for an inactive status, `=== 'paused'`.      |
| Frontend hook/mutator             | `src/features/sessions/hooks/useSessionManager.test.ts`               | `setPaneActivityPanelCollapsed(sessionId, paneId, true)` optimistically updates the matching `Pane.activityPanelCollapsed` and resolves on IPC success. Race-safe revert test: two rapid calls with conflicting values resolve to the last-clicked value regardless of IPC ordering, including when the first IPC rejects after the second succeeds (the §3.5 + §5.2 revert guard).                                           |
| Frontend header                   | `AgentStatusPanel/Header.test.tsx`                                    | Renders agent glyph, agent short label, a `StatusDot` for the given `status`, and a chevron button. Clicking the chevron calls `onCollapse`. The gradient wash inline style references `agent.accentDim`.                                                                                                                                                                                                                     |
| Frontend rail                     | `AgentStatusRail.test.tsx`                                            | At `contextUsedPercentage: 50` and `isRunning: true`, renders the agent glyph chip, the vendor mark (for `claude`/`codex` only — not for `shell`), a context bar with fill 50% in the agent accent, the rotated `% ctx` label, and a pulsing running dot. At `> 85` it switches the fill to the error token. At `null` percent, no fill bar (track only) and `% ctx` label reads `--`. Clicking the chevron calls `onExpand`. |
| Frontend panel                    | `AgentStatusPanel/index.test.tsx`                                     | The existing assertions about body sub-component rendering pass unchanged (regression check). New cases: the new `Header` sub-component is rendered above the body; the three new required props (`agent`, `status`, `onCollapse`) are wired; `onCollapse` from the header reaches the panel's prop.                                                                                                                          |
| Frontend integration              | `src/features/workspace/WorkspaceView.integration.test.tsx`           | Initial render with `Pane.activityPanelCollapsed === null` shows `<AgentStatusPanel/>`. Clicking the header chevron calls the mutator and (after the optimistic update) renders `<AgentStatusRail/>` instead. Clicking the rail chevron returns to the panel. Errors from the mutator surface to `notifyInfo`.                                                                                                                |
| Frontend integration (multi-pane) | same file                                                             | Confirms §5.6: two panes in one session each carry their own collapse pref; switching focus swaps the rendered branch.                                                                                                                                                                                                                                                                                                        |
| Frontend visual / motion smoke    | `AgentStatusPanel/index.test.tsx` (or a dedicated `.visual.test.tsx`) | The wrapper has `transition-[width] duration-[220ms] ease-pane` and `overflow-hidden`. We assert the class names — not the runtime animation (jsdom doesn't actually paint).                                                                                                                                                                                                                                                  |

Coverage target follows the project default in `rules/CLAUDE.md` (80% minimum, TDD mandatory). The new test files are co-located with their source (vitest convention).

### 6.2 Implementation order

The work is dependency-ordered to keep each PR small, reviewable, and
mergable on its own. Each step's outputs feed the next.

1. **Vendor SVG assets land first.** Add `src/assets/vendor-icons/anthropic.svg` and `openai.svg` with no other code changes. Tiny, reviewable, lets later steps assume the imports exist.
2. **Rust changes — schema + IPC.**
   - Extend `CachedSession` and `SessionInfo` with the new field.
   - Add `SetSessionActivityPanelCollapsedRequest` + `set_session_activity_panel_collapsed_inner` in `commands.rs`.
   - Wire the new method on `BackendState` and the router branch in `ipc.rs`.
   - Regenerate ts-rs bindings via `cargo test`.
   - Land with all Rust unit tests from §6.1.
3. **Frontend types + helpers.**
   - Extend `Pane` type, update `sessionFromInfo`, update every other Pane construction site per §3.5's table.
   - Add `agentTypeToRegistryKey`, `agentStatusToSessionStatus`, `vendorMarkFor` to `registry.ts`.
   - Extend `useSessionManager` with `setPaneActivityPanelCollapsed`.
   - Land with the registry helper tests + mutator tests from §6.1.
4. **Components: Header + Rail + Panel folder move.**
   - Move `AgentStatusPanel.tsx` to `AgentStatusPanel/index.tsx` (and the test file alongside) as a no-behavior-change rename commit.
   - Add `AgentStatusPanel/Header.tsx` + `Header.test.tsx`.
   - Add `AgentStatusRail.tsx` + `AgentStatusRail.test.tsx`.
   - Land with the component tests from §6.1.
5. **WorkspaceView wiring.**
   - Add the stable wrapper, `handleCollapse`, branch render, error plumbing.
   - Land with the integration tests from §6.1 (single-pane + multi-pane).
6. **Polish & verification.**
   - Manual smoke: `npm run dev`, toggle the panel in Claude + Codex + shell panes, reload, verify the state survives, kill a session, restart, verify the §5.5 behavior.
   - `npm run type-check`, `npm run lint`, `npm run test` all green.
   - Commit follows conventional format per `rules/common/git-workflow.md`.

### 6.3 What is NOT tested

- The actual 220 ms `width` animation. jsdom doesn't paint; visual regression
  is out of scope. We assert the wrapper's class string contains
  `transition-[width]` and rely on manual smoke to confirm the curve feels
  right.
- The CSS-mask vendor-icon rendering. We assert the mask URL points at the
  imported asset; we don't assert visual pixel output.
- Cross-machine `app_data_dir` paths. The existing cache test suite covers
  that surface; we inherit it.
- Concurrent IPC at the Rust level beyond what `mutate_holds_lock_through_flush`
  already covers. The §5.2 rapid-toggle test runs at the frontend layer,
  where the race-safe revert guard lives.
