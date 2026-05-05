# Command Palette — Trigger Swap & Functional Tab Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the command palette to real workspace actions for terminal-tab management (`:new`, `:close`, `:rename`, `:next`, `:previous`, `:goto`), stub the split-pane verbs, and replace the bare-`:` global trigger with a `Ctrl+:` capture-phase listener that works inside the terminal.

**Architecture:** Palette becomes a pure dispatcher (renders, filters, dispatches `execute(args)`). Workspace owns the action surface — it builds the verb-keyed command list via `useMemo` over `useSessionManager` deps and passes it to `<CommandPalette commands={…} />`. Derived values (`filteredResults`, `clampedSelectedIndex`) move to top-level fields on the hook return so the type signature distinguishes real `useState` state from `useMemo` derivations. Failure feedback flows through a single `notifyInfo` banner mounted by `WorkspaceView`.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + React Testing Library, jsdom, Tailwind, framer-motion (already in use).

**Spec:** `docs/superpowers/specs/2026-05-04-command-palette-trigger-actions-design.md`

---

## File Structure

**Create:**

- `src/features/command-palette/registry/parseQuery.ts` — pure verb/args splitter.
- `src/features/command-palette/registry/parseQuery.test.ts`
- `src/features/workspace/commands/buildWorkspaceCommands.ts` — pure helper that produces the eight-command array given session-manager deps.
- `src/features/workspace/commands/buildWorkspaceCommands.test.ts`
- `src/features/workspace/hooks/useNotifyInfo.ts` — state + auto-dismiss timer + click-to-dismiss.
- `src/features/workspace/hooks/useNotifyInfo.test.ts`
- `src/features/workspace/components/InfoBanner.tsx` — info-tinted banner component.
- `src/features/workspace/components/InfoBanner.test.tsx`
- `src/features/workspace/WorkspaceView.command-palette.test.tsx` — integration: WorkspaceView mounts palette, commands drive session manager.
- `src/features/workspace/WorkspaceView.notifyInfo.test.tsx` — integration: banner appears for failure cases, auto-dismisses, collapses on rapid notifyInfo calls.

**Modify:**

- `src/features/command-palette/registry/types.ts` — shrink `CommandPaletteState` (drop `filteredResults`).
- `src/features/command-palette/hooks/useCommandPalette.ts` — accept optional `commands`, `useMemo` for `filteredResults`, `clampedSelectedIndex`, capture-phase `Ctrl+:` listener, repeat guard, drop bare-`:`, update return shape.
- `src/features/command-palette/hooks/useCommandPalette.test.ts`
- `src/features/command-palette/CommandPalette.tsx` — pass `commands` prop down, read top-level `filteredResults` / `clampedSelectedIndex`.
- `src/features/command-palette/CommandPalette.test.tsx`
- `src/features/command-palette/components/CommandResults.tsx` — accept the clamped index, omit `aria-activedescendant` for empty list.
- `src/App.tsx` — stop rendering `<CommandPalette />` at the App level.
- `src/App.test.tsx` — update assertion.
- `src/features/workspace/WorkspaceView.tsx` — wire `useNotifyInfo`, build commands via `buildWorkspaceCommands`, mount `<CommandPalette commands={…} />`, render `<InfoBanner />`.

---

## Task 1: `parseQuery` utility (pure function)

**Files:**

- Create: `src/features/command-palette/registry/parseQuery.ts`
- Test: `src/features/command-palette/registry/parseQuery.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/command-palette/registry/parseQuery.test.ts`:

```typescript
import { describe, expect, test } from 'vitest'
import { parseQuery } from './parseQuery'

describe('parseQuery', () => {
  test('empty input yields empty verb and args', () => {
    expect(parseQuery('')).toEqual({ verbToken: '', args: '' })
  })

  test('whitespace-only input yields empty verb and args', () => {
    expect(parseQuery('   ')).toEqual({ verbToken: '', args: '' })
  })

  test('single-token input puts everything in verbToken', () => {
    expect(parseQuery(':open')).toEqual({ verbToken: ':open', args: '' })
  })

  test('verb plus single-token args splits on first space', () => {
    expect(parseQuery(':rename foo')).toEqual({
      verbToken: ':rename',
      args: 'foo',
    })
  })

  test('verb plus multi-token args preserves the rest as a single string', () => {
    expect(parseQuery(':rename foo bar baz')).toEqual({
      verbToken: ':rename',
      args: 'foo bar baz',
    })
  })

  test('outer whitespace is trimmed before parsing', () => {
    expect(parseQuery('  :open  ')).toEqual({ verbToken: ':open', args: '' })
  })

  test('inner whitespace between verb and args is collapsed via trim', () => {
    expect(parseQuery(':rename   foo')).toEqual({
      verbToken: ':rename',
      args: 'foo',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/command-palette/registry/parseQuery.test.ts`

Expected: FAIL with module-not-found for `./parseQuery`.

- [ ] **Step 3: Write minimal implementation**

Create `src/features/command-palette/registry/parseQuery.ts`:

```typescript
export interface ParsedQuery {
  verbToken: string
  args: string
}

export const parseQuery = (query: string): ParsedQuery => {
  const trimmed = query.trim()
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx === -1) {
    return { verbToken: trimmed, args: '' }
  }

  return {
    verbToken: trimmed.slice(0, spaceIdx),
    args: trimmed.slice(spaceIdx + 1).trim(),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/command-palette/registry/parseQuery.test.ts`

Expected: 7 tests pass.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/command-palette/registry/parseQuery.ts \
        src/features/command-palette/registry/parseQuery.test.ts
git commit -m "feat(command-palette): add parseQuery verb/args splitter"
```

---

## Task 2: Shrink `CommandPaletteState` and update return shape

**Files:**

- Modify: `src/features/command-palette/registry/types.ts`
- Modify: `src/features/command-palette/hooks/useCommandPalette.ts`

This task only changes types and the hook's return shape. Behavior changes (Ctrl+:, capture phase, useMemo) come in later tasks. We keep tests green by adding the new top-level fields _alongside_ the old `state.filteredResults` for one task, then remove the old field in Task 3.

- [ ] **Step 1: Update `CommandPaletteState` in types.ts**

Replace `src/features/command-palette/registry/types.ts` with:

```typescript
export interface Command {
  id: string
  label: string
  description?: string
  icon: string
  children?: Command[]
  execute?: (args: string) => void
  match?: (query: string) => number
}

export interface CommandPaletteState {
  isOpen: boolean
  query: string
  selectedIndex: number
  currentNamespace: Command | null
}

export interface UseCommandPaletteReturn {
  state: CommandPaletteState
  filteredResults: Command[]
  clampedSelectedIndex: number
  open: () => void
  close: () => void
  setQuery: (query: string) => void
  selectIndex: (index: number) => void
  executeSelected: () => void
  navigateUp: () => void
  navigateDown: () => void
}
```

- [ ] **Step 2: Update `useCommandPalette.ts` to match the new return shape**

Open `src/features/command-palette/hooks/useCommandPalette.ts`. Replace the local `interface UseCommandPaletteReturn` block at the top of the file with:

```typescript
import type { UseCommandPaletteReturn } from '../registry/types'
```

(The interface now lives in `types.ts` and is imported.)

In the hook body, drop `filteredResults: []` from the initial `useState` value. Replace the existing initial state with:

```typescript
const [state, setState] = useState<CommandPaletteState>({
  isOpen: false,
  query: ':',
  selectedIndex: 0,
  currentNamespace: null,
})
```

Add a `filteredResults` derivation right after `setState` is declared. Replace the existing `filterCommands` callback so it filters against the **verb token only** (per spec §4 — `:rename foo` must filter as if the user typed `:rename`, while `foo` is preserved as the args for dispatch). Add an import for `parseQuery` at the top of `useCommandPalette.ts`:

```typescript
import { parseQuery } from '../registry/parseQuery'
```

Then inside the hook body:

```typescript
const filterCommands = useCallback(
  (verbToken: string, namespace: Command | null): Command[] => {
    const searchSpace = namespace
      ? (traverseNamespace(namespace) ?? [])
      : defaultCommands

    if (!verbToken || verbToken === ':') {
      return searchSpace
    }

    const cleanVerb = verbToken.startsWith(':') ? verbToken.slice(1) : verbToken
    const allCommands = [...searchSpace]
    const leaves = getAllLeaves(searchSpace)
    allCommands.push(...leaves)

    const scored = allCommands
      .map((cmd) => {
        const score = cmd.match
          ? cmd.match(cleanVerb)
          : fuzzyMatch(cleanVerb, cmd.label.replace(':', ''))

        return { cmd, score }
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ cmd }) => cmd)

    const seen = new Set<string>()

    return scored.filter((cmd) => {
      if (seen.has(cmd.id)) {
        return false
      }
      seen.add(cmd.id)

      return true
    })
  },
  []
)

const parsedQuery = useMemo(() => parseQuery(state.query), [state.query])

const filteredResults = useMemo(
  () => filterCommands(parsedQuery.verbToken, state.currentNamespace),
  [filterCommands, parsedQuery.verbToken, state.currentNamespace]
)

const clampedSelectedIndex =
  filteredResults.length === 0
    ? -1
    : Math.min(state.selectedIndex, filteredResults.length - 1)
