# Shared Focus Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workspace-level `activeContainerId` state so the DockPanel (editor + diff) and TerminalZone share the same border-highlight logic, enabling keyboard shortcuts (`Ctrl+e/g/b` + `Ctrl+1-4` reclaim) to focus either zone.

**Architecture:** A new `containerIds.ts` module exports shared constants and `FocusTarget` type. `WorkspaceView` owns `activeContainerId` state plus a `focusRequestSeq` counter that drives a `useLayoutEffect` for DOM focus movement. Both `TerminalZone` and `DockPanel` gain `forwardRef` imperative handles for programmatic focus. `useDockShortcuts` is a new capture-phase hook; `usePaneShortcuts` gains two optional params for terminal-reclaim logic.

**Tech Stack:** React 18 (`forwardRef`, `useImperativeHandle`, `useLayoutEffect`, `useRef`), Vitest + `@testing-library/react`, TypeScript, Tailwind CSS.

---

## File Map

| Status | Path                                                            | Change                                                            |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Create | `src/features/workspace/containerIds.ts`                        | Shared constants + `FocusTarget` type                             |
| Create | `src/features/workspace/hooks/useDockShortcuts.ts`              | Ctrl+e/g/b capture-phase hook                                     |
| Create | `src/features/workspace/hooks/useDockShortcuts.test.ts`         | Hook unit tests                                                   |
| Modify | `src/features/terminal/components/TerminalPane/index.tsx`       | `forwardRef` exposing `focusTerminal(): boolean`                  |
| Modify | `src/features/terminal/components/TerminalPane/index.test.tsx`  | (if exists)                                                       |
| Modify | `src/features/terminal/components/SplitView/SplitView.tsx`      | `forwardRef` exposing `focusActivePane(): boolean`                |
| Modify | `src/features/terminal/components/SplitView/SplitView.test.tsx` | Handle test                                                       |
| Modify | `src/features/workspace/components/TerminalZone.tsx`            | `isZoneFocused`, pointer/focus handlers, `forwardRef`             |
| Modify | `src/features/workspace/components/TerminalZone.test.tsx`       | Opacity + ref tests                                               |
| Modify | `src/features/workspace/components/DockPanel.tsx`               | `isFocused`, visual highlight, internal focus logic, `forwardRef` |
| Modify | `src/features/workspace/components/DockPanel.test.tsx`          | Highlight + ref tests                                             |
| Modify | `src/features/editor/hooks/useCodeMirror.ts`                    | `shouldAutoFocus` ref guard on RAF + `updateContent`              |
| Modify | `src/features/editor/components/CodeEditor.tsx`                 | `shouldAutoFocus` prop + `forwardRef` exposing `focus(): boolean` |
| Modify | `src/features/terminal/hooks/usePaneShortcuts.ts`               | `onTerminalZoneFocus` + `isTerminalContainerActive`               |
| Modify | `src/features/terminal/hooks/usePaneShortcuts.test.ts`          | Container-reclaim truth table tests                               |
| Modify | `src/features/workspace/WorkspaceView.tsx`                      | All wiring: state, refs, helpers, session wrappers                |

---

## Task 1: Shared constants module

**Files:**

- Create: `src/features/workspace/containerIds.ts`

- [ ] **Step 1: Write the file**

```ts
// src/features/workspace/containerIds.ts
export const TERMINAL_CONTAINER_ID = 'terminal' as const
export const DOCK_CONTAINER_ID = 'dock' as const

export type FocusTarget = 'terminal' | 'editor' | 'diff'
```

- [ ] **Step 2: Verify it type-checks**

```bash
npm run type-check
```

Expected: no errors related to this file.

- [ ] **Step 3: Commit**

```bash
git add src/features/workspace/containerIds.ts
git commit -m "feat(workspace): add containerIds shared constants module"
```

---

## Task 2: TerminalPane imperative handle

`TerminalPane` currently keeps `bodyRef` private. We expose it upward so `SplitView` can call `focusTerminal()` without reaching into internals.

**Files:**

- Modify: `src/features/terminal/components/TerminalPane/index.tsx`

- [ ] **Step 1: Write the test first**

