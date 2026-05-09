---
title: Terminal pane UI adjustments — scrollbar styling + agent-type detection bridge
date: 2026-05-09
status: draft
owners: [winoooops]
related:
  - docs/superpowers/specs/2026-05-08-step-4-terminal-pane-handoff-design.md
  - docs/design/handoff/README.md
---

# Terminal pane UI adjustments

Two small follow-up fixes to step 4 (handoff §4.6 TerminalPane chrome) after first-pass implementation:

1. **Bug 1**: xterm.js's `.xterm-viewport` scrollbar renders with the browser default (light grey/white on dark background), creating a bright vertical strip on the right edge of the terminal pane.
2. **Bug 2**: Originally reported as "tab is always yellow regardless of the live agent". Session creation hard-codes `agentType: 'generic'`. The codex-implemented step-4 baseline drilled `activeAgentType` through both `WorkspaceView → Tabs` AND `WorkspaceView → TerminalZone → TerminalPane` to override `Session.agentType` for the active pane / tab. With both overrides in place the tab DOES color correctly today (per Image 3), but two parallel sources of truth disagree at lifecycle edges (tab activation, EXIT_HOLD window, PTY exit). This bug consolidates the data flow into a single source — `Session.agentType`, written by the bridge effect in `WorkspaceView` — and removes both `activeAgentType` prop chains.
3. **Bug 3**: The session tab visual is rough. Three concrete issues: (a) the active tab uses a `linear-gradient(accentDim → surface)` background that washes the whole tab in agent color — handoff §4.3 specifies plain `bg-surface` with only a 2 px accent stripe at the top. (b) The close `×` button is always visible on every tab, fighting the agent chip + status dot for attention on a 130–220 px-wide surface. (c) Title is at 11 px, below the 12.5 px handoff value.

Both bugs are fixable in small, independent commits.

## Goals

1. Style `.xterm-viewport` scrollbar to match the existing `thin-scrollbar` utility in `src/index.css` (`#333344` thumb, transparent track, 6 px wide).
2. `Session.agentType` is updated by **two narrow runtime signals** — never by ambiguous "not yet checked" / "exit-hold-pending" states from `useAgentStatus`. Plus one initialization point on session creation/restart (Decision D11; not a "runtime signal" but a baseline that the runtime signals act on). Lifecycle:
   - **Initialization**: new sessions are created with `agentType: 'generic'` (in `useSessionManager.sessionFromInfo` / `createSession`); `restartSession` re-seeds `'generic'` on the replaced session entry (Decision D11). This is the baseline; runtime signals overwrite it.
   - **Detected (write detected value)**: when `useAgentStatus` returns `isActive: true` with a non-null `agentType`, write that into `Session.agentType`. This is the only path that overwrites a previous value with new live detection.
   - **Status transition to `completed` / `errored` (reset to `'generic'`)**: when **any** session's `status` flips to one of these, force its `agentType` back to `'generic'`. Without this, awaiting-restart chrome keeps the last agent's accent, AND inactive exited sessions retain their stale agent indefinitely. This is the **only** runtime reset path.
   - **Detector says inactive but PTY is still alive (no write — agent stays sticky)**: do nothing. The Rust detector returns `Option<(AgentType, u32)>` and yields `None` (`agentType: null`) when no agent process is found in the PTY's tree — including when the user typed `exit` in Claude Code and only the shell remains. The bridge's `if (!isActive || !agentType) return` guard means **once detected, `Session.agentType` sticks until the PTY exits** (status flips to `completed` / `errored`). This is a deliberate tradeoff:
     - Pro: avoids the cross-session-leak race + the EXIT_HOLD_MS flicker.
     - Con: a Claude tab whose user typed `exit` keeps reading "claude" until they restart or close the session. Acceptable for step-4 scope; if it bothers users in practice, step-9 polish can add an explicit "agent disappeared but PTY alive" reset path keyed off something less ambiguous (e.g., a transition counter or PID change).
   - **Tab activation (no write)**: when the user switches to a different session, `useAgentStatus` resets to `{ isActive: false, agentType: null, sessionId: <new> }` until the first detection result. The bridge MUST NOT write `'generic'` here — that would clobber the inactive session's last-known agentType. The first case's `isActive: true && agentType: non-null` guard covers this.
   - **Inactive sessions**: `Session.agentType` is last-known-ever and is **not** updated until the session becomes active again and the detector resolves a new value (or its status flips to completed/errored). `useAgentStatus` only observes one session at a time. Per-session detection is step-5 territory along with multi-pane.

   Every consumer of `agentForSession(session)` — Tab strip, Header chip, Footer prompt-marker (`>`) glyph, RestartAffordance — follows the resulting `Session.agentType`.