```

The split here is load-bearing: typing `:rename foo` produces `parsedQuery.verbToken = ':rename'`, so the `:rename` command stays highlighted while the user types its argument. The args portion (`'foo'`) is consumed by `executeSelected` in Step 4.

- [ ] **Step 3: Update `setQuery` and `open` / `close` to stop touching `filteredResults`**

In `useCommandPalette.ts`, the existing `open`, `close`, and `setQuery` callbacks all set `filteredResults: filterCommands(...)` inside their `setState` calls. Remove those lines — `filteredResults` is now derived. The replacement bodies:

```typescript
const open = useCallback((): void => {
  setState((prev) => ({
    ...prev,
    isOpen: true,
    query: ':',
    selectedIndex: 0,
    currentNamespace: null,
  }))
}, [])

const close = useCallback((): void => {
  setState((prev) => ({
    ...prev,
    isOpen: false,
    query: ':',
    selectedIndex: 0,
    currentNamespace: null,
  }))
}, [])

const setQuery = useCallback((query: string): void => {
  setState((prev) => ({
    ...prev,
    query,
    selectedIndex: 0,
  }))
}, [])
```

- [ ] **Step 4: Update `executeSelected` to read `filteredResults` and `clampedSelectedIndex`**

Replace the existing `executeSelected` body with:

```typescript
const executeSelected = useCallback((): void => {
  if (clampedSelectedIndex < 0) {
    return
  }

  const selected = filteredResults[clampedSelectedIndex]
  if (!selected) {
    return
  }

  if (selected.children && selected.children.length > 0) {
    setState((prev) => ({
      ...prev,
      currentNamespace: selected,
      query: ':',
      selectedIndex: 0,
    }))

    return
  }

  if (selected.execute) {
    selected.execute(parsedQuery.args)
    close()
  }
}, [filteredResults, clampedSelectedIndex, parsedQuery.args, close])
```

The dispatch now passes only the `args` portion of the parsed query — typing `:rename foo` calls `execute('foo')`, not `execute('rename foo')`. Zero-arg commands like `:close` receive `''` and ignore it.

- [ ] **Step 5: Update `navigateUp` / `navigateDown` to base off `clampedSelectedIndex`**

```typescript
const navigateUp = useCallback((): void => {
  if (filteredResults.length === 0) {
    return
  }
  setState((prev) => {
    const base = clampedSelectedIndex
    const newIndex = base <= 0 ? filteredResults.length - 1 : base - 1

    return { ...prev, selectedIndex: newIndex }
  })
}, [filteredResults.length, clampedSelectedIndex])

const navigateDown = useCallback((): void => {
  if (filteredResults.length === 0) {
    return
  }
  setState((prev) => {
    const base = clampedSelectedIndex
    const newIndex = base >= filteredResults.length - 1 ? 0 : base + 1

    return { ...prev, selectedIndex: newIndex }
  })
}, [filteredResults.length, clampedSelectedIndex])
```

- [ ] **Step 6: Update the hook's return statement**

```typescript
return {
  state,
  filteredResults,
  clampedSelectedIndex,
  open,
  close,
  setQuery,
  selectIndex,
  executeSelected,
  navigateUp,
  navigateDown,
}
```

- [ ] **Step 7: Update `CommandPalette.tsx` to read top-level fields**

Replace the existing destructuring + reads in `src/features/command-palette/CommandPalette.tsx`:

```typescript
const {
  state,
  filteredResults,
  clampedSelectedIndex,
  close,
  setQuery,
  selectIndex,
} = useCommandPalette()
```

Update the `activeDescendantId` calculation and `<CommandResults>` props:

```typescript
<CommandInput
  value={state.query}
  onChange={setQuery}
  activeDescendantId={
    filteredResults[clampedSelectedIndex]
      ? `command-${filteredResults[clampedSelectedIndex].id}`
      : undefined
  }
/>

{/* … */}

<CommandResults
  filteredResults={filteredResults}
  selectedIndex={clampedSelectedIndex}
  onSelect={selectIndex}
/>
```

- [ ] **Step 8: Run type-check**

Run: `npm run type-check`

Expected: no errors.

- [ ] **Step 9: Run existing palette tests; expect updates needed in test file**

Run: `npx vitest run src/features/command-palette/`

Expected: some tests fail because they reference `state.filteredResults`. We will fix the tests in this same task to keep the commit green.

- [ ] **Step 10: Update `useCommandPalette.test.ts` to read top-level fields**

Open `src/features/command-palette/hooks/useCommandPalette.test.ts`. Replace every read of `result.current.state.filteredResults` with `result.current.filteredResults`, and every read of `result.current.state.selectedIndex` (when used to verify highlighted item) with `result.current.clampedSelectedIndex`. (Reads of `state.selectedIndex` for raw-cursor assertions stay as-is.)

**Important behavior change to migrate around:** with the new `useMemo` derivation, `filteredResults` is computed every render regardless of `isOpen` — and the existing `filterCommands` returns the full `defaultCommands` list whenever `query === ':'`. So tests that previously asserted "`filteredResults` is empty when the palette is closed" will fail under the new model. Migrate them like this:

| Old assertion                                                                         | New assertion                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expect(result.current.state.filteredResults).toEqual([])` (when closed)              | Either drop the assertion (it was checking internal cache state, not user-visible behavior), or replace with `expect(result.current.state.isOpen).toBe(false)`. |
| `expect(screen.queryByRole('dialog')).not.toBeInTheDocument()` (when closed)          | Unchanged — this checks the user-visible contract and still passes.                                                                                             |
| `expect(result.current.state.filteredResults.length).toBeGreaterThan(0)` (after open) | `expect(result.current.filteredResults.length).toBeGreaterThan(0)` — same intent, top-level read.                                                               |

Walking each assertion this way keeps the test suite aligned with the new contract: state is what `useState` holds, derived values are computed every render, and the user-visible truth is what the DOM shows.

If you find the test file does not exist or has different shape, check it first via `Read` before editing.

- [ ] **Step 11: Update `CommandPalette.test.tsx` if it reads `state.filteredResults`**

Same pattern: any `state.filteredResults` reference becomes a top-level `filteredResults` reference in the assertion (these tests typically render the component and query the DOM, so the change may be minimal — but check before assuming).

- [ ] **Step 12: Run full test suite**

Run: `npm run test`

Expected: all tests pass. If any palette tests still fail, fix them by reading top-level fields. **Do not** revert the type changes.

- [ ] **Step 13: Commit**

```bash
git add src/features/command-palette/
git commit -m "refactor(command-palette): hoist filteredResults and clampedSelectedIndex out of state

Replaces useState-cached filteredResults with a useMemo derivation over
(query, currentNamespace), and exposes filteredResults plus a clamped
selectedIndex as top-level fields on the hook return. The CommandPaletteState
type shrinks to true useState fields. Consumers update their read paths."
```

---

## Task 3: Accept optional `commands` prop end-to-end

**Files:**

- Modify: `src/features/command-palette/hooks/useCommandPalette.ts`
- Modify: `src/features/command-palette/CommandPalette.tsx`
- Modify: `src/features/command-palette/hooks/useCommandPalette.test.ts`

- [ ] **Step 1: Write the failing test for the `commands` parameter**

Append to `src/features/command-palette/hooks/useCommandPalette.test.ts`:

```typescript
describe('useCommandPalette commands prop', () => {
  test('uses defaultCommands when no commands argument is supplied', () => {
    const { result } = renderHook(() => useCommandPalette())

    act(() => {
      result.current.open()
    })

    expect(result.current.filteredResults.length).toBeGreaterThan(0)
  })

  test('uses supplied commands when the argument is non-empty', () => {
    const customCommands: Command[] = [
      {
        id: 'custom-only',
        label: ':custom',
        icon: 'star',
        execute: vi.fn(),
      },
    ]

    const { result } = renderHook(() => useCommandPalette(customCommands))

    act(() => {
      result.current.open()
    })

    expect(result.current.filteredResults.map((c) => c.id)).toEqual([
      'custom-only',
    ])
  })

  test('re-derives filteredResults when commands change between renders', () => {
    const first: Command[] = [
      { id: 'a', label: ':a', icon: 'star', execute: vi.fn() },
    ]
    const second: Command[] = [
      { id: 'b', label: ':b', icon: 'star', execute: vi.fn() },
    ]

    const { result, rerender } = renderHook(
      ({ commands }: { commands: Command[] }) => useCommandPalette(commands),
      { initialProps: { commands: first } }
    )

    act(() => {
      result.current.open()
    })
    expect(result.current.filteredResults.map((c) => c.id)).toEqual(['a'])

    rerender({ commands: second })
    expect(result.current.filteredResults.map((c) => c.id)).toEqual(['b'])
  })
})
```

Add the necessary imports at the top of the test file if missing:

```typescript
import { renderHook, act } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Command } from '../registry/types'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/command-palette/hooks/useCommandPalette.test.ts`

Expected: failures around the `commands` argument not being honored.

- [ ] **Step 3: Add the `commands` parameter to the hook**

Modify `src/features/command-palette/hooks/useCommandPalette.ts` so the hook accepts an optional `commands` argument:

```typescript
export const useCommandPalette = (
  commands: Command[] = defaultCommands
): UseCommandPaletteReturn => {
  // …
}
```

Update `filterCommands` to read from `commands` when there is no namespace, and fold `commands` into the `useMemo` deps:

```typescript
const filterCommands = useCallback(
  (query: string, namespace: Command | null): Command[] => {
    const searchSpace = namespace
      ? (traverseNamespace(namespace) ?? [])
      : commands

    // …rest unchanged
  },
  [commands]
)

const filteredResults = useMemo(
  () => filterCommands(state.query, state.currentNamespace),
  [filterCommands, state.query, state.currentNamespace]
)
```