Open `src/features/terminal/components/TerminalPane/index.tsx`. In its sibling test file (check `src/features/terminal/components/TerminalPane/index.test.tsx` — if it doesn't exist, create it; check what exists in the directory first with `ls src/features/terminal/components/TerminalPane/`):

```bash
ls src/features/terminal/components/TerminalPane/
```

Add a test:

```ts
// Near bottom of index.test.tsx (add to existing describe block or create one)
import { createRef } from 'react'
import type { TerminalPaneHandle } from './index'

test('TerminalPane: ref handle exposes focusTerminal returning false when body not ready', () => {
  const ref = createRef<TerminalPaneHandle>()
  // Use the existing mock infrastructure — Body is mocked, so bodyRef.current?.focusTerminal is undefined
  render(
    <TerminalPane
      ref={ref}
      session={makeSession()}
      pane={makePane()}
      service={mockService}
      isActive={false}
    />
  )
  // bodyRef.current is null in test env because Body is mocked without a real BodyHandle
  expect(ref.current).not.toBeNull()
  const result = ref.current!.focusTerminal()
  expect(result).toBe(false)
})
```

- [ ] **Step 2: Run — should FAIL with "TerminalPane: unknown handle / no forwardRef"**

```bash
npx vitest run src/features/terminal/components/TerminalPane/index.test.tsx
```

Expected: FAIL (property `ref` not accepted, or `ref.current` is null).

- [ ] **Step 3: Add `TerminalPaneHandle` and `forwardRef` to `index.tsx`**

At the top of `src/features/terminal/components/TerminalPane/index.tsx`, add to imports:

```ts
import { forwardRef, useImperativeHandle, ... } from 'react'
// (add forwardRef, useImperativeHandle to existing react import)
```

After the `TerminalPaneProps` interface, add:

```ts
export interface TerminalPaneHandle {
  /** Returns true if xterm body focused successfully, false if not ready. */
  focusTerminal(): boolean
}
```

Wrap the existing function with `forwardRef`:

```ts
export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(
  function TerminalPane(
    {
      session,
      pane,
      isActive,
      service,
      onPaneReady = undefined,
      mode = 'spawn',
      onClose = undefined,
      onCwdChange = undefined,
      onRestart = undefined,
      deferFit = false,
    }: TerminalPaneProps,
    ref
  ): ReactElement {
    const agent = agentForPane(pane)
    const bodyRef = useRef<BodyHandle>(null)
    // ... rest of existing code unchanged ...

    useImperativeHandle(ref, () => ({
      focusTerminal(): boolean {
        if (!bodyRef.current) return false
        bodyRef.current.focusTerminal()
        return true
      },
    }))

    // ... rest of component (return JSX) unchanged ...
  }
)
```

The `useImperativeHandle` call goes just after the `wasActiveRef` / `bodyRef` declarations, before `ptyStatus`.

- [ ] **Step 4: Run — should PASS**

```bash
npx vitest run src/features/terminal/components/TerminalPane/index.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Verify type-check passes**

```bash
npm run type-check
```

- [ ] **Step 6: Commit**

```bash
git add src/features/terminal/components/TerminalPane/index.tsx src/features/terminal/components/TerminalPane/index.test.tsx
git commit -m "feat(terminal): expose focusTerminal() imperative handle on TerminalPane"
```

---

## Task 3: SplitView imperative handle

`SplitView` holds refs to its `TerminalPane` slots and exposes `focusActivePane()` which delegates to the active pane's `focusTerminal()`.

**Files:**

- Modify: `src/features/terminal/components/SplitView/SplitView.tsx`
- Modify: `src/features/terminal/components/SplitView/SplitView.test.tsx`

- [ ] **Step 1: Write the failing test**

In `SplitView.test.tsx`, add at the bottom of the describe block:

```ts
import { createRef } from 'react'
import type { SplitViewHandle } from './SplitView'

test('SplitView: focusActivePane() returns false when no active pane ref is available (mocked TerminalPane)', () => {
  const ref = createRef<SplitViewHandle>()
  // TerminalPane is mocked — it won't expose an imperative handle
  render(
    <SplitView
      ref={ref}
      session={makeSession('s1', ['p0'])}  // use existing test helper
      service={mockService}
      isActive={true}
    />
  )
  expect(ref.current).not.toBeNull()
  const result = ref.current!.focusActivePane()
  expect(result).toBe(false)
})
```

Note: `SplitView.test.tsx` already has a `makeSession` helper — check it first and reuse it.

- [ ] **Step 2: Run — should FAIL**

```bash
npx vitest run src/features/terminal/components/SplitView/SplitView.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Add `SplitViewHandle` and `forwardRef`**

In `SplitView.tsx`, add to imports: `forwardRef`, `useImperativeHandle`, `useRef` (from react).

Add the export interface after `SplitViewProps`:

```ts
export interface SplitViewHandle {
  /** Focuses the active TerminalPane. Returns true on success, false if no active pane is ready. */
  focusActivePane(): boolean
}
```

Change the component to use `forwardRef`. Inside the component body, add:

1. A `Map`-based ref for pane handles: `const paneHandleRefs = useRef<Map<string, TerminalPaneHandle | null>>(new Map())`
2. `useImperativeHandle`:

```ts
useImperativeHandle(ref, () => ({
  focusActivePane(): boolean {
    const activePane = session.panes.find((p) => p.active)
    if (!activePane) {
      outerDivRef.current?.focus()
      return false
    }
    const handle = paneHandleRefs.current.get(activePane.id)
    if (!handle) {
      outerDivRef.current?.focus()
      return false
    }
    const focused = handle.focusTerminal()
    if (!focused) outerDivRef.current?.focus()
    return focused
  },
}))
```

3. Add `outerDivRef = useRef<HTMLDivElement>(null)` and attach it to the outer `<div>` with `ref={outerDivRef} tabIndex={-1}`.

4. Attach pane refs: in the `visiblePanes.map(...)`, change the `<TerminalPane>` to:

```ts
<TerminalPane
  key={pane.ptyId}
  ref={(handle): void => {
    paneHandleRefs.current.set(pane.id, handle)
  }}
  // ... existing props unchanged
/>
```

Also import `TerminalPaneHandle` from `'../TerminalPane'`.

- [ ] **Step 4: Ensure existing tests still pass**

```bash
npx vitest run src/features/terminal/components/SplitView/SplitView.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Type-check**

```bash
npm run type-check
```

- [ ] **Step 6: Commit**

```bash
git add src/features/terminal/components/SplitView/SplitView.tsx src/features/terminal/components/SplitView/SplitView.test.tsx
git commit -m "feat(terminal): expose focusActivePane() imperative handle on SplitView"
```

---

## Task 4: TerminalZone visual + focus changes

**Files:**

- Modify: `src/features/workspace/components/TerminalZone.tsx`
- Modify: `src/features/workspace/components/TerminalZone.test.tsx`

- [ ] **Step 1: Write failing tests**

In `TerminalZone.test.tsx`, add:

```ts
test('isZoneFocused=false applies opacity dim class to outer div', () => {
  render(
    <TerminalZone
      sessions={[]}
      activeSessionId={null}
      service={mockService}
      setSessionActivePane={vi.fn()}
      setSessionLayout={vi.fn()}
      addPane={vi.fn()}
      removePane={vi.fn()}
      isZoneFocused={false}
    />
  )
  const outer = screen.getByTestId('terminal-zone')
  expect(outer.className).toContain('opacity-[0.65]')
})

test('isZoneFocused=true (default) does not apply dim class', () => {
  render(
    <TerminalZone
      sessions={[]}
      activeSessionId={null}
      service={mockService}
      setSessionActivePane={vi.fn()}
      setSessionLayout={vi.fn()}
      addPane={vi.fn()}
      removePane={vi.fn()}
    />
  )
  const outer = screen.getByTestId('terminal-zone')
  expect(outer.className).not.toContain('opacity-[0.65]')
})

test('TerminalZone: ref exposes focusActivePane returning false when no sessions', () => {
  const ref = createRef<TerminalZoneHandle>()
  render(
    <TerminalZone
      ref={ref}
      sessions={[]}
      activeSessionId={null}
      service={mockService}
      setSessionActivePane={vi.fn()}
      setSessionLayout={vi.fn()}
      addPane={vi.fn()}
      removePane={vi.fn()}
    />
  )
  expect(ref.current).not.toBeNull()
  const result = ref.current!.focusActivePane()
  expect(result).toBe(false)
})
```

- [ ] **Step 2: Run — should FAIL**

```bash
npx vitest run src/features/workspace/components/TerminalZone.test.tsx
```

- [ ] **Step 3: Modify TerminalZone**

In `TerminalZone.tsx`, add these changes:

**Imports:** Add `forwardRef`, `useImperativeHandle`, `useRef` from react. Import `SplitViewHandle` from `'../../terminal/components/SplitView/SplitView'`.

**New export interface** (after `TerminalZoneProps`):

```ts
export interface TerminalZoneHandle {
  focusActivePane(): boolean
}
```

**New prop** in `TerminalZoneProps`:

```ts
isZoneFocused?: boolean  // default: true
onContainerPointerDown?: () => void
```

**Component body changes:**

```ts
export const TerminalZone = forwardRef<TerminalZoneHandle, TerminalZoneProps>(
  function TerminalZone({
    // ... existing props ...,
    isZoneFocused = true,
    onContainerPointerDown = undefined,
  }: TerminalZoneProps, ref): ReactElement {

    const outerDivRef = useRef<HTMLDivElement>(null)
    const activeSplitViewRef = useRef<SplitViewHandle | null>(null)

    useImperativeHandle(ref, () => ({
      focusActivePane(): boolean {
        if (!activeSplitViewRef.current) {
          outerDivRef.current?.focus()
          return false
        }
        const focused = activeSplitViewRef.current.focusActivePane()
        if (!focused) outerDivRef.current?.focus()
        return focused
      },
    }))

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
      onContainerPointerDown?.()
      const target = e.target as Element
      if (
        !target.closest(
          'button,input,textarea,a,select,[tabindex]:not([tabindex="-1"])'
        )
      ) {
        ;(e.currentTarget as HTMLElement).focus()
      }
    }

    // ... existing activeSession, showToolbar logic ...
```

**Outer div** (`data-testid="terminal-zone"`): change the `className` and add `ref`, `tabIndex`, handlers:

```tsx
<div
  ref={outerDivRef}
  data-testid="terminal-zone"
  data-container-id="terminal"
  tabIndex={-1}
  className={`flex min-h-0 flex-1 flex-col ${
    !isZoneFocused ? 'opacity-[0.65]' : 'opacity-100'
  } transition-opacity duration-[220ms]`}
  onPointerDown={handlePointerDown}
  onFocus={onContainerPointerDown}
>
```

**SplitView ref wiring:** in the sessions render loop, find the `<SplitView>` element. Attach a callback ref:

```tsx
<SplitView
  ref={
    isActive
      ? (handle): void => {
          activeSplitViewRef.current = handle
        }
      : null
  }
  // ... existing props ...
/>
```

- [ ] **Step 4: Run — all tests should pass**

```bash
npx vitest run src/features/workspace/components/TerminalZone.test.tsx
```

- [ ] **Step 5: Type-check**

```bash
npm run type-check
```

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/components/TerminalZone.tsx src/features/workspace/components/TerminalZone.test.tsx
git commit -m "feat(workspace): TerminalZone opacity dim, container focus, and imperative handle"
```

---

## Task 5: DockPanel visual highlight + imperative handle

**Files:**

- Modify: `src/features/workspace/components/DockPanel.tsx`
- Modify: `src/features/workspace/components/DockPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

In `DockPanel.test.tsx`, add a test group:

```ts
describe('DockPanel focus highlight', () => {
  test('isFocused=true applies mauve border to junction edge', () => {
    renderDockPanel({ isFocused: true, position: 'bottom' })
    const section = screen.getByTestId('dock-panel')
    // bottom dock: junction border is border-top
    expect(section.className).toContain('border-t-[#cba6f7]')
  })

  test('isFocused=false uses neutral border', () => {
    renderDockPanel({ isFocused: false, position: 'bottom' })
    const section = screen.getByTestId('dock-panel')
    expect(section.className).toContain('border-t-[rgba(74,68,79,0.3)]')
    expect(section.className).not.toContain('border-t-[#cba6f7]')
  })

  test('isFocused=true applies box-shadow via style prop', () => {
    renderDockPanel({ isFocused: true })
    const section = screen.getByTestId('dock-panel')
    expect(section.style.boxShadow).toBeTruthy()
  })

  test('isFocused=false has no box-shadow', () => {
    renderDockPanel({ isFocused: false })
    const section = screen.getByTestId('dock-panel')
    expect(section.style.boxShadow).toBeFalsy()
  })
})

test('DockPanel: ref exposes focusEditor returning false when no editorView', () => {
  // useCodeMirror mock returns editorView: null (override for this test)
  vi.spyOn(useCodeMirrorModule, 'useCodeMirror').mockReturnValueOnce({
    editorView: null,
    updateContent: vi.fn(),
    setContainer: vi.fn(),
  })
  const ref = createRef<DockPanelHandle>()
  renderDockPanel({ ref, tab: 'editor' } as any)
  expect(ref.current).not.toBeNull()
  // focusEditor() should fall back and return false (no editorView)
  const result = ref.current!.focusEditor()
  expect(result).toBe(false)
})
```

- [ ] **Step 2: Run — should FAIL**

```bash
npx vitest run src/features/workspace/components/DockPanel.test.tsx
```

- [ ] **Step 3: Modify DockPanel**

**New imports** in `DockPanel.tsx`: `forwardRef`, `useImperativeHandle`, `useRef`, `type PointerEvent` (from react). Import `CodeEditorHandle` from `'../../editor/components/CodeEditor'` (this will be added in Task 6 — for now add as a future import with `// TODO: add after Task 6`).

**New interface** (export):

```ts
export interface DockPanelHandle {
  focusEditor(): boolean
  focusDiff(): void
}
```

**New props** in `DockPanelBaseProps`:

```ts
isFocused?: boolean
onContainerFocus?: () => void
```

**Component changes** — add inside the function:

```ts
const sectionRef = useRef<HTMLDivElement>(null)
const diffWrapperRef = useRef<HTMLDivElement>(null)
const editorHandleRef = useRef<CodeEditorHandle | null>(null)

useImperativeHandle(ref, () => ({
  focusEditor(): boolean {
    if (editorHandleRef.current) {
      return editorHandleRef.current.focus()
    }
    sectionRef.current?.focus()
    return false
  },
  focusDiff(): void {
    diffWrapperRef.current?.focus() ?? sectionRef.current?.focus()
  },
}))

const handlePointerDown = (e: React.PointerEvent<HTMLElement>): void => {
  onContainerFocus?.()
  const target = e.target as Element
  if (
    !target.closest(
      'button,input,textarea,a,select,[tabindex]:not([tabindex="-1"])'
    )
  ) {
    sectionRef.current?.focus()
  }
}
```

**Update `borderClass` logic** — focused replaces neutral with mauve color (same width):

```ts
const focusBorderColor = isFocused ? '#cba6f7' : 'rgba(74,68,79,0.3)'
const borderClass =
  position === 'top'
    ? `border-b border-b-[${focusBorderColor}]`
    : position === 'bottom'
      ? `border-t border-t-[${focusBorderColor}]`
      : position === 'left'
        ? `border-r border-r-[${focusBorderColor}]`
        : `border-l border-l-[${focusBorderColor}]`
```

**Update `<section>` element**:

```tsx
<section
  ref={sectionRef}
  data-testid="dock-panel"
  data-position={position}
  data-container-id="dock"
  aria-label={sectionAriaLabel}
  tabIndex={-1}
  style={{
    ...containerStyle,
    boxShadow: isFocused
      ? '0 0 0 1px #cba6f7 inset, 0 0 0 6px rgba(203,166,247,0.12)'
      : undefined,
    transition: 'box-shadow 220ms ease',
  }}
  onPointerDown={handlePointerDown}
  onFocus={onContainerFocus}
  className={`relative z-30 flex shrink-0 flex-col bg-[#121221] ${borderClass}`}
>
```

**Wrap diff panel** with the stable focusable div:

```tsx
{
  tab === 'diff' && (
    <div
      data-testid="diff-panel"
      className="flex min-h-0 flex-1 overflow-hidden"
    >
      <div ref={diffWrapperRef} tabIndex={-1} className="flex min-h-0 flex-1">
        {/* existing DiffPanelContent */}
      </div>
    </div>
  )
}
```

**Wrap component** with `forwardRef`:

```ts
const DockPanel = forwardRef<DockPanelHandle, DockPanelProps>(
  function DockPanel({ ...props }: DockPanelProps, ref): ReactElement {
    // ... body ...
  }
)
export default DockPanel
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/features/workspace/components/DockPanel.test.tsx
```

Expected: all PASS.

- [ ] **Step 5: Type-check**

```bash
npm run type-check
```

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/components/DockPanel.tsx src/features/workspace/components/DockPanel.test.tsx
git commit -m "feat(workspace): DockPanel focus highlight, container focus, and imperative handle"
```

---

## Task 6: CodeEditor `shouldAutoFocus` + imperative handle

**Files:**

- Modify: `src/features/editor/hooks/useCodeMirror.ts`
- Modify: `src/features/editor/components/CodeEditor.tsx`
- Modify: `src/features/editor/components/CodeEditor.test.tsx`

- [ ] **Step 1: Write failing tests**

In `CodeEditor.test.tsx`, add:

```ts
import { createRef } from 'react'
import type { CodeEditorHandle } from './CodeEditor'

describe('CodeEditor imperative handle', () => {
  test('ref.focus() returns true when editorView is ready', () => {
    // existing mock returns a real editorView-like object
    const ref = createRef<CodeEditorHandle>()
    render(
      <CodeEditor
        ref={ref}
        filePath="/test.ts"
        content="hello"
        shouldAutoFocus={false}
      />
    )
    expect(ref.current).not.toBeNull()
    // mockEditorView.focus exists via mock — focus() returns true
    const result = ref.current!.focus()
    expect(result).toBe(true)
  })

  test('ref.focus() returns false when no filePath (no editorView)', () => {
    const ref = createRef<CodeEditorHandle>()
    render(
      <CodeEditor
        ref={ref}
        filePath={null}
        content=""
        shouldAutoFocus={false}
      />
    )
    expect(ref.current).not.toBeNull()
    const result = ref.current!.focus()
    expect(result).toBe(false)
  })
})
```

- [ ] **Step 2: Run — should FAIL**

```bash
npx vitest run src/features/editor/components/CodeEditor.test.tsx
```

- [ ] **Step 3: Update `useCodeMirror` to accept and respect `shouldAutoFocus`**

In `useCodeMirror.ts`, add `shouldAutoFocus?: boolean` to `UseCodeMirrorOptions` interface (check the existing options shape first). Add a ref that's written during render:

At the top of the hook body, after existing refs:

```ts
const shouldAutoFocusRef = useRef(shouldAutoFocus ?? true)
shouldAutoFocusRef.current = shouldAutoFocus ?? true
```

Find the RAF focus call (`requestAnimationFrame(() => { ... view.focus() })`). Add the guard:

```ts
requestAnimationFrame(() => {
  if (viewRef.current !== view) return
  view.requestMeasure()
  if (shouldAutoFocusRef.current) view.focus() // guard added
})
```

Find `updateContent`'s `view.focus()` call and add the same guard:

```ts
// Focus editor after content load
if (shouldAutoFocusRef.current) view.focus() // guard added
```

Return `viewRef` from the hook (already returned as `editorView` state) — no change needed.

- [ ] **Step 4: Add `CodeEditorHandle` and `forwardRef` to `CodeEditor.tsx`**

```ts
// New imports
import { forwardRef, useImperativeHandle } from 'react'

// Add to props interface:
interface CodeEditorProps {
  // ...existing...
  shouldAutoFocus?: boolean
}

// New handle type:
export interface CodeEditorHandle {
  /** Returns true if editorView focused, false if no file loaded. */
  focus(): boolean
}

// Wrap component:
export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor({ ..., shouldAutoFocus = false }, ref): ReactElement {
    const { editorView, updateContent, setContainer } = useCodeMirror({
      // ...existing options...,
      shouldAutoFocus,
    })

    useImperativeHandle(ref, () => ({
      focus(): boolean {
        if (!editorView) return false
        editorView.focus()
        return true
      },
    }))

    // ...rest of component unchanged...
  }
)
```

- [ ] **Step 5: Run — all CodeEditor tests should pass**

```bash
npx vitest run src/features/editor/components/CodeEditor.test.tsx
```

- [ ] **Step 6: Type-check**

```bash
npm run type-check
```

- [ ] **Step 7: Commit**

```bash
git add src/features/editor/hooks/useCodeMirror.ts src/features/editor/components/CodeEditor.tsx src/features/editor/components/CodeEditor.test.tsx
git commit -m "feat(editor): shouldAutoFocus guard and imperative focus() handle on CodeEditor"
```

---

## Task 7: `usePaneShortcuts` container-reclaim additions

Add `onTerminalZoneFocus` and `isTerminalContainerActive` optional params. The truth table from the spec (§6.4) drives the new logic.

**Files:**

- Modify: `src/features/terminal/hooks/usePaneShortcuts.ts`
- Modify: `src/features/terminal/hooks/usePaneShortcuts.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `usePaneShortcuts.test.ts`:

```ts
describe('usePaneShortcuts — container-reclaim extensions', () => {
  // Helper to attach a fake dock element to document.body
  const attachFakeDock = (): HTMLElement => {
    const el = document.createElement('div')
    el.setAttribute('data-container-id', 'dock')
    el.setAttribute('tabindex', '-1')
    document.body.appendChild(el)
    return el
  }

  const removeFakeDock = (el: HTMLElement): void => {
    document.body.removeChild(el)
  }

  test('Ctrl+1 from dock (activeElement in dock): consumes key and calls onTerminalZoneFocus', () => {
    const onTerminalZoneFocus = vi.fn()
    const dockEl = attachFakeDock()
    dockEl.focus()

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: false,
        onTerminalZoneFocus,
      })
    )

    const event = fire('1', { ctrlKey: true })

    expect(onTerminalZoneFocus).toHaveBeenCalledOnce()
    expect(event.preventDefaultSpy).toHaveBeenCalled()

    removeFakeDock(dockEl)
  })

  test('Ctrl+1 from dock (activeElement NOT in dock): passes through, no callback', () => {
    const onTerminalZoneFocus = vi.fn()
    // activeElement is body — not in dock
    ;(document.activeElement as HTMLElement | null)?.blur?.()

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: false,
        onTerminalZoneFocus,
      })
    )

    const event = fire('1', { ctrlKey: true })

    expect(onTerminalZoneFocus).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Ctrl+1 in dialog: passes through regardless of container state', () => {
    const onTerminalZoneFocus = vi.fn()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inner = document.createElement('button')
    dialog.appendChild(inner)
    document.body.appendChild(dialog)
    inner.focus()

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: false,
        onTerminalZoneFocus,
      })
    )

    const event = fire('1', { ctrlKey: true })

    expect(onTerminalZoneFocus).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(dialog)
  })

  test('Ctrl+1 terminal-active + pane active + activeElement in xterm textarea: pass through', () => {
    const onTerminalZoneFocus = vi.fn()
    const textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    document.body.appendChild(textarea)
    textarea.focus()

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: true,
        onTerminalZoneFocus,
      })
    )

    const event = fire('1', { ctrlKey: true })

    expect(onTerminalZoneFocus).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(textarea)
  })

  test('Ctrl+1 terminal-active + pane active + activeElement NOT in xterm: consumes + calls callback', () => {
    const onTerminalZoneFocus = vi.fn()
    // activeElement is body
    ;(document.activeElement as HTMLElement | null)?.blur?.()

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: true,
        onTerminalZoneFocus,
      })
    )

    const event = fire('1', { ctrlKey: true })

    expect(onTerminalZoneFocus).toHaveBeenCalledOnce()
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('existing tests unaffected when new params are omitted', () => {
    // Same as existing "Ctrl+1 with already-active p0 lets the event propagate"
    const setSessionActivePane = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
        // no isTerminalContainerActive, no onTerminalZoneFocus
      })
    )

    const event = fire('1', { ctrlKey: true })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — should FAIL**

