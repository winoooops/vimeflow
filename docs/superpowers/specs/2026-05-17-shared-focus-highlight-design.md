# Shared Focus Highlight — Design Spec

**Date:** 2026-05-17  
**Branch:** `feat/shared-focus-highlight`  
**Status:** Approved

---

## 1. Problem

Border highlights (colored ring + glow + opacity dim) currently exist only between terminal panes inside a single session. The Dock panel (editor + diff viewer) has no focus concept. Before keyboard shortcuts for expand/shrink can target the correct panel, the workspace needs a concept of an _active container_ — which major resizable section of the layout currently has user intent.

---

## 2. Scope

This PR:

- Introduces `activeContainerId` state to `WorkspaceView`
- Adds visual focus treatment to `DockPanel` (mauve highlight)
- Adds visual dim treatment to `TerminalZone` when dock is active
- Wires focus transfer via click (pointer down) and keyboard shortcuts
- Adds new shortcuts: `Ctrl+e` (jump to editor), `Ctrl+g` (jump to diff), `Ctrl+b` (return to terminal — dock only)
- Side-effects `Ctrl+1-4` to claim terminal container focus
- Adds `useDockShortcuts` hook

Out of scope:

- Expand/shrink keyboard shortcuts (follow-on PR)
- Sidebar / activity panel as focusable containers
- Any change to per-pane `Pane.active` terminal focus logic

---

## 3. State model

### 3.1 Container IDs

Constants live in a dedicated module so both `WorkspaceView` and `useDockShortcuts` can import them without a dependency cycle:

**`src/features/workspace/containerIds.ts`**

```ts
export const TERMINAL_CONTAINER_ID = 'terminal' as const
export const DOCK_CONTAINER_ID = 'dock' as const

export type FocusTarget = 'terminal' | 'editor' | 'diff'
```

`FocusTarget` is exported from this module so `WorkspaceView`, `useDockShortcuts`, and their tests can import it without coupling to each other. The container ID type is `string` — extensible without a union update when more containers are added.

### 3.2 WorkspaceView state

```ts
const [activeContainerId, setActiveContainerId] = useState<string>(
  TERMINAL_CONTAINER_ID
)
```

Default: `TERMINAL_CONTAINER_ID` — terminal is the primary view.

**Reset rule:** when dock closes (`setIsDockOpen(false)`), also call `setActiveContainerId(TERMINAL_CONTAINER_ID)`.

### 3.3 Derived props passed to children

```ts
// TerminalZone
isZoneFocused={activeContainerId === TERMINAL_CONTAINER_ID}

// DockPanel
isFocused={activeContainerId === DOCK_CONTAINER_ID}
```

Children receive a `boolean`; they do not know their own container ID.

---

## 4. Visual treatment

### 4.1 DockPanel — focused (`isFocused=true`)

Accent color: `#cba6f7` (Catppuccin Mocha mauve / design-system primary). Fixed — not tied to any agent.

| Layer             | Unfocused (current)                 | Focused                                                                                                                                 |
| ----------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Junction border   | `1px solid rgba(74,68,79,0.3)`      | `1px solid #cba6f7` (width unchanged — avoids layout jitter)                                                                            |
| Container shadow  | none                                | `0 0 0 1px #cba6f7 inset, 0 0 0 6px rgba(203,166,247,0.12)` — inset ring reinforces the border visually without changing box dimensions |
| DockTab header bg | `bg-[#0d0d1c]` (current, unchanged) | `bg-[#0d0d1c]` + `rgba(203,166,247,0.05)` overlay                                                                                       |

Transitions: `180ms ease` on border, `220ms ease` on shadow — same timing as `TerminalPane`.

The junction border is the edge that faces the terminal zone:

- bottom dock → `border-top`
- top dock → `border-bottom`
- left dock → `border-right`
- right dock → `border-left`

### 4.2 TerminalZone — unfocused (`isZoneFocused=false`)