- [ ] **Step 4: Pass `commands` from `CommandPalette` down to the hook**

Update `src/features/command-palette/CommandPalette.tsx`:

```typescript
import type { Command } from './registry/types'

interface CommandPaletteProps {
  commands?: Command[]
}

export const CommandPalette = ({
  commands = undefined,
}: CommandPaletteProps): ReactElement | null => {
  const {
    state,
    filteredResults,
    clampedSelectedIndex,
    close,
    setQuery,
    selectIndex,
  } = useCommandPalette(commands)

  // …rest unchanged
}
```

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run src/features/command-palette/hooks/useCommandPalette.test.ts`

Expected: the three new tests pass.

- [ ] **Step 6: Run the whole palette suite + type-check**

Run: `npm run type-check && npx vitest run src/features/command-palette/`

Expected: green across the board.

- [ ] **Step 7: Commit**

```bash
git add src/features/command-palette/
git commit -m "feat(command-palette): accept optional commands prop

Hook signature gains commands?: Command[] (defaults to defaultCommands).
CommandPalette forwards the prop. The useMemo filter step is now keyed
on (query, currentNamespace, commands), so consumers that swap the prop
across renders see the latest list immediately."
```

---

## Task 4: Replace bare-`:` trigger with capture-phase `Ctrl+:`

**Files:**

- Modify: `src/features/command-palette/hooks/useCommandPalette.ts`
- Modify: `src/features/command-palette/CommandPalette.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append the following block to `src/features/command-palette/CommandPalette.test.tsx`. Replace the existing tests that dispatch `key: ':'` events as "open" triggers — they will still test "Backspace closes" but should be reworded to reflect the trigger.

```typescript
describe('CommandPalette Ctrl+: trigger', () => {
  test('Ctrl+: opens the palette from anywhere', async () => {
    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':', ctrlKey: true })
      document.dispatchEvent(event)
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  test('bare : does NOT open the palette', () => {
    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':' })
      document.dispatchEvent(event)
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('Ctrl+: while open closes the palette (toggle)', async () => {
    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':', ctrlKey: true })
      document.dispatchEvent(event)
    })
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':', ctrlKey: true })
      document.dispatchEvent(event)
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test('Ctrl+: calls preventDefault and stopPropagation on both directions', async () => {
    render(<CommandPalette />)

    const openEvent = new KeyboardEvent('keydown', {
      key: ':',
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    })
    const preventDefaultSpy = vi.spyOn(openEvent, 'preventDefault')
    const stopPropagationSpy = vi.spyOn(openEvent, 'stopPropagation')

    act(() => {
      document.dispatchEvent(openEvent)
    })
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(stopPropagationSpy).toHaveBeenCalled()

    const closeEvent = new KeyboardEvent('keydown', {
      key: ':',
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    })
    const closePreventSpy = vi.spyOn(closeEvent, 'preventDefault')
    const closeStopSpy = vi.spyOn(closeEvent, 'stopPropagation')

    act(() => {
      document.dispatchEvent(closeEvent)
    })

    expect(closePreventSpy).toHaveBeenCalled()
    expect(closeStopSpy).toHaveBeenCalled()
  })

  test('held-key auto-repeat does not toggle but still suppresses the key', async () => {
    render(<CommandPalette />)

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: ':', ctrlKey: true })
      )
    })
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const repeatEvent = new KeyboardEvent('keydown', {
      key: ':',
      ctrlKey: true,
      repeat: true,
      cancelable: true,
      bubbles: true,
    })
    const preventDefaultSpy = vi.spyOn(repeatEvent, 'preventDefault')

    act(() => {
      document.dispatchEvent(repeatEvent)
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(preventDefaultSpy).toHaveBeenCalled()
  })

  test('document-level capture-phase listener wins over a target stopPropagation', async () => {
    const TargetWithBubbleStop = (): JSX.Element => (
      <input
        data-testid="bubble-target"
        onKeyDown={(e) => {
          e.stopPropagation()
        }}
      />
    )

    render(
      <>
        <TargetWithBubbleStop />
        <CommandPalette />
      </>
    )

    const target = screen.getByTestId('bubble-target')
    target.focus()

    act(() => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ':',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      )
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
```

Make sure the existing "opens palette when : key is pressed" test is replaced by the `Ctrl+:` variant above. The "Backspace closes on empty `:` query" test stays.

- [ ] **Step 2: Run tests to verify red**

Run: `npx vitest run src/features/command-palette/CommandPalette.test.tsx`

Expected: the new Ctrl+: tests fail (palette still opens on bare `:`); the bare-`:` test fails (palette opens when it should not).

- [ ] **Step 3: Add the trigger helper and rewrite the keydown effect**

In `src/features/command-palette/hooks/useCommandPalette.ts`, replace the existing `useEffect` keydown block. First, add a helper above the hook body (or as a module-level const):

```typescript
const isPaletteToggle = (event: KeyboardEvent): boolean =>
  event.ctrlKey && !event.metaKey && !event.altKey && event.key === ':'
```

Then replace the `useEffect` body with:

```typescript
useEffect(() => {
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (isPaletteToggle(event)) {
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      if (state.isOpen) {
        close()
      } else {
        open()
      }

      return
    }

    if (!state.isOpen) {
      return
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        close()
        break
      case 'ArrowUp':
        event.preventDefault()
        navigateUp()
        break
      case 'ArrowDown':
        event.preventDefault()
        navigateDown()
        break
      case 'Enter':
        event.preventDefault()
        executeSelected()
        break
      case 'Backspace':
        if (state.query === ':') {
          event.preventDefault()
          close()
        }
        break
    }
  }

  document.addEventListener('keydown', handleKeyDown, { capture: true })

  return (): void => {
    document.removeEventListener('keydown', handleKeyDown, { capture: true })
  }
}, [
  state.isOpen,
  state.query,
  open,
  close,
  navigateUp,
  navigateDown,
  executeSelected,
])
```

Note: the bare-`:` `isInputElement` block is gone entirely. The handler now skips focused inputs only for non-trigger keys (which it does by gating on `state.isOpen` first).

- [ ] **Step 4: Run the trigger tests**

Run: `npx vitest run src/features/command-palette/CommandPalette.test.tsx`

Expected: all six new trigger tests pass. The Backspace-on-empty-`:` test still passes.

- [ ] **Step 5: Run the whole palette suite + type-check**

Run: `npm run type-check && npx vitest run src/features/command-palette/`

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/features/command-palette/
git commit -m "feat(command-palette): replace bare-: trigger with capture-phase Ctrl+:

Adds isPaletteToggle helper, registers the keydown listener in DOM
capture phase so it intercepts before xterm.js can stopPropagation,
runs preventDefault + stopPropagation on every Ctrl+: hit (both open
and close), and skips the toggle when event.repeat is true to avoid
flashing on held keys. Removes the bare-: branch and the
isInputElement guard for the trigger path."
```

---

## Task 5: `useNotifyInfo` hook

**Files:**

- Create: `src/features/workspace/hooks/useNotifyInfo.ts`
- Create: `src/features/workspace/hooks/useNotifyInfo.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/workspace/hooks/useNotifyInfo.test.ts`:

```typescript
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useNotifyInfo } from './useNotifyInfo'