3. Remove the now-redundant `activeAgentType` prop chain through `TerminalZone` → `TerminalPane`. Single source of truth becomes `Session.agentType`.
4. Bring `Tab.tsx` visually in line with handoff §4.3 (`docs/design/handoff/README.md`): active tab uses `bg-surface` with a 2 px agent-accent stripe (no gradient bg); close `×` only renders when the tab is active OR hovered; title 12.5 px; agent chip + StatusDot kept (StatusDot only when `running`/`paused` — same as today).

> `AgentStatusPanel` is **not** in this consumer list — it reads `useAgentStatus` directly (Phase 4 wiring) for the model-id / context-window / tool-call surfaces, so its rendering is unaffected by `Session.agentType` changes.

## Non-goals

- Adding `'gemini'` to either `Session.agentType` or the Rust `AgentType` binding. Neither side currently includes Gemini detection (`src/bindings/AgentType.ts` is `'claudeCode' | 'codex' | 'aider' | 'generic'`); that's a separate feature, out of scope here.
- Adding a distinct accent for `'aider'`. The detector binding includes `aider`, but `agentForSession` currently maps `aider → shell` (yellow). When Aider is detected and bridged into `Session.agentType`, the chrome will continue to render as shell-yellow until a follow-up adds `aider` to the `AGENTS` registry. Acceptable: shipping the detection bridge improves Claude / Codex coverage; Aider stays at the existing baseline. Tracked as a follow-up.
- Per-session agent detection for inactive sessions. `useAgentStatus(sessionId)` subscribes to a single session — the workspace passes the active one. Multi-session detection is step-5 territory along with multi-pane.
- Visual transition smoothing when the tab color flips from shell-yellow to lavender/mint after PTY spawn. Detection runs immediately on subscription (not only on the 2000 ms interval), so the visible shell-yellow phase is bounded by the detector's PID walk + IPC round-trip (~tens to hundreds of ms in practice) rather than a full 2 s. The 2 s ceiling applies to retries after the initial detection. Acceptable for step 4 either way.

## Decisions

| #   | Decision                                                                                                                       | Rationale                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Scrollbar styling **updates the existing scoped `.terminal-pane-body .xterm-viewport` rule** in `src/index.css` (lines 70–90). | The codex-implemented step-4 already has a scoped rule with `rgba(205, 214, 244, 0.18)` thumb (the bright color the user is reporting). A new global `.xterm-viewport` rule would lose specificity to the scoped one. Updating the scoped rule's values to `#333344` matches the `thin-scrollbar` utility pattern.                                                            |
| D2  | Bridge detection via the existing `updateSessionAgentType(id, agentType)` setter on `useSessionManager`                        | Single source of truth via `Session.agentType` — every chrome consumer (Tab strip, Header chip, Footer prompt-marker, RestartAffordance) reads `agentForSession(session)` already. `AgentStatusPanel` is not part of this set; it reads `useAgentStatus` directly. Alternative (read `useAgentStatus` inline in chrome consumers) duplicates the override logic across files. |
| D3  | Detection → Session mapping inline in `WorkspaceView.tsx` via a small `useEffect`                                              | Workspace already owns `useAgentStatus(activeSessionId)` and the session manager — co-locating the bridge there avoids new prop-drilling.                                                                                                                                                                                                                                     |
| D4  | Setter bails early on unchanged value                                                                                          | Returning `prev` when the target session's `agentType` already matches keeps the `setSessions` reference stable and avoids re-render churn for chrome consumers.                                                                                                                                                                                                              |
| D5  | Bridge effect guards on `agentStatus.sessionId === activeSessionId`                                                            | `useAgentStatus` resets state on session change but the previous session's resolved agent can briefly remain in the hook's state (the cleanup is in an effect, ordering with the new render). Stamping `Session.agentType` requires the detector and the active session to agree on the id, otherwise we'd write the previous session's agentType into the newly active one.  |
| D6  | `useAgentStatus.agentType` is consumed directly — no separate mapping util                                                     | The hook already applies its internal `AGENT_TYPE_MAP` (camelCase Rust enum → kebab-case UI value), so `agentStatus.agentType` is `Session['agentType'] \| null` and feeds directly into the setter.                                                                                                                                                                          |
| D7  | Remove the `activeAgentType` prop chain (in BOTH `WorkspaceView → Tabs` AND `WorkspaceView → TerminalZone`)                    | Once `Session.agentType` reflects live detection, the per-pane / per-tab override becomes redundant — chrome and the tab strip both read `session.agentType` directly. Two prop chains existed in the codex implementation; both must go for D2's single-source-of-truth claim to hold.                                                                                       |
| D11 | `restartSession` seeds `agentType: 'generic'` on the new session                                                               | The existing restart path copies the previous session's metadata onto the new entry. Without explicit seeding, a stale agent from before the exit can leak into the new session and the bridge's `isActive=true` guard never fires for a shell-only PTY (detector returns `None`), leaving the tab stuck on the wrong color.                                                  |
| D8  | Active tab: drop the `linear-gradient` bg, use `bg-surface` + 2 px agent-accent top stripe per handoff §4.3                    | The current gradient (`linear-gradient(accentDim → surface)`) over-saturates the tab with agent color. Handoff specifies just plain surface bg + the 2 px stripe; that's enough identity signal because the agent chip already carries the color.                                                                                                                             |
| D9  | Close `×` only visible when `isActive` OR `:hover`                                                                             | Reduces visual noise on inactive tabs. Active tabs still show close (so the user can dismiss the current session); inactive tabs reveal close on hover. Keyboard a11y unchanged: `Delete`/`Backspace` on a focused tab still calls `onClose`.                                                                                                                                 |
| D10 | Title 12.5 px (`text-[12.5px]`); StatusDot kept at 5 px when `running`/`paused` only                                           | 12.5 px matches handoff §4.3. StatusDot retention preserves the live-energy cue (running pulse) without adding clutter — completed/errored tabs already imply state through agent chip dimming + the `(ended)` suffix in `aria-label`.                                                                                                                                        |