The outer `<div>` of `TerminalZone` gets:

```
opacity: 0.65
transition: opacity 220ms ease
```

The per-pane `Pane.active` highlight (colored border + glow) is **not changed** — it lives inside the dimmed wrapper and restores visually the moment `isZoneFocused` returns to `true`.

### 4.3 Unchanged states

- `TerminalZone` focused: current appearance, no change
- `DockPanel` unfocused: current neutral border, no change

---

## 5. Focus transfer

### 5.1 Click

`onPointerDown` on the outer wrapper of each zone calls the parent callback (no-arg) to update `activeContainerId`. **Each component** (`TerminalZone`, `DockPanel`) also handles the focus-wrapper logic internally: when the click target is non-interactive, the component calls `.focus()` on its own wrapper element. This keeps the parent callback no-arg and the focus logic co-located with the element that needs it.

```ts
// Inside TerminalZone/DockPanel onPointerDown:
onContainerPointerDown?.() // notify parent — no-arg
const target = e.target as Element
if (
  !target.closest(
    'button,input,textarea,a,select,[tabindex]:not([tabindex="-1"])'
  )
) {
  ;(e.currentTarget as HTMLElement).focus()
}
```

The selector excludes `tabindex="-1"` elements (programmatic-only fallback containers) so that clicking a `<div tabIndex={-1}>` inside the dock (e.g., the diff wrapper) still triggers the section focus.

**Keyboard / programmatic focus:** a `focusin` listener (bubbles) on each zone wrapper calls `setActiveContainerId` whenever real DOM focus enters the zone from any path — Tab key, programmatic `.focus()`, or assistive technology. This keeps `activeContainerId` in sync even when the pointer is not involved. The `focusin` handler is the same as the `onPointerDown` callback (`onContainerPointerDown`) — `WorkspaceView` supplies a single closure for both events.

- `onPointerDown` inside `<TerminalZone>` wrapper → `setActiveContainerId(TERMINAL_CONTAINER_ID)`
- `onPointerDown` inside `<DockPanel>` wrapper → parent callback `onContainerFocus()` (no-arg) + component-internal conditional focus (see §5.1 pattern). `DockPanel` handles its own `.focus()` logic.
- **Dock tab button click** → `WorkspaceView`'s `onTabChange(next)` handler calls `setDockTab(next)` + `setActiveContainerId(DOCK_CONTAINER_ID)`. No `requestFocus` — the tab button's own `onClick` naturally receives focus, and the new panel content renders after the state update.
- `DockPeekButton` open → calls `openDock()`. `openDock()` calls `requestFocus(...)` internally because the dock was not visible and no element received natural click focus.

`Ctrl+b`'s zone check remains reliable because any click inside the dock sets `activeContainerId` to `DOCK_CONTAINER_ID` via `onPointerDown` before the key handler fires.

**Session tab / sidebar session clicks / new session creation / command-palette session commands:** all of these express terminal intent. Every path that changes the active session (session tab click, sidebar list selection, new session creation, command-palette `:new`/`:next`/`:previous`/`:goto` session commands) flows through `WorkspaceView` state setters. The `setActiveSessionId` handler calls `setActiveContainerId(TERMINAL_CONTAINER_ID)` and `requestFocus('terminal')`. For **new session creation** (`addSession`): session spawn is async (goes through the session manager and IPC); the new pane may not be mounted by the time the focus request fires. Implementation should treat this as best-effort: if `focusActivePane()` fails (returns `false`), no retry is scheduled — the user may need to click the terminal. A future improvement could watch for `activeSessionId` changes in `TerminalZone` and re-attempt focus when the new session's `SplitView` mounts, but that is out of scope for this PR. This covers: clicking a tab after dock focus, selecting from sidebar after dock focus, and creating a new session while dock is active.

### 5.2 Keyboard shortcuts