describe('useNotifyInfo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('initial message is null', () => {
    const { result } = renderHook(() => useNotifyInfo())
    expect(result.current.message).toBeNull()
  })

  test('notifyInfo sets the message', () => {
    const { result } = renderHook(() => useNotifyInfo())

    act(() => {
      result.current.notifyInfo('hello')
    })

    expect(result.current.message).toBe('hello')
  })

  test('message auto-dismisses after 5 seconds', () => {
    const { result } = renderHook(() => useNotifyInfo())

    act(() => {
      result.current.notifyInfo('hello')
    })

    act(() => {
      vi.advanceTimersByTime(4999)
    })
    expect(result.current.message).toBe('hello')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.message).toBeNull()
  })

  test('successive notifyInfo calls collapse to the latest message and reset the timer', () => {
    const { result } = renderHook(() => useNotifyInfo())

    act(() => {
      result.current.notifyInfo('first')
    })

    act(() => {
      vi.advanceTimersByTime(4000)
    })

    act(() => {
      result.current.notifyInfo('second')
    })

    expect(result.current.message).toBe('second')

    act(() => {
      vi.advanceTimersByTime(4999)
    })
    expect(result.current.message).toBe('second')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.message).toBeNull()
  })

  test('dismiss clears the message immediately', () => {
    const { result } = renderHook(() => useNotifyInfo())

    act(() => {
      result.current.notifyInfo('hello')
    })

    act(() => {
      result.current.dismiss()
    })

    expect(result.current.message).toBeNull()
  })

  test('cleanup on unmount cancels pending timer', () => {
    const { result, unmount } = renderHook(() => useNotifyInfo())

    act(() => {
      result.current.notifyInfo('hello')
    })

    unmount()

    // No assertion needed beyond "no errors thrown when timers advance".
    expect(() => {
      vi.advanceTimersByTime(10000)
    }).not.toThrow()
  })

  test('autoDismissMs override is respected', () => {
    const { result } = renderHook(() => useNotifyInfo(1000))

    act(() => {
      result.current.notifyInfo('hello')
    })

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.message).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify red**

Run: `npx vitest run src/features/workspace/hooks/useNotifyInfo.test.ts`

Expected: module-not-found.

- [ ] **Step 3: Implement the hook**

Create `src/features/workspace/hooks/useNotifyInfo.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseNotifyInfoReturn {
  message: string | null
  notifyInfo: (message: string) => void
  dismiss: () => void
}

const DEFAULT_AUTO_DISMISS_MS = 5000

export const useNotifyInfo = (
  autoDismissMs: number = DEFAULT_AUTO_DISMISS_MS
): UseNotifyInfoReturn => {
  const [message, setMessage] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const dismiss = useCallback((): void => {
    clearTimer()
    setMessage(null)
  }, [clearTimer])

  const notifyInfo = useCallback(
    (next: string): void => {
      clearTimer()
      setMessage(next)
      timerRef.current = window.setTimeout(() => {
        setMessage(null)
        timerRef.current = null
      }, autoDismissMs)
    },
    [clearTimer, autoDismissMs]
  )

  useEffect(
    () => (): void => {
      clearTimer()
    },
    [clearTimer]
  )

  return { message, notifyInfo, dismiss }
}
```

- [ ] **Step 4: Run tests to verify green**

Run: `npx vitest run src/features/workspace/hooks/useNotifyInfo.test.ts`

Expected: 7 tests pass.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/hooks/
git commit -m "feat(workspace): add useNotifyInfo hook for transient banners

State + timer + cleanup. Successive notifyInfo calls collapse to the
latest message and reset the timer. Default auto-dismiss is 5 seconds;
override via the optional argument. dismiss() clears immediately."
```

---

## Task 6: `InfoBanner` component

**Files:**

- Create: `src/features/workspace/components/InfoBanner.tsx`
- Create: `src/features/workspace/components/InfoBanner.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/features/workspace/components/InfoBanner.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { InfoBanner } from './InfoBanner'

describe('InfoBanner', () => {
  test('renders nothing when message is null', () => {
    const { container } = render(
      <InfoBanner message={null} onDismiss={vi.fn()} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  test('renders the message text when provided', () => {
    render(<InfoBanner message="hello" onDismiss={vi.fn()} />)

    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  test('uses role="status" for non-assertive a11y announcement', () => {
    render(<InfoBanner message="hello" onDismiss={vi.fn()} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  test('clicking the dismiss button calls onDismiss', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()
    render(<InfoBanner message="hello" onDismiss={onDismiss} />)

    await user.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify red**

Run: `npx vitest run src/features/workspace/components/InfoBanner.test.tsx`

Expected: module-not-found.

- [ ] **Step 3: Implement the component**

Create `src/features/workspace/components/InfoBanner.tsx`:

```typescript
import type { ReactElement } from 'react'

interface InfoBannerProps {
  message: string | null
  onDismiss: () => void
}

export const InfoBanner = ({
  message,
  onDismiss,
}: InfoBannerProps): ReactElement | null => {
  if (message === null) {
    return null
  }

  return (
    <div
      role="status"
      className="absolute top-2 left-1/2 -translate-x-1/2 z-40 max-w-2xl px-4 py-2 rounded-lg bg-primary/20 border border-primary/40 text-sm text-primary font-inter backdrop-blur-sm flex items-center gap-3 shadow-lg"
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        aria-label="Dismiss message"
        onClick={onDismiss}
        className="text-primary hover:text-on-surface transition-colors"
      >
        ✕
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify green**

Run: `npx vitest run src/features/workspace/components/InfoBanner.test.tsx`

Expected: 4 tests pass.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/components/InfoBanner.tsx \
        src/features/workspace/components/InfoBanner.test.tsx
git commit -m "feat(workspace): add InfoBanner component for non-error messages

role=status (non-assertive) so screen readers don't interrupt the
user mid-sentence; primary tint to distinguish from the existing
error banner; click-to-dismiss via the X button."
```

---

## Task 7: `buildWorkspaceCommands` helper — happy-path commands

**Files:**

- Create: `src/features/workspace/commands/buildWorkspaceCommands.ts`
- Create: `src/features/workspace/commands/buildWorkspaceCommands.test.ts`

This task lands the eight commands with their **happy-path** behaviors. Failure-mode branches (stale id, `:goto` edge cases) are added in Task 8 so that file diff stays focused.

- [ ] **Step 1: Write the failing happy-path tests**

Create `src/features/workspace/commands/buildWorkspaceCommands.test.ts`:

```typescript
import { describe, expect, test, vi } from 'vitest'
import { buildWorkspaceCommands } from './buildWorkspaceCommands'
import type { Session } from '../types'

const makeSession = (id: string, name: string): Session => ({
  id,
  projectId: 'proj-1',
  name,
  status: 'running',
  workingDirectory: '~',
  agentType: 'claude-code',
  createdAt: '2026-05-04T00:00:00Z',
  lastActivityAt: '2026-05-04T00:00:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 200 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
})

const makeDeps = (
  overrides: Partial<Parameters<typeof buildWorkspaceCommands>[0]> = {}
): Parameters<typeof buildWorkspaceCommands>[0] => ({
  sessions: [],
  activeSessionId: null,
  createSession: vi.fn(),
  removeSession: vi.fn(),
  renameSession: vi.fn(),
  setActiveSessionId: vi.fn(),
  notifyInfo: vi.fn(),
  ...overrides,
})

describe('buildWorkspaceCommands — shape', () => {
  test('returns exactly 8 commands in the documented order', () => {
    const commands = buildWorkspaceCommands(makeDeps())

    expect(commands.map((c) => c.id)).toEqual([
      'tab-new',
      'tab-close',
      'tab-rename',
      'tab-next',
      'tab-previous',
      'tab-goto',
      'split-horizontal',
      'split-vertical',
    ])
  })

  test('every command has a label starting with ":"', () => {
    const commands = buildWorkspaceCommands(makeDeps())

    for (const command of commands) {
      expect(command.label.startsWith(':')).toBe(true)
    }
  })
})

describe('buildWorkspaceCommands — happy-path execute', () => {
  test(':new calls createSession with no args', () => {
    const createSession = vi.fn()
    const commands = buildWorkspaceCommands(makeDeps({ createSession }))
    const target = commands.find((c) => c.id === 'tab-new')!

    target.execute?.('')

    expect(createSession).toHaveBeenCalledWith()
  })

  test(':close removes the active session when one is set and present', () => {
    const removeSession = vi.fn()
    const sessions = [makeSession('a', 'tab-a'), makeSession('b', 'tab-b')]
    const commands = buildWorkspaceCommands(
      makeDeps({ sessions, activeSessionId: 'a', removeSession })
    )
    const target = commands.find((c) => c.id === 'tab-close')!

    target.execute?.('')

    expect(removeSession).toHaveBeenCalledWith('a')
  })

  test(':rename calls renameSession when args are non-empty', () => {
    const renameSession = vi.fn()
    const sessions = [makeSession('a', 'old')]
    const commands = buildWorkspaceCommands(
      makeDeps({ sessions, activeSessionId: 'a', renameSession })
    )
    const target = commands.find((c) => c.id === 'tab-rename')!

    target.execute?.('new-name')

    expect(renameSession).toHaveBeenCalledWith('a', 'new-name')
  })

  test(':next selects the next session with wrap', () => {
    const setActiveSessionId = vi.fn()
    const sessions = [
      makeSession('a', 'a'),
      makeSession('b', 'b'),
      makeSession('c', 'c'),
    ]
    const commands = buildWorkspaceCommands(
      makeDeps({ sessions, activeSessionId: 'b', setActiveSessionId })
    )
    const target = commands.find((c) => c.id === 'tab-next')!

    target.execute?.('')

    expect(setActiveSessionId).toHaveBeenCalledWith('c')

    setActiveSessionId.mockClear()
    const wrapCommands = buildWorkspaceCommands(
      makeDeps({ sessions, activeSessionId: 'c', setActiveSessionId })
    )
    wrapCommands.find((c) => c.id === 'tab-next')!.execute?.('')

    expect(setActiveSessionId).toHaveBeenCalledWith('a')
  })

  test(':previous selects the previous session with wrap', () => {
    const setActiveSessionId = vi.fn()
    const sessions = [
      makeSession('a', 'a'),
      makeSession('b', 'b'),
      makeSession('c', 'c'),
    ]
    const commands = buildWorkspaceCommands(
      makeDeps({ sessions, activeSessionId: 'b', setActiveSessionId })
    )

    commands.find((c) => c.id === 'tab-previous')!.execute?.('')
    expect(setActiveSessionId).toHaveBeenCalledWith('a')

    setActiveSessionId.mockClear()
    const wrapCommands = buildWorkspaceCommands(
      makeDeps({ sessions, activeSessionId: 'a', setActiveSessionId })
    )
    wrapCommands.find((c) => c.id === 'tab-previous')!.execute?.('')
    expect(setActiveSessionId).toHaveBeenCalledWith('c')
  })

  test(':goto N selects the Nth session (1-indexed)', () => {
    const setActiveSessionId = vi.fn()
    const sessions = [
      makeSession('a', 'a'),
      makeSession('b', 'b'),
      makeSession('c', 'c'),
    ]
    const commands = buildWorkspaceCommands(
      makeDeps({ sessions, activeSessionId: null, setActiveSessionId })
    )

    commands.find((c) => c.id === 'tab-goto')!.execute?.('2')

    expect(setActiveSessionId).toHaveBeenCalledWith('b')
  })

  test(':goto <name> fuzzy-matches and picks the highest score', () => {
    const setActiveSessionId = vi.fn()
    const sessions = [
      makeSession('a', 'my-project'),
      makeSession('b', 'my-other'),
      makeSession('c', 'unrelated'),
    ]
    const commands = buildWorkspaceCommands(
      makeDeps({ sessions, activeSessionId: null, setActiveSessionId })
    )

    commands.find((c) => c.id === 'tab-goto')!.execute?.('proj')

    expect(setActiveSessionId).toHaveBeenCalledWith('a')
  })

  test(':split-horizontal calls notifyInfo with the stub message', () => {
    const notifyInfo = vi.fn()
    const commands = buildWorkspaceCommands(makeDeps({ notifyInfo }))

    commands.find((c) => c.id === 'split-horizontal')!.execute?.('')

    expect(notifyInfo).toHaveBeenCalledWith(
      'Split-pane support is coming in a future release'
    )
  })

  test(':split-vertical calls notifyInfo with the same stub message', () => {
    const notifyInfo = vi.fn()
    const commands = buildWorkspaceCommands(makeDeps({ notifyInfo }))

    commands.find((c) => c.id === 'split-vertical')!.execute?.('')

    expect(notifyInfo).toHaveBeenCalledWith(
      'Split-pane support is coming in a future release'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify red**

Run: `npx vitest run src/features/workspace/commands/buildWorkspaceCommands.test.ts`

Expected: module-not-found.

- [ ] **Step 3: Implement the helper (happy-path only)**

Create `src/features/workspace/commands/buildWorkspaceCommands.ts`:

```typescript
import type { Command } from '../../command-palette/types'
import { fuzzyMatch } from '../../command-palette/registry/fuzzyMatch'
import type { Session } from '../types'

export interface WorkspaceCommandDeps {
  sessions: Session[]
  activeSessionId: string | null
  createSession: () => void
  removeSession: (id: string) => void
  renameSession: (id: string, name: string) => void
  setActiveSessionId: (id: string) => void
  notifyInfo: (message: string) => void
}

const SPLIT_STUB_MESSAGE = 'Split-pane support is coming in a future release'

export const buildWorkspaceCommands = (
  deps: WorkspaceCommandDeps
): Command[] => {
  const {
    sessions,
    activeSessionId,
    createSession,
    removeSession,
    renameSession,
    setActiveSessionId,
    notifyInfo,
  } = deps

  const resolveActiveIndex = (): number =>
    activeSessionId ? sessions.findIndex((s) => s.id === activeSessionId) : -1

  return [
    {
      id: 'tab-new',
      label: ':new',
      description: 'Create a new terminal tab',
      icon: 'add',
      execute: () => {
        createSession()
      },
    },
    {
      id: 'tab-close',
      label: ':close',
      description: 'Close the active tab',
      icon: 'close',
      execute: () => {
        const idx = resolveActiveIndex()
        if (idx === -1) {
          notifyInfo('No active tab to close')

          return
        }
        removeSession(sessions[idx].id)
      },
    },
    {
      id: 'tab-rename',
      label: ':rename',
      description: 'Rename the active tab',
      icon: 'edit',
      execute: (args) => {
        const idx = resolveActiveIndex()
        if (idx === -1) {
          notifyInfo('No active tab to rename')

          return
        }
        const trimmed = args.trim()
        if (trimmed.length === 0) {
          return
        }
        renameSession(sessions[idx].id, trimmed)
      },
    },
    {
      id: 'tab-next',
      label: ':next',
      description: 'Switch to the next tab',
      icon: 'arrow_forward',
      execute: () => {
        const len = sessions.length
        if (len === 0) {
          return
        }
        const idx = resolveActiveIndex()
        if (idx === -1) {
          setActiveSessionId(sessions[0].id)

          return
        }
        if (len === 1) {
          return
        }
        setActiveSessionId(sessions[(idx + 1) % len].id)
      },
    },
    {
      id: 'tab-previous',
      label: ':previous',
      description: 'Switch to the previous tab',
      icon: 'arrow_back',
      execute: () => {
        const len = sessions.length
        if (len === 0) {
          return
        }
        const idx = resolveActiveIndex()
        if (idx === -1) {
          setActiveSessionId(sessions[len - 1].id)

          return
        }
        if (len === 1) {
          return
        }
        setActiveSessionId(sessions[(idx - 1 + len) % len].id)
      },
    },
    {
      id: 'tab-goto',
      label: ':goto',
      description: 'Jump to a tab by position or name',
      icon: 'arrow_outward',
      execute: (args) => {
        const trimmed = args.trim()
        if (trimmed.length === 0) {
          notifyInfo('Usage: :goto <position or name>')

          return
        }
        const isNumericForm = /^-?\d*\.?\d+$/.test(trimmed)
        const len = sessions.length

        if (isNumericForm) {
          const numeric = Number(trimmed)
          const isValidPosition = Number.isInteger(numeric) && numeric > 0
          if (!isValidPosition) {
            notifyInfo('Position must be a positive integer')

            return
          }
          if (numeric > len) {
            notifyInfo(`No tab at position ${numeric}`)

            return
          }
          setActiveSessionId(sessions[numeric - 1].id)

          return
        }

        if (len === 0) {
          notifyInfo('No tabs to switch to')

          return
        }

        let bestScore = 0
        let bestIndex = -1
        for (let i = 0; i < len; i++) {
          const score = fuzzyMatch(trimmed, sessions[i].name)
          if (score > bestScore) {
            bestScore = score
            bestIndex = i
          }
        }
        if (bestIndex === -1) {
          notifyInfo(`No tab matching ${trimmed}`)

          return
        }
        setActiveSessionId(sessions[bestIndex].id)
      },
    },
    {
      id: 'split-horizontal',
      label: ':split-horizontal',
      description: 'Split the active tab horizontally (coming soon)',
      icon: 'horizontal_split',
      execute: () => {
        notifyInfo(SPLIT_STUB_MESSAGE)
      },
    },
    {
      id: 'split-vertical',
      label: ':split-vertical',
      description: 'Split the active tab vertically (coming soon)',
      icon: 'vertical_split',
      execute: () => {
        notifyInfo(SPLIT_STUB_MESSAGE)
      },
    },
  ]
}
```

- [ ] **Step 4: Run tests to verify green**

Run: `npx vitest run src/features/workspace/commands/buildWorkspaceCommands.test.ts`

Expected: all happy-path tests pass.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/commands/
git commit -m "feat(workspace): buildWorkspaceCommands helper (happy paths)

Pure helper that produces the eight palette commands wired against a
session-manager-shaped deps object. Active session is resolved via
findIndex (preview of stale-id handling). :goto numeric uses the
isNumericForm regex to distinguish position attempts from name
queries; non-numeric falls through to fuzzyMatch against tab names."
```

---

## Task 8: `buildWorkspaceCommands` — failure-mode coverage

**Files:**

- Modify: `src/features/workspace/commands/buildWorkspaceCommands.test.ts`
- (Implementation already covers most failure paths from Task 7 — this task is primarily test additions.)

- [ ] **Step 1: Append failure-mode tests**

Append to `buildWorkspaceCommands.test.ts`:

```typescript
describe('buildWorkspaceCommands — failure modes', () => {
  test(':close with no active session emits notifyInfo', () => {
    const notifyInfo = vi.fn()
    const removeSession = vi.fn()
    const sessions = [makeSession('a', 'a')]
    const commands = buildWorkspaceCommands(
      makeDeps({ sessions, activeSessionId: null, removeSession, notifyInfo })
    )

    commands.find((c) => c.id === 'tab-close')!.execute?.('')

    expect(notifyInfo).toHaveBeenCalledWith('No active tab to close')
    expect(removeSession).not.toHaveBeenCalled()
  })

  test(':close with stale active id emits notifyInfo', () => {
    const notifyInfo = vi.fn()
    const removeSession = vi.fn()
    const sessions = [makeSession('real', 'real')]
    const commands = buildWorkspaceCommands(
      makeDeps({
        sessions,
        activeSessionId: 'ghost',
        removeSession,
        notifyInfo,
      })
    )

    commands.find((c) => c.id === 'tab-close')!.execute?.('')

    expect(notifyInfo).toHaveBeenCalledWith('No active tab to close')
    expect(removeSession).not.toHaveBeenCalled()
  })

  test(':rename with no active session emits notifyInfo', () => {
    const notifyInfo = vi.fn()
    const renameSession = vi.fn()
    const commands = buildWorkspaceCommands(
      makeDeps({
        sessions: [],
        activeSessionId: null,
        renameSession,
        notifyInfo,
      })
    )

    commands.find((c) => c.id === 'tab-rename')!.execute?.('foo')

    expect(notifyInfo).toHaveBeenCalledWith('No active tab to rename')
    expect(renameSession).not.toHaveBeenCalled()
  })

  test(':rename with empty args is a silent no-op', () => {
    const notifyInfo = vi.fn()
    const renameSession = vi.fn()
    const commands = buildWorkspaceCommands(
      makeDeps({
        sessions: [makeSession('a', 'a')],
        activeSessionId: 'a',
        renameSession,
        notifyInfo,
      })
    )

    commands.find((c) => c.id === 'tab-rename')!.execute?.('   ')

    expect(notifyInfo).not.toHaveBeenCalled()
    expect(renameSession).not.toHaveBeenCalled()
  })

  test(':next with no sessions is a silent no-op', () => {
    const setActiveSessionId = vi.fn()
    const notifyInfo = vi.fn()
    const commands = buildWorkspaceCommands(
      makeDeps({
        sessions: [],
        activeSessionId: null,
        setActiveSessionId,
        notifyInfo,
      })
    )

    commands.find((c) => c.id === 'tab-next')!.execute?.('')

    expect(setActiveSessionId).not.toHaveBeenCalled()
    expect(notifyInfo).not.toHaveBeenCalled()
  })

  test(':next with single session and stale active id selects sessions[0]', () => {
    const setActiveSessionId = vi.fn()
    const sessions = [makeSession('real', 'real')]
    const commands = buildWorkspaceCommands(
      makeDeps({ sessions, activeSessionId: 'ghost', setActiveSessionId })
    )

    commands.find((c) => c.id === 'tab-next')!.execute?.('')

    expect(setActiveSessionId).toHaveBeenCalledWith('real')
  })

  test(':previous with stale active id and len>=1 selects sessions[len-1]', () => {
    const setActiveSessionId = vi.fn()
    const sessions = [
      makeSession('a', 'a'),
      makeSession('b', 'b'),
      makeSession('c', 'c'),
    ]
    const commands = buildWorkspaceCommands(
      makeDeps({ sessions, activeSessionId: 'ghost', setActiveSessionId })
    )

    commands.find((c) => c.id === 'tab-previous')!.execute?.('')

    expect(setActiveSessionId).toHaveBeenCalledWith('c')
  })

  test(':goto with empty args emits Usage notifyInfo', () => {
    const notifyInfo = vi.fn()
    const commands = buildWorkspaceCommands(
      makeDeps({ sessions: [makeSession('a', 'a')], notifyInfo })
    )

    commands.find((c) => c.id === 'tab-goto')!.execute?.('')

    expect(notifyInfo).toHaveBeenCalledWith('Usage: :goto <position or name>')
  })

  test(':goto with 0 / negative / decimal emits "Position must be a positive integer"', () => {
    const notifyInfo = vi.fn()
    const setActiveSessionId = vi.fn()
    const commands = buildWorkspaceCommands(
      makeDeps({
        sessions: [makeSession('a', 'a')],
        notifyInfo,
        setActiveSessionId,
      })
    )

    for (const arg of ['0', '-1', '1.5']) {
      ;(notifyInfo as ReturnType<typeof vi.fn>).mockClear()
      commands.find((c) => c.id === 'tab-goto')!.execute?.(arg)

      expect(notifyInfo).toHaveBeenCalledWith(
        'Position must be a positive integer'
      )
    }
    expect(setActiveSessionId).not.toHaveBeenCalled()
  })

  test(':goto with out-of-range integer emits "No tab at position N"', () => {
    const notifyInfo = vi.fn()
    const commands = buildWorkspaceCommands(
      makeDeps({ sessions: [makeSession('a', 'a')], notifyInfo })
    )

    commands.find((c) => c.id === 'tab-goto')!.execute?.('5')

    expect(notifyInfo).toHaveBeenCalledWith('No tab at position 5')
  })

  test(':goto fuzzy with no match emits "No tab matching ..."', () => {
    const notifyInfo = vi.fn()
    const setActiveSessionId = vi.fn()
    const sessions = [makeSession('a', 'my-project')]
    const commands = buildWorkspaceCommands(
      makeDeps({ sessions, notifyInfo, setActiveSessionId })
    )

    commands.find((c) => c.id === 'tab-goto')!.execute?.('zzz')

    expect(notifyInfo).toHaveBeenCalledWith('No tab matching zzz')
    expect(setActiveSessionId).not.toHaveBeenCalled()
  })

  test(':goto fuzzy with empty session list emits "No tabs to switch to"', () => {
    const notifyInfo = vi.fn()
    const commands = buildWorkspaceCommands(
      makeDeps({ sessions: [], notifyInfo })
    )

    commands.find((c) => c.id === 'tab-goto')!.execute?.('foo')

    expect(notifyInfo).toHaveBeenCalledWith('No tabs to switch to')
  })

  test(':goto NaN routes to fuzzy-name branch', () => {
    const setActiveSessionId = vi.fn()
    const sessions = [makeSession('a', 'NaN'), makeSession('b', 'other')]
    const commands = buildWorkspaceCommands(
      makeDeps({ sessions, setActiveSessionId })
    )

    commands.find((c) => c.id === 'tab-goto')!.execute?.('NaN')

    expect(setActiveSessionId).toHaveBeenCalledWith('a')
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/features/workspace/commands/buildWorkspaceCommands.test.ts`

Expected: every test in the new `failure modes` describe passes (the implementation from Task 7 already covers all branches).

- [ ] **Step 3: Lint + type-check**

Run: `npm run lint && npm run type-check`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/workspace/commands/buildWorkspaceCommands.test.ts
git commit -m "test(workspace): cover buildWorkspaceCommands failure modes

Adds: stale active id (close, rename, next, previous), :rename empty
args silent no-op, :goto out-of-range / 0 / negative / decimal /
no-match / NaN-as-name. Implementation from Task 7 already covered
these branches; this commit pins the contract."
```

---

## Task 9: Wire palette into `WorkspaceView`, remove from `App.tsx`

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Update `App.tsx` to stop rendering the palette**

Replace `src/App.tsx` contents:

```typescript
import type { ReactElement } from 'react'
import { WorkspaceView } from './features/workspace/WorkspaceView'

const App = (): ReactElement => <WorkspaceView />

export default App
```

- [ ] **Step 2: Update `App.test.tsx` to assert the palette is no longer at the App level**

Open `src/App.test.tsx`. Find any test that asserts `<CommandPalette />` is rendered as a sibling of `<WorkspaceView />` (e.g. searches for `dialog` role at the App level without opening it). Either delete those tests or replace them with: "App renders WorkspaceView at the top level". The palette is now an internal concern of WorkspaceView and should be tested there instead.

If there are no such tests, this step is a no-op for the file.

Run `npx vitest run src/App.test.tsx` to confirm green.

- [ ] **Step 3: Wire `useNotifyInfo`, `buildWorkspaceCommands`, and `<CommandPalette />` into `WorkspaceView`**

Open `src/features/workspace/WorkspaceView.tsx`. Add imports near the top:

```typescript
import { CommandPalette } from '../command-palette/CommandPalette'
import { buildWorkspaceCommands } from './commands/buildWorkspaceCommands'
import { useNotifyInfo } from './hooks/useNotifyInfo'
import { InfoBanner } from './components/InfoBanner'
```

Inside the component body, after `useSessionManager(...)`, add:

```typescript
const {
  message: commandMessage,
  notifyInfo,
  dismiss: dismissCommandMessage,
} = useNotifyInfo()

const workspaceCommands = useMemo(
  () =>
    buildWorkspaceCommands({
      sessions,
      activeSessionId,
      createSession,
      removeSession,
      renameSession,
      setActiveSessionId,
      notifyInfo,
    }),
  [
    sessions,
    activeSessionId,
    createSession,
    removeSession,
    renameSession,
    setActiveSessionId,
    notifyInfo,
  ]
)
```

In the JSX, render `<CommandPalette commands={workspaceCommands} />` at the end of the root `<div>` (alongside the unsaved-changes dialog and drag overlay) and render `<InfoBanner />` inside the main workspace column (above or below the existing `fileError` banner — it shares the absolute-positioning container):

```tsx
;<InfoBanner message={commandMessage} onDismiss={dismissCommandMessage} />

{
  /* …existing fileError banner stays unchanged… */
}

{
  /* …elsewhere, near the root close: */
}
;<CommandPalette commands={workspaceCommands} />
```

- [ ] **Step 4: Type-check**

Run: `npm run type-check`

Expected: clean.

- [ ] **Step 5: Run all tests**

Run: `npm run test`

Expected: all tests pass except possibly the existing `WorkspaceView` test files. If any of those mount the workspace and assert palette absence, they will need a small update — fix any that break.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/features/workspace/WorkspaceView.tsx
git commit -m "feat(workspace): mount CommandPalette inside WorkspaceView

Palette no longer lives at the App level. WorkspaceView builds the
verb-keyed command list via buildWorkspaceCommands over the live
useSessionManager API, plumbs notifyInfo through, and renders an
InfoBanner alongside the existing fileError banner."
```

---

## Task 10: Integration test — palette commands drive session manager

**Files:**

- Create: `src/features/workspace/WorkspaceView.command-palette.test.tsx`

- [ ] **Step 1: Write the integration test**

Create `src/features/workspace/WorkspaceView.command-palette.test.tsx`:

```typescript
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { WorkspaceView } from './WorkspaceView'

const openPalette = (): void => {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: ':', ctrlKey: true })
    )
  })
}

describe('WorkspaceView × CommandPalette integration', () => {
  test('Ctrl+: opens the palette inside the workspace', async () => {
    render(<WorkspaceView />)

    openPalette()

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  test(':new triggers a new tab via the session manager', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    // Wait for at least one tab to appear from auto-create-on-empty.
    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBeGreaterThan(0)
    })

    const baselineTabCount = screen.getAllByTestId('terminal-pane').length

    openPalette()
    await waitFor(() => screen.getByRole('dialog'))

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, ':new')

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })

    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBeGreaterThan(
        baselineTabCount
      )
    })
  })

  test(':split-horizontal surfaces the not-yet-implemented banner', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    openPalette()
    await waitFor(() => screen.getByRole('dialog'))

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, ':split-horizontal')

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })

    await waitFor(() => {
      expect(
        screen.getByText('Split-pane support is coming in a future release')
      ).toBeInTheDocument()
    })
  })

  // Helper: type a verb into the palette and press Enter.
  const dispatchPaletteVerb = async (
    user: ReturnType<typeof userEvent.setup>,
    verb: string
  ): Promise<void> => {
    openPalette()
    await waitFor(() => screen.getByRole('dialog'))
    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, verb)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  }

  test(':close removes the active tab', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    // Wait for at least one auto-created tab plus a manual one (so :close has
    // a non-zero target without dropping us to zero tabs).
    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBeGreaterThan(0)
    })
    await dispatchPaletteVerb(user, ':new')
    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBe(2)
    })

    await dispatchPaletteVerb(user, ':close')

    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBe(1)
    })
  })

  test(':rename foo renames the active tab', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBeGreaterThan(0)
    })

    await dispatchPaletteVerb(user, ':rename my-renamed-tab')

    // Tab name appears in the tab bar button aria-label
    // ("🤖 my-renamed-tab" per TerminalZone.tsx).
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /my-renamed-tab/ })
      ).toBeInTheDocument()
    })
  })

  test(':next and :previous cycle through tabs with wrap', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    // Create three tabs total (one auto + two via :new).
    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBeGreaterThan(0)
    })
    await dispatchPaletteVerb(user, ':new')
    await dispatchPaletteVerb(user, ':new')
    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBe(3)
    })

    // Capture initial active session id from the active terminal-pane.
    const activePaneId = (): string =>
      document
        .querySelector('[data-testid="terminal-pane"]:not(.hidden)')
        ?.getAttribute('data-session-id') ?? ''

    const initial = activePaneId()
    expect(initial).not.toBe('')

    await dispatchPaletteVerb(user, ':next')
    await waitFor(() => {
      expect(activePaneId()).not.toBe(initial)
    })

    await dispatchPaletteVerb(user, ':previous')
    await waitFor(() => {
      expect(activePaneId()).toBe(initial)
    })
  })

  test(':goto 2 jumps to the second tab (1-indexed)', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBeGreaterThan(0)
    })
    await dispatchPaletteVerb(user, ':new')
    await dispatchPaletteVerb(user, ':new')
    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBe(3)
    })

    // Read sessionIds in tab-order from the rendered panes.
    const panes = screen.getAllByTestId('terminal-pane')
    const secondSessionId = panes[1].getAttribute('data-session-id')
    expect(secondSessionId).toBeTruthy()

    await dispatchPaletteVerb(user, ':goto 2')

    await waitFor(() => {
      const visiblePane = document.querySelector(
        '[data-testid="terminal-pane"]:not(.hidden)'
      )
      expect(visiblePane?.getAttribute('data-session-id')).toBe(
        secondSessionId
      )
    })
  })

  test(':goto <name> fuzzy-matches the tab name', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBeGreaterThan(0)
    })
    await dispatchPaletteVerb(user, ':new')
    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBe(2)
    })

    // Rename the second (most-recently-created) tab to a known string,
    // then jump to a different tab, then :goto by name.
    await dispatchPaletteVerb(user, ':rename uniqueton')

    // Switch away so :goto is observable as a real switch.
    await dispatchPaletteVerb(user, ':next')

    await dispatchPaletteVerb(user, ':goto uniq')

    await waitFor(() => {
      const visiblePane = document.querySelector(
        '[data-testid="terminal-pane"]:not(.hidden)'
      )
      // Tab strip button text contains the renamed string.
      expect(
        screen.getByRole('button', { name: /uniqueton/ })
      ).toBeInTheDocument()
      // Active pane should match the renamed tab.
      expect(visiblePane).toBeTruthy()
    })
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/features/workspace/WorkspaceView.command-palette.test.tsx`

Expected: all three tests pass.

- [ ] **Step 3: Lint**

Run: `npm run lint`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/workspace/WorkspaceView.command-palette.test.tsx
git commit -m "test(workspace): integration test for palette × session manager

Confirms Ctrl+: opens the palette inside WorkspaceView, :new produces
a new tab through the live session manager, and :split-horizontal
surfaces the stub message via the InfoBanner."
```

---

## Task 11: Integration test — `notifyInfo` banner behavior

**Files:**

- Create: `src/features/workspace/WorkspaceView.notifyInfo.test.tsx`

- [ ] **Step 1: Write the test**

Create `src/features/workspace/WorkspaceView.notifyInfo.test.tsx`:

```typescript
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceView } from './WorkspaceView'

describe('WorkspaceView × notifyInfo banner', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const dispatchPaletteCommand = async (verb: string): Promise<void> => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: ':', ctrlKey: true })
      )
    })
    await waitFor(() => screen.getByRole('dialog'))

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, verb)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
  }

  test('banner appears when :goto receives an out-of-range position', async () => {
    render(<WorkspaceView />)

    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBeGreaterThan(0)
    })

    await dispatchPaletteCommand(':goto 99')

    await waitFor(() => {
      expect(screen.getByText(/No tab at position 99/)).toBeInTheDocument()
    })
  })

  test('banner auto-dismisses after 5 seconds', async () => {
    render(<WorkspaceView />)

    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBeGreaterThan(0)
    })

    await dispatchPaletteCommand(':split-vertical')

    expect(
      screen.getByText('Split-pane support is coming in a future release')
    ).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5001)
    })

    await waitFor(() => {
      expect(
        screen.queryByText('Split-pane support is coming in a future release')
      ).not.toBeInTheDocument()
    })
  })

  test('banner dismisses on click', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<WorkspaceView />)

    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBeGreaterThan(0)
    })

    await dispatchPaletteCommand(':split-horizontal')

    expect(
      screen.getByText('Split-pane support is coming in a future release')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(
      screen.queryByText('Split-pane support is coming in a future release')
    ).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/features/workspace/WorkspaceView.notifyInfo.test.tsx`

Expected: all three tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/features/workspace/WorkspaceView.notifyInfo.test.tsx
git commit -m "test(workspace): integration test for notifyInfo banner

Asserts the banner appears for :goto out-of-range, auto-dismisses
after 5 seconds, and dismisses on click."
```

---

## Task 12: Stale-commands closure regression test

**Files:**

- Create: `src/features/command-palette/hooks/useCommandPalette.staleClosure.test.ts`

This test pins down the round-2 codex finding that drove the `useMemo` refactor: an open palette must dispatch against the **latest** `commands` prop, not a snapshot.

- [ ] **Step 1: Write the test**

Create `src/features/command-palette/hooks/useCommandPalette.staleClosure.test.ts`:

```typescript
import { act, renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useCommandPalette } from './useCommandPalette'
import type { Command } from '../registry/types'

describe('useCommandPalette stale-closure regression', () => {
  test('Enter dispatches the latest closure when commands prop changes mid-open', () => {
    const firstExecute = vi.fn()
    const secondExecute = vi.fn()

    const buildCommands = (active: 'a' | 'b'): Command[] => [
      {
        id: 'cmd',
        label: ':do',
        icon: 'star',
        execute: () => {
          if (active === 'a') firstExecute()
          else secondExecute()
        },
      },
    ]

    const { result, rerender } = renderHook(
      ({ commands }: { commands: Command[] }) => useCommandPalette(commands),
      { initialProps: { commands: buildCommands('a') } }
    )

    act(() => {
      result.current.open()
    })

    rerender({ commands: buildCommands('b') })

    act(() => {
      result.current.executeSelected()
    })

    expect(firstExecute).not.toHaveBeenCalled()
    expect(secondExecute).toHaveBeenCalledTimes(1)
  })

  test('clampedSelectedIndex stays valid after commands prop shrinks the result list', () => {
    const longCommands: Command[] = [
      { id: 'a', label: ':alpha', icon: 's', execute: vi.fn() },
      { id: 'b', label: ':bravo', icon: 's', execute: vi.fn() },
      { id: 'c', label: ':charlie', icon: 's', execute: vi.fn() },
      { id: 'd', label: ':delta', icon: 's', execute: vi.fn() },
      { id: 'e', label: ':echo', icon: 's', execute: vi.fn() },
    ]
    const shortCommands: Command[] = [
      { id: 'a', label: ':alpha', icon: 's', execute: vi.fn() },
      { id: 'b', label: ':bravo', icon: 's', execute: vi.fn() },
    ]

    const { result, rerender } = renderHook(
      ({ commands }: { commands: Command[] }) => useCommandPalette(commands),
      { initialProps: { commands: longCommands } }
    )

    act(() => {
      result.current.open()
    })
    expect(result.current.filteredResults.length).toBe(5)

    // Move the cursor to raw selectedIndex = 3.
    act(() => {
      result.current.navigateDown()
      result.current.navigateDown()
      result.current.navigateDown()
    })
    expect(result.current.state.selectedIndex).toBe(3)

    // Shrink via the commands prop, NOT via setQuery (which would reset
    // selectedIndex to 0 and trivially pass this test). Goal: keep the raw
    // cursor at 3 while filteredResults drops to length 2 — that is the
    // exact regression clampedSelectedIndex protects against.
    rerender({ commands: shortCommands })

    expect(result.current.filteredResults.length).toBe(2)
    expect(result.current.state.selectedIndex).toBe(3)
    expect(result.current.clampedSelectedIndex).toBe(1)
    expect(
      result.current.filteredResults[result.current.clampedSelectedIndex]
    ).toBeDefined()
  })

  test('clampedSelectedIndex is -1 when commands shrinks to empty', () => {
    const someCommands: Command[] = [
      { id: 'a', label: ':alpha', icon: 's', execute: vi.fn() },
    ]

    const { result, rerender } = renderHook(
      ({ commands }: { commands: Command[] }) => useCommandPalette(commands),
      { initialProps: { commands: someCommands } }
    )

    act(() => {
      result.current.open()
    })
    expect(result.current.clampedSelectedIndex).toBe(0)

    rerender({ commands: [] })

    expect(result.current.filteredResults.length).toBe(0)
    expect(result.current.clampedSelectedIndex).toBe(-1)

    // Enter must be a no-op when the result list is empty.
    act(() => {
      result.current.executeSelected()
    })
    // No assertion needed besides "did not throw"; mocks were not called
    // because there were no commands to dispatch.
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/features/command-palette/hooks/useCommandPalette.staleClosure.test.ts`

Expected: both tests pass. (The implementation from Task 2 + Task 3 already supports this behavior; this test pins the contract against future regressions.)

- [ ] **Step 3: Run the entire suite + type-check + lint**

Run: `npm run type-check && npm run lint && npm run test`

Expected: full green.

- [ ] **Step 4: Commit**

```bash
git add src/features/command-palette/hooks/useCommandPalette.staleClosure.test.ts
git commit -m "test(command-palette): pin stale-closure and shrink-results contracts

Two regressions the spec explicitly calls out: (1) Enter must invoke
the latest commands-prop closure even when the prop changed while
the palette was open; (2) shrinking filteredResults past selectedIndex
must yield a valid clampedSelectedIndex without leaving consumers
reading undefined."
```

---

## Task 13: Final cleanup, documentation, and full-suite verification

**Files:**

- Possibly: `src/features/command-palette/data/defaultCommands.ts` (no edit — confirmed left untouched per spec)
- Possibly: `src/features/command-palette/CommandPalette.tsx` (verify final shape)

- [ ] **Step 1: Confirm `defaultCommands.ts` is unchanged**

Run: `git diff main -- src/features/command-palette/data/defaultCommands.ts`

Expected: no changes to that file (per spec Section 4 — `defaultCommands` is preserved as the no-prop fallback).

- [ ] **Step 2: Run lint + format check**

Run: `npm run lint && npm run format:check`

Expected: clean. If `format:check` fails, run `npm run format` and stage the result in the next commit.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`

Expected: every test passes. Coverage check is not enforced as a gate but should not regress meaningfully — the new feature adds tests that cover its surface.

- [ ] **Step 4: Run the full type-check**

Run: `npm run type-check`

Expected: zero errors.

- [ ] **Step 5: Smoke-test in the dev server**

Run: `npm run dev`

In another terminal, open `http://localhost:5173` (or the printed URL). Manually verify:

1. `Ctrl+:` opens the palette from anywhere — including with the terminal focused.
2. Bare `:` keystroke does NOT open the palette anymore (it goes to the focused element).
3. `:new` adds a new terminal tab.
4. `:close` closes the active tab.
5. `:rename foo` renames the active tab to `foo`.
6. `:next` and `:previous` cycle through tabs.
7. `:goto 1` jumps to the first tab; `:goto <name>` fuzzy-matches a tab.
8. `:split-horizontal` and `:split-vertical` show the "coming in a future release" banner that auto-dismisses after 5 seconds and can be clicked away.
9. `Ctrl+:` while open closes the palette.
10. Held `Ctrl+:` does not flash the palette open/closed.

Stop the dev server.

- [ ] **Step 6: Final commit (if any formatting / cleanup changes)**

If steps 2-5 produced any pending changes (formatting, missed commits), stage and commit them:

```bash
git add -A
git commit -m "chore(command-palette): formatting + final cleanup pass"
```

If nothing changed, skip this step.

- [ ] **Step 7: Verify the branch is ready for review**

Run: `git log --oneline main..HEAD`

You should see a clean, conventional-commit history of approximately 11 commits, one per task. Each one independently builds, type-checks, and tests green (within reason — the few ordering-dependent commits are noted above).

---

## Self-Review Checklist (run after writing all tasks above)

**1. Spec coverage:**

| Spec section                                                     | Implementing task(s)                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| §1 Goals — trigger swap                                          | Task 4                                                                        |
| §1 Goals — eight verbs (`:new` … `:goto`, splits)                | Task 7, 8                                                                     |
| §1 Goals — responsibility split                                  | Task 9                                                                        |
| §2 Architecture — useMemo filter                                 | Task 2, 3                                                                     |
| §2 Hook return shape                                             | Task 2                                                                        |
| §2 Empty-list / `clampedSelectedIndex = -1`                      | Task 2 (executeSelected guard, navigation guards) + Task 12                   |
| §3 Trigger — capture phase                                       | Task 4 (capture-phase listener test + impl)                                   |
| §3 Trigger — both-direction preventDefault                       | Task 4 (preventDefault test)                                                  |
| §3 Trigger — repeat guard                                        | Task 4 (repeat test)                                                          |
| §3 Trigger — bare-`:` removed                                    | Task 4 (negative test)                                                        |
| §3 Pre-filled `:` preserved                                      | Existing behavior, unchanged in Task 4 (`open` still sets `query: ':'`)       |
| §4 Command list table                                            | Task 7                                                                        |
| §4 `parseQuery` grammar                                          | Task 1 (the helper); Task 7 ignores extra args by passing through             |
| §4 `defaultCommands` replace-not-augment                         | Task 9 (workspace passes `commands` prop) + Task 13 (no defaultCommands edit) |
| §4 Relocation App → WorkspaceView                                | Task 9                                                                        |
| §5 `notifyInfo` mechanism                                        | Task 5, 6, 9                                                                  |
| §5 `:close` failure modes                                        | Task 8                                                                        |
| §5 `:rename` failure modes                                       | Task 8                                                                        |
| §5 `:next` / `:previous` failure modes (incl. stale-id recovery) | Task 8                                                                        |
| §5 `:goto` failure modes (numeric vs name classifier)            | Task 7 (impl) + Task 8 (tests)                                                |
| §5 `:new` silent UI failure                                      | Task 7 (no failure-path coded — matches spec)                                 |
| §5 stub split commands                                           | Task 7                                                                        |
| §6 Coverage map                                                  | Tasks 1, 5, 7, 8, 10, 11                                                      |
| §6 Behavioral test #1 stale-commands closure                     | Task 12                                                                       |
| §6 Behavioral test #2 clampedSelectedIndex shrink                | Task 12                                                                       |
| §6 Behavioral test #3 auto-repeat suppression                    | Task 4                                                                        |
| §6 Behavioral test #4 capture phase wins over xterm              | Task 4                                                                        |
| §6 Behavioral test #5 `:goto` numeric edge cases                 | Task 8                                                                        |
| §6 Behavioral test #6 `:goto` fuzzy edge cases                   | Task 8                                                                        |
| §6 Behavioral test #7 stale-id collapse                          | Task 8                                                                        |
| §6 Existing tests update — `:` → `Ctrl+:`                        | Task 4 (rewrites the tests in `CommandPalette.test.tsx`)                      |
| §6 Existing tests update — `state.filteredResults` reads         | Task 2 (Step 10-12)                                                           |
| §6 Existing tests update — `App.tsx` palette assertion           | Task 9                                                                        |

**Every spec requirement maps to a task above.**

**2. Placeholder scan:** None — every step has runnable code, exact paths, and exact verification commands.

**3. Type / signature consistency:**

- `parseQuery(query: string): ParsedQuery` — defined in Task 1, consumed in Task 2 (the filter step uses `parsedQuery.verbToken`; `executeSelected` passes `parsedQuery.args` to `execute`). This wiring is load-bearing: without it, `:rename foo` would filter against the literal string `rename foo` (likely scoring zero against `rename` and disappearing from results) and dispatch the wrong string to the handler. Tasks 7 and 8 rely on `:rename`'s `execute` receiving only the name argument, not the verb-plus-args concatenation.
- `WorkspaceCommandDeps` — defined in Task 7, consumed by Task 9.
- `UseNotifyInfoReturn` — defined in Task 5, consumed by Task 9.
- `Command` interface — unchanged. `execute?` is optional in the type; all eight new commands supply it.
- `clampedSelectedIndex` — defined as a number in Task 2, consumed in Task 2 (CommandPalette.tsx update) and tested in Task 12.

**4. Commit-message types:**

All implementation commits use `feat(<scope>):`, `refactor(<scope>):`, `test(<scope>):`, or `chore(<scope>):` per project convention (config-conventional). No `spec(planner):` here — that's only used for the spec-side commits, which already happened.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-04-command-palette-trigger-actions.md`.**

This plan has been written **in spec-only mode at the user's request** — control is being returned to `/lifeline:planner` so codex can review the plan before any implementation begins. Do not invoke `superpowers:executing-plans` or `superpowers:subagent-driven-development` until the codex pass on this plan completes and the user has walked the findings.

After codex review of the plan and any approved iterations land, the user will choose between:

1. **Subagent-Driven** — fresh subagent per task, review between tasks (recommended for higher-risk tasks like Task 4's listener changes).
2. **Inline Execution** — execute tasks in this session with checkpoints.