```bash
npx vitest run src/features/terminal/hooks/usePaneShortcuts.test.ts
```

- [ ] **Step 3: Implement the changes**

Add to `UsePaneShortcutsOptions`:

```ts
onTerminalZoneFocus?: () => void
isTerminalContainerActive?: boolean
```

Add refs in the hook body:

```ts
const onTerminalZoneFocusRef = useRef(onTerminalZoneFocus)
const isTerminalContainerActiveRef = useRef(isTerminalContainerActive)
onTerminalZoneFocusRef.current = onTerminalZoneFocus
isTerminalContainerActiveRef.current = isTerminalContainerActive
```

In `handleKeyDown`, add this block immediately before the `activeId === null` guard (i.e., at the top of the digit-key logic, inside the `if (digitMatch)` block):

```ts
if (digitMatch) {
  const paneIndex = Number.parseInt(digitMatch[1], 10) - 1

  // Container-reclaim logic (only when new params are wired)
  const isTCA = isTerminalContainerActiveRef.current
  const onTZF = onTerminalZoneFocusRef.current

  if (isTCA !== undefined && onTZF !== undefined) {
    const ae = document.activeElement as Element | null

    // Rule 0: Never fire inside a dialog
    if (
      document.querySelector(
        '[role="dialog"]:not([hidden]):not([aria-hidden="true"]),[role="alertdialog"]:not([hidden]):not([aria-hidden="true"])'
      )
    ) {
      return
    }

    if (!isTCA) {
      // Dock is active — reclaim only if activeElement is inside dock
      if (ae?.closest('[data-container-id="dock"]')) {
        onTZF()
        event.preventDefault()
        event.stopPropagation()
        // fall through to pane-focus logic below
      } else {
        return // stale state — pass through
      }
    } else {
      // Terminal container is active
      if (paneIndex < activeSession.panes.length) {
        const target = activeSession.panes[paneIndex]
        if (target.active) {
          // Already-active pane
          if (ae?.closest('.xterm-helper-textarea')) {
            return // xterm has focus — pass through
          }
          // Focus is on chrome/sidebar — reclaim xterm
          onTZF()
          event.preventDefault()
          event.stopPropagation()
          return
        }
      }
      // Different pane OR out-of-range: fall through to existing logic
    }
  }

  // --- Existing logic below (unchanged) ---
  if (paneIndex >= activeSession.panes.length) {
    return
  }
  const target = activeSession.panes[paneIndex]
  if (target.active) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  setSessionActivePane(activeSession.id, target.id)
  return
}
```