## Architecture

### Bug 1 — scrollbar

`src/index.css` already has scoped `.terminal-pane-body .xterm-viewport` rules (lines 70–90) — the codex implementation styled the scrollbar but with `rgba(205, 214, 244, 0.18)` thumb, which is the light-grey-on-dark that reads as "too white". A new global `.xterm-viewport` rule would lose specificity to the scoped one, so we **update the existing rule in place** rather than adding a new selector.

```diff
 .terminal-pane-body .xterm-viewport {
   scrollbar-width: thin;
-  scrollbar-color: rgba(205, 214, 244, 0.24) transparent;
+  scrollbar-color: #333344 transparent;
 }

 .terminal-pane-body .xterm-viewport::-webkit-scrollbar {
   width: 6px;
+  height: 6px;
 }

 .terminal-pane-body .xterm-viewport::-webkit-scrollbar-track {
   background: transparent;
 }

 .terminal-pane-body .xterm-viewport::-webkit-scrollbar-thumb {
-  background: rgba(205, 214, 244, 0.18);
-  border-radius: 999px;
+  background: #333344;
+  border-radius: 10px;
 }

 .terminal-pane-body .xterm-viewport::-webkit-scrollbar-thumb:hover {
-  background: rgba(205, 214, 244, 0.3);
+  background: #4a444f;
 }
```

Values mirror the `thin-scrollbar` utility (`#333344` thumb, `#4a444f` hover) so the terminal scrollbar matches every other scroll surface in the app. No test change — CSS-only, verified visually in `tauri:dev`.

### Bug 2 — agent-detection bridge

#### `useSessionManager` — `updateSessionAgentType` setter

> **Note**: the codex implementation already added this setter under the name `updateSessionAgentType`. This spec aligns with that name. Keep the existing implementation; verify it matches the bail-early semantics below — if it doesn't, tighten it as part of this PR.

```ts
// src/features/sessions/hooks/useSessionManager.ts

export interface SessionManager {
  // ...existing methods...

  /**
   * Update a session's agentType. Used by WorkspaceView to flip the type
   * after the agent-status detector identifies the running process.
   * No-op (returns `prev`) if the id isn't in `sessions` OR the value is
   * unchanged — both cases avoid re-rendering consumers for a no-op write.
   */
  updateSessionAgentType: (id: string, agentType: Session['agentType']) => void
}

const updateSessionAgentType = useCallback(
  (id: string, agentType: Session['agentType']): void => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === id)
      if (idx === -1) return prev // unknown id
      if (prev[idx].agentType === agentType) return prev // no-op
      const next = [...prev]
      next[idx] = { ...prev[idx], agentType }
      return next
    })
  },
  []
)
```

