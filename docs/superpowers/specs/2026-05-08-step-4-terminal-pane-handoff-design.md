---
title: Step 4 — Single TerminalPane (handoff §4.6)
date: 2026-05-08
status: draft
issue: 163
owners: [winoooops]
related:
  - docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md
  - docs/design/handoff/README.md
  - docs/design/handoff/prototype/src/splitview.jsx
  - docs/roadmap/progress.yaml
---

# Step 4 — Single TerminalPane (handoff §4.6)

## Context

Step 4 of the UI Handoff Migration ([#163](https://github.com/winoooops/vimeflow/issues/163)). The migration spec ([2026-05-05-ui-handoff-migration-design.md](./2026-05-05-ui-handoff-migration-design.md)) decomposes the visual update into 10 steps; steps 1–3 landed in #171, #173, #174 (tokens + agents registry, app shell, sidebar sessions list + browser-style session tabs). Step 4 replaces the chrome around xterm with handoff §4.6: collapsible header, scroll body, input footer, focus ring, agent identity chip — wired to one PTY.

Existing `src/features/terminal/components/TerminalPane.tsx` (~380 LOC) wires xterm + `portable-pty` correctly but renders without chrome. The replacement is a chrome wrapper around the existing xterm wiring; the xterm code itself moves verbatim, no behavior change there.

Multi-pane layout (SplitView grid + LayoutSwitcher + ⌘1–4 / ⌘\) is **step 5**, not step 4. This spec is single-pane.

## Goals & non-goals

**Goals.**

1. Match handoff §4.6 visually pixel-for-pixel: header (collapsible) + scroll body + input footer + focus ring + agent identity chip + status pip.
2. Status pip tracks **PTY health** (from `useTerminal` `status: 'idle' | 'running' | 'exited' | 'error'`), distinct from `Session.status`.
3. Preserve existing exports — `TerminalPane` named export plus `terminalCache` / `clearTerminalCache` / `disposeTerminalSession` / `TerminalPaneMode` / `TerminalPaneProps`. **No production-consumer churn beyond a one-line additive update in `TerminalZone.tsx`**: `TerminalPaneProps` gains two new required props — `session: Session` (chrome data source) and `isActive: boolean` (gates per-pane git IPC) — both already in `TerminalZone`'s scope. `useSessionManager.ts` is untouched. Tests pinned at the old `TerminalPane.tsx` path are migrated to the new `TerminalPane/{index,Body,RestartAffordance}.test.tsx` files as part of this PR (see §6 + §7).
4. Keep all existing behavior: PTY spawn / attach / awaiting-restart, OSC 7 cwd tracking, ResizeObserver-driven fit, `restoreData` replay, `notifyPaneReady` drain.

**Non-goals.**

1. Multi-pane orchestration (`focusedPaneId`, SplitView). Step 5.
2. Functional input footer (PTY submit on Enter). Decorative-only; xterm remains the input surface.
3. "Close pane" semantics (distinct from "close session"). No close button rendered until step 5 wires it.
4. RelTime ticking refresh, ContextSmiley, status-bar polish. Step 9.
5. Footer placeholder behavior needing periodic refresh — static derivation only.

## Decisions (resolved during brainstorming)

| #   | Decision                                                                                                                                         | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Focus state is **local to the pane** (`useFocusedPane`)                                                                                          | In single-pane there is no `focusedPaneId` to coordinate. Step 5 (SplitView) introduces a workspace-level `focusedPaneId`; the prop rename there is cheap. Local state lets us verify the 180–220ms transition visually.                                                                                                                                                                                                                            |
| Q2  | **Full visual fidelity, decorative behaviors** for elements that don't make single-pane sense yet                                                | Header collapse: real. Footer: rendered, `readOnly`, placeholder mirrors state, click → focus xterm. Close button: not rendered (no `onClose` passed) — present in subcomponent's prop API for step 5. Avoids ambiguous footer-vs-xterm input and redundant close affordance vs SessionTabs.                                                                                                                                                        |
| Q3  | Module decomposition: **Approach 2** — full subcomponent split (`Header`/`Body`/`Footer`)                                                        | Existing TerminalPane.tsx is ~380 LOC; chrome additions push past the 400-LOC budget. Header / Footer / `useFocusedPane` are testable in isolation (no xterm, no jsdom-terminal harness); Body still needs the jsdom + xterm harness because it owns xterm wiring. Body is a verbatim move of the existing xterm code.                                                                                                                              |
| Q4  | Layout: **`TerminalPane/` directory** with `index.tsx`, `Header.tsx`, `Body.tsx`, `Footer.tsx`                                                   | Per `rules/CLAUDE.md` ("Topics with enough depth use the directory pattern"). TS module resolution preserves existing import paths (`'../../terminal/components/TerminalPane'` resolves to `index.tsx`).                                                                                                                                                                                                                                            |
| Q5  | Status pip semantics: **`useTerminal.status` for live PTYs**, **`session.status` for awaiting-restart**                                          | DoD says "tracks PTY health". `useTerminal.status` covers live panes. In awaiting-restart there is no live PTY (`useTerminal.status` would be `'idle'`), so the pip falls back to `session.status` (currently always `'completed'` post-exit — see Open Question §exit-status). Mapping for live panes: `running→running`, `idle→paused`, `exited→completed`, `error→errored`. (See Open Question §pip-parity for the `idle→paused` approximation.) |
| Q6  | Git status sources — **branch from new `useGitBranch(workingDirectory)` hook**, **±changes from existing `useGitStatus(workingDirectory)` hook** | `useGitStatus` returns `{files, ...}` only — no branch. Adds a small new `git_branch(cwd)` Rust command + ts-rs binding + `useGitBranch` React hook (~90 LOC total). Self-contained per-pane scaling to step 5. WorkspaceView's existing `useGitStatus(activeCwd)` is unrelated; git read IPC is observable + cached, not destructive — no double-watch concern.                                                                                    |
| Q7  | Pane title: **`session.name`** (via the new `session` prop)                                                                                      | Already cwd-derived (`tabName(cwd, idx)`) or user-renamed. Matches what the SessionTab strip displays. Reachable now that `TerminalPaneProps` carries the session (Goal #3).                                                                                                                                                                                                                                                                        |
| Q8  | Header collapse: **per-pane local `useState`**, not persisted                                                                                    | Single-pane today; persistence is meaningless. Step 5 may revisit (per-pane in `panes[]` registry, or a global default).                                                                                                                                                                                                                                                                                                                            |
| Q9  | Awaiting-restart: chrome **wraps** the Restart button                                                                                            | Visual parity with running panes (same border-radius, outline, agent chip, status pip showing `completed`/`errored` via `session.status` per Q5). The Restart UI replaces only the Body's xterm; Header + Footer render identically.                                                                                                                                                                                                                |

> Q1 and Q2 were explicitly approved by the user during brainstorming. Q3 and Q4 were the user's decomposition + folder choices. Q5–Q9 are proposed by this spec — flag during section review if any of them are wrong.

## Open questions

- **§pip-parity (Q5)** — `useTerminal.status === 'idle'` currently maps to the existing `StatusDot` `paused` tone (warning amber, pulsing) rather than a distinct `idle` tone matching the handoff prototype's primitive. Decision deferred until end-of-spec review when total PR size is visible: if Step 4 lands well under the typical-file budget, extend `StatusDot` with an `idle` state in this PR; otherwise hold for Step 9 polish.

- **§exit-status (Q5/Q9)** — `useSessionManager.sessionFromInfo` currently maps every non-Alive session to `'completed'`; no path sets `'errored'` on PTY exit. Spec assumes the awaiting-restart pip can show either, but in practice today only `'completed'` is reachable. Acceptable for Step 4 (pip is honest about the state the manager records). Resolving the exit-status mapping (non-zero exit → `'errored'`) is out of scope here and can land independently — flagging so Step 5 / future polish can pick it up.

## §1 Architecture — module decomposition

```
src/features/terminal/components/
└── TerminalPane/
    ├── index.tsx                       # Container. Public API. Mode branch. Composes Header + (Body | RestartAffordance) + Footer.
    ├── index.test.tsx
    ├── Header.tsx                      # Agent chip · pip · title · branch · ±changes · relative-time · collapse + close
    ├── Header.test.tsx
    ├── Body.tsx                        # xterm + PTY wiring + useTerminal + register/unregister + forwardRef focusTerminal
    ├── Body.test.tsx
    ├── Footer.tsx                      # Decorative input + pip + click-to-focus glue + optional placeholder override
    ├── Footer.test.tsx
    ├── RestartAffordance.tsx           # Body-slot replacement when mode === 'awaiting-restart'
    ├── RestartAffordance.test.tsx
    ├── useFocusedPane.ts               # Local focus state hook
    ├── useFocusedPane.test.ts
    ├── ptyStatusToSessionStatus.ts     # Pure mapping util (PTY status → SessionStatus pip input)
    ├── ptyStatusToSessionStatus.test.ts
    ├── aggregateLineDelta.ts           # Pure aggregation over useGitStatus().files (insertions / deletions)
    └── aggregateLineDelta.test.ts
```

**Module ownership at a glance:**

| Currently in `TerminalPane.tsx`                                             | New home                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `terminalCache`, `clearTerminalCache`, `disposeTerminalSession`             | `Body.tsx` (xterm-lifecycle owners). Re-exported by `index.tsx` so external consumers don't break.                                                                                                          |
| `TerminalPaneProps` type                                                    | `index.tsx` (public API surface).                                                                                                                                                                           |
| `TerminalPaneMode` type                                                     | `index.tsx` exports the public union `'attach' \| 'spawn' \| 'awaiting-restart'`. Body's internal prop is the narrower `'attach' \| 'spawn'` (Body never sees `'awaiting-restart'`).                        |
| Awaiting-restart fast-path (`<button onClick={onRestart}>Restart</button>`) | `index.tsx` decides the body branch (`<Body>` vs `<RestartAffordance>`). Header + Footer unchanged.                                                                                                         |
| xterm setup, OSC 7 handler, ResizeObserver, fit/resize wiring               | `Body.tsx` (verbatim move — no behavior change).                                                                                                                                                            |
| `useTerminal()` hook call (yields `session`, `resize`, `status`)            | `Body.tsx` — alongside xterm, so `resize` + `status` stay co-located with the xterm setup that depends on them. PTY status flows up to `index.tsx` via `onPtyStatusChange` callback for Header/Footer pips. |
| `registerPtySession` / `unregisterPtySession` lifecycle effect              | `Body.tsx` (it has `ptySession?.id` natively from `useTerminal`).                                                                                                                                           |
| Imperative `terminal.focus()` on container click                            | `Body.tsx` exposes via `React.forwardRef` + `useImperativeHandle`; `index.tsx` calls `bodyRef.current?.focusTerminal()` from the container's `onClick`.                                                     |

**Public-API preservation.** External imports of `TerminalPane`, `terminalCache`, `clearTerminalCache`, `disposeTerminalSession`, `TerminalPaneMode`, and `TerminalPaneProps` keep working via `TerminalPane/index.tsx` re-exports. The old `TerminalPane.tsx` file is removed in the refactor commit; tests pinned at the old path migrate to the new path in this PR.

**File-size budget under `rules/common/coding-style/` (200–400 typical, 800 max):**

| File                                             | Estimated LOC                                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.tsx`                                      | ~160 (props, `useFocusedPane`, mode branch, pipStatus derivation, footerPlaceholder, Header/Body/Footer composition, bodyRef forwarding)                                                                           |
| `Header.tsx`                                     | ~120 (chip + pip + title + branch + ±changes + relative-time + collapse + close)                                                                                                                                   |
| `Body.tsx`                                       | ~280 (xterm + `useTerminal` + `registerPtySession` + `useImperativeHandle` for focusTerminal — lifted from current TerminalPane.tsx)                                                                               |
| `Footer.tsx`                                     | ~80 (decorative input + pip + focus glue + placeholder override)                                                                                                                                                   |
| `RestartAffordance.tsx`                          | ~50 (title + button + relative-time)                                                                                                                                                                               |
| `useFocusedPane.ts`                              | ~60 (local state + click-outside listener + onTerminalFocusChange bridge)                                                                                                                                          |
| `ptyStatusToSessionStatus.ts`                    | ~20 (pure mapping function)                                                                                                                                                                                        |
| `aggregateLineDelta.ts`                          | ~20 (pure reducer over `useGitStatus().files` — `insertions` / `deletions`)                                                                                                                                        |
| `src-tauri/src/git/mod.rs` (existing, ~1693 LOC) | **+~30 LOC** (`git_branch(cwd)` async fn — `git rev-parse --abbrev-ref HEAD` wrapper). Exception to the 800-LOC file budget: additive function in an already-large module; splitting `git/mod.rs` is out of scope. |
| `src-tauri/src/lib.rs` (existing)                | **+~2 LOC** (`use git::git_branch` import + entry in BOTH `generate_handler![...]` arms — test build and prod build).                                                                                              |
| `src/features/diff/hooks/useGitBranch.ts` (new)  | ~60 (small hook mirroring `useGitStatus`'s skip/idle conventions for non-existent or `.`/`~` cwd)                                                                                                                  |

All **new** files under 400 LOC. The two existing-file additions (`git/mod.rs`, `lib.rs`) are surgical (+30 LOC, +2 LOC); they don't introduce new files and don't aim to bring the existing files under-budget. Total **net new** lines ≈ ~880 LOC: existing `TerminalPane.tsx` (~380 LOC, moves into `Body.tsx`) + chrome additions (~410 LOC) + `git_branch` plumbing (~90 LOC).

## §2 Component APIs

```ts
// TerminalPane/index.tsx — public surface (re-exports cache helpers from Body)

export interface TerminalPaneProps {
  // Existing — unchanged
  sessionId: string
  cwd: string
  service: ITerminalService
  shell?: string
  env?: Record<string, string>
  restoredFrom?: RestoreData
  onCwdChange?: (cwd: string) => void
  onPaneReady?: NotifyPaneReady
  mode?: TerminalPaneMode
  onRestart?: (sessionId: string) => void

  // NEW — session source for chrome (name, agentType, status, lastActivityAt)
  session: Session

  // NEW — gates per-pane git IPC (useGitBranch + useGitStatus) so hidden
  // panes don't burn IPC. TerminalZone already computes this:
  //   isActive={session.id === activeSessionId}
  isActive: boolean

  // RESERVED for step 5; not wired this PR
  onClose?: (sessionId: string) => void
}

export const TerminalPane: (props: TerminalPaneProps) => ReactElement

// `TerminalPaneMode` is the public API mode union — defined here, not in Body.
export type TerminalPaneMode = 'attach' | 'spawn' | 'awaiting-restart'

// Re-exports preserved from current API
export {
  terminalCache,
  clearTerminalCache,
  disposeTerminalSession,
} from './Body'
```

```ts
// TerminalPane/Header.tsx — final shape (also referenced by §3 data flow)

export interface HeaderProps {
  agent: Agent // resolved via agentForSession(session) in index.tsx
  session: Session // for name + lastActivityAt
  pipStatus: SessionStatus // mapped from PTY status (live) OR session.status (awaiting-restart)
  branch: string | null // from useGitBranch(session.workingDirectory) in index.tsx
  added: number // from aggregateLineDelta(useGitStatus().files)
  removed: number // from aggregateLineDelta(useGitStatus().files)
  isFocused: boolean // drives header-bg gradient
  isCollapsed: boolean // drives padding + hides branch / ±changes / RelTime when true
  onToggleCollapse: () => void
  onClose?: () => void // rendered only when defined (not in single-pane mode)
}

export const Header: (props: HeaderProps) => ReactElement
```

```ts
// TerminalPane/Body.tsx — owns terminalCache + xterm + useTerminal

export const terminalCache: Map<
  string,
  { terminal: Terminal; fitAddon: FitAddon }
>
export const clearTerminalCache: () => void
export const disposeTerminalSession: (sessionId: string) => void

// Public-API mode lives in index.tsx (see TerminalPaneMode below). Body's
// internal prop is narrower because Body never sees 'awaiting-restart'.
type BodyMode = 'attach' | 'spawn'

export interface BodyProps {
  sessionId: string
  cwd: string
  service: ITerminalService
  shell?: string
  env?: Record<string, string>
  restoredFrom?: RestoreData
  onCwdChange?: (cwd: string) => void
  onPaneReady?: NotifyPaneReady
  mode: BodyMode
  onPtyStatusChange?: (status: 'idle' | 'running' | 'exited' | 'error') => void
  onFocusChange?: (focused: boolean) => void // raised when xterm gains/loses focus
}

export interface BodyHandle {
  focusTerminal: () => void // index.tsx calls this on container click
}

export const Body: React.ForwardRefExoticComponent<
  BodyProps & React.RefAttributes<BodyHandle>
>
```

```ts
// TerminalPane/Footer.tsx

export interface FooterProps {
  agent: Agent
  pipStatus: SessionStatus
  isFocused: boolean
  isPaused: boolean // = pipStatus === 'paused'
  onClickFocus: () => void // click-anywhere-to-focus glue (forwards to useFocusedPane setter + xterm.focus())
  /**
   * Optional placeholder override. When set, replaces the internal
   * focused/paused/blurred derivation. `index.tsx` uses this for
   * awaiting-restart panes (e.g. "session ended — restart to resume CLAUDE")
   * so Footer stays generic and the per-mode copy lives at the call site.
   */
  placeholder?: string
}

export const Footer: (props: FooterProps) => ReactElement
```

```ts
// TerminalPane/useFocusedPane.ts

export interface UseFocusedPaneOptions {
  // React 19's `useRef<HTMLDivElement>(null)` returns
  // `RefObject<HTMLDivElement | null>`, so the option type accepts the
  // nullable form. Using `HTMLElement | null` keeps the hook usable for
  // any container element type the caller picks.
  containerRef: RefObject<HTMLElement | null>
  /**
   * Initial focused state. Defaults to false. When set to true, the pane
   * starts focused (used in tests + edge cases). Live focus updates flow
   * through `onTerminalFocusChange` (called from Body's `onFocusChange`)
   * and the document-level click-outside listener.
   */
  initial?: boolean
}

export interface UseFocusedPaneReturn {
  isFocused: boolean
  /** Imperative setter for tests + xterm focus bridge integration. */
  setFocused: (next: boolean) => void
  /**
   * Wired to Body's `onFocusChange` so xterm-driven focus loss/gain
   * (e.g. tabbing in/out of the textarea) flips local state.
   */
  onTerminalFocusChange: (focused: boolean) => void
}

export const useFocusedPane: (
  opts: UseFocusedPaneOptions
) => UseFocusedPaneReturn
```

**Key behaviors of `useFocusedPane`:**

- On mount, attaches a `mousedown` listener to `document` that sets `isFocused = false` when the click target is outside `containerRef.current`. Removed on unmount.
- `onTerminalFocusChange(focused)` is called from `<Body onFocusChange={...} />`. The hook mirrors the xterm focus event into local state. When Body is absent (awaiting-restart), only the click-outside listener and the `onContainerClick` (defined in index.tsx) manage state.
- `index.tsx` wires the container's `onClick` to: `bodyRef.current?.focusTerminal()` then `setFocused(true)`. The two calls are sequenced so the cursor lands in xterm immediately after the click.

**Focus bridge contract:** Body owns xterm; xterm owns focus events. Body translates them into a single boolean via `onFocusChange?: (focused: boolean) => void`. `index.tsx` forwards that boolean into `useFocusedPane.onTerminalFocusChange`. xterm ownership doesn't leak above Body.

**`pipStatus` derivation (in `index.tsx`):**

```ts
const [ptyStatus, setPtyStatus] = useState<
  'idle' | 'running' | 'exited' | 'error'
>('idle')
// <Body onPtyStatusChange={setPtyStatus} ... />

const pipStatus: SessionStatus =
  mode === 'awaiting-restart'
    ? session.status // 'completed' | 'errored'
    : ptyStatusToSessionStatus(ptyStatus)

// where ptyStatusToSessionStatus:
//   'idle'    → 'paused'    (see Open Question §pip-parity)
//   'running' → 'running'
//   'exited'  → 'completed'
//   'error'   → 'errored'
```

The mapping lives in a small util (`TerminalPane/ptyStatusToSessionStatus.ts`) so it can be unit-tested without React.

**Git-branch hook (new):**

```ts
// src/features/diff/hooks/useGitBranch.ts

export interface UseGitBranchOptions {
  /** Enable/disable the hook entirely — when false, returns empty state with no IPC. Mirrors useGitStatus's enabled gate. */
  enabled?: boolean
}

export interface UseGitBranchReturn {
  branch: string | null // null while loading, when cwd is invalid, or on error
  loading: boolean
  error: Error | null
  refresh: () => void
  idle: boolean // mirrors useGitStatus.idle — short-circuits IPC for `.`/`~` fallbacks
}

export const useGitBranch: (
  cwd: string,
  options?: UseGitBranchOptions
) => UseGitBranchReturn
```

Backed by a new `git_branch(cwd: String) -> Result<String, String>` Tauri command in `src-tauri/src/git/mod.rs`. **Implemented via the `git` CLI** (matching the rest of `src-tauri/src/git/mod.rs`, which uses `Command::new("git")` exclusively — `git2`/libgit2 is NOT a dependency in `src-tauri/Cargo.toml`). Path-scope safety: the command MUST start with `let safe_cwd = validate_cwd(&cwd)?;`, mirroring `git_status` and `get_git_diff` — without this, a renderer-supplied `cwd` could escape the home-scope sandbox. After validation: `git -C <safe_cwd> symbolic-ref --short HEAD`, trimmed; returns the branch name even in unborn repos (no commits yet). On detached HEAD, `symbolic-ref` exits non-zero; the command catches that and returns the empty string (which the hook treats as null). The command must be added to **both** `generate_handler![...]` lists in `src-tauri/src/lib.rs` (the test-build and prod-build branches) and re-exported from `git::mod` alongside the existing `git_status` / `get_git_diff`. Header renders branch as a dim grey label; falls back to omitting the segment when `branch` is null or empty.

## §3 Data flow

> Note on `RelTime`: a `<RelTime>` component does **not** exist in the codebase yet, but a pure formatter does — `formatRelativeTime(iso: string)` at `src/features/agent-status/utils/relativeTime.ts`, already used by `sessions/components/Card.tsx`. Step 4 calls the formatter directly inside Header (and inside `RestartAffordance` per §5) — a static string, no setInterval refresh. Step 9 polish replaces these call sites with a `<RelTime>` component that periodically re-renders. Both Header and `RestartAffordance` render the timestamp inside a single span so the future swap is a one-line edit per call site, not a reflow.

Single direction: `WorkspaceView` → `TerminalZone` → `TerminalPane/index.tsx` → Header / Footer / Body.

### Inputs `index.tsx` receives

| Input                                                                                        | Source                                                     | Used by                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session: Session`                                                                           | `TerminalZone` (already in scope from `sessions.map(...)`) | Title (`session.name`), agent (via `agentForSession`), pip in awaiting-restart (`session.status`), RelTime (`session.lastActivityAt`), branch + ±changes hook input (`session.workingDirectory`) |
| `cwd: string`                                                                                | TerminalZone — `session.workingDirectory`                  | Body's `useTerminal({ cwd })`. Kept distinct from `session.workingDirectory` for the OSC 7 cwd-update flow that doesn't mutate `Session` until `onCwdChange` fires.                              |
| `isActive: boolean`                                                                          | TerminalZone — `session.id === activeSessionId`            | Gates per-pane git IPC (`useGitBranch`, `useGitStatus`) so hidden panes don't fire requests. Single-pane today: `true` for the active session, `false` for everyone else.                        |
| `mode`, `restoredFrom`, `service`, `shell`, `env`, `onCwdChange`, `onPaneReady`, `onRestart` | TerminalZone (unchanged)                                   | Body's `useTerminal()` (live panes); `<RestartAffordance>` (awaiting-restart)                                                                                                                    |
| `onClose?`                                                                                   | Reserved for step 5 — unset in step 4                      | Header (rendered only when defined)                                                                                                                                                              |

### Derivations inside `index.tsx`

```ts
type PtyStatus = 'idle' | 'running' | 'exited' | 'error'

const agent = agentForSession(session) // 'claude-code' → AGENTS.claude, etc.

const [ptyStatus, setPtyStatus] = useState<PtyStatus>('idle')
const pipStatus: SessionStatus =
  mode === 'awaiting-restart'
    ? session.status
    : ptyStatusToSessionStatus(ptyStatus)

const isPaused = pipStatus === 'paused' // Footer placeholder cue

const [isCollapsed, setIsCollapsed] = useState(false) // header collapse, per-pane local (Q8)

// Both hooks are gated on `isActive` so hidden (display:none) panes don't
// fire IPC. `enabled` is the existing useGitStatus convention; useGitBranch
// mirrors it.
const { branch } = useGitBranch(session.workingDirectory, {
  enabled: isActive,
})
const { files, filesCwd } = useGitStatus(session.workingDirectory, {
  enabled: isActive,
})

// Freshness guard: useGitStatus retains the previous cwd's `files` while a
// new cwd's fetch is in flight. Only aggregate when filesCwd matches the
// session's current cwd to avoid showing stale ±counts after a rename or
// session-switch.
const isFresh = filesCwd === session.workingDirectory
const { added, removed } = isFresh
  ? aggregateLineDelta(files) // pure util in TerminalPane/aggregateLineDelta.ts
  : { added: 0, removed: 0 }

const containerRef = useRef<HTMLDivElement>(null)
const bodyRef = useRef<BodyHandle>(null)
const { isFocused, setFocused, onTerminalFocusChange } = useFocusedPane({
  containerRef,
})

// Live mode: focus xterm + flip isFocused.
// Awaiting-restart mode: bodyRef.current is null (no <Body> rendered), so
// focusTerminal() is a natural no-op via optional chaining; isFocused still
// flips so the chrome's outline + cursor swap reflect the click.
const handleContainerClick = (): void => {
  bodyRef.current?.focusTerminal()
  setFocused(true)
}
```

### Outputs flowing into Header

```ts
<Header
  agent={agent}
  session={session}                  // for name, lastActivityAt
  pipStatus={pipStatus}
  branch={branch ?? null}
  added={added}
  removed={removed}
  isFocused={isFocused}
  isCollapsed={isCollapsed}
  onToggleCollapse={() => setIsCollapsed((c) => !c)}
  onClose={onClose ? () => onClose(session.id) : undefined}
/>
```

> `branch` / `added` / `removed` come from `index.tsx` (single owner of git data fetch + chrome derivations) so Header stays pure and unit-testable without git IPC mocks. The final `HeaderProps` shape is in §2.

### Outputs flowing into Body (live panes only)

```ts
<Body
  ref={bodyRef}
  sessionId={session.id}
  cwd={cwd}
  service={service}
  shell={shell}
  env={env}
  restoredFrom={restoredFrom}
  onCwdChange={onCwdChange}
  onPaneReady={onPaneReady}
  mode={mode}                          // narrowed: index.tsx routes 'awaiting-restart' away from Body
  onPtyStatusChange={setPtyStatus}
  onFocusChange={onTerminalFocusChange}
/>
```

### Outputs flowing into Footer

```ts
const footerPlaceholder =
  mode === 'awaiting-restart'
    ? `session ended — restart to resume ${agent.short.toLowerCase()}`
    : undefined

<Footer
  agent={agent}
  pipStatus={pipStatus}
  isFocused={isFocused}
  isPaused={isPaused}
  onClickFocus={handleContainerClick}
  placeholder={footerPlaceholder}
/>
```

### `aggregateLineDelta` util

Pure aggregation over `useGitStatus().files` so it's unit-testable without React or IPC mocks:

```ts
// TerminalPane/aggregateLineDelta.ts

import type { ChangedFile } from '../../../diff/types' // up 3 levels: TerminalPane → components → terminal → features/

export interface LineDelta {
  added: number
  removed: number
}

// `ChangedFile` shape (from `src/features/diff/types/index.ts`):
// `{ path, status, insertions?: number, deletions?: number, ... }`. Both
// numeric fields are optional — absent when stat counts are unavailable.
export const aggregateLineDelta = (files: ChangedFile[]): LineDelta =>
  files.reduce(
    (acc, f) => ({
      added: acc.added + (f.insertions ?? 0),
      removed: acc.removed + (f.deletions ?? 0),
    }),
    { added: 0, removed: 0 }
  )
```

### Awaiting-restart data flow

Same `session`, `agent`, `branch`, `added`, `removed`, `lastActivityAt` as the live case. `pipStatus` resolves directly to `session.status` (`'completed' | 'errored'`). Body slot is replaced with:

```ts
<RestartAffordance
  agent={agent}
  sessionId={session.id}
  exitedAt={session.lastActivityAt}
  onRestart={onRestart ?? (() => {})}
/>
```

Footer also receives an `placeholder` override in this mode:

```ts
const footerPlaceholder =
  mode === 'awaiting-restart'
    ? `session ended — restart to resume ${agent.short.toLowerCase()}`
    : undefined

<Footer
  agent={agent}
  pipStatus={pipStatus}
  isFocused={isFocused}
  isPaused={isPaused}
  onClickFocus={handleContainerClick}
  placeholder={footerPlaceholder}
/>
```

Footer reuses `handleContainerClick` for `onClickFocus`; in awaiting-restart `bodyRef.current` is null, so `focusTerminal()` is a no-op via optional chaining and only `setFocused(true)` runs — chrome outline + cursor swap reflect the click consistently in both modes.

### Hidden inactive panes

`TerminalZone` already wraps each pane in `<div className={isActive ? '' : 'hidden'} />`. That continues. `useFocusedPane` checks `containerRef.current.offsetWidth > 0` before processing click-outside events on hidden panes, mirroring the existing Body/xterm hidden-container guards.

## §4 Focus model

Single-pane mode = single source of truth for `isFocused`, owned by `index.tsx` via `useFocusedPane`. Step 5 lifts this into a workspace-level `focusedPaneId` (Q1).

### Initial state

`isFocused` starts as **`false`**. The user must click the pane (or xterm gains focus through autofocus on mount) before the focused styling applies. Reasoning:

- Reflects reality: a freshly-mounted pane hasn't been interacted with.
- Lets the pane test the unfocused → focused transition naturally (DoD asks for visual verification of the 180–220 ms timing).
- Existing `TerminalPane.tsx` does **not** call `terminal.focus()` after `xterm.open(container)`, so Body inherited from it won't auto-focus on mount. The pane stays unfocused until the user clicks the container or programmatically focuses xterm. This matches handoff §4.6 ("Click anywhere on the pane → focus it"). If a future iteration wants click-once + first-focus parity (e.g. autofocus on the active session's mount), it adds an explicit `terminal.focus()` call inside Body.tsx; out of scope here.

### State transitions

| Trigger                                               | Source                                                                                 | Effect                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| User clicks anywhere inside `containerRef`            | `<div onClick={handleContainerClick}>` in `index.tsx`                                  | `bodyRef.current?.focusTerminal()` then `setFocused(true)`                                     |
| xterm gains focus (textarea focus, programmatic)      | Body's `onFocusChange(true)` callback → `useFocusedPane.onTerminalFocusChange(true)`   | `setFocused(true)`                                                                             |
| xterm loses focus (tab away, blur event)              | Body's `onFocusChange(false)` callback → `useFocusedPane.onTerminalFocusChange(false)` | `setFocused(false)`                                                                            |
| User clicks anywhere outside `containerRef`           | `mousedown` listener on `document` (added on hook mount, removed on unmount)           | `setFocused(false)` if click target is not contained by `containerRef.current`                 |
| Pane is hidden (`isActive === false` in TerminalZone) | `containerRef.current.offsetWidth === 0`                                               | Click-outside listener early-returns (no state change) — mirrors Body's existing hidden-guards |

### Visual contract (handoff §4.6)

When `isFocused === true`:

- `outline: 2px solid <agent.accent>`
- `outline-offset: -2px`
- `box-shadow: 0 0 0 6px <agent.accentDim>, 0 8px 32px rgba(0,0,0,0.35)`
- Header background: `linear-gradient(180deg, <agent.accentDim>, rgba(13,13,28,0.0))`
- Cursor: `default`

When `isFocused === false`:

- `outline: 1px solid rgba(74,68,79,0.22)`
- `outline-offset: -1px`
- `box-shadow: none`
- Header background: `transparent`
- Cursor: `pointer`

Transition: `outline-color 180ms ease, box-shadow 220ms ease, opacity 220ms ease`. Verbatim from the prototype (`docs/design/handoff/prototype/src/splitview.jsx`, `function TerminalPane`).

### Implementation outline

```ts
// TerminalPane/useFocusedPane.ts

export const useFocusedPane = ({
  containerRef,
  initial = false,
}: UseFocusedPaneOptions): UseFocusedPaneReturn => {
  const [isFocused, setIsFocused] = useState(initial)

  const onTerminalFocusChange = useCallback((focused: boolean): void => {
    setIsFocused(focused)
  }, [])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      const node = containerRef.current
      if (!node) return
      // Hidden-pane guard: don't process clicks against a 0-width pane.
      if (node.offsetWidth === 0) return
      const target = e.target as Node | null
      if (target && !node.contains(target)) {
        setIsFocused(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return (): void => {
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [containerRef])

  return {
    isFocused,
    setFocused: setIsFocused,
    onTerminalFocusChange,
  }
}
```

### What `Body` does for the bridge

```ts
// Inside Body.tsx — added to the existing xterm setup effect.
const onFocusDisposable = newTerminal.onFocus(() => onFocusChange?.(true))
const onBlurDisposable = newTerminal.onBlur(() => onFocusChange?.(false))

// In the cleanup branch:
onFocusDisposable.dispose()
onBlurDisposable.dispose()
```

`forwardRef` exposes the imperative handle:

```ts
useImperativeHandle(
  ref,
  () => ({
    focusTerminal: (): void => {
      const cached = terminalCache.get(sessionId)
      cached?.terminal.focus()
    },
  }),
  [sessionId]
)
```

### Why not lift to WorkspaceView yet?

Step 5 introduces multi-pane, where `focusedPaneId: string | null` becomes the global selector. Refactoring `useFocusedPane` from local to lifted is a known-cheap rename: the hook becomes a thin wrapper that reads `focusedPaneId === paneId` and calls `setFocusedPane(paneId)` from context instead of local `setIsFocused`. The container's `onClick` and the click-outside listener semantics survive verbatim.

### Edge cases

- **Mount with `restoredFrom`**: Body re-attaches xterm via `terminalCache`; xterm's `.open(container)` doesn't fire focus. `isFocused` stays `false` until the user clicks or types.
- **Awaiting-restart**: no Body, no xterm. `bodyRef.current` is null. Click toggles `isFocused`; click-outside still works. Restart click re-mounts Body in the next render via parent state change; new Body's xterm will fire `onFocus` if focused.
- **Multiple panes (future)**: only one pane's container holds focus; click-outside listeners across panes coordinate via the lifted `focusedPaneId` (out of scope for step 4).

## §5 RestartAffordance + awaiting-restart visuals

### Component

```tsx
// TerminalPane/RestartAffordance.tsx (new)

export interface RestartAffordanceProps {
  agent: Agent
  sessionId: string
  exitedAt: string // = session.lastActivityAt
  onRestart: (sessionId: string) => void
}

export const RestartAffordance: (props: RestartAffordanceProps) => ReactElement
```

Renders inside the body slot of `index.tsx` when `mode === 'awaiting-restart'`. Header + Footer stay mounted around it.

### Visual layout

```
┌───────────────────────────────────────────────────┐
│ [∴ CLAUDE] ● auth refactor · feat/jose-auth · …  │  ← Header (unchanged, pip = completed)
├───────────────────────────────────────────────────┤
│                                                   │
│              Session exited.                      │
│              [↻ Restart]                          │  ← RestartAffordance (this section)
│                ended <2m ago>                     │
│                                                   │
├───────────────────────────────────────────────────┤
│ ● > session ended — restart to resume claude      │  ← Footer (placeholder override from index.tsx)
└───────────────────────────────────────────────────┘
```

Body-replacement styling:

- Container: `flex flex-col items-center justify-center gap-3 h-full w-full bg-surface text-on-surface/70`
- Title: `font-mono text-sm` `Session exited.`
- Button: pill, `rounded-pill bg-surface-container px-3 py-1.5 font-label text-sm hover:bg-surface-container/80 focus-visible:ring-2`. Glyph `↻` (Material Symbol `restart_alt`) + label `Restart`. Focus-visible ring uses `agent.accent` at 50% opacity.
- Timestamp: `text-xs text-on-surface/50`. Rendered as `<span>ended {formatRelativeTime(exitedAt)}</span>` — single-span seam so step 9 polish can swap the inner string for a `<RelTime>` component without touching parent layout.

### Footer focusability

The decorative `<input>` element in `Footer.tsx` is **`readOnly` AND `tabIndex={-1}` AND `aria-hidden="true"`**. Without `tabIndex={-1}`, browsers still let users tab to a `readOnly` input — a dead focus target with no editable purpose. Removing it from the tab order matches the prototype's intent (decorative chrome, not an interactive surface) without departing from the prototype's DOM structure.

### Behavior

- Click button → `onRestart(sessionId)`. `useSessionManager.restartSession` runs the **spawn-first, then-kill** sequence: ① `service.spawn({ cwd: cachedCwd, ... })` returns the new sessionId; ② `service.kill({ sessionId: id })` retires the old; ③ `restoreData` is seeded **under the new sessionId** so the new TerminalPane mounts in `mode: 'attach'`. The old sessionId disappears from React state, its TerminalPane unmounts, and Body's existing cleanup effect calls `entry.terminal.dispose()` on the cached xterm — natural ownership, no special-case dispose call in `restartSession`. The new TerminalPane in turn mounts with chrome unchanged + Body re-attached to the fresh PTY.
- `Enter` / `Space` activates the button (native `<button>` behavior). `aria-label={`Restart session ${sessionId}`}` (matches existing TerminalPane.tsx convention so jest-axe + tests pass).

### Footer placeholder for awaiting-restart

`index.tsx` passes a `placeholder` override into `<Footer>` only when `mode === 'awaiting-restart'`:

```ts
// in index.tsx — handed to Footer
const footerPlaceholder =
  mode === 'awaiting-restart'
    ? `session ended — restart to resume ${agent.short.toLowerCase()}`
    : undefined // Footer falls back to its internal derivation
```

When `placeholder` is undefined, Footer derives internally:

```ts
// inside Footer.tsx
const derivedPlaceholder = isFocused
  ? isPaused
    ? 'paused'
    : `message ${agent.short.toLowerCase()}...`
  : `click to focus ${agent.short.toLowerCase()}`

const text = placeholder ?? derivedPlaceholder
```

Future-proofing: a richer placeholder regime (slash-command suggestions, slash-mode hints, errored-with-reason variants) extends by passing more `placeholder` strings from index.tsx — Footer's internal derivation stays the simple three-branch fallback. No structural change required.

### Edge cases

- **Restart fails** (e.g., spawn error): `useSessionManager.restartSession` returns; the session remains `'completed'`. No toast in step 4 (out of scope; tracked separately). Existing console.warn in `restartSession` continues; UI shows the same RestartAffordance again.
- **Cached terminalCache entry**: the old sessionId's TerminalPane unmounts when React drops the entry from `sessions[]`; Body's existing cleanup effect disposes the xterm and removes the entry from `terminalCache` — no explicit `disposeTerminalSession` call from `restartSession`. The new sessionId mounts with no cache entry, creates a fresh xterm. No stale buffer.
- **Hidden awaiting-restart pane** (different active session): chrome renders, body shows RestartAffordance, click events guarded by the `offsetWidth > 0` check in `useFocusedPane`. Clicking restart on a hidden pane is impossible (the container is `display: none`).

## §6 Testing approach

Vitest + Testing Library, `test()` not `it()`, query priority `getByRole` > `getByLabelText` > `getByText` > `getByTestId`, per `rules/typescript/testing/CLAUDE.md`. Test files co-located with sources.

### Per-file test scope

| File                                  | What its test covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | jsdom + xterm?   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `index.test.tsx`                      | Mode branching: `attach` / `spawn` render `<Body>`; `awaiting-restart` renders `<RestartAffordance>` + omits `<Body>`. Header receives correct `agent` (from `agentForSession(session)`), `branch`, `added`/`removed`. Footer receives placeholder override only in awaiting-restart. Container `onClick` fires `bodyRef.current?.focusTerminal()` then `setFocused(true)`. Outline class flips on `isFocused` change. Body is mocked via `vi.mock('./Body', ...)`.                                                 | No (Body mocked) |
| `Header.test.tsx`                     | Agent chip renders `agent.short` + `agent.glyph` styled with `agent.accent`. Status pip renders correct `StatusDot` variant for each `pipStatus`. Title from `session.name`. Branch / `+added` / `−removed` / relative-time hidden when `isCollapsed === true`. `onToggleCollapse` fires on collapse-button click. `onClose` button rendered only when prop is defined. Material Symbols icons verified via `querySelector('.material-symbols-outlined')` per project gotcha.                                       | No               |
| `Body.test.tsx`                       | Inherits the existing `TerminalPane.test.tsx` cases that exercise PTY/xterm wiring (spawn/attach lifecycle, OSC 7, ResizeObserver, terminalCache). Awaiting-restart cases move to `index.test.tsx` (mode branching) and `RestartAffordance.test.tsx` (button render + click). New cases: `onPtyStatusChange` fires for each PTY status transition. `onFocusChange(true)` fires when xterm gains focus. `useImperativeHandle` exposes `focusTerminal()` that calls `terminalCache.get(sessionId)?.terminal.focus()`. | Yes              |
| `Footer.test.tsx`                     | Pip + agent-accent `>` glyph render. Default placeholder derivation: `isFocused && isPaused → 'paused'`, `isFocused && !isPaused → 'message <agent>...'`, `!isFocused → 'click to focus <agent>'`. Override `placeholder` prop replaces derivation. `onClickFocus` fires on container click. Input is `readOnly`.                                                                                                                                                                                                   | No               |
| `RestartAffordance.test.tsx`          | Renders title `"Session exited."` + button labelled `Restart session <id>` + relative-time string from `formatRelativeTime(exitedAt)`. Click button → `onRestart(sessionId)`. Enter / Space activates button. Focus-visible ring uses `agent.accent`.                                                                                                                                                                                                                                                               | No               |
| `useFocusedPane.test.ts`              | Initial state from `initial` option. `setFocused(true/false)` updates state. `onTerminalFocusChange(true/false)` updates state. `mousedown` outside `containerRef` flips state to `false`. `mousedown` inside container is a no-op. `offsetWidth === 0` short-circuits the outside-click handler. Listener cleanup on unmount.                                                                                                                                                                                      | No (jsdom only)  |
| `ptyStatusToSessionStatus.test.ts`    | Pure function: each PTY status maps to the documented SessionStatus value.                                                                                                                                                                                                                                                                                                                                                                                                                                          | No               |
| `aggregateLineDelta.test.ts`          | Empty array → `{ added: 0, removed: 0 }`. Files with `insertions: undefined` / `deletions: undefined` treated as `0` via `?? 0`. Sums across multiple files. Caller is responsible for not passing `null` entries — `useGitStatus().files` is `ChangedFile[]`, never sparse.                                                                                                                                                                                                                                        | No               |
| `useGitBranch.test.ts` (new)          | Mirrors `useGitStatus.test.ts` patterns: skips IPC for `.` / `~` / empty cwd (returns idle). Calls `invoke('git_branch', { cwd })`. Treats empty result as `null`. Refresh fires a re-fetch. Cleanup on unmount cancels in-flight request via mounted-ref pattern.                                                                                                                                                                                                                                                  | No               |
| `src-tauri/src/git/mod.rs` (existing) | Rust unit/integration test for `git_branch`: temp-dir + `git init` (unborn repo) returns the configured default branch via `symbolic-ref --short HEAD`; temp-dir + commit + `git checkout --detach HEAD` returns the empty string; non-repo cwd returns an error string. (Added inline alongside existing `git_status` tests.)                                                                                                                                                                                      | (Rust)           |

### What we deliberately don't test

- Visual transition timing (180–220 ms) — `transition` CSS isn't reliably observable in jsdom. Verified manually per the issue's risk note.
- `formatRelativeTime` itself — already covered in `agent-status/utils/relativeTime.test.ts`.
- `useGitStatus` itself — already covered.
- xterm.js internals — upstream's tests.
- ResizeObserver firing during real layout changes — existing TerminalPane tests use a stub; lifted unchanged into Body tests.
- Integration-style tests pairing chrome + Body — explicit non-goal; chrome is unit-tested with Body mocked, Body is unit-tested in isolation, and the existing E2E suite in `src-tauri/tests/` covers the integrated path.

### Coverage target

`rules/common/testing.md` mandates 80% minimum. Existing `TerminalPane.tsx` coverage is 92.99%. Goal: maintain or improve. Likely improved since chrome subcomponents have less surface area per file.

### Mocking strategy

- `vi.mock('./Body', ...)` inside `index.test.tsx` so chrome tests don't pull in the xterm harness.
- Hook mocks for chrome tests (`index.test.tsx` / `Header.test.tsx`):
  - `vi.mock('../../../diff/hooks/useGitBranch')` (path: `TerminalPane → components → terminal → features → diff/hooks/useGitBranch`).
  - `vi.mock('../../../diff/hooks/useGitStatus')`.
  - These are 3-up paths because the test files live one level deeper than the existing `TerminalPane.tsx` did.
- `agentForSession` is a pure util — called directly, never mocked.
- Tauri `invoke` is **not** globally mocked in `src/test/setup.ts`. Per-test-file convention: `vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))` at the top of each test that crosses the IPC boundary, mirroring `useGitStatus.test.ts` and `tauriTerminalService.test.ts`. Specifically: `useGitBranch.test.ts` mocks invoke; chrome tests don't (Body is mocked in `index.test.tsx`, hooks mocked in `Header.test.tsx`).
- xterm in Body tests reuses the existing mock pattern from `TerminalPane.test.tsx`.

### Pre-push gate

`pre-push` hook runs `vitest run`. Type-check via `tsc -b` runs in CI. `npm run lint` enforces the `test()` not `it()` rule and the `no-console` rule. All must be green before merge.

## §7 Migration mechanics, risks, references

### Migration commit shape

The work lands as a single PR (#163). Suggested commit slicing within that PR for reviewability:

1. `feat(terminal): add git_branch IPC + useGitBranch hook` — Rust command, ts-rs binding, hook + tests. Tauri shape change isolated. Ships green on its own (no consumers yet).
2. `refactor(terminal): split TerminalPane.tsx into TerminalPane/ folder` — verbatim move of xterm wiring into `Body.tsx`; `index.tsx` becomes a thin pass-through that renders only `<Body>`. No chrome yet. Existing tests adapt to the new path. Visual: unchanged.
3. `feat(terminal): wire chrome (Header, Footer, useFocusedPane, RestartAffordance)` — adds chrome, adds `session: Session` to `TerminalPaneProps`, `TerminalZone` passes it. Visual: matches handoff §4.6.
4. `chore(terminal): tighten test split + coverage` — moves awaiting-restart cases into the right test files; adds new chrome tests. (May be folded into commit 3 if light.)

### Backward-compat concerns

- **Existing imports of `TerminalPane`**: TS module resolution makes `'../../terminal/components/TerminalPane'` resolve to `TerminalPane/index.tsx`. Zero consumer churn.
- **Existing imports of `terminalCache` / `clearTerminalCache` / `disposeTerminalSession` / `TerminalPaneMode`**: re-exported by `index.tsx`. Zero consumer churn.
- **`TerminalZone.tsx`**: gains one prop on its `<TerminalPane>` JSX (`session={session}`). One-line additive change.
- **`useSessionManager.ts`**: untouched.
- **Tests pinned at the old path** (`terminal/components/TerminalPane.test.tsx`): rename to `terminal/components/TerminalPane/Body.test.tsx` for PTY/xterm cases; awaiting-restart cases extract to `index.test.tsx` + `RestartAffordance.test.tsx` per §6. Test data and assertions transfer verbatim.

### Risks & mitigations

| Risk                                                                                                                                                  | Mitigation                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focus-ring transition timing (180–220 ms) — can't be jsdom-tested                                                                                     | Manual verification per the issue's risk note. Capture a short demo recording (akin to `docs/media/hero-init.gif`) showing focus / blur / re-focus.                                                                                                                         |
| `forwardRef` + `useImperativeHandle` in `Body.tsx` is new for this PR                                                                                 | Pattern is standard React 19; covered by Body's unit tests. If reviewers prefer a callback-ref alternative, swap is mechanical — `focusTerminal` is one method.                                                                                                             |
| `git_branch` Rust command edge cases (detached HEAD, unborn repo, non-repo cwd) might leak as "branch?" labels                                        | Rust integration test enumerates the three edge cases; hook treats empty string + null uniformly as "no branch", so Header simply omits the branch segment. No `branch?` placeholder ever rendered.                                                                         |
| Branch + ±changes hooks running per pane — IPC pressure                                                                                               | Single-pane today: 1×`useGitBranch` + 1×`useGitStatus` per active session. Both are observable + cached in Rust. Step 5 multi-pane multiplies by N but the watchers de-duplicate in the existing git-watcher. Re-evaluate at step 5 if measurable cost.                     |
| Body's xterm setup effect dependency change (now includes `onPtyStatusChange` / `onFocusChange` callbacks) — risk of recreating xterm on every render | Wrap callbacks in stable refs (the existing `resizeRef` pattern, lines 188–199 of current TerminalPane.tsx) so the xterm-creation effect's dependency array stays narrow. New ref per callback. Existing tests cover the "terminal not recreated on prop change" invariant. |
| Chrome adds DOM nodes around xterm — may shift xterm's container size by a few pixels                                                                 | Existing ResizeObserver in Body re-fits xterm whenever its container changes size. No coordination needed; verified via the existing resize-resilience tests.                                                                                                               |
| Old TerminalPane.tsx file deletion may break import paths in stale branches                                                                           | Out of merge order. PR explicitly deletes the old file; rebase conflicts (if any) resolve to the new TerminalPane/ folder.                                                                                                                                                  |

### Out of scope (explicit non-ports)

- Multi-pane orchestration / SplitView / `focusedPaneId` lifted state — **step 5**.
- Functional input footer (PTY-stdin submit on Enter) — explicit non-goal; xterm remains the input surface.
- "Close pane" semantics distinct from "close session" — **step 5** (defines the distinction).
- Step 9 polish: ticking `<RelTime>` component, ContextSmiley wiring, full status-bar contents.
- Pixel-perfect StatusDot `idle` tone (deferred — see Open Question §pip-parity).
- Session manager exit-status mapping (`'errored'` for non-zero exit) — see Open Question §exit-status.
- Toast notifications on restart spawn failure.
- Any change to `useSessionManager`, `TerminalZone`'s session loop, or the Rust PTY lifecycle.

### References

- Issue: [#163 — Step 4 Single TerminalPane (handoff §4.6)](https://github.com/winoooops/vimeflow/issues/163)
- Migration spec: `docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md`
- Visual spec: `docs/design/handoff/README.md` §4.6 (TerminalPane), §5.3 (pane lifecycle), §5.5 (terminal narrative streaming), §6 (tokens / agent registry)
- Visual reference (prototype): `docs/design/handoff/prototype/src/splitview.jsx` `function TerminalPane`
- Existing implementation: `src/features/terminal/components/TerminalPane.tsx` (the file this PR refactors)
- Agent registry: `src/agents/registry.ts`, `src/features/sessions/utils/agentForSession.ts`
- StatusDot primitive: `src/features/sessions/components/StatusDot.tsx`
- Relative-time formatter (pure): `src/features/agent-status/utils/relativeTime.ts`
- useTerminal hook: `src/features/terminal/hooks/useTerminal.ts`
- Sibling pattern reference (`Tab.tsx` consuming agent registry): `src/features/sessions/components/Tab.tsx`
- Rules: `rules/typescript/coding-style/CLAUDE.md`, `rules/typescript/testing/CLAUDE.md`, `rules/common/coding-style/CLAUDE.md`
- Roadmap entry: `docs/roadmap/progress.yaml` (`ui-handoff-migration / ui-s4`)

<!-- codex-reviewed: 2026-05-09T03:26:07Z -->
