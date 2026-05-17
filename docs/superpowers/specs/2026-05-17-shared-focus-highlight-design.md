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
- Adds new shortcuts: `Ctrl+e` (editor), `Ctrl+g` (git diff), `Ctrl+b` (toggle dock)
- Side-effects `Ctrl+1-4` to claim terminal container focus
- Adds `useDockShortcuts` hook

Out of scope:

- Expand/shrink keyboard shortcuts (follow-on PR)
- Sidebar / activity panel as focusable containers
- Any change to per-pane `Pane.active` terminal focus logic

---

## 3. State model

### 3.1 Container IDs

Two named constants defined alongside `WorkspaceView`:

```ts
const TERMINAL_CONTAINER_ID = 'terminal' as const
const DOCK_CONTAINER_ID = 'dock' as const
```

The type is `string` — extensible without a union update when more containers are added.

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

| Layer             | Unfocused (current)            | Focused                            |
| ----------------- | ------------------------------ | ---------------------------------- |
| Junction border   | `1px solid rgba(74,68,79,0.3)` | `2px solid #cba6f7`                |
| Container shadow  | none                           | `0 0 0 6px rgba(203,166,247,0.12)` |
| DockTab header bg | transparent                    | `rgba(203,166,247,0.05)`           |

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

`onPointerDown` on the outer wrapper of each zone calls `setActiveContainerId` with its container ID. This mirrors how `SplitView` slot `onClick` claims pane-level focus today.

- Clicking inside `<TerminalZone>` wrapper → `setActiveContainerId(TERMINAL_CONTAINER_ID)`
- Clicking inside `<DockPanel>` wrapper → `setActiveContainerId(DOCK_CONTAINER_ID)`

### 5.2 Keyboard shortcuts

New hook: `useDockShortcuts` (see §6.3).

| Shortcut             | Action                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Ctrl+1-4` / `⌘+1-4` | Focus terminal pane N (existing) **+ side-effect:** `setActiveContainerId(TERMINAL_CONTAINER_ID)`                                                   |
| `Ctrl+\` / `⌘+\`     | Rotate terminal pane layout (existing, **unchanged**)                                                                                               |
| `Ctrl+e` / `⌘+e`     | Jump to editor tab: `setDockTab('editor')` + `setActiveContainerId(DOCK_CONTAINER_ID)` + open dock if closed                                        |
| `Ctrl+g` / `⌘+g`     | Jump to diff tab: `setDockTab('diff')` + `setActiveContainerId(DOCK_CONTAINER_ID)` + open dock if closed                                            |
| `Ctrl+b` / `⌘+b`     | Toggle: if active=dock → `setActiveContainerId(TERMINAL_CONTAINER_ID)`; otherwise → `setActiveContainerId(DOCK_CONTAINER_ID)` + open dock if closed |

`Ctrl+e`, `Ctrl+g`, `Ctrl+b` work regardless of which zone is currently active.

### 5.3 Toolbar hint update

The keyboard hint strip inside `TerminalZone`'s layout toolbar updates from:

```
Ctrl+\ cycle
```

to:

```
Ctrl+1-4 pane · Ctrl+e editor · Ctrl+g diff · Ctrl+b dock
```

---

## 6. Component / hook changes

### 6.1 `TerminalZone`

New optional prop (default preserves current behaviour):

```ts
isZoneFocused?: boolean  // default: true
```

The outer `<div data-testid="terminal-zone">` gains a conditional class:

```ts
className={`flex min-h-0 flex-1 flex-col ${!isZoneFocused ? 'opacity-[0.65] transition-opacity duration-[220ms]' : ''}`}
```

### 6.2 `DockPanel`

New optional prop (default preserves current behaviour):

```ts
isFocused?: boolean  // default: false
```

- `borderClass` logic extended: focused → replace `border-[rgba(74,68,79,0.3)]` with `border-[#cba6f7]` and upgrade from `border` to `border-2`
- Container `<section>` gains `boxShadow` via inline style when focused
- `DockTab` header `<div>` gains `rgba(203,166,247,0.05)` background when focused

Outer `<section>` gets `onPointerDown` → `onContainerFocus?.()` (caller-provided callback, avoids threading `setActiveContainerId` into the component).

### 6.3 New: `useDockShortcuts`

Location: `src/features/workspace/hooks/useDockShortcuts.ts`

```ts
interface UseDockShortcutsParams {
  isDockOpen: boolean
  setIsDockOpen: (open: boolean) => void
  setDockTab: (tab: 'editor' | 'diff') => void
  activeContainerId: string
  setActiveContainerId: (id: string) => void
  modKey: '⌘' | 'Ctrl'
}
```

Attaches a `keydown` listener (same pattern as `usePaneShortcuts`) for `e`, `g`, `b` with the platform modifier. Guards: skip if focus is inside a `contenteditable` or `<input>` (to avoid hijacking editor keystrokes).

### 6.4 `usePaneShortcuts`

Add optional callback:

```ts
onZoneFocus?: (containerId: string) => void
```

Call it with `TERMINAL_CONTAINER_ID` inside the existing `Ctrl+1-4` handler. Backward-compatible (existing callers pass nothing).

### 6.5 `WorkspaceView`

- Adds `activeContainerId` / `setActiveContainerId` state
- Passes `isZoneFocused` to `<TerminalZone>`
- Passes `isFocused` + `onContainerFocus` to `<DockPanel>` (and `<DockPeekButton>` need not handle this — peek button click implies opening, which is already handled by `setIsDockOpen`)
- Calls `useDockShortcuts`
- Passes `onZoneFocus={setActiveContainerId}` to `usePaneShortcuts`
- Resets `activeContainerId` on dock close

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

- `Ctrl+e` → `setDockTab('editor')`, `setActiveContainerId(DOCK_CONTAINER_ID)`, `setIsDockOpen(true)` called
- `Ctrl+g` → `setDockTab('diff')`, `setActiveContainerId(DOCK_CONTAINER_ID)`, `setIsDockOpen(true)` called
- `Ctrl+b` when `activeContainerId === DOCK_CONTAINER_ID` → `setActiveContainerId(TERMINAL_CONTAINER_ID)`
- `Ctrl+b` when `activeContainerId === TERMINAL_CONTAINER_ID` → `setActiveContainerId(DOCK_CONTAINER_ID)`, `setIsDockOpen(true)`
- No-op when modifier not held

**`usePaneShortcuts.test.ts`** (existing file):

- `Ctrl+1-4` calls `onZoneFocus(TERMINAL_CONTAINER_ID)` when callback provided
- Existing tests unaffected when callback omitted

### Manual smoke test

`npm run dev` — verify:

1. Clicking terminal → terminal zone lit, dock neutral
2. Clicking dock → dock border turns mauve, terminal dims
3. `Ctrl+e` → dock opens (if closed), editor tab active, dock lit
4. `Ctrl+g` → diff tab active, dock lit
5. `Ctrl+b` toggles container focus back and forth
6. `Ctrl+1-4` → terminal zone regains focus
7. Closing dock → terminal zone regains focus automatically