Returned alongside the existing methods.

#### `WorkspaceView.tsx` — bridge effect

```ts
// inside WorkspaceView component
const agentStatus = useAgentStatus(activeSessionId)

// Bridge agent-status detection into Session.agentType so all chrome
// consumers (Tab, Header chip, Footer prompt-marker, RestartAffordance,
// AgentStatusPanel) follow the live agent.
//
// Guards:
//   1. activeSessionId exists.
//   2. agentStatus.isActive is true (the detector has resolved an agent
//      for this session — otherwise agentType is null).
//   3. agentStatus.sessionId === activeSessionId — useAgentStatus resets
//      asynchronously on session change; the guard prevents stamping the
//      previous session's resolved agentType onto the newly active one
//      during the cross-fade window.
//
// Dependencies: scalar fields only so the effect doesn't refire on every
// status object identity change.
//
// agentStatus.agentType is already in Session['agentType'] shape because
// useAgentStatus applies its internal AGENT_TYPE_MAP before returning —
// no mapping util needed (Decision D6).
//
// Bridge effect: write Session.agentType ONLY when the detector reports
// isActive=true with a non-null agentType for the current activeSessionId.
// We deliberately do NOT write on isActive=false — that case can mean
// (a) tab just activated, detector hasn't run yet (don't clobber
// last-known), (b) the 5-second EXIT_HOLD_MS window after an agent exits,
// or (c) the agent process genuinely exited and only the shell remains
// (detector returns None).
//
// Consumers downstream of Session.agentType: Tab strip, Header chip,
// Footer prompt-marker (`>`) glyph, RestartAffordance — all via
// agentForSession(session). AgentStatusPanel is intentionally NOT a
// consumer — it reads useAgentStatus directly for model-id /
// context-window / tool-call surfaces and is unaffected by this bridge.
//
// Reads agentStatus directly — no intermediate `activeAgentType` variable
// (Decision D7's prop-chain removal also retires that derivation, leaving
// the scalar fields as the bridge's only inputs).
useEffect(() => {
  if (!activeSessionId) return
  if (agentStatus.sessionId !== activeSessionId) return
  if (!agentStatus.isActive || !agentStatus.agentType) return
  updateSessionAgentType(activeSessionId, agentStatus.agentType)
}, [
  activeSessionId,
  agentStatus.isActive,
  agentStatus.agentType,
  agentStatus.sessionId,
  updateSessionAgentType,
])

// Reset effect: when ANY session's status transitions to completed/errored
// (PTY exit), force its agentType back to 'generic'. Watches the whole
// sessions array so inactive exited sessions also get reset — without
// this, an inactive session that exited in the background would retain
// its last-detected agent until reactivation.
useEffect(() => {
  for (const session of sessions) {
    if (session.status !== 'completed' && session.status !== 'errored') continue
    if (session.agentType === 'generic') continue
    updateSessionAgentType(session.id, 'generic')
  }
}, [sessions, updateSessionAgentType])
```

> **Effect dependency note**: depending on `sessions` causes the reset effect to fire on every sessions array change, but `updateSessionAgentType` bails early when the value is already `'generic'` so this is cheap — at most one setter call per session per status transition. If profiling later shows churn, narrow the dep array by deriving a stable `exitedSignature = sessions.map(s => s.id + s.status).join('|')` and depending on that string instead.

#### Restart-path atomicity (Decision D11)