New hook: `useDockShortcuts` (see §6.3).

| Shortcut             | Action                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Ctrl+1-4` / `⌘+1-4` | See §6.4 for the authoritative truth table. Summary: consumed when (a) dock-reclaim (double-guarded) or (b) terminal pane switch to a different pane (works from sidebar too — intentional). Pass-through when pane already active. Never from dialogs.                                                                                          |
| `Ctrl+\` / `⌘+\`     | Rotate terminal pane layout (existing, **unchanged**)                                                                                                                                                                                                                                                                                            |
| `Ctrl+e` / `⌘+e`     | Jump to editor tab: `setDockTab('editor')` + `setActiveContainerId(DOCK_CONTAINER_ID)` + open dock if closed                                                                                                                                                                                                                                     |
| `Ctrl+g` / `⌘+g`     | Jump to diff tab: `setDockTab('diff')` + `setActiveContainerId(DOCK_CONTAINER_ID)` + open dock if closed                                                                                                                                                                                                                                         |
| `Ctrl+b` / `⌘+b`     | Return to terminal: claims `TERMINAL_CONTAINER_ID`. **Only fires when `activeContainerId === DOCK_CONTAINER_ID` AND `document.activeElement` is inside `[data-container-id="dock"]`** — double-guarded to prevent stale state (e.g. sidebar focus after dock was last active) from stealing the key. From the terminal, passes through to xterm. |

**Terminal steal policy (authoritative):**

- `Ctrl+1-4` — dock-reclaim is double-guarded (dock active AND `activeElement` in dock). Terminal pane switching from any context (including sidebar) is intentional and consumes the key. Never fires from dialogs. Full truth table in §6.4.
- `Ctrl+e`, `Ctrl+g` — capture-phase; globally stolen including from xterm. Users who need readline end-of-line / abort must use the mouse.
- `Ctrl+b` — NOT stolen from terminal zone. Only fires when `activeContainerId === DOCK_CONTAINER_ID` AND `document.activeElement` inside dock panel (double-guarded).

`Ctrl+b` does **not** close the dock. It only moves container focus from dock → terminal.

#### DOM focus transfer — version-counter state + `useLayoutEffect`

React state updates are batched; calling a focus helper immediately after `setState` reads stale state and may target unmounted DOM (e.g., a just-opened dock). Ref writes alone do not schedule re-renders, so `pendingFocusTarget` alone can't guarantee a `useLayoutEffect` fires. The correct pattern:

1. A **`requestFocus(target: FocusTarget)`** helper in `WorkspaceView` increments a `focusRequestSeq` state counter AND writes to `pendingFocusTarget` ref. Incrementing the counter guarantees a re-render even when no other state changes (e.g., repeat `Ctrl+e` while dock is already on editor tab).

2. `useLayoutEffect(..., [focusRequestSeq])` fires after every render caused by a focus request, reads the ref, calls the appropriate focus helper, and clears the ref.

```ts
// FocusTarget imported from src/features/workspace/containerIds.ts
const pendingFocusTarget = useRef<FocusTarget | null>(null)
const [focusRequestSeq, setFocusRequestSeq] = useState(0)

const requestFocus = useCallback((target: FocusTarget): void => {
  pendingFocusTarget.current = target
  setFocusRequestSeq((n) => n + 1)
}, [])