**Important:** The new block goes before the existing `if (paneIndex >= activeSession.panes.length)` check. When the new block runs, it handles its paths and either returns early or falls through to the existing logic.

- [ ] **Step 4: Run all pane shortcut tests**

```bash
npx vitest run src/features/terminal/hooks/usePaneShortcuts.test.ts
```

Expected: all PASS (new + existing).

- [ ] **Step 5: Type-check**

```bash
npm run type-check
```

- [ ] **Step 6: Commit**

```bash
git add src/features/terminal/hooks/usePaneShortcuts.ts src/features/terminal/hooks/usePaneShortcuts.test.ts
git commit -m "feat(terminal): usePaneShortcuts container-reclaim extensions (Ctrl+1-4 from dock)"
```

---

## Task 8: `useDockShortcuts` new hook

**Files:**

- Create: `src/features/workspace/hooks/useDockShortcuts.ts`
- Create: `src/features/workspace/hooks/useDockShortcuts.test.ts`

- [ ] **Step 1: Write the test file first**

Create `src/features/workspace/hooks/useDockShortcuts.test.ts`:

```ts
import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { useDockShortcuts } from './useDockShortcuts'
import { DOCK_CONTAINER_ID, TERMINAL_CONTAINER_ID } from '../containerIds'

// Helper: fire a keyboard event from document
const fire = (
  key: string,
  modifiers: Partial<KeyboardEventInit> = {}
): KeyboardEvent & { preventDefaultSpy: ReturnType<typeof vi.spyOn> } => {
  const event = new KeyboardEvent('keydown', {
    key,
    code: `Key${key.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  })
  const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
  document.dispatchEvent(event)
  return Object.assign(event, { preventDefaultSpy })
}