`useSessionManager.restartSession` (existing path) does **spawn-first → kill-old → seed restoreData under new sessionId → replace the React state entry**. The replace step copies forward most of the previous session's metadata (`name`, `cwd`, etc.) — including `agentType`. This means: if a Claude session exited and the reset effect raced with the user clicking Restart, the new session can inherit the old `agentType` (purple) before detection fires for the new shell. The bridge's `if (!isActive) return` guard then leaves it stale until detection picks up a new agent (which never happens for a fresh shell — see Goal #2 lifecycle).

**Fix**: `restartSession` explicitly seeds the new session entry with `agentType: 'generic'` so every restart starts from a known baseline. The bridge writes the detected agent (if any) on the next detection tick. One-line change inside `restartSession`'s state-replace block:

```diff
 setSessions((prev) =>
   prev.map((s) =>
     s.id === id
       ? {
           ...s,
           id: result.sessionId,
           status: 'running',
+          agentType: 'generic',
           // ...other fields...
         }
       : s
   )
 )
```

This eliminates the race and means the restart-spawn window has the same baseline as a fresh-spawn window: starts as `'generic'` (yellow), detection fires within ~2 s and writes the live agent. Symmetric, predictable.

#### Remove the `activeAgentType` prop chain (Decision D7)

The codex implementation drilled `activeAgentType` through **two** prop chains: `WorkspaceView → Tabs → Tab` AND `WorkspaceView → TerminalZone → TerminalPane`. Both override `Session.agentType` for the active session's chrome. Once the bridge effect writes the detected agent into `Session.agentType` directly, both chains become redundant; leaving them keeps two sources of truth and lets `useAgentStatus`'s pre-detection state (`agentStatus.isActive: false` after EXIT_HOLD_MS, with stale `agentType` still populated) bleed into the visual.

| File                                                                                                       | Change                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/workspace/WorkspaceView.tsx`                                                                 | Remove `const activeAgentType = ...` derivation AND the `agentStatusMatchesActiveSession` helper (its only consumer was the derivation). Remove `activeAgentType={activeAgentType}` from BOTH `<Tabs />` AND `<TerminalZone />` JSX. Update the bridge effect to read `agentStatus.isActive` / `agentStatus.agentType` / `agentStatus.sessionId` directly (snippet above). |
| `src/features/sessions/components/Tabs.tsx`                                                                | Remove `activeAgentType` from `TabsProps`; remove the `chromeSession` derivation inside `sessions.map(...)`; pass `agent={agentForSession(session)}` directly.                                                                                                                                                                                                             |
| `src/features/workspace/components/TerminalZone.tsx`                                                       | Remove `activeAgentType` from `TerminalZoneProps`; remove the per-pane forward `activeAgentType={isActive ? activeAgentType : null}` on `<TerminalPane />`.                                                                                                                                                                                                                |
| `src/features/terminal/components/TerminalPane/index.tsx`                                                  | Remove `activeAgentType` from `TerminalPaneProps`; remove the local `chromeSession` derivation; chrome reads `session` directly. The `agent` constant becomes `const agent = agentForSession(session)`.                                                                                                                                                                    |
| `src/features/sessions/components/Tabs.test.tsx` + `TerminalZone.test.tsx` + `TerminalPane/index.test.tsx` | Drop fixtures that pass `activeAgentType` — tests now exercise the simpler one-source path.                                                                                                                                                                                                                                                                                |

This consolidation is part of the same commit as the bridge — without it, both paths exist simultaneously and diverge.

### Race window

`useAgentStatus` runs detection immediately on subscription attach (not only on the 2000 ms `DETECTION_POLL_MS` interval). The visible shell-yellow phase after a fresh spawn is therefore bounded by the detector's PID walk + IPC round-trip (~tens to hundreds of ms in practice), not a full 2 s. The 2 s ceiling applies only to retries after the initial detection. Acceptable either way; if the eager-detection path ever proves insufficient, step 9 polish can pre-warm detection at `spawn` resolve.

### Test approach

| File                          | New test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useSessionManager.test.ts`   | (a) `updateSessionAgentType` updates the matching session; returns `prev` reference for unknown id (no re-render); returns `prev` reference when value unchanged. (b) `restartSession` seeds `agentType: 'generic'` on the replaced session entry (Decision D11).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `WorkspaceView.test.tsx`      | (a) detected → setter called with detected type. `useAgentStatus` mock yields `{ isActive: true, agentType: 'claude-code', sessionId: 's1' }` for `activeSessionId === 's1'`, `updateSessionAgentType('s1', 'claude-code')` is called. (b) `isActive: false` → **no setter call** (preserves last-known across tab activation + EXIT_HOLD + agent-exited-but-shell-alive). (c) cross-session guard. When `agentStatus.sessionId !== activeSessionId`, no setter call. (d) PTY exit reset for active session. When the active session's `status` transitions to `'completed'` or `'errored'`, setter called with `'generic'`. (e) PTY exit reset for inactive session. When an inactive session's status transitions to `'completed'` while its `agentType` is non-`'generic'`, setter called with `'generic'`. |
| `Tabs.test.tsx`               | Drop assertions about `activeAgentType` prop (prop removed). Tab strip rendering driven by `session.agentType` only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `TerminalZone.test.tsx`       | Drop assertions about `activeAgentType` prop (prop removed). Chrome rendering driven by `session.agentType` only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `TerminalPane/index.test.tsx` | Drop test cases that pass `activeAgentType`. Existing agent-chip / Header tests already use `session.agentType` paths and continue to pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Bug 3 — Tab visual (handoff §4.3 alignment)

**File**: `src/features/sessions/components/Tab.tsx` (~30 LOC delta).

Three changes inside the existing `Tab` component:

1. **Drop the gradient on active.** Replace `style={activeChromeStyle}` (which sets `background: linear-gradient(...)` and `borderColor: agent.accentSoft`) with a plain `bg-surface` + tonal-border class set when active. Only the 2 px top stripe carries agent color.
2. **Hover-reveal close — applies to BOTH active and inactive tabs.** Wrap the tab in a `group` and switch the close button to `opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity`. The close button is `aria-hidden="true"` permanently — sighted users see it on hover or when the tab itself is keyboard-focused (group-focus-within); screen-reader / keyboard-only users close via `Delete` / `Backspace` on the focused tab.
3. **Title 12.5 px.** Replace `text-[11px]` with `text-[12.5px]` on the title `<span>`. (Tailwind's `text-xs` is 12 px; we use the arbitrary value to hit handoff's exact spec.)

```tsx
// Tab.tsx — after changes (relevant lines only)

<div
  // ...existing wrapper attrs unchanged...
  data-active={isActive}
  className={`
    group  // <-- added so child opacity reacts to hover/focus-within
    relative flex h-[30px] min-w-[130px] max-w-[220px] cursor-pointer items-center gap-2
    rounded-t-lg border border-transparent pl-3 pr-2 outline-none transition-colors
    focus-visible:ring-2 focus-visible:ring-primary/50
    ${isActive
      ? '-mb-px bg-surface border-outline-variant/30'  // <-- removed gradient, just surface
      : 'hover:bg-on-surface/[0.025]'
    }
  `}
>
  {isActive && (
    <span
      aria-hidden="true"
      className="absolute inset-x-1.5 top-0 h-0.5 rounded-b-sm"
      style={{ background: agent.accent }}
    />
  )}
  {/* agent chip — unchanged */}
  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] ...">  {/* 12.5 px */}
    {session.name}
  </span>
  {/* StatusDot — unchanged (running/paused only) */}
  <button
    type="button"
    tabIndex={-1}
    onClick={...}
    aria-label={`Close ${session.name}`}
    aria-hidden="true"  // permanent — visible affordance is mouse/focus only; SR users close via Delete/Backspace on the focused tab
    className="
      flex h-4 w-4 shrink-0 items-center justify-center rounded
      text-on-surface-variant/70 transition-opacity
      opacity-0 pointer-events-none
      group-hover:opacity-100 group-hover:pointer-events-auto
      group-focus-within:opacity-100 group-focus-within:pointer-events-auto
      hover:bg-on-surface/[0.06] hover:text-on-surface
    "
  >
    <span className="material-symbols-outlined text-[11px]">close</span>
  </button>
</div>
```

> **A11y note**: the close button is permanently `aria-hidden="true"` and has `pointer-events-none` by default. It's a decorative affordance for sighted users only — visible on hover or when the tab itself is keyboard-focused (group-focus-within). Screen-reader / keyboard-only users close via the `Delete` / `Backspace` shortcut on the focused tab, which doesn't depend on the button being focusable or visible. Conditional rendering (`{(isActive || isHovered) && <button>}`) was rejected because it requires JS hover state — `pointer-events-none + aria-hidden` is the CSS-driven equivalent.

#### Tab.tsx tests

| Test                                                     | Assertion                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active tab uses surface bg, no gradient                  | `getByTestId('session-tab')` for active has class `bg-surface` and no inline `style.background` containing `linear-gradient`.                                                                                                                       |
| Close button hidden on **both** inactive AND active tabs | Query via `screen.getByLabelText(/Close /i)` — the button is `aria-hidden="true"` so role-based queries can't reach it even with `hidden: true`. Assert class string contains `opacity-0` and `pointer-events-none`. Same for both states.          |
| Hover/focus reveal class strings                         | jsdom can't drive `:hover`. Verify the class string contains `group-hover:opacity-100`, `group-hover:pointer-events-auto`, `group-focus-within:opacity-100`, `group-focus-within:pointer-events-auto`. Visual verification covers the actual hover. |
| Click handler still wired                                | Use `fireEvent.click` (NOT `userEvent.click`) on the close button — the latter respects `pointer-events: none` and won't dispatch. Keyboard close (`Delete`/`Backspace` on the focused tab) is unchanged.                                           |
| Title font size                                          | Title span has class `text-[12.5px]`.                                                                                                                                                                                                               |

### Commit shape

Three atomic commits, no dependency:

1. `chore(terminal): style xterm scrollbar to match app thin-scrollbar`
2. `feat(sessions): drive agentType from agent-status detection` — includes the `activeAgentType` prop-chain removal (Decision D7) so the source-of-truth consolidation lands atomically.
3. `refactor(sessions): align Tab visual with handoff §4.3` — drop active-tab gradient, hover-reveal close, 12.5 px title.

## Risks

| Risk                                                                                                                                       | Mitigation                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Updating the scoped `.terminal-pane-body .xterm-viewport` rule could affect any future consumer that also uses that class on its container | `.terminal-pane-body` is set only by `Body.tsx`. No other consumer; safe.                                                                                                                                                                                                                       |
| Detector race causes brief mis-color on first paint (up to ~2 s)                                                                           | Acceptable per Goals; documented in the commit body.                                                                                                                                                                                                                                            |
| Cross-session leak — previous session's detected agentType written into newly active session                                               | Bridge effect guards on `agentStatus.sessionId === activeSessionId` (Decision D5). Tested explicitly.                                                                                                                                                                                           |
| `setSessionAgentType` re-renders on every agent-status change                                                                              | Effect depends on scalar fields (`isActive`, `agentType`, `sessionId`) not the whole `agentStatus` object. Setter bails early returning `prev` when value is unchanged (Decision D4) so even if the effect fires, no re-render cascade. Wrapped in `useCallback` for stable identity.           |
| Inactive sessions retain last-detected agent — could become stale if their underlying process changes off-screen                           | Documented in Goal #2 lifecycle: inactive = last-known. Per-session multi-detection is step-5 territory. The active session always reflects live detection so the user-visible session is correct.                                                                                              |
| Active session retains its agent color after the user types `exit` (PTY still alive but agent process gone)                                | Documented in Goal #2 lifecycle: detector returns `None` for shell-only PTYs, and the bridge ignores `isActive: false` to avoid flicker. The tab updates only when the PTY exits OR the user re-activates an agent. Step-9 polish can introduce an explicit "agent gone, PTY alive" reset path. |
| PTY exit doesn't reset `agentType` because `useAgentStatus` stops emitting                                                                 | Reset effect watches the entire `sessions` array (active AND inactive); on any `completed`/`errored` transition, forces `agentType` back to `'generic'`. Tested for both active and inactive cases.                                                                                             |
| Aider rendered as yellow shell despite detection                                                                                           | Out-of-scope per Non-goals. Tracked as follow-up — adds `aider` to the `AGENTS` registry with its own accent. Acceptable interim because the high-value cases (Claude / Codex) are correctly colored.                                                                                           |
| Hover-reveal close button is invisible on touch devices                                                                                    | Acceptable: vimeflow is a desktop-only Tauri app per `docs/CLAUDE.md`; touch isn't a target surface. If touch ever ships, switch to always-visible close on coarse pointer (`@media (pointer: coarse)`).                                                                                        |
| Tab tests can't drive `:hover` reliably in jsdom                                                                                           | Test the class string contains `group-hover:opacity-100`; rely on `tauri:dev` visual verification for the actual hover transition. Same pattern the existing focus-ring transition tests use (jsdom can't time CSS transitions either).                                                         |

## References

- `src/index.css` — existing `thin-scrollbar` utility for reference
- `src/features/sessions/hooks/useSessionManager.ts:40,645` — current `agentType: 'generic'` defaults
- `src/features/sessions/utils/agentForSession.ts` — Session→Agent mapping
- `src/features/agent-status/hooks/useAgentStatus.ts` — detector hook
- `src/bindings/AgentType.ts` — Rust-generated agent enum (authoritative for the mapping util)
- `docs/superpowers/specs/2026-05-08-step-4-terminal-pane-handoff-design.md` — parent step-4 spec