useLayoutEffect(() => {
  const target = pendingFocusTarget.current
  if (!target) return
  pendingFocusTarget.current = null
  if (target === 'terminal') terminalZoneRef.current?.focusActivePane()
  if (target === 'editor') dockPanelRef.current?.focusEditor()
  if (target === 'diff') dockPanelRef.current?.focusDiff()
}, [focusRequestSeq])
```

This handles both "already mounted" (re-focus on repeat press) and "just opened" (dock mounts before `useLayoutEffect` fires) cases.

#### Ref chain

| Ref               | What it holds                    | How exposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `terminalZoneRef` | `TerminalZone` imperative handle | `forwardRef` + `useImperativeHandle` on `TerminalZone` exposing `{ focusActivePane(): boolean }`. `TerminalZone` maintains an `activeSplitViewRef` typed as `React.RefObject<SplitViewHandle>` and attaches it directly to `<SplitView ref={isActive ? activeSplitViewRef : null}>` (the `SplitView` component, not the session wrapper div) — this exposes `SplitView`'s imperative handle, not a DOM node. `SplitView` must have `forwardRef`. `TerminalZone.focusActivePane()`: (a) if `activeSplitViewRef.current` is null → focus `TerminalZone` outer div, return `false`; (b) call `activeSplitViewRef.current.focusActivePane()`; if it returns `false` → also focus `TerminalZone` outer div. `SplitView.focusActivePane()`: call active `TerminalPane`'s `focusTerminal(): boolean`; if `false` → focus `SplitView` outer `<div tabIndex={-1}>`, return `false`. `TerminalPane.focusTerminal()`: returns `true` if xterm body focused, `false` if not ready. |
| `dockPanelRef`    | `DockPanel` imperative handle    | `forwardRef` + `useImperativeHandle` on `DockPanel`; exposes `focusEditor()` (CodeMirror `EditorView.focus()`) and `focusDiff()` (diff root `tabIndex={-1}` div `.focus()`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

`CodeEditor` exposes `focus(): boolean` via `useImperativeHandle` — returns `true` if `editorView` exists and was focused, `false` if `editorView` is null (no file). `DockPanel.focusEditor()` checks the return: if `false`, falls back to focusing the dock container `<section>` (`tabIndex={-1}`).

**Auto-focus gate:** `CodeEditor` receives a new `shouldAutoFocus?: boolean` prop (default `false`; `DockPanel` passes `isFocused`). This intentionally prevents CodeMirror from stealing focus when a file is opened/selected from the sidebar while `activeContainerId` is `'terminal'` — the file loads into the editor buffer silently; the user uses `Ctrl+e` to switch. `useCodeMirror` already calls `view.focus()` on mount/file-path changes — some paths use `requestAnimationFrame`. The gate must use a **ref** (not the prop value directly captured in a closure) so the check is evaluated at execution time, not at scheduling time:

```ts
// Write synchronously during render — always current when any callback fires
const shouldAutoFocusRef = useRef(shouldAutoFocus)
shouldAutoFocusRef.current = shouldAutoFocus