// Attach a dock element and focus it so Ctrl+b guard passes
const attachDockAndFocus = (): HTMLElement => {
  const el = document.createElement('section')
  el.setAttribute('data-container-id', 'dock')
  el.setAttribute('tabindex', '-1')
  document.body.appendChild(el)
  el.focus()
  return el
}

const removeEl = (el: HTMLElement): void => {
  document.body.removeChild(el)
}

describe('useDockShortcuts', () => {
  const makeProps = (overrides = {}) => ({
    activeContainerId: DOCK_CONTAINER_ID,
    openDock: vi.fn(),
    claimTerminal: vi.fn(),
    modKey: 'Ctrl' as const,
    ...overrides,
  })

  beforeEach(() => vi.clearAllMocks())

  test('Ctrl+e calls openDock("editor") and prevents default', () => {
    const props = makeProps()
    const dockEl = attachDockAndFocus()
    renderHook(() => useDockShortcuts(props))

    const event = fire('e', { ctrlKey: true })

    expect(props.openDock).toHaveBeenCalledWith('editor')
    expect(event.preventDefaultSpy).toHaveBeenCalled()

    removeEl(dockEl)
  })

  test('Ctrl+g calls openDock("diff") and prevents default', () => {
    const props = makeProps()
    const dockEl = attachDockAndFocus()
    renderHook(() => useDockShortcuts(props))

    const event = fire('g', { ctrlKey: true })

    expect(props.openDock).toHaveBeenCalledWith('diff')
    expect(event.preventDefaultSpy).toHaveBeenCalled()

    removeEl(dockEl)
  })

  test('Ctrl+b when dock active and activeElement in dock: calls claimTerminal', () => {
    const props = makeProps({ activeContainerId: DOCK_CONTAINER_ID })
    const dockEl = attachDockAndFocus()
    renderHook(() => useDockShortcuts(props))

    const event = fire('b', { ctrlKey: true })

    expect(props.claimTerminal).toHaveBeenCalledOnce()
    expect(event.preventDefaultSpy).toHaveBeenCalled()

    removeEl(dockEl)
  })

  test('Ctrl+b when dock active but activeElement NOT in dock: no-op', () => {
    const props = makeProps({ activeContainerId: DOCK_CONTAINER_ID })
    // activeElement is body (not in dock)
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    renderHook(() => useDockShortcuts(props))

    const event = fire('b', { ctrlKey: true })

    expect(props.claimTerminal).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Ctrl+b when terminal active: no-op (passes through to xterm)', () => {
    const props = makeProps({ activeContainerId: TERMINAL_CONTAINER_ID })
    renderHook(() => useDockShortcuts(props))

    const event = fire('b', { ctrlKey: true })

    expect(props.claimTerminal).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('No modifier: no-op', () => {
    const props = makeProps()
    renderHook(() => useDockShortcuts(props))

    const event = fire('e')

    expect(props.openDock).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Shift+Ctrl+e: no-op (shift excluded)', () => {
    const props = makeProps()
    renderHook(() => useDockShortcuts(props))

    const event = fire('e', { ctrlKey: true, shiftKey: true })

    expect(props.openDock).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Ctrl+e from within a dialog: no-op', () => {
    const props = makeProps()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inner = document.createElement('button')
    dialog.appendChild(inner)
    document.body.appendChild(dialog)
    inner.focus()
    renderHook(() => useDockShortcuts(props))

    const event = fire('e', { ctrlKey: true })

    expect(props.openDock).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(dialog)
  })

  test('macOS (modKey=⌘): Cmd+e fires, Ctrl+e does not', () => {
    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useDockShortcuts(props))

    // Ctrl+e should not fire
    fire('e', { ctrlKey: true })
    expect(props.openDock).not.toHaveBeenCalled()

    // Cmd+e should fire
    fire('e', { metaKey: true })
    expect(props.openDock).toHaveBeenCalledWith('editor')
  })

  test('unmount removes listener', () => {
    const props = makeProps()
    const { unmount } = renderHook(() => useDockShortcuts(props))
    unmount()
    fire('e', { ctrlKey: true })
    expect(props.openDock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — should FAIL (hook doesn't exist)**

```bash
npx vitest run src/features/workspace/hooks/useDockShortcuts.test.ts
```

- [ ] **Step 3: Implement the hook**

Create `src/features/workspace/hooks/useDockShortcuts.ts`:

```ts
import { useEffect, useRef } from 'react'
import {
  DOCK_CONTAINER_ID,
  TERMINAL_CONTAINER_ID,
  type FocusTarget,
} from '../containerIds'

export interface UseDockShortcutsParams {
  activeContainerId: string
  /** Sets isDockOpen + activeContainerId + calls requestFocus internally */
  openDock: (tab: 'editor' | 'diff') => void
  /** Sets activeContainerId to terminal + calls requestFocus internally */
  claimTerminal: () => void
  modKey: '⌘' | 'Ctrl'
}

const DIALOG_SELECTOR =
  '[role="dialog"]:not([hidden]):not([aria-hidden="true"]),[role="alertdialog"]:not([hidden]):not([aria-hidden="true"])'

export const useDockShortcuts = ({
  activeContainerId,
  openDock,
  claimTerminal,
  modKey,
}: UseDockShortcutsParams): void => {
  // Latest-value refs so the capture listener never reads stale closure state
  const activeContainerIdRef = useRef(activeContainerId)
  const openDockRef = useRef(openDock)
  const claimTerminalRef = useRef(claimTerminal)
  const modKeyRef = useRef(modKey)

  activeContainerIdRef.current = activeContainerId
  openDockRef.current = openDock
  claimTerminalRef.current = claimTerminal
  modKeyRef.current = modKey

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Modifier check — must be exact platform modifier, no shift/alt
      const mk = modKeyRef.current
      const modPressed =
        mk === '⌘' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      if (!modPressed || e.shiftKey || e.altKey) return

      // Never pierce dialogs
      if (document.querySelector(DIALOG_SELECTOR)) return

      const target: Element =
        e.target instanceof Element
          ? e.target
          : (document.activeElement ?? document.body)

      // Input guard — suppress from text-entry surfaces outside terminal zone
      const inTerminalZone = !!target.closest('[data-container-id="terminal"]')
      const inCodeMirror = !!target.closest('.cm-editor')
      const isTextEntry =
        !!target.closest('input, textarea') ||
        (!inCodeMirror &&
          !!(
            target.closest('[contenteditable]') ||
            target.closest('[role="textbox"]')
          ))
      if (isTextEntry && !inTerminalZone) return

      const key = e.key.toLowerCase()

      if (key === 'e') {
        e.preventDefault()
        e.stopPropagation()
        openDockRef.current('editor')
        return
      }

      if (key === 'g') {
        e.preventDefault()
        e.stopPropagation()
        openDockRef.current('diff')
        return
      }

      if (key === 'b') {
        // Ctrl+b only fires when dock is the active container AND activeElement is inside dock
        const ae = document.activeElement as Element | null
        if (
          activeContainerIdRef.current === DOCK_CONTAINER_ID &&
          ae?.closest('[data-container-id="dock"]')
        ) {
          e.preventDefault()
          e.stopPropagation()
          claimTerminalRef.current()
        }
        // Otherwise: pass through (terminal zone, sidebar, etc.)
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })
    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, []) // stable — all values read from refs
}
```

- [ ] **Step 4: Run — all tests should pass**

```bash
npx vitest run src/features/workspace/hooks/useDockShortcuts.test.ts
```

- [ ] **Step 5: Type-check**

```bash
npm run type-check
```

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/hooks/useDockShortcuts.ts src/features/workspace/hooks/useDockShortcuts.test.ts
git commit -m "feat(workspace): useDockShortcuts hook (Ctrl+e/g/b capture-phase)"
```

---

## Task 9: WorkspaceView orchestration

Wire all new state, refs, helpers, and shortcut hooks together.

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx`

- [ ] **Step 1: Add new imports**

```ts
import { useRef, useLayoutEffect, useState, useCallback, type ReactElement, ... } from 'react'
import {
  TERMINAL_CONTAINER_ID,
  DOCK_CONTAINER_ID,
  type FocusTarget,
} from './containerIds'
import { useDockShortcuts } from './hooks/useDockShortcuts'
import type { TerminalZoneHandle } from './components/TerminalZone'
import type { DockPanelHandle } from './components/DockPanel'
import type { CodeEditorHandle } from '../editor/components/CodeEditor'
// DockPanel already imported; ensure it's the default import
```

- [ ] **Step 2: Add new state + refs inside WorkspaceView**

After the existing `usePaneShortcuts(...)` call, add:

```ts
// Container focus state
const [activeContainerId, setActiveContainerId] = useState<string>(
  TERMINAL_CONTAINER_ID
)
const [focusRequestSeq, setFocusRequestSeq] = useState(0)
const pendingFocusTarget = useRef<FocusTarget | null>(null)

// Imperative refs for programmatic focus
const terminalZoneRef = useRef<TerminalZoneHandle>(null)
const dockPanelRef = useRef<DockPanelHandle>(null)

const requestFocus = useCallback((target: FocusTarget): void => {
  pendingFocusTarget.current = target
  setFocusRequestSeq((n) => n + 1)
}, [])

// Process pending focus requests after render
useLayoutEffect(() => {
  const target = pendingFocusTarget.current
  if (!target) return
  pendingFocusTarget.current = null
  if (target === 'terminal') terminalZoneRef.current?.focusActivePane()
  if (target === 'editor') dockPanelRef.current?.focusEditor()
  if (target === 'diff') dockPanelRef.current?.focusDiff()
}, [focusRequestSeq])

// openDock: centralises all dock-opening paths
const openDock = useCallback(
  (tab?: 'editor' | 'diff'): void => {
    const nextTab = tab ?? dockTab
    if (tab) setDockTab(tab)
    setIsDockOpen(true)
    setActiveContainerId(DOCK_CONTAINER_ID)
    requestFocus(nextTab === 'editor' ? 'editor' : 'diff')
  },
  [dockTab, requestFocus]
)

// claimTerminal: centralises all terminal-claiming paths
const claimTerminal = useCallback((): void => {
  setActiveContainerId(TERMINAL_CONTAINER_ID)
  requestFocus('terminal')
}, [requestFocus])

// closeDock: used by dock close button
const closeDock = useCallback((): void => {
  setIsDockOpen(false)
  claimTerminal()
}, [claimTerminal])

// onTerminalZoneFocus: passed to usePaneShortcuts
const activeContainerIdRef = useRef(activeContainerId)
activeContainerIdRef.current = activeContainerId
const onTerminalZoneFocus = useCallback((): void => {
  setActiveContainerId(TERMINAL_CONTAINER_ID)
  requestFocus('terminal')
}, [requestFocus])
```

- [ ] **Step 3: Update `usePaneShortcuts` call**

Change the existing `usePaneShortcuts(...)` call to pass the new params:

```ts
usePaneShortcuts({
  sessions,
  activeSessionId,
  setSessionActivePane,
  setSessionLayout,
  preferModifier,
  onTerminalZoneFocus,
  isTerminalContainerActive: activeContainerId === TERMINAL_CONTAINER_ID,
})
```

- [ ] **Step 4: Add `useDockShortcuts` call**

After the `usePaneShortcuts` call:

```ts
useDockShortcuts({
  activeContainerId,
  openDock: (tab) => openDock(tab),
  claimTerminal,
  modKey: preferModifier === 'meta' ? '⌘' : 'Ctrl',
})
```

- [ ] **Step 5: Session-intent wrappers**

Wrap `setActiveSessionId`, `createSession`, and `removeSession` so they claim terminal focus. Replace the raw functions with wrappers at the point of use:

```ts
// Near the usePaneShortcuts / useDockShortcuts calls:
const handleSetActiveSessionId = useCallback(
  (id: string): void => {
    setActiveSessionId(id)
    claimTerminal()
  },
  [setActiveSessionId, claimTerminal]
)

const handleCreateSession = useCallback((): void => {
  createSession()
  claimTerminal()
}, [createSession, claimTerminal])

const handleRemoveSession = useCallback(
  (sessionId: string): void => {
    const wasActive = sessionId === activeSessionId
    removeSession(sessionId)
    if (wasActive) claimTerminal()
  },
  [activeSessionId, removeSession, claimTerminal]
)
```

Then replace all usages of `setActiveSessionId` / `createSession` / `removeSession` in the JSX:

- `onSessionClick={setActiveSessionId}` → `onSessionClick={handleSetActiveSessionId}`
- `onCreateSession={createSession}` → `onCreateSession={handleCreateSession}`
- `onSelect={setActiveSessionId}` → `onSelect={handleSetActiveSessionId}`
- `onClose={removeSession}` → `onClose={handleRemoveSession}`
- `onNew={createSession}` → `onNew={handleCreateSession}`
- `onRemoveSession={removeSession}` → `onRemoveSession={handleRemoveSession}`

Also update `handleOpenDiff` to use `openDock`:

```ts
const handleOpenDiff = useCallback(
  (file: ChangedFile): void => {
    setSelectedDiffFile({
      path: file.path,
      staged: file.staged,
      cwd: activeCwd,
    })
    openDock('diff')
  },
  [activeCwd, openDock]
)
```

- [ ] **Step 6: Wire refs and new props into JSX**

Find the `<TerminalZone ... />` element and add:

```tsx
<TerminalZone
  ref={terminalZoneRef}
  isZoneFocused={activeContainerId === TERMINAL_CONTAINER_ID}
  onContainerPointerDown={() => setActiveContainerId(TERMINAL_CONTAINER_ID)}
  // ... all existing props unchanged ...
/>
```

Find the `<DockPanel ... />` element and add:

```tsx
<DockPanel
  ref={dockPanelRef}
  isFocused={activeContainerId === DOCK_CONTAINER_ID}
  onContainerFocus={() => setActiveContainerId(DOCK_CONTAINER_ID)}
  onClose={closeDock}
  // ... all other props unchanged (replace onClose={() => setIsDockOpen(false)} with closeDock) ...
/>
```

Find the `<DockPeekButton ... />` and update `onOpen`:

```tsx
<DockPeekButton position={dockPosition} onOpen={() => openDock()} />
```

Also update `<CodeEditor>` (inside DockPanel — already handled via DockPanel's `isFocused` prop threading `shouldAutoFocus`). **DockPanel** needs to pass `shouldAutoFocus={isFocused}` to its internal `<CodeEditor>`. Add this when writing the DockPanel internal change:

In `DockPanel.tsx`, find the `<CodeEditor ... />` element and add:

```tsx
<CodeEditor
  ref={editorHandleRef}
  shouldAutoFocus={isFocused}
  // ... existing props ...
/>
```

- [ ] **Step 7: Update toolbar hint**

In `TerminalZone.tsx`, find the keyboard hint `<span>` that currently shows `Ctrl+\ cycle`. Update it to show the new shortcuts using the `modKey` prop:

```tsx
<span className="ml-auto hidden items-center gap-1 font-mono text-xs text-on-surface-muted sm:inline-flex">
  <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>
  <span>+1-4 pane</span>
  <span>·</span>
  <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>
  <span>+\ layout</span>
  <span>·</span>
  <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>
  <span>+e editor</span>
  <span>·</span>
  <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>
  <span>+g diff</span>
  <span>·</span>
  <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>
  <span>+b back</span>
</span>
```

- [ ] **Step 8: Run the full test suite**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 9: Type-check**

```bash
npm run type-check
```

- [ ] **Step 10: Lint**

```bash
npm run lint
```

Fix any lint errors before proceeding.

- [ ] **Step 11: Commit**

```bash
git add src/features/workspace/WorkspaceView.tsx src/features/workspace/components/TerminalZone.tsx src/features/workspace/components/DockPanel.tsx
git commit -m "feat(workspace): wire activeContainerId, focus helpers, and dock shortcuts in WorkspaceView"
```

---

## Task 10: Manual smoke test + final cleanup

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Smoke test the following flows**

1. Start with terminal zone lit, dock neutral — click dock → dock border turns mauve (`#cba6f7`), terminal dims to 65% opacity
2. Click terminal zone → terminal zone lit again, dock border neutral
3. Press `Ctrl+e` → dock opens (if closed), editor tab active, dock lit
4. Press `Ctrl+g` → diff tab active, dock lit
5. Press `Ctrl+b` from dock → terminal zone regains focus
6. Press `Ctrl+b` from terminal → NO zone change (passes through to xterm)
7. Press `Ctrl+1` (single-pane) from dock → terminal zone regains focus
8. Close dock (× button) → terminal zone regains focus automatically
9. Open a file from the sidebar → file loads in editor WITHOUT stealing focus from terminal (if terminal is active)
10. Click a session tab → terminal zone becomes active

- [ ] **Step 3: Run the complete test suite one final time**

```bash
npm run test
npm run type-check
npm run lint
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: shared-focus-highlight smoke test verified"
```

---

## Self-Review

### Spec Coverage

| Spec Section                                            | Covered by Task        |
| ------------------------------------------------------- | ---------------------- |
| §3 State model: `activeContainerId`, constants          | Task 1, Task 9         |
| §4 Visual: DockPanel mauve border + shadow              | Task 5                 |
| §4 Visual: TerminalZone opacity dim                     | Task 4                 |
| §5.1 Click focus transfer (pointer + focus events)      | Task 4, Task 5, Task 9 |
| §5.1 Session-intent wrappers                            | Task 9                 |
| §5.2 `requestFocus` + `useLayoutEffect` mechanism       | Task 9                 |
| §5.2 Ref chain: TerminalZone → SplitView → TerminalPane | Task 2, Task 3, Task 4 |
| §5.2 DockPanel ref: focusEditor + focusDiff             | Task 5                 |
| §5.2 CodeEditor auto-focus gate + imperative handle     | Task 6                 |
| §5.2 `Ctrl+e/g/b` shortcuts                             | Task 8                 |
| §5.3 Toolbar hint update                                | Task 9 (step 7)        |
| §6.3 `useDockShortcuts` with all guards                 | Task 8                 |
| §6.4 `usePaneShortcuts` container-reclaim truth table   | Task 7                 |
| §6.5 `openDock`, `claimTerminal`, `closeDock` helpers   | Task 9                 |
| §6.5 `onTerminalZoneFocus` callback                     | Task 9                 |
| §7 Tests                                                | Tasks 2-9              |

### Potential Issues Flagged for Implementor

1. **`TerminalPane/index.test.tsx`** — the test file may not exist. Check `ls src/features/terminal/components/TerminalPane/` before writing the test file. The mock infrastructure in that directory should be inspected to understand how `Body` is mocked.

2. **`SplitView.test.tsx`** — inspect the existing `makeSession` helper and mock setup before adding the new test to ensure the helper signature matches.

3. **`DockPanel` ref threading in Task 5** — `editorHandleRef` needs to be forwarded as a `ref` to `CodeEditor`. This requires importing `CodeEditorHandle` and `CodeEditor` ref after Task 6 is complete. Do Task 6 before Task 5's final wiring if the types cause compile errors. (Tasks 5 and 6 can be swapped if needed.)

4. **`openDock` stale dockTab** — When `openDock()` is called without an explicit tab from `DockPeekButton`, it reads `dockTab` from the closure. Add `dockTab` to the `useCallback` deps (`[dockTab, requestFocus]`) to ensure the latest value is always used.

5. **New-session focus** — `handleCreateSession` calls `claimTerminal()` synchronously, but the new pane may not be mounted yet (async IPC). The `useLayoutEffect` will attempt `focusActivePane()` which may return `false` and fall back to the zone div. This is acceptable for the initial PR (best-effort) per spec §5.1 note.