// Inside useCodeMirror's automatic focus paths ONLY (on-mount, file-path change):
if (!shouldAutoFocusRef.current) return
view.focus()
```

This guard applies **only to the automatic/scheduled `view.focus()` paths** inside `useCodeMirror`: (a) on mount, (b) on file-path change, (c) inside `updateContent()` which is called by `CodeEditor` on content/prop sync and may also call `view.focus()`. All three paths must check `shouldAutoFocusRef.current`. It does NOT apply to the imperative `CodeEditor.focus()` method — which is called by `DockPanel.focusEditor()` in response to explicit user actions (`Ctrl+e`, `Ctrl+g`) where focus is intentionally moved to the editor from any zone.

The render-time ref write is sufficient: when `isFocused` becomes `false` (user leaves dock), `shouldAutoFocusRef.current` is updated before the next RAF fires, preventing stale auto-focus.

For diff: `DockPanel` wraps `<DiffPanelContent>` in a stable `<div ref={diffWrapperRef} tabIndex={-1}>`. `DockPanel.focusDiff()` calls `diffWrapperRef.current?.focus()`. This guarantees focusability regardless of which render branch `DiffPanelContent` is in (loading / empty / populated).

| Shortcut / action    | State mutation                                                    | `requestFocus()` called with                             |
| -------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `Ctrl+1-4`           | via `onTerminalZoneFocus()` when appropriate per §6.4 truth table | `'terminal'` — `onTerminalZoneFocus` always calls it     |
| `Ctrl+e`             | `openDock('editor')`                                              | `'editor'`                                               |
| `Ctrl+g`             | `openDock('diff')`                                                | `'diff'`                                                 |
| `Ctrl+b` (dock only) | `claimTerminal()`                                                 | `'terminal'`                                             |
| Click terminal zone  | `setActiveContainerId(TERMINAL_CONTAINER_ID)`                     | — (natural click focus)                                  |
| Click dock           | `setActiveContainerId(DOCK_CONTAINER_ID)`                         | — (natural click focus)                                  |
| Peek button open     | `openDock()`                                                      | `'editor'` or `'diff'` per `dockTab` (inside `openDock`) |
| Dock close button    | `closeDock()`                                                     | `'terminal'` (inside `closeDock`)                        |

### 5.3 Toolbar hint update

The keyboard hint strip inside `TerminalZone`'s layout toolbar updates from:

```
Ctrl+\ cycle
```

to:

```
{modKey}+1-4 pane · {modKey}+\ layout · {modKey}+e editor · {modKey}+g diff · {modKey}+b back
```

(rendered with the platform `modKey` — `⌘` on macOS, `Ctrl` elsewhere, matching the existing hint pattern; `{modKey}+\` is restored to keep the existing layout-rotation shortcut discoverable)

---

## 6. Component / hook changes

### 6.1 `TerminalZone`

New optional props (defaults preserve current behaviour):

```ts
isZoneFocused?: boolean          // default: true — drives opacity dim
onContainerPointerDown?: () => void  // called from onPointerDown on outer div
```

The outer `<div data-testid="terminal-zone" data-container-id="terminal">` gains:

- `tabIndex={-1}` — makes the wrapper programmatically focusable (fallback target)
- Opacity + transition applied unconditionally for smooth fade both ways: `${!isZoneFocused ? 'opacity-[0.65]' : 'opacity-100'} transition-opacity duration-[220ms]`
- `onPointerDown` internally: calls `onContainerPointerDown?.()` (no-arg, notifies WorkspaceView) + component-internal conditional `.focus()` (same pattern as shown in §5.1)
- `onFocus` (bubbling) → also calls `onContainerPointerDown` so Tab/programmatic DOM focus into any terminal-zone child claims terminal container focus

### 6.2 `DockPanel`

New optional prop (default preserves current behaviour):

```ts
isFocused?: boolean  // default: false
```

- `borderClass` logic extended: focused → only the color changes, width stays at `1px`. For example, bottom dock: unfocused = `border-t border-t-[rgba(74,68,79,0.3)]` → focused = `border-t border-t-[#cba6f7]`. Only the junction edge's color changes — no width change, no layout jitter.
- Container `<section>` gains `boxShadow` via inline style when focused: `0 0 0 1px #cba6f7 inset, 0 0 0 6px rgba(203,166,247,0.12)` — the inset ring adds visual depth without affecting box dimensions.
- `DockTab` header `<div>` gains `rgba(203,166,247,0.05)` background when focused

Outer `<section data-testid="dock-panel" data-container-id="dock">` (gets `tabIndex={-1}`) gains:

- `onFocus` (bubbling) → `onContainerFocus?.()` — keeps `activeContainerId` in sync when Tab or programmatic focus enters the dock
- `onPointerDown` (internal, not exposed as prop) — calls `onContainerFocus?.()` then conditionally focuses its own wrapper:
  ```ts
  onContainerFocus?.()
  if (
    !e.target.closest(
      'button,input,textarea,a,select,[tabindex]:not([tabindex="-1"])'
    )
  ) {
    sectionRef.current?.focus()
  }
  ```

`onContainerFocus?: () => void` is the caller-provided callback; `WorkspaceView` supplies `() => setActiveContainerId(DOCK_CONTAINER_ID)`.

### 6.3 New: `useDockShortcuts`

Location: `src/features/workspace/hooks/useDockShortcuts.ts`

```ts
interface UseDockShortcutsParams {
  activeContainerId: string
  openDock: (tab: 'editor' | 'diff') => void // sets state + activeContainerId + calls requestFocus internally
  claimTerminal: () => void // sets activeContainerId to terminal + calls requestFocus internally
  modKey: '⌘' | 'Ctrl'
}
```

The hook stores `activeContainerId` in a latest-value ref (written during render, same pattern as `shouldAutoFocusRef`) so the capture-phase keydown handler always reads the current value, avoiding stale-closure bugs:

```ts
const activeContainerIdRef = useRef(activeContainerId)
activeContainerIdRef.current = activeContainerId
// handler reads activeContainerIdRef.current, not the closed-over prop
```

Attaches a `keydown` listener in **capture phase** (`addEventListener('keydown', handler, true)`) for `e`, `g`, `b` with the platform modifier. Capture phase is required so the handler runs before target-level handlers in xterm and CodeMirror; a bubble-phase listener would fire after those handlers and `preventDefault` / `stopPropagation` would have no effect on them.

**Modifier check:** `modKey === '⌘'` → check `e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey`; `modKey === 'Ctrl'` → check `e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey`. Requiring the absence of Shift and Alt prevents accidentally handling `Ctrl+Shift+E`, `Ctrl+Alt+G`, etc. This is the specified policy for dock shortcuts; it may differ from `usePaneShortcuts` (which may allow Shift/Alt for non-US layout compatibility) — implementors should not assume identity between the two hooks.

**Input guard — exact rule:**

```ts
// Fall back to document.activeElement for document-dispatched events (e.g. test suites)
const target: Element =
  e.target instanceof Element
    ? e.target
    : (document.activeElement ?? document.body)
// Never fire when any open modal is visible (regardless of where focus is)
if (
  document.querySelector(
    '[role="dialog"]:not([hidden]):not([aria-hidden="true"]),[role="alertdialog"]:not([hidden]):not([aria-hidden="true"])'
  )
)
  return
const inTerminalZone = !!target.closest('[data-container-id="terminal"]')
const inCodeMirror = !!target.closest('.cm-editor')
// Use closest() for ancestor checks so nested contenteditable/textbox widgets are caught
const isTextEntry =
  !!target.closest('input, textarea') ||
  (!inCodeMirror &&
    !!(
      target.closest('[contenteditable]') || target.closest('[role="textbox"]')
    ))
if (isTextEntry && !inTerminalZone) return
```

Fires from: xterm's internal `<textarea>` (inside terminal zone), CodeMirror content (inside `.cm-editor`), non-text-entry areas of the dock.
Suppressed from: `<input>` / `<textarea>` outside the terminal zone; `contenteditable` / `role=textbox` ancestors that are not CodeMirror; any open visible dialog (detected via `document.querySelector('[role="dialog"]:not([hidden]):not([aria-hidden="true"]),...')`).
**Modal detection limitation:** React portals and CSS-toggled modals may not use `hidden` or `aria-hidden`. Implementors should verify the dialog guard against the command palette implementation. If the palette or other modals use a different open-state mechanism, add their selectors or use a broader focus-trap check.
**Dock-local text inputs** (e.g., a future search field inside the dock): also suppressed — the `closest('input,textarea')` guard already covers them since they are outside the terminal zone.

**Event cancellation:** every handled shortcut must call both `e.preventDefault()` and `e.stopPropagation()` to prevent bubble-through to CodeMirror key bindings, xterm, or Electron/browser accelerators — matching the existing `usePaneShortcuts` pattern.

### 6.4 `usePaneShortcuts`

Add optional no-arg callback (no-arg avoids importing workspace-layer constants into the terminal feature):

```ts
onTerminalZoneFocus?: () => void
```

The second optional param mirrors to a latest-value ref (same pattern as `useDockShortcuts`):

```ts
isTerminalContainerActive?: boolean  // WorkspaceView passes activeContainerId === TERMINAL_CONTAINER_ID

const isTerminalContainerActiveRef = useRef(isTerminalContainerActive)
isTerminalContainerActiveRef.current = isTerminalContainerActive
```

When `onTerminalZoneFocus` or `isTerminalContainerActive` is not provided (existing callers), existing pane-switch behavior is unchanged. When both are provided by `WorkspaceView`, the following **authoritative truth table** applies (evaluated top-to-bottom, first match wins). Only `Digit1`–`Digit4` codes are affected; `Ctrl+\` is not.

| Condition                                                                                                                                                    | Consumes key? | Action                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------ |
| `document.querySelector('[role="dialog"]:not([hidden]):not([aria-hidden="true"]),[role="alertdialog"]:not([hidden]):not([aria-hidden="true"])')` is non-null | No            | Pass through — exact same selector as `useDockShortcuts` guard                                   |
| `isTerminalContainerActive === false` AND `document.activeElement` inside `[data-container-id="dock"]`                                                       | Yes           | `onTerminalZoneFocus()` + focus pane N if it exists (else fallback)                              |
| `isTerminalContainerActive === false` (stale state, not in dock)                                                                                             | No            | Pass through                                                                                     |
| `isTerminalContainerActive === true` AND pane N already active AND `document.activeElement` inside `.xterm-helper-textarea`                                  | No            | Pass through — xterm has focus, key reaches terminal app directly                                |
| `isTerminalContainerActive === true` AND pane N already active AND `document.activeElement` NOT inside `.xterm-helper-textarea`                              | Yes           | `onTerminalZoneFocus()` + consume — restores xterm focus whether from terminal chrome or sidebar |
| `isTerminalContainerActive === true` AND pane N differs                                                                                                      | Yes           | Focus pane N (existing behavior — works from sidebar, intentional)                               |

### 6.5 `WorkspaceView`

**New `openDock()` helper** — replaces all direct `setIsDockOpen(true)` call sites so every dock-open path consistently claims dock focus:

```ts
const openDock = useCallback(
  (tab?: TabType): void => {
    const nextTab = tab ?? dockTab
    if (tab) setDockTab(tab)
    setIsDockOpen(true)
    setActiveContainerId(DOCK_CONTAINER_ID)
    requestFocus(nextTab === 'editor' ? 'editor' : 'diff')
  },
  [dockTab, requestFocus]
)
```

Existing call sites that call `setIsDockOpen(true)` directly (e.g., `handleOpenDiff`, peek button, `Ctrl+e`, `Ctrl+g`) all migrate to `openDock()`. `Ctrl+b` does **not** call `openDock()` — it calls `claimTerminal()` only.

**Dock close** — a `closeDock()` helper mirrors it:

```ts
const claimTerminal = useCallback((): void => {
  setActiveContainerId(TERMINAL_CONTAINER_ID)
  requestFocus('terminal')
}, [requestFocus])

const closeDock = useCallback((): void => {
  setIsDockOpen(false)
  claimTerminal()
}, [claimTerminal])
```

**Session-intent wrappers** — every path that expresses terminal intent must call `claimTerminal()`. `WorkspaceView` wraps:

```ts
const handleSetActiveSessionId = useCallback(
  (id: string): void => {
    setActiveSessionId(id)
    claimTerminal()
  },
  [claimTerminal]
)

const handleAddSession = useCallback(
  (...args): void => {
    addSession(...args)
    claimTerminal()
  },
  [claimTerminal]
)
```

Additionally, the **remove/close** path also wraps:

```ts
const handleRemoveSession = useCallback(
  (sessionId: string): void => {
    const wasActive = sessionId === activeSessionId
    removeSession(sessionId)
    if (wasActive) claimTerminal() // active session closed — return focus to terminal
  },
  [activeSessionId, claimTerminal]
)
```

These wrappers replace direct calls in session tab clicks, sidebar selection, new-session button, tab-close button, and command-palette session commands (`:new`, `:next`, `:previous`, `:goto`, `:close`).

Other changes:

- Adds `activeContainerId` / `setActiveContainerId` state
- Adds `pendingFocusTarget` ref + `useLayoutEffect` (see §5.2 DOM focus section)
- Attaches `terminalZoneRef` and `dockPanelRef` to the respective components
- Passes `isZoneFocused` to `<TerminalZone>`
- Passes `isFocused` + `onContainerFocus` to `<DockPanel>`
- Calls `useDockShortcuts`, passing `activeContainerId` so `Ctrl+b` can check current zone
- Passes `onTerminalZoneFocus` to `usePaneShortcuts`:

  ```ts
  const activeContainerIdRef = useRef(activeContainerId)
  activeContainerIdRef.current = activeContainerId // sync during render

  const onTerminalZoneFocus = useCallback((): void => {
    setActiveContainerId(TERMINAL_CONTAINER_ID)
    requestFocus('terminal') // always — harmless when already active, correct for sidebar restore
  }, [requestFocus])
  ```

---

## 7. Testing plan

### Unit tests

**`DockPanel.test.tsx`** (existing file):

- `isFocused=true` → container has mauve border class and box-shadow style
- `isFocused=false` → container has neutral border class, no shadow

**`TerminalZone.test.tsx`** (existing file):

- `isZoneFocused=false` → outer div has opacity dim class
- `isZoneFocused=true` (default) → outer div does not have dim class

**New: `useDockShortcuts.test.ts`**:

- `Ctrl+e` → `openDock('editor')` called
- `Ctrl+g` → `openDock('diff')` called
- `Ctrl+b` when `activeContainerId === DOCK_CONTAINER_ID` AND `document.activeElement` inside `[data-container-id="dock"]` → `claimTerminal()` called
- `Ctrl+b` when `activeContainerId === DOCK_CONTAINER_ID` BUT `document.activeElement` NOT inside `[data-container-id="dock"]` (stale state, e.g. sidebar focus) → no-op
- `Ctrl+b` when `activeContainerId === TERMINAL_CONTAINER_ID` → neither `claimTerminal()` nor `openDock()` called
- No-op when modifier not held

**`usePaneShortcuts.test.ts`** (existing file):

- `Ctrl+1-4` from dock (mock `isTerminalContainerActive: false`, `activeElement` in dock): `onTerminalZoneFocus()` called, key consumed
- `Ctrl+1-4` from dock (mock `isTerminalContainerActive: false`, `activeElement` NOT in dock): `onTerminalZoneFocus()` NOT called, key passes through
- `Ctrl+1-4` in dialog (any container): `onTerminalZoneFocus()` NOT called, key passes through
- `Ctrl+1-4` terminal-active + already-active pane + `activeElement` in terminal zone: `onTerminalZoneFocus()` NOT called, key passes through
- `Ctrl+1-4` terminal-active + already-active pane + `activeElement` NOT in terminal zone (sidebar): `onTerminalZoneFocus()` called, key consumed
- Existing tests (no callback/`isTerminalContainerActive`) unaffected

### Manual smoke test

`npm run dev` — verify:

1. Clicking terminal → terminal zone lit, dock neutral
2. Clicking dock → dock border turns mauve, terminal dims
3. `Ctrl+e` → dock opens (if closed), editor tab active, dock lit
4. `Ctrl+g` → diff tab active, dock lit
5. `Ctrl+b` from dock → terminal zone regains focus; `Ctrl+b` from terminal → passes through (no zone change)
6. `Ctrl+1-4` from dock → terminal zone regains focus
7. Closing dock → terminal zone regains focus automatically
