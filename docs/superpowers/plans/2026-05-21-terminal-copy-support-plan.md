# Terminal Copy Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to copy text from the terminal via drag-select, platform-native keyboard shortcut, or right-click menu — frontend-only, no Rust / IPC / preload changes.

**Architecture:** A new `useTerminalClipboard({ terminal })` hook (under `src/features/terminal/hooks/`) wires xterm.js's `onSelectionChange`, a custom key event handler, and a `contextmenu` listener on `terminal.element`, and exposes `{ copy, paste, selectAll, clear, isOpen, openAt, close, hasSelection }`. A new `<TerminalContextMenu>` component (feature-local) consumes those callbacks and uses `@floating-ui/react` for positioning + accessibility. `Body.tsx` receives two top-level additions (hook call + JSX mount). Cleanup is defensive (try/catch around xterm calls) so React effect ordering does not matter.

**Tech Stack:** TypeScript, React 18, `@xterm/xterm@6.0.0`, `@floating-ui/react`, Vitest + Testing Library.

**Spec:** [`docs/superpowers/specs/2026-05-21-terminal-copy-support-design.md`](../specs/2026-05-21-terminal-copy-support-design.md) (codex-reviewed).

---

## File structure

**New files (4):**

- `src/features/terminal/hooks/useTerminalClipboard.ts` — the hook (~200 lines).
- `src/features/terminal/hooks/useTerminalClipboard.test.ts` — unit tests (~600 lines, 27 cases).
- `src/features/terminal/components/TerminalContextMenu.tsx` — the menu (~150 lines).
- `src/features/terminal/components/TerminalContextMenu.test.tsx` — unit tests (~250 lines, 8 cases).

**Edited files (1):**

- `src/features/terminal/components/TerminalPane/Body.tsx` — add the hook call + JSX mount (one location, ~25 lines).

---

## Phase 1 — `useTerminalClipboard` hook (Tasks 1-10)

### Task 1: Hook scaffold + null-terminal guard

**Files:**

- Create: `src/features/terminal/hooks/useTerminalClipboard.ts`
- Create: `src/features/terminal/hooks/useTerminalClipboard.test.ts`

Spec ref: §4 Signature.

- [ ] **Step 1.1: Write the failing test**

```typescript
// src/features/terminal/hooks/useTerminalClipboard.test.ts
import { renderHook } from '@testing-library/react'
import { test, expect } from 'vitest'
import { useTerminalClipboard } from './useTerminalClipboard'

test('terminal === null → all callbacks are no-ops and state is empty', () => {
  const { result } = renderHook(() => useTerminalClipboard({ terminal: null }))

  expect(result.current.hasSelection).toBe(false)
  expect(result.current.isOpen).toBe(false)
  expect(result.current.openAt).toBeNull()
  expect(() => result.current.selectAll()).not.toThrow()
  expect(() => result.current.clear()).not.toThrow()
  expect(() => result.current.close()).not.toThrow()
  await expect(result.current.copy()).resolves.toBeUndefined()
  await expect(result.current.paste()).resolves.toBeUndefined()
})
```

- [ ] **Step 1.2: Run to verify failure**

```bash
npx vitest run src/features/terminal/hooks/useTerminalClipboard.test.ts
```

Expected: error `Cannot find module './useTerminalClipboard'`.

- [ ] **Step 1.3: Make the test compile by fixing the missing `async` on the `test` callback, then re-run**

The test signature uses `await`, so the callback needs `async`. Update Step 1.1's test to:

```typescript
test('terminal === null → all callbacks are no-ops and state is empty', async () => {
```

Run again: now fails with `Cannot find module './useTerminalClipboard'`.

- [ ] **Step 1.4: Create the minimal hook**

```typescript
// src/features/terminal/hooks/useTerminalClipboard.ts
import { useState } from 'react'
import type { Terminal } from '@xterm/xterm'

export type ClipboardModifier = 'meta' | 'ctrl'

export interface UseTerminalClipboardOptions {
  terminal: Terminal | null
  preferModifier?: ClipboardModifier
  onCopyError?: (error: unknown) => void
  onPasteError?: (error: unknown) => void
}

export interface UseTerminalClipboardResult {
  hasSelection: boolean
  isOpen: boolean
  openAt: { x: number; y: number } | null
  close: () => void
  copy: () => Promise<void>
  paste: () => Promise<void>
  selectAll: () => void
  clear: () => void
}

const noopVoid = (): void => undefined
const noopAsync = async (): Promise<void> => undefined

export const useTerminalClipboard = (
  options: UseTerminalClipboardOptions
): UseTerminalClipboardResult => {
  const [hasSelection] = useState(false)
  const [isOpen] = useState(false)
  const [openAt] = useState<{ x: number; y: number } | null>(null)

  return {
    hasSelection,
    isOpen,
    openAt,
    close: noopVoid,
    copy: noopAsync,
    paste: noopAsync,
    selectAll: noopVoid,
    clear: noopVoid,
  }
}
```

- [ ] **Step 1.5: Run to verify pass**

```bash
npx vitest run src/features/terminal/hooks/useTerminalClipboard.test.ts
```

Expected: `1 passed`.

- [ ] **Step 1.6: Commit**

```bash
git add src/features/terminal/hooks/useTerminalClipboard.ts src/features/terminal/hooks/useTerminalClipboard.test.ts
git commit -m "feat(terminal): scaffold useTerminalClipboard hook with null-terminal guard"
```

---

### Task 2: Terminal mock helper + `hasSelection` reactivity

**Files:**

- Modify: `src/features/terminal/hooks/useTerminalClipboard.test.ts`
- Modify: `src/features/terminal/hooks/useTerminalClipboard.ts`

Spec ref: §4 "Selection-change subscription", §7.2.1 row 3.

- [ ] **Step 2.1: Add the `MockTerminal` helper near the top of the test file**

Add this immediately below the imports in `useTerminalClipboard.test.ts`:

```typescript
import type { IDisposable, Terminal } from '@xterm/xterm'

interface MockTerminalControls {
  terminal: Terminal
  fireSelectionChange: (hasSelection: boolean) => void
  element: HTMLElement
}

const createMockTerminal = (): MockTerminalControls => {
  const element = document.createElement('div')
  document.body.appendChild(element)

  const selectionListeners = new Set<() => void>()
  let selectionText = ''

  const terminal = {
    element,
    hasSelection: (): boolean => selectionText.length > 0,
    getSelection: (): string => selectionText,
    clearSelection: (): void => {
      selectionText = ''
    },
    clear: (): void => undefined,
    selectAll: (): void => {
      selectionText = 'EVERYTHING'
    },
    paste: (_text: string): void => undefined,
    attachCustomKeyEventHandler: (
      _handler: (event: KeyboardEvent) => boolean
    ): void => undefined,
    onSelectionChange: (listener: () => void): IDisposable => {
      selectionListeners.add(listener)
      return {
        dispose: (): void => {
          selectionListeners.delete(listener)
        },
      }
    },
  } as unknown as Terminal

  return {
    terminal,
    element,
    fireSelectionChange: (has): void => {
      selectionText = has ? 'EVERYTHING' : ''
      selectionListeners.forEach((listener) => {
        listener()
      })
    },
  }
}
```

- [ ] **Step 2.2: Write the failing tests for `hasSelection` reactivity**

Append to the test file:

```typescript
test('hasSelection flips true when terminal.onSelectionChange fires with a selection', () => {
  const mock = createMockTerminal()
  const { result } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  expect(result.current.hasSelection).toBe(false)
  mock.fireSelectionChange(true)
  expect(result.current.hasSelection).toBe(true)
})

test('hasSelection flips back to false when selection clears', () => {
  const mock = createMockTerminal()
  const { result } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  mock.fireSelectionChange(true)
  expect(result.current.hasSelection).toBe(true)
  mock.fireSelectionChange(false)
  expect(result.current.hasSelection).toBe(false)
})
```

- [ ] **Step 2.3: Run to verify they fail**

```bash
npx vitest run src/features/terminal/hooks/useTerminalClipboard.test.ts
```

Expected: 2 failures — `hasSelection` stays `false` (no subscription wired yet).

- [ ] **Step 2.4: Wire the subscription**

Replace `useTerminalClipboard.ts` with:

```typescript
import { useEffect, useState } from 'react'
import type { Terminal } from '@xterm/xterm'

export type ClipboardModifier = 'meta' | 'ctrl'

export interface UseTerminalClipboardOptions {
  terminal: Terminal | null
  preferModifier?: ClipboardModifier
  onCopyError?: (error: unknown) => void
  onPasteError?: (error: unknown) => void
}

export interface UseTerminalClipboardResult {
  hasSelection: boolean
  isOpen: boolean
  openAt: { x: number; y: number } | null
  close: () => void
  copy: () => Promise<void>
  paste: () => Promise<void>
  selectAll: () => void
  clear: () => void
}

const noopVoid = (): void => undefined
const noopAsync = async (): Promise<void> => undefined

export const useTerminalClipboard = (
  options: UseTerminalClipboardOptions
): UseTerminalClipboardResult => {
  const { terminal } = options

  const [hasSelection, setHasSelection] = useState(false)
  const [isOpen] = useState(false)
  const [openAt] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!terminal) {
      return
    }

    const disposable = terminal.onSelectionChange(() => {
      setHasSelection(terminal.hasSelection())
    })

    return (): void => {
      disposable.dispose()
    }
  }, [terminal])

  return {
    hasSelection,
    isOpen,
    openAt,
    close: noopVoid,
    copy: noopAsync,
    paste: noopAsync,
    selectAll: noopVoid,
    clear: noopVoid,
  }
}
```

- [ ] **Step 2.5: Run to verify all 3 tests pass**

```bash
npx vitest run src/features/terminal/hooks/useTerminalClipboard.test.ts
```

Expected: `3 passed`.

- [ ] **Step 2.6: Commit**

```bash
git add src/features/terminal/hooks/useTerminalClipboard.ts src/features/terminal/hooks/useTerminalClipboard.test.ts
git commit -m "feat(terminal): track xterm selection via onSelectionChange"
```

---

### Task 3: `selectAll()` and `clear()` callbacks

**Files:**

- Modify: `src/features/terminal/hooks/useTerminalClipboard.ts`
- Modify: `src/features/terminal/hooks/useTerminalClipboard.test.ts`

Spec ref: §4 callback table.

- [ ] **Step 3.1: Write the failing tests**

First, **merge `vi` into the existing vitest import at the top of the test file** (the repo enforces `import/first` and `import/no-duplicates`). Change line 2:

```typescript
import { test, expect } from 'vitest'
```

to:

```typescript
import { test, expect, vi } from 'vitest'
```

Then append the new tests to the end of the file:

```typescript
test('selectAll() forwards to terminal.selectAll', () => {
  const mock = createMockTerminal()
  const spy = vi.spyOn(mock.terminal, 'selectAll')
  const { result } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  result.current.selectAll()
  expect(spy).toHaveBeenCalledOnce()
})

test('clear() forwards to terminal.clear (NOT clearSelection)', () => {
  const mock = createMockTerminal()
  const clearSpy = vi.spyOn(mock.terminal, 'clear')
  const clearSelectionSpy = vi.spyOn(mock.terminal, 'clearSelection')
  const { result } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  result.current.clear()
  expect(clearSpy).toHaveBeenCalledOnce()
  expect(clearSelectionSpy).not.toHaveBeenCalled()
})
```

- [ ] **Step 3.2: Run to verify failure (both still no-op)**

```bash
npx vitest run src/features/terminal/hooks/useTerminalClipboard.test.ts
```

Expected: 2 failures.

- [ ] **Step 3.3: Implement `selectAll` and `clear` in the hook**

In `useTerminalClipboard.ts`, replace the `return { ... }` block at the bottom with:

```typescript
const selectAll = (): void => {
  if (!terminal) return
  terminal.selectAll()
}

const clear = (): void => {
  if (!terminal) return
  terminal.clear()
}

return {
  hasSelection,
  isOpen,
  openAt,
  close: noopVoid,
  copy: noopAsync,
  paste: noopAsync,
  selectAll,
  clear,
}
```

- [ ] **Step 3.4: Run, verify pass**

```bash
npx vitest run src/features/terminal/hooks/useTerminalClipboard.test.ts
```

Expected: `5 passed`.

- [ ] **Step 3.5: Commit**

```bash
git add src/features/terminal/hooks/useTerminalClipboard.ts src/features/terminal/hooks/useTerminalClipboard.test.ts
git commit -m "feat(terminal): wire selectAll and clear callbacks to xterm methods"
```

---

### Task 4: `copy()` happy path with `writeText`

**Files:**

- Modify: `src/features/terminal/hooks/useTerminalClipboard.ts`
- Modify: `src/features/terminal/hooks/useTerminalClipboard.test.ts`

Spec ref: §4 Copy-failure policy (primary path).

- [ ] **Step 4.1: Add a clipboard mock helper at the top of the test file**

Add immediately after `createMockTerminal`:

```typescript
interface ClipboardMockControls {
  writeTextMock: ReturnType<typeof vi.fn>
  readTextMock: ReturnType<typeof vi.fn>
  restore: () => void
}

const installClipboardMock = (
  overrides: {
    writeText?: () => Promise<void>
    readText?: () => Promise<string>
  } = {}
): ClipboardMockControls => {
  const writeTextMock = vi.fn(overrides.writeText ?? (async () => undefined))
  const readTextMock = vi.fn(overrides.readText ?? (async () => ''))
  const original = window.navigator.clipboard
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: writeTextMock, readText: readTextMock },
    configurable: true,
    writable: true,
  })
  return {
    writeTextMock,
    readTextMock,
    restore: (): void => {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: original,
        configurable: true,
        writable: true,
      })
    },
  }
}
```

- [ ] **Step 4.2: Write the failing test**

Append:

```typescript
test('copy() with selection writes selection text via navigator.clipboard.writeText', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()
  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({ terminal: mock.terminal })
    )
    mock.fireSelectionChange(true)

    await result.current.copy()

    expect(clipboard.writeTextMock).toHaveBeenCalledOnce()
    expect(clipboard.writeTextMock).toHaveBeenCalledWith('EVERYTHING')
  } finally {
    clipboard.restore()
  }
})

test('copy() with empty selection is a no-op', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()
  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({ terminal: mock.terminal })
    )
    // hasSelection stays false; copy must NOT call writeText.

    await result.current.copy()

    expect(clipboard.writeTextMock).not.toHaveBeenCalled()
  } finally {
    clipboard.restore()
  }
})
```

- [ ] **Step 4.3: Run, verify failure**

Expected: 2 failures (copy is still `noopAsync`).

- [ ] **Step 4.4: Implement `copy()` happy path**

In `useTerminalClipboard.ts`, add this above the `return` and replace `copy: noopAsync` with `copy`:

```typescript
const copy = async (): Promise<void> => {
  if (!terminal || !terminal.hasSelection()) return
  const text = terminal.getSelection()
  if (text === '') return
  await window.navigator.clipboard.writeText(text)
}
```

Update the return shape:

```typescript
return {
  hasSelection,
  isOpen,
  openAt,
  close: noopVoid,
  copy,
  paste: noopAsync,
  selectAll,
  clear,
}
```

- [ ] **Step 4.5: Run, verify pass**

Expected: `7 passed`.

- [ ] **Step 4.6: Commit**

```bash
git add src/features/terminal/hooks/useTerminalClipboard.ts src/features/terminal/hooks/useTerminalClipboard.test.ts
git commit -m "feat(terminal): wire copy() to navigator.clipboard.writeText with selection guard"
```

---

### Task 5: `copy()` textarea+execCommand fallback + `onCopyError`

**Files:**

- Modify: `src/features/terminal/hooks/useTerminalClipboard.ts`
- Modify: `src/features/terminal/hooks/useTerminalClipboard.test.ts`

Spec ref: §4 Copy failure policy (fallback + final error).

- [ ] **Step 5.1: Define `document.execCommand` in jsdom (one-time setup), then write the failing tests**

jsdom does not ship `document.execCommand` as a callable property, so `vi.spyOn(document, 'execCommand')` throws unless we define it first. Add this helper near `installClipboardMock`:

```typescript
const installExecCommandStub = (
  returnValue: boolean
): { restore: () => void; spy: ReturnType<typeof vi.fn> } => {
  const spy = vi.fn(() => returnValue)
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    document,
    'execCommand'
  )
  Object.defineProperty(document, 'execCommand', {
    value: spy,
    configurable: true,
    writable: true,
  })
  return {
    spy,
    restore: (): void => {
      if (originalDescriptor) {
        Object.defineProperty(document, 'execCommand', originalDescriptor)
      } else {
        // Property didn't exist before; remove our stub.
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (document as unknown as { execCommand?: unknown }).execCommand
      }
    },
  }
}
```

Then append the failing tests:

```typescript
test('copy() falls back to execCommand("copy") when writeText rejects', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock({
    writeText: async () => {
      throw new Error('writeText denied')
    },
  })
  const execStub = installExecCommandStub(true)
  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({ terminal: mock.terminal })
    )
    mock.fireSelectionChange(true)

    await result.current.copy()

    expect(clipboard.writeTextMock).toHaveBeenCalledOnce()
    expect(execStub.spy).toHaveBeenCalledWith('copy')
  } finally {
    clipboard.restore()
    execStub.restore()
  }
})

test('copy() calls onCopyError when both writeText and execCommand fail', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock({
    writeText: async () => {
      throw new Error('writeText denied')
    },
  })
  const execStub = installExecCommandStub(false)
  const onCopyError = vi.fn()
  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        onCopyError,
      })
    )
    mock.fireSelectionChange(true)

    await result.current.copy()

    expect(onCopyError).toHaveBeenCalledOnce()
    expect(onCopyError.mock.calls[0][0]).toBeInstanceOf(Error)
  } finally {
    clipboard.restore()
    execStub.restore()
  }
})

test('copy() calls onCopyError when document.execCommand is undefined', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock({
    writeText: async () => {
      throw new Error('writeText denied')
    },
  })
  const original = Object.getOwnPropertyDescriptor(document, 'execCommand')
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete (document as unknown as { execCommand?: unknown }).execCommand
  const onCopyError = vi.fn()
  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        onCopyError,
      })
    )
    mock.fireSelectionChange(true)

    await result.current.copy()

    expect(onCopyError).toHaveBeenCalledOnce()
  } finally {
    clipboard.restore()
    if (original) {
      Object.defineProperty(document, 'execCommand', original)
    }
  }
})
```

- [ ] **Step 5.2: Run, verify failure**

Expected: 2 failures.

- [ ] **Step 5.3: Implement the fallback and `onCopyError`**

Replace the `copy` definition:

```typescript
const writeViaTextarea = (text: string): boolean => {
  // jsdom (and some sandboxed Electron builds) ship without
  // document.execCommand. Treat undefined or throwing as fallback
  // failure so the outer catch surfaces it via onCopyError.
  const execCommand = (
    document as unknown as {
      execCommand?: (command: string) => boolean
    }
  ).execCommand
  if (typeof execCommand !== 'function') return false

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()
  let ok = false
  try {
    ok = execCommand.call(document, 'copy')
  } catch {
    ok = false
  } finally {
    document.body.removeChild(textarea)
  }
  return ok
}

const copy = async (): Promise<void> => {
  if (!terminal || !terminal.hasSelection()) return
  const text = terminal.getSelection()
  if (text === '') return
  try {
    await window.navigator.clipboard.writeText(text)
    return
  } catch (writeError: unknown) {
    const fallbackOk = writeViaTextarea(text)
    if (fallbackOk) return
    const finalError =
      writeError instanceof Error
        ? writeError
        : new Error('Clipboard write failed')
    options.onCopyError?.(finalError)
  }
}
```

- [ ] **Step 5.4: Run, verify pass**

Expected: `9 passed`.

- [ ] **Step 5.5: Commit**

```bash
git add src/features/terminal/hooks/useTerminalClipboard.ts src/features/terminal/hooks/useTerminalClipboard.test.ts
git commit -m "feat(terminal): add execCommand textarea fallback and onCopyError surface for copy()"
```

---

### Task 6: `paste()` — happy path, empty-string no-op, Mode A undefined

**Files:**

- Modify: `src/features/terminal/hooks/useTerminalClipboard.ts`
- Modify: `src/features/terminal/hooks/useTerminalClipboard.test.ts`

Spec ref: §4 paste row + §5.4 Mode A/B.

- [ ] **Step 6.1: Write the failing tests**

Append:

```typescript
test('paste() with non-empty clipboard calls terminal.paste(text)', async () => {
  const mock = createMockTerminal()
  const pasteSpy = vi.spyOn(mock.terminal, 'paste')
  const clipboard = installClipboardMock({
    readText: async () => 'hello',
  })
  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({ terminal: mock.terminal })
    )

    await result.current.paste()

    expect(pasteSpy).toHaveBeenCalledWith('hello')
  } finally {
    clipboard.restore()
  }
})

test('paste() with empty clipboard is a silent no-op (no terminal.paste call)', async () => {
  const mock = createMockTerminal()
  const pasteSpy = vi.spyOn(mock.terminal, 'paste')
  const onPasteError = vi.fn()
  const clipboard = installClipboardMock({
    readText: async () => '',
  })
  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        onPasteError,
      })
    )

    await result.current.paste()

    expect(pasteSpy).not.toHaveBeenCalled()
    expect(onPasteError).not.toHaveBeenCalled()
  } finally {
    clipboard.restore()
  }
})

test('paste() when navigator.clipboard.readText is undefined → calls onPasteError', async () => {
  const mock = createMockTerminal()
  const pasteSpy = vi.spyOn(mock.terminal, 'paste')
  const onPasteError = vi.fn()
  const original = window.navigator.clipboard
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: async () => undefined },
    configurable: true,
    writable: true,
  })
  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        onPasteError,
      })
    )

    await result.current.paste()

    expect(pasteSpy).not.toHaveBeenCalled()
    expect(onPasteError).toHaveBeenCalledOnce()
    expect(onPasteError.mock.calls[0][0]).toBeInstanceOf(Error)
  } finally {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: original,
      configurable: true,
      writable: true,
    })
  }
})
```

- [ ] **Step 6.2: Run, verify 3 failures**

- [ ] **Step 6.3: Implement `paste()`**

Replace `paste: noopAsync` with a real implementation. Above the `return`:

```typescript
const paste = async (): Promise<void> => {
  if (!terminal) return
  const clipboard = window.navigator.clipboard
  if (clipboard?.readText === undefined) {
    options.onPasteError?.(new Error('Clipboard read API unavailable'))
    return
  }
  try {
    const text = await clipboard.readText()
    if (text === '') return
    terminal.paste(text)
  } catch (error: unknown) {
    options.onPasteError?.(error)
  }
}
```

Update return:

```typescript
    paste,
```

- [ ] **Step 6.4: Run, verify pass**

Expected: `12 passed`.

- [ ] **Step 6.5: Commit**

```bash
git add src/features/terminal/hooks/useTerminalClipboard.ts src/features/terminal/hooks/useTerminalClipboard.test.ts
git commit -m "feat(terminal): wire paste() to terminal.paste with readText guards and onPasteError"
```

---

### Task 7: `paste()` Mode B — readText rejects

**Files:**

- Modify: `src/features/terminal/hooks/useTerminalClipboard.test.ts`

Spec ref: §5.4 Mode B.

- [ ] **Step 7.1: Write the failing test**

Append:

```typescript
test('paste() when readText() rejects → calls onPasteError with the rejection', async () => {
  const mock = createMockTerminal()
  const pasteSpy = vi.spyOn(mock.terminal, 'paste')
  const onPasteError = vi.fn()
  const clipboard = installClipboardMock({
    readText: async () => {
      throw new Error('readText denied')
    },
  })
  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        onPasteError,
      })
    )

    await result.current.paste()

    expect(pasteSpy).not.toHaveBeenCalled()
    expect(onPasteError).toHaveBeenCalledOnce()
    const errorArg = onPasteError.mock.calls[0][0] as Error
    expect(errorArg.message).toBe('readText denied')
  } finally {
    clipboard.restore()
  }
})
```

- [ ] **Step 7.2: Run, verify pass without code changes**

The Mode B path was already implemented in Task 6's `try/catch`. Expected: `13 passed`. If it fails, fix the catch block in `paste()`.

- [ ] **Step 7.3: Commit (test-only)**

```bash
git add src/features/terminal/hooks/useTerminalClipboard.test.ts
git commit -m "test(terminal): cover readText reject → onPasteError path"
```

---

### Task 8: Contextmenu listener + `isOpen`/`openAt`/`close`

**Files:**

- Modify: `src/features/terminal/hooks/useTerminalClipboard.ts`
- Modify: `src/features/terminal/hooks/useTerminalClipboard.test.ts`

Spec ref: §4 "Contextmenu listener", §4 contextmenu test row.

- [ ] **Step 8.1: Write the failing tests**

First, **merge `act` into the existing `@testing-library/react` import at the top of the test file** (the repo enforces `import/first` and `import/no-duplicates`). Change line 1:

```typescript
import { renderHook } from '@testing-library/react'
```

to:

```typescript
import { renderHook, act } from '@testing-library/react'
```

Then append the new tests to the end of the file:

```typescript
test('right-click on terminal.element sets isOpen=true, openAt={x,y}, and calls preventDefault', () => {
  const mock = createMockTerminal()
  const { result } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 200,
  })
  const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

  act(() => {
    mock.element.dispatchEvent(event)
  })

  expect(result.current.isOpen).toBe(true)
  expect(result.current.openAt).toEqual({ x: 100, y: 200 })
  expect(preventDefaultSpy).toHaveBeenCalledOnce()
})

test('close() resets isOpen and openAt (idempotent)', () => {
  const mock = createMockTerminal()
  const { result } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  act(() => {
    mock.element.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 75,
      })
    )
  })
  expect(result.current.isOpen).toBe(true)

  act(() => {
    result.current.close()
  })
  expect(result.current.isOpen).toBe(false)
  expect(result.current.openAt).toBeNull()

  // Second close() is a no-op
  act(() => {
    result.current.close()
  })
  expect(result.current.isOpen).toBe(false)
})
```

- [ ] **Step 8.2: Run, verify failure**

- [ ] **Step 8.3: Implement contextmenu listener and `close`**

In `useTerminalClipboard.ts`:

1. Replace the `[isOpen]` and `[openAt]` state declarations:

```typescript
const [isOpen, setIsOpen] = useState(false)
const [openAt, setOpenAt] = useState<{ x: number; y: number } | null>(null)
```

2. Update the `useEffect` to wire the contextmenu listener (replace the existing effect body):

```typescript
useEffect(() => {
  if (!terminal) {
    return
  }
  const element = terminal.element
  if (!element) {
    return
  }

  const disposable = terminal.onSelectionChange(() => {
    setHasSelection(terminal.hasSelection())
  })

  const handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setIsOpen(true)
    setOpenAt({ x: event.clientX, y: event.clientY })
  }
  element.addEventListener('contextmenu', handleContextMenu, {
    capture: true,
  })

  return (): void => {
    try {
      disposable.dispose()
    } catch {
      /* terminal already disposed; safe to swallow */
    }
    element.removeEventListener('contextmenu', handleContextMenu, {
      capture: true,
    })
  }
}, [terminal])
```

3. Add the `close` callback above the `return`:

```typescript
const close = (): void => {
  setIsOpen(false)
  setOpenAt(null)
}
```

4. Update the return:

```typescript
    close,
```

- [ ] **Step 8.4: Run, verify pass**

Expected: `15 passed`.

- [ ] **Step 8.5: Commit**

```bash
git add src/features/terminal/hooks/useTerminalClipboard.ts src/features/terminal/hooks/useTerminalClipboard.test.ts
git commit -m "feat(terminal): open context menu on right-click via terminal.element listener"
```

---

### Task 9: Mousedown/mouseup drag-gated auto-copy

**Files:**

- Modify: `src/features/terminal/hooks/useTerminalClipboard.ts`
- Modify: `src/features/terminal/hooks/useTerminalClipboard.test.ts`

Spec ref: §5.1.

- [ ] **Step 9.1: Write the failing tests**

Append:

```typescript
const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

test('drag → mouseup with selection auto-copies via writeText', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()
  try {
    renderHook(() => useTerminalClipboard({ terminal: mock.terminal }))

    // Simulate drag: mousedown → onSelectionChange(true) → mouseup
    mock.element.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0 })
    )
    mock.fireSelectionChange(true)
    mock.element.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0 })
    )

    await flushMicrotasks()

    expect(clipboard.writeTextMock).toHaveBeenCalledWith('EVERYTHING')
  } finally {
    clipboard.restore()
  }
})

test('selectAll() then mouseup (no mousedown) does NOT auto-copy', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()
  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({ terminal: mock.terminal })
    )

    // selectAll fires onSelectionChange but isDragging stays false
    act(() => {
      result.current.selectAll()
      mock.fireSelectionChange(true)
    })

    mock.element.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0 })
    )
    await flushMicrotasks()

    expect(clipboard.writeTextMock).not.toHaveBeenCalled()
  } finally {
    clipboard.restore()
  }
})

test('mousedown with right button (button !== 0) does NOT start a drag', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()
  try {
    renderHook(() => useTerminalClipboard({ terminal: mock.terminal }))

    mock.element.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 2 })
    )
    mock.fireSelectionChange(true)
    mock.element.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0 })
    )
    await flushMicrotasks()

    expect(clipboard.writeTextMock).not.toHaveBeenCalled()
  } finally {
    clipboard.restore()
  }
})
```

- [ ] **Step 9.2: Run, verify failure**

- [ ] **Step 9.3: Implement the drag gate**

Replace the `useEffect` body (the entire `useEffect` from Task 8) with:

```typescript
useEffect(() => {
  if (!terminal) {
    return
  }
  const element = terminal.element
  if (!element) {
    return
  }

  let isDragging = false
  let pendingSelection = false

  const handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return
    isDragging = true
    pendingSelection = false
  }

  const disposable = terminal.onSelectionChange(() => {
    const has = terminal.hasSelection()
    setHasSelection(has)
    if (isDragging && has) {
      pendingSelection = true
    }
  })

  const handleMouseUp = (): void => {
    if (!isDragging) return
    isDragging = false
    if (!pendingSelection || !terminal.hasSelection()) return
    pendingSelection = false
    queueMicrotask(() => {
      if (terminal.hasSelection()) {
        void copyRef.current()
      }
    })
  }

  const handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setIsOpen(true)
    setOpenAt({ x: event.clientX, y: event.clientY })
  }

  element.addEventListener('mousedown', handleMouseDown, { passive: true })
  element.addEventListener('mouseup', handleMouseUp, { passive: true })
  element.addEventListener('contextmenu', handleContextMenu, {
    capture: true,
  })

  return (): void => {
    try {
      disposable.dispose()
    } catch {
      /* terminal already disposed; safe to swallow */
    }
    element.removeEventListener('mousedown', handleMouseDown)
    element.removeEventListener('mouseup', handleMouseUp)
    element.removeEventListener('contextmenu', handleContextMenu, {
      capture: true,
    })
  }
}, [terminal])
```

Add a `copyRef` to keep the latest `copy` callback fresh without re-running the effect. Above the `useEffect`:

```typescript
const copyRef = useRef<() => Promise<void>>(noopAsync)
```

And immediately after the `copy` definition:

```typescript
copyRef.current = copy
```

Import `useRef` from `react`:

```typescript
import { useEffect, useRef, useState } from 'react'
```

- [ ] **Step 9.4: Run, verify pass**

Expected: `18 passed`.

- [ ] **Step 9.5: Commit**

```bash
git add src/features/terminal/hooks/useTerminalClipboard.ts src/features/terminal/hooks/useTerminalClipboard.test.ts
git commit -m "feat(terminal): auto-copy on drag-released mouseup only (not selectAll/programmatic)"
```

---

### Task 10: Key event handler — keydown gate, bindings, callback refs, defensive cleanup

**Files:**

- Modify: `src/features/terminal/hooks/useTerminalClipboard.ts`
- Modify: `src/features/terminal/hooks/useTerminalClipboard.test.ts`

Spec ref: §4 Key event handler + Selection-less suppression + Callback freshness via refs + §5.6 defensive cleanup.

This is the largest task in Phase 1. Sub-steps:

- [ ] **Step 10.1: Add a key-event helper to the test file**

```typescript
type AttachedHandler = (event: KeyboardEvent) => boolean

const captureKeyHandler = (mock: MockTerminalControls): AttachedHandler => {
  const calls = (
    mock.terminal.attachCustomKeyEventHandler as unknown as {
      mock: { calls: AttachedHandler[][] }
    }
  ).mock.calls
  expect(calls.length).toBeGreaterThan(0)
  const lastCall = calls[calls.length - 1]
  return lastCall[0]
}
```

Then make `attachCustomKeyEventHandler` a real `vi.fn` in `createMockTerminal`. Replace its definition inside the `terminal` object:

```typescript
    attachCustomKeyEventHandler: vi.fn(),
```

Add `import { vi } from 'vitest'` at the top of the test file if missing.

- [ ] **Step 10.2: Write the failing tests**

Append a substantial test block:

```typescript
const keyboardEvent = (
  overrides: Partial<KeyboardEventInit> & {
    type?: string
    code: string
  }
): KeyboardEvent => {
  const { type = 'keydown', code, ...rest } = overrides
  return new KeyboardEvent(type, { code, ...rest })
}

test('event.type === "keyup" passes through (handler returns true)', () => {
  const mock = createMockTerminal()
  renderHook(() => useTerminalClipboard({ terminal: mock.terminal }))
  const handler = captureKeyHandler(mock)

  const result = handler(
    keyboardEvent({
      type: 'keyup',
      code: 'KeyC',
      ctrlKey: true,
      shiftKey: true,
    })
  )
  expect(result).toBe(true)
})

test('preferModifier="ctrl" + Ctrl+Shift+C with selection → suppress + copy', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()
  try {
    renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        preferModifier: 'ctrl',
      })
    )
    mock.fireSelectionChange(true)
    const handler = captureKeyHandler(mock)

    const result = handler(
      keyboardEvent({ code: 'KeyC', ctrlKey: true, shiftKey: true })
    )
    await flushMicrotasks()

    expect(result).toBe(false)
    expect(clipboard.writeTextMock).toHaveBeenCalledWith('EVERYTHING')
  } finally {
    clipboard.restore()
  }
})

test('preferModifier="ctrl" + Ctrl+Shift+C WITHOUT selection → suppress + no copy (no SIGINT leak)', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()
  try {
    renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        preferModifier: 'ctrl',
      })
    )
    const handler = captureKeyHandler(mock)

    const result = handler(
      keyboardEvent({ code: 'KeyC', ctrlKey: true, shiftKey: true })
    )
    await flushMicrotasks()

    expect(result).toBe(false) // suppressed — must NOT reach xterm/PTY
    expect(clipboard.writeTextMock).not.toHaveBeenCalled()
  } finally {
    clipboard.restore()
  }
})

test('preferModifier="ctrl" + Ctrl+C with selection passes through (SIGINT path preserved)', () => {
  const mock = createMockTerminal()
  renderHook(() =>
    useTerminalClipboard({
      terminal: mock.terminal,
      preferModifier: 'ctrl',
    })
  )
  mock.fireSelectionChange(true)
  const handler = captureKeyHandler(mock)

  const result = handler(keyboardEvent({ code: 'KeyC', ctrlKey: true }))
  expect(result).toBe(true)
})

test('preferModifier="meta" + Cmd+C with selection → suppress + copy', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()
  try {
    renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        preferModifier: 'meta',
      })
    )
    mock.fireSelectionChange(true)
    const handler = captureKeyHandler(mock)

    const result = handler(keyboardEvent({ code: 'KeyC', metaKey: true }))
    await flushMicrotasks()

    expect(result).toBe(false)
    expect(clipboard.writeTextMock).toHaveBeenCalledOnce()
  } finally {
    clipboard.restore()
  }
})

test('preferModifier="meta" + Cmd+C without selection passes through', () => {
  const mock = createMockTerminal()
  renderHook(() =>
    useTerminalClipboard({
      terminal: mock.terminal,
      preferModifier: 'meta',
    })
  )
  const handler = captureKeyHandler(mock)

  const result = handler(keyboardEvent({ code: 'KeyC', metaKey: true }))
  expect(result).toBe(true)
})

test('preferModifier="ctrl" + Ctrl+Shift+V → suppress + paste', async () => {
  const mock = createMockTerminal()
  const pasteSpy = vi.spyOn(mock.terminal, 'paste')
  const clipboard = installClipboardMock({ readText: async () => 'pasted' })
  try {
    renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        preferModifier: 'ctrl',
      })
    )
    const handler = captureKeyHandler(mock)

    const result = handler(
      keyboardEvent({ code: 'KeyV', ctrlKey: true, shiftKey: true })
    )
    await flushMicrotasks()

    expect(result).toBe(false)
    expect(pasteSpy).toHaveBeenCalledWith('pasted')
  } finally {
    clipboard.restore()
  }
})

test('preferModifier="meta" + Cmd+Shift+V → suppress + paste', async () => {
  const mock = createMockTerminal()
  const pasteSpy = vi.spyOn(mock.terminal, 'paste')
  const clipboard = installClipboardMock({ readText: async () => 'pasted' })
  try {
    renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        preferModifier: 'meta',
      })
    )
    const handler = captureKeyHandler(mock)

    const result = handler(
      keyboardEvent({ code: 'KeyV', metaKey: true, shiftKey: true })
    )
    await flushMicrotasks()

    expect(result).toBe(false)
    expect(pasteSpy).toHaveBeenCalledWith('pasted')
  } finally {
    clipboard.restore()
  }
})

test('unrelated key (KeyA) passes through unchanged', () => {
  const mock = createMockTerminal()
  renderHook(() => useTerminalClipboard({ terminal: mock.terminal }))
  const handler = captureKeyHandler(mock)

  expect(handler(keyboardEvent({ code: 'KeyA', ctrlKey: true }))).toBe(true)
  expect(handler(keyboardEvent({ code: 'KeyA' }))).toBe(true)
})

test('re-render with new onCopyError reference does NOT re-attach handlers', () => {
  const mock = createMockTerminal()
  const attachSpy = mock.terminal
    .attachCustomKeyEventHandler as unknown as ReturnType<typeof vi.fn>

  const { rerender } = renderHook(
    ({ onCopyError }: { onCopyError: () => void }) =>
      useTerminalClipboard({ terminal: mock.terminal, onCopyError }),
    { initialProps: { onCopyError: () => {} } }
  )

  const callsBefore = attachSpy.mock.calls.length

  rerender({ onCopyError: () => {} }) // new identity each render

  const callsAfter = attachSpy.mock.calls.length
  expect(callsAfter).toBe(callsBefore)
})
```

- [ ] **Step 10.3: Run, verify failures (expect ~10 failures)**

- [ ] **Step 10.4: Implement the key handler with platform detection, refs, defensive cleanup**

Replace the entire `useTerminalClipboard.ts` with this final implementation:

```typescript
import { useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'

export type ClipboardModifier = 'meta' | 'ctrl'

export interface UseTerminalClipboardOptions {
  terminal: Terminal | null
  preferModifier?: ClipboardModifier
  onCopyError?: (error: unknown) => void
  onPasteError?: (error: unknown) => void
}

export interface UseTerminalClipboardResult {
  hasSelection: boolean
  isOpen: boolean
  openAt: { x: number; y: number } | null
  close: () => void
  copy: () => Promise<void>
  paste: () => Promise<void>
  selectAll: () => void
  clear: () => void
}

const detectModifier = (): ClipboardModifier => {
  const platform =
    typeof window !== 'undefined' && window.navigator
      ? window.navigator.platform.toLowerCase()
      : ''
  return platform.includes('mac') ? 'meta' : 'ctrl'
}

const writeViaTextarea = (text: string): boolean => {
  // jsdom (and some sandboxed Electron builds) ship without
  // document.execCommand. Treat undefined or throwing as fallback
  // failure so the outer catch surfaces it via onCopyError.
  const execCommand = (
    document as unknown as {
      execCommand?: (command: string) => boolean
    }
  ).execCommand
  if (typeof execCommand !== 'function') return false

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()
  let ok = false
  try {
    ok = execCommand.call(document, 'copy')
  } catch {
    ok = false
  } finally {
    document.body.removeChild(textarea)
  }
  return ok
}

const noopVoid = (): void => undefined
const noopAsync = async (): Promise<void> => undefined

export const useTerminalClipboard = (
  options: UseTerminalClipboardOptions
): UseTerminalClipboardResult => {
  const { terminal } = options
  const preferModifier = options.preferModifier ?? detectModifier()

  const [hasSelection, setHasSelection] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [openAt, setOpenAt] = useState<{ x: number; y: number } | null>(null)

  const onCopyErrorRef = useRef(options.onCopyError)
  const onPasteErrorRef = useRef(options.onPasteError)
  onCopyErrorRef.current = options.onCopyError
  onPasteErrorRef.current = options.onPasteError

  const copy = async (): Promise<void> => {
    if (!terminal || !terminal.hasSelection()) return
    const text = terminal.getSelection()
    if (text === '') return
    try {
      await window.navigator.clipboard.writeText(text)
      return
    } catch (writeError: unknown) {
      const fallbackOk = writeViaTextarea(text)
      if (fallbackOk) return
      const finalError =
        writeError instanceof Error
          ? writeError
          : new Error('Clipboard write failed')
      onCopyErrorRef.current?.(finalError)
    }
  }

  const paste = async (): Promise<void> => {
    if (!terminal) return
    const clipboard = window.navigator.clipboard
    if (clipboard?.readText === undefined) {
      onPasteErrorRef.current?.(new Error('Clipboard read API unavailable'))
      return
    }
    try {
      const text = await clipboard.readText()
      if (text === '') return
      terminal.paste(text)
    } catch (error: unknown) {
      onPasteErrorRef.current?.(error)
    }
  }

  const selectAll = (): void => {
    if (!terminal) return
    terminal.selectAll()
  }

  const clear = (): void => {
    if (!terminal) return
    terminal.clear()
  }

  const close = (): void => {
    setIsOpen(false)
    setOpenAt(null)
  }

  const copyRef = useRef<() => Promise<void>>(noopAsync)
  const pasteRef = useRef<() => Promise<void>>(noopAsync)
  copyRef.current = copy
  pasteRef.current = paste

  useEffect(() => {
    if (!terminal) {
      return
    }
    const element = terminal.element
    if (!element) {
      return
    }

    let isDragging = false
    let pendingSelection = false

    const handleMouseDown = (event: MouseEvent): void => {
      if (event.button !== 0) return
      isDragging = true
      pendingSelection = false
    }

    const disposable = terminal.onSelectionChange(() => {
      const has = terminal.hasSelection()
      setHasSelection(has)
      if (isDragging && has) {
        pendingSelection = true
      }
    })

    const handleMouseUp = (): void => {
      if (!isDragging) return
      isDragging = false
      if (!pendingSelection || !terminal.hasSelection()) return
      pendingSelection = false
      queueMicrotask(() => {
        if (terminal.hasSelection()) {
          void copyRef.current()
        }
      })
    }

    const handleContextMenu = (event: MouseEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      setIsOpen(true)
      setOpenAt({ x: event.clientX, y: event.clientY })
    }

    const isMac = preferModifier === 'meta'

    const handleKey = (event: KeyboardEvent): boolean => {
      if (event.type !== 'keydown') return true

      // Copy bindings
      if (event.code === 'KeyC') {
        if (isMac) {
          const cmdOnly =
            event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
          if (cmdOnly) {
            if (terminal.hasSelection()) {
              event.preventDefault()
              void copyRef.current()
              return false
            }
            return true // Cmd+C without selection: pass-through (safe on Mac)
          }
        } else {
          const ctrlShift =
            event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey
          if (ctrlShift) {
            event.preventDefault()
            if (terminal.hasSelection()) {
              void copyRef.current()
            }
            // Selection-less suppression: return false either way so the
            // PTY does NOT receive \x03 (which would interrupt the process).
            return false
          }
        }
      }

      // Paste bindings (suppress regardless of clipboard state)
      if (event.code === 'KeyV') {
        const matched = isMac
          ? event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey
          : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey
        if (matched) {
          event.preventDefault()
          void pasteRef.current()
          return false
        }
      }

      return true
    }

    try {
      terminal.attachCustomKeyEventHandler(handleKey)
    } catch {
      /* terminal not ready; effect will rerun if/when it is */
    }

    element.addEventListener('mousedown', handleMouseDown, { passive: true })
    element.addEventListener('mouseup', handleMouseUp, { passive: true })
    element.addEventListener('contextmenu', handleContextMenu, {
      capture: true,
    })

    return (): void => {
      try {
        disposable.dispose()
      } catch {
        /* terminal already disposed; safe to swallow */
      }
      try {
        terminal.attachCustomKeyEventHandler(() => true)
      } catch {
        /* terminal already disposed; restoration is moot */
      }
      element.removeEventListener('mousedown', handleMouseDown)
      element.removeEventListener('mouseup', handleMouseUp)
      element.removeEventListener('contextmenu', handleContextMenu, {
        capture: true,
      })
      setIsOpen(false)
      setOpenAt(null)
      setHasSelection(false)
    }
  }, [terminal, preferModifier])

  return {
    hasSelection,
    isOpen,
    openAt,
    close,
    copy,
    paste,
    selectAll,
    clear,
  }
}
```

- [ ] **Step 10.5: Run, verify all 27 tests pass**

```bash
npx vitest run src/features/terminal/hooks/useTerminalClipboard.test.ts
```

Expected: `27 passed` (or however many you accumulated — count them in the test file).

- [ ] **Step 10.6: Run the full test suite to make sure nothing else broke**

```bash
npm run test
```

Expected: green.

- [ ] **Step 10.7: Run lint and type-check**

```bash
npm run lint -- src/features/terminal/hooks/useTerminalClipboard.ts src/features/terminal/hooks/useTerminalClipboard.test.ts
npm run type-check
```

Fix any issues that surface. The most likely ones are explicit return types on inner functions and `unknown`-narrowing in catches.

- [ ] **Step 10.8: Commit**

```bash
git add src/features/terminal/hooks/useTerminalClipboard.ts src/features/terminal/hooks/useTerminalClipboard.test.ts
git commit -m "feat(terminal): wire keyboard shortcuts with platform detection and SIGINT-safe Ctrl+Shift+C"
```

---

### Task 10b: Cleanup + terminal-identity-change lifecycle tests

**Files:**

- Modify: `src/features/terminal/hooks/useTerminalClipboard.test.ts`

Spec ref: §5.6 defensive cleanup, §7.2.1 "Cleanup on unmount" and "Cleanup on `terminal` identity change" rows. These are the riskiest behaviors in the lifecycle contract; the cleanup is defensive precisely because React effect ordering is subtle (codex flagged the spec on this).

- [ ] **Step 10b.1: Write the failing tests**

Append:

```typescript
test('unmount disposes onSelectionChange, restores default key handler, removes DOM listeners', () => {
  const mock = createMockTerminal()
  const attachSpy = mock.terminal
    .attachCustomKeyEventHandler as unknown as ReturnType<typeof vi.fn>

  const { result, unmount } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  // Confirm initial attach
  expect(attachSpy).toHaveBeenCalledTimes(1)

  unmount()

  // attachCustomKeyEventHandler called again with `() => true` to restore default
  expect(attachSpy).toHaveBeenCalledTimes(2)
  const restoreHandler = attachSpy.mock.calls[1][0] as (
    e: KeyboardEvent
  ) => boolean
  // The restore handler must be a "return true for everything" no-op.
  expect(restoreHandler(new KeyboardEvent('keydown', { code: 'KeyC' }))).toBe(
    true
  )

  // DOM listeners are gone — dispatching contextmenu after unmount must
  // NOT mutate state. (Quick proxy: assert no further updates happen via
  // hasSelection. result.current is the LAST rendered value.)
  mock.element.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 1,
      clientY: 1,
    })
  )
  expect(result.current.isOpen).toBe(false)
})

test('unmount tolerates a terminal whose attachCustomKeyEventHandler throws (defensive)', () => {
  const mock = createMockTerminal()
  const attachSpy = mock.terminal
    .attachCustomKeyEventHandler as unknown as ReturnType<typeof vi.fn>

  const { unmount } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  // Simulate the terminal already being disposed: the restore call throws.
  attachSpy.mockImplementationOnce(() => {
    throw new Error('terminal disposed')
  })

  // Defensive cleanup must NOT bubble the error out of React's cleanup.
  expect(() => {
    unmount()
  }).not.toThrow()
})

test('changing terminal identity cleans up old terminal and attaches to new one', () => {
  const first = createMockTerminal()
  const second = createMockTerminal()
  const firstAttach = first.terminal
    .attachCustomKeyEventHandler as unknown as ReturnType<typeof vi.fn>
  const secondAttach = second.terminal
    .attachCustomKeyEventHandler as unknown as ReturnType<typeof vi.fn>

  const { rerender } = renderHook(
    ({ terminal }: { terminal: Terminal }) =>
      useTerminalClipboard({ terminal }),
    { initialProps: { terminal: first.terminal } }
  )

  expect(firstAttach).toHaveBeenCalledTimes(1)
  expect(secondAttach).toHaveBeenCalledTimes(0)

  rerender({ terminal: second.terminal })

  // First terminal: restore call (count 2). Second terminal: initial attach (count 1).
  expect(firstAttach).toHaveBeenCalledTimes(2)
  expect(secondAttach).toHaveBeenCalledTimes(1)

  // Old terminal's listeners no longer mutate state — selection fired on
  // `first` must not flip hasSelection (it's tied to the active terminal).
  first.fireSelectionChange(true)
  // (We don't have direct access to React state here without result.current,
  // but the absence of a console error and the count assertions above prove
  // the cleanup ran. A full assertion on state would require result.current
  // — kept this test focused on observable attach/restore counts.)
})

test('terminal === null after non-null resets isOpen/openAt/hasSelection', () => {
  const mock = createMockTerminal()
  const { result, rerender } = renderHook(
    ({ terminal }: { terminal: Terminal | null }) =>
      useTerminalClipboard({ terminal }),
    { initialProps: { terminal: mock.terminal as Terminal | null } }
  )

  // Open the menu and set selection.
  act(() => {
    mock.element.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      })
    )
    mock.fireSelectionChange(true)
  })
  expect(result.current.isOpen).toBe(true)
  expect(result.current.hasSelection).toBe(true)

  // Drop to null; cleanup must reset state.
  rerender({ terminal: null })

  expect(result.current.isOpen).toBe(false)
  expect(result.current.openAt).toBeNull()
  expect(result.current.hasSelection).toBe(false)
})
```

- [ ] **Step 10b.2: Run, verify pass (no implementation changes needed — Task 10's cleanup already does this)**

```bash
npx vitest run src/features/terminal/hooks/useTerminalClipboard.test.ts
```

Expected: all tests pass, including the four new ones. If any fail, the cleanup logic in `useTerminalClipboard.ts` needs adjustment — likely the `setIsOpen(false) / setOpenAt(null) / setHasSelection(false)` calls at the end of the cleanup.

- [ ] **Step 10b.3: Commit**

```bash
git add src/features/terminal/hooks/useTerminalClipboard.test.ts
git commit -m "test(terminal): cover unmount cleanup and terminal-identity-change lifecycle"
```

---

## Phase 2 — `TerminalContextMenu` component (Tasks 11-14)

### Task 11: Component scaffold + null when closed

**Files:**

- Create: `src/features/terminal/components/TerminalContextMenu.tsx`
- Create: `src/features/terminal/components/TerminalContextMenu.test.tsx`

Spec ref: §6 Signature.

- [ ] **Step 11.1: Write the failing tests**

```tsx
// src/features/terminal/components/TerminalContextMenu.test.tsx
import { render, screen } from '@testing-library/react'
import { test, expect, vi } from 'vitest'
import { TerminalContextMenu } from './TerminalContextMenu'

const baseProps = {
  onClose: vi.fn(),
  onCopy: vi.fn(),
  onPaste: vi.fn(),
  onSelectAll: vi.fn(),
  onClear: vi.fn(),
  canCopy: true,
}

test('renders null when isOpen is false', () => {
  const { container } = render(
    <TerminalContextMenu {...baseProps} isOpen={false} position={null} />
  )
  expect(container).toBeEmptyDOMElement()
})

test('renders a menu with four items when isOpen and canCopy', () => {
  render(
    <TerminalContextMenu
      {...baseProps}
      isOpen={true}
      position={{ x: 50, y: 60 }}
    />
  )

  expect(
    screen.getByRole('menu', { name: 'Terminal actions' })
  ).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Paste' })).toBeInTheDocument()
  expect(
    screen.getByRole('menuitem', { name: 'Select All' })
  ).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Clear' })).toBeInTheDocument()
})
```

- [ ] **Step 11.2: Run, verify failure (module not found)**

- [ ] **Step 11.3: Create the minimal component**

```tsx
// src/features/terminal/components/TerminalContextMenu.tsx
import type { ReactElement } from 'react'

export interface TerminalContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number } | null
  onClose: () => void
  onCopy: () => void
  onPaste: () => void
  onSelectAll: () => void
  onClear: () => void
  canCopy: boolean
}

export const TerminalContextMenu = ({
  isOpen,
  onCopy,
  onPaste,
  onSelectAll,
  onClear,
  canCopy,
}: TerminalContextMenuProps): ReactElement | null => {
  if (!isOpen) return null
  return (
    <div role="menu" aria-label="Terminal actions">
      <button
        type="button"
        role="menuitem"
        onClick={onCopy}
        aria-disabled={canCopy ? undefined : true}
      >
        Copy
      </button>
      <button type="button" role="menuitem" onClick={onPaste}>
        Paste
      </button>
      <button type="button" role="menuitem" onClick={onSelectAll}>
        Select All
      </button>
      <button type="button" role="menuitem" onClick={onClear}>
        Clear
      </button>
    </div>
  )
}
```

- [ ] **Step 11.4: Run, verify pass**

Expected: `2 passed`.

- [ ] **Step 11.5: Commit**

```bash
git add src/features/terminal/components/TerminalContextMenu.tsx src/features/terminal/components/TerminalContextMenu.test.tsx
git commit -m "feat(terminal): scaffold TerminalContextMenu with four menuitem buttons"
```

---

### Task 12: Disabled Copy + activation order (onCopy → onClose)

**Files:**

- Modify: `src/features/terminal/components/TerminalContextMenu.tsx`
- Modify: `src/features/terminal/components/TerminalContextMenu.test.tsx`

Spec ref: §6 Accessibility contract row "Copy item" + §6 Dismissal order.

- [ ] **Step 12.1: Write the failing tests**

Append:

```tsx
test('Copy item has aria-disabled="true" when canCopy is false', () => {
  render(
    <TerminalContextMenu
      {...baseProps}
      isOpen={true}
      position={{ x: 0, y: 0 }}
      canCopy={false}
    />
  )
  expect(screen.getByRole('menuitem', { name: 'Copy' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
})

test('clicking Copy with canCopy=true fires onCopy then onClose (in that order)', async () => {
  const { userEvent } = await import('@testing-library/user-event')
  const user = userEvent.setup()
  const order: string[] = []
  const onCopy = vi.fn(() => order.push('copy'))
  const onClose = vi.fn(() => order.push('close'))

  render(
    <TerminalContextMenu
      {...baseProps}
      onCopy={onCopy}
      onClose={onClose}
      isOpen={true}
      position={{ x: 0, y: 0 }}
    />
  )

  await user.click(screen.getByRole('menuitem', { name: 'Copy' }))

  expect(order).toEqual(['copy', 'close'])
})

test('clicking Copy when canCopy=false does NOT fire onCopy', async () => {
  const { userEvent } = await import('@testing-library/user-event')
  const user = userEvent.setup()
  const onCopy = vi.fn()
  const onClose = vi.fn()

  render(
    <TerminalContextMenu
      {...baseProps}
      onCopy={onCopy}
      onClose={onClose}
      canCopy={false}
      isOpen={true}
      position={{ x: 0, y: 0 }}
    />
  )

  await user.click(screen.getByRole('menuitem', { name: 'Copy' }))

  expect(onCopy).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})
```

- [ ] **Step 12.2: Run, verify failure (currently no onClose call, no disabled gating)**

- [ ] **Step 12.3: Implement disabled gating and dismissal order**

Wrap each item's click handler with a chained call to `onClose`. Replace the four `<button>` elements:

```tsx
const wrap = (handler: () => void) => (): void => {
  handler()
  onClose()
}

const handleCopyClick = (): void => {
  if (!canCopy) return
  onCopy()
  onClose()
}

return (
  <div role="menu" aria-label="Terminal actions">
    <button
      type="button"
      role="menuitem"
      onClick={handleCopyClick}
      aria-disabled={canCopy ? undefined : true}
    >
      Copy
    </button>
    <button type="button" role="menuitem" onClick={wrap(onPaste)}>
      Paste
    </button>
    <button type="button" role="menuitem" onClick={wrap(onSelectAll)}>
      Select All
    </button>
    <button type="button" role="menuitem" onClick={wrap(onClear)}>
      Clear
    </button>
  </div>
)
```

Also destructure `onClose` from props (it was unused before):

```tsx
export const TerminalContextMenu = ({
  isOpen,
  onClose,
  onCopy,
  onPaste,
  onSelectAll,
  onClear,
  canCopy,
}: TerminalContextMenuProps): ReactElement | null => {
```

- [ ] **Step 12.4: Run, verify pass**

Expected: `5 passed`.

- [ ] **Step 12.5: Commit**

```bash
git add src/features/terminal/components/TerminalContextMenu.tsx src/features/terminal/components/TerminalContextMenu.test.tsx
git commit -m "feat(terminal): gate Copy on canCopy and chain item activation through onClose"
```

---

### Task 13: floating-ui positioning + dismissal (Escape, outside click)

**Files:**

- Modify: `src/features/terminal/components/TerminalContextMenu.tsx`
- Modify: `src/features/terminal/components/TerminalContextMenu.test.tsx`

Spec ref: §6 Positioning + §6 Accessibility contract (useRole, useDismiss).

- [ ] **Step 13.1: Write the failing tests**

Append:

```tsx
test('pressing Escape calls onClose', async () => {
  const { userEvent } = await import('@testing-library/user-event')
  const user = userEvent.setup()
  const onClose = vi.fn()

  render(
    <TerminalContextMenu
      {...baseProps}
      onClose={onClose}
      isOpen={true}
      position={{ x: 0, y: 0 }}
    />
  )

  await user.keyboard('{Escape}')

  expect(onClose).toHaveBeenCalledOnce()
})

test('clicking outside the menu calls onClose', async () => {
  const { userEvent } = await import('@testing-library/user-event')
  const user = userEvent.setup()
  const onClose = vi.fn()

  render(
    <div>
      <button type="button" data-testid="outside">
        outside
      </button>
      <TerminalContextMenu
        {...baseProps}
        onClose={onClose}
        isOpen={true}
        position={{ x: 0, y: 0 }}
      />
    </div>
  )

  await user.click(screen.getByTestId('outside'))

  expect(onClose).toHaveBeenCalledOnce()
})
```

- [ ] **Step 13.2: Run, verify failure**

- [ ] **Step 13.3: Wire floating-ui — replace `TerminalContextMenu.tsx`**

```tsx
import { useEffect, type ReactElement } from 'react'
import {
  FloatingFocusManager,
  FloatingPortal,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'

export interface TerminalContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number } | null
  onClose: () => void
  onCopy: () => void
  onPaste: () => void
  onSelectAll: () => void
  onClear: () => void
  canCopy: boolean
}

export const TerminalContextMenu = ({
  isOpen,
  position,
  onClose,
  onCopy,
  onPaste,
  onSelectAll,
  onClear,
  canCopy,
}: TerminalContextMenuProps): ReactElement | null => {
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: (open) => {
      if (!open) onClose()
    },
    placement: 'bottom-start',
    middleware: [
      offset(0),
      flip({ fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
      shift({ padding: 8 }),
    ],
  })

  useEffect(() => {
    if (!position) return
    refs.setReference({
      getBoundingClientRect: () => ({
        x: position.x,
        y: position.y,
        top: position.y,
        left: position.x,
        right: position.x,
        bottom: position.y,
        width: 0,
        height: 0,
      }),
    })
  }, [position, refs])

  const role = useRole(context, { role: 'menu' })
  const dismiss = useDismiss(context, {
    outsidePress: true,
    escapeKey: true,
  })
  const { getFloatingProps } = useInteractions([role, dismiss])

  if (!isOpen) return null

  const handleCopyClick = (): void => {
    if (!canCopy) return
    onCopy()
    onClose()
  }
  const wrap = (handler: () => void) => (): void => {
    handler()
    onClose()
  }

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} initialFocus={canCopy ? 0 : 1}>
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          aria-label="Terminal actions"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleCopyClick}
            aria-disabled={canCopy ? undefined : true}
          >
            Copy
          </button>
          <button type="button" role="menuitem" onClick={wrap(onPaste)}>
            Paste
          </button>
          <button type="button" role="menuitem" onClick={wrap(onSelectAll)}>
            Select All
          </button>
          <button type="button" role="menuitem" onClick={wrap(onClear)}>
            Clear
          </button>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  )
}
```

- [ ] **Step 13.4: Run, verify pass**

Expected: `7 passed`.

- [ ] **Step 13.5: Commit**

```bash
git add src/features/terminal/components/TerminalContextMenu.tsx src/features/terminal/components/TerminalContextMenu.test.tsx
git commit -m "feat(terminal): position menu via floating-ui + dismiss on Escape/outside click"
```

---

### Task 14: Keyboard navigation (Arrow Down/Up, disabled skip, loop)

**Files:**

- Modify: `src/features/terminal/components/TerminalContextMenu.tsx`
- Modify: `src/features/terminal/components/TerminalContextMenu.test.tsx`

Spec ref: §6 Keyboard navigation.

- [ ] **Step 14.1: Write the failing test**

Append:

```tsx
test('ArrowDown navigates through enabled items and skips disabled Copy', async () => {
  const { userEvent } = await import('@testing-library/user-event')
  const user = userEvent.setup()

  render(
    <TerminalContextMenu
      {...baseProps}
      isOpen={true}
      position={{ x: 0, y: 0 }}
      canCopy={false}
    />
  )

  // Initial focus should be on Paste (index 1) because Copy is disabled.
  expect(screen.getByRole('menuitem', { name: 'Paste' })).toHaveFocus()

  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: 'Select All' })).toHaveFocus()

  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: 'Clear' })).toHaveFocus()

  // Loop back to Paste (Copy is disabled and skipped)
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: 'Paste' })).toHaveFocus()
})
```

- [ ] **Step 14.2: Run, verify failure**

- [ ] **Step 14.3: Wire `useListNavigation` with `listRef`, `activeIndex`, `disabledIndices`, `loop`**

Edit `TerminalContextMenu.tsx`:

1. **Merge `useState` and `useRef` into the existing React import** (the repo enforces `import/no-duplicates`, so do NOT add a second `import ... from 'react'` line). Change the existing line:

```tsx
import { useEffect, type ReactElement } from 'react'
```

to:

```tsx
import { useEffect, useRef, useState, type ReactElement } from 'react'
```

Then merge `useListNavigation` into the existing `@floating-ui/react` import block. Change:

```tsx
import {
  FloatingFocusManager,
  FloatingPortal,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'
```

to:

```tsx
import {
  FloatingFocusManager,
  FloatingPortal,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from '@floating-ui/react'
```

2. Inside the component, after the existing hooks but before the `useInteractions` call:

```tsx
const listRef = useRef<Array<HTMLElement | null>>([])
const [activeIndex, setActiveIndex] = useState<number | null>(null)
const disabledIndices = canCopy ? undefined : [0]

const listNavigation = useListNavigation(context, {
  listRef,
  activeIndex,
  onNavigate: setActiveIndex,
  loop: true,
  disabledIndices,
  openOnArrowKeyDown: false,
})
```

3. Update `useInteractions`:

```tsx
const { getFloatingProps, getItemProps } = useInteractions([
  role,
  dismiss,
  listNavigation,
])
```

4. Add ref-callback + `getItemProps` to each button. Replace each `<button>` with:

```tsx
          <button
            type="button"
            role="menuitem"
            ref={(node) => { listRef.current[0] = node }}
            tabIndex={activeIndex === 0 ? 0 : -1}
            {...getItemProps({
              onClick: handleCopyClick,
            })}
            aria-disabled={canCopy ? undefined : true}
          >
            Copy
          </button>
          <button
            type="button"
            role="menuitem"
            ref={(node) => { listRef.current[1] = node }}
            tabIndex={activeIndex === 1 ? 0 : -1}
            {...getItemProps({
              onClick: wrap(onPaste),
            })}
          >
            Paste
          </button>
          <button
            type="button"
            role="menuitem"
            ref={(node) => { listRef.current[2] = node }}
            tabIndex={activeIndex === 2 ? 0 : -1}
            {...getItemProps({
              onClick: wrap(onSelectAll),
            })}
          >
            Select All
          </button>
          <button
            type="button"
            role="menuitem"
            ref={(node) => { listRef.current[3] = node }}
            tabIndex={activeIndex === 3 ? 0 : -1}
            {...getItemProps({
              onClick: wrap(onClear),
            })}
          >
            Clear
          </button>
```

- [ ] **Step 14.4: Run, verify pass**

Expected: `8 passed`.

- [ ] **Step 14.5: Run full suite + lint + type-check**

```bash
npm run test
npm run lint -- src/features/terminal/components/TerminalContextMenu.tsx src/features/terminal/components/TerminalContextMenu.test.tsx
npm run type-check
```

Fix issues.

- [ ] **Step 14.6: Commit**

```bash
git add src/features/terminal/components/TerminalContextMenu.tsx src/features/terminal/components/TerminalContextMenu.test.tsx
git commit -m "feat(terminal): wire useListNavigation for keyboard menu navigation with disabled-item skipping"
```

---

## Phase 3 — Integration & QA (Tasks 15-17)

### Task 15: Wire `useTerminalClipboard` + `<TerminalContextMenu>` into `Body.tsx`

**Files:**

- Modify: `src/features/terminal/components/TerminalPane/Body.tsx`

Spec ref: §7.1.

- [ ] **Step 15.1: Read the current `Body.tsx` around the imports and the return**

```bash
sed -n '1,40p' src/features/terminal/components/TerminalPane/Body.tsx
sed -n '785,810p' src/features/terminal/components/TerminalPane/Body.tsx
```

Note the exact `return (` block and the imports block.

- [ ] **Step 15.2: Add the new imports near the existing terminal-feature imports**

Add to `Body.tsx`:

```tsx
import { useTerminalClipboard } from '../../hooks/useTerminalClipboard'
import { TerminalContextMenu } from '../TerminalContextMenu'
```

- [ ] **Step 15.3: Call the hook at component top level**

After the existing `useEffect` that owns Terminal creation (around line 786 after the `[sessionId]` deps), and before the `return`, add:

```tsx
const clipboard = useTerminalClipboard({
  terminal,
  // TODO: surface clipboard failures via the project's logger/toast.
  // Until a surface is in place, both callbacks are no-ops; QA matrix
  // rows 6 / 11 will fail silently if Electron denies clipboard-read
  // — verify `navigator.clipboard.readText()` works in this build
  // before merging (see spec §7.1).
  onCopyError: () => undefined,
  onPasteError: () => undefined,
})
```

- [ ] **Step 15.4: Mount the menu inside the existing return**

Find the inner `<div ref={containerRef} ... />` and append a sibling `<TerminalContextMenu>` immediately after it:

```tsx
      <div
        ref={containerRef}
        data-testid="terminal-pane"
        data-pty-id={sessionId}
        className="h-full w-full"
      />
      <TerminalContextMenu
        isOpen={clipboard.isOpen}
        position={clipboard.openAt}
        onClose={clipboard.close}
        onCopy={(): void => {
          void clipboard.copy()
        }}
        onPaste={(): void => {
          void clipboard.paste()
        }}
        onSelectAll={clipboard.selectAll}
        onClear={clipboard.clear}
        canCopy={clipboard.hasSelection}
      />
```

- [ ] **Step 15.5: Run the existing Body.tsx tests to make sure the integration didn't break anything**

```bash
npx vitest run src/features/terminal/components/TerminalPane/
```

Expected: all existing tests still pass.

- [ ] **Step 15.6: Run lint + type-check**

```bash
npm run lint -- src/features/terminal/components/TerminalPane/Body.tsx
npm run type-check
```

Fix any issues. Common ones: explicit return types on the arrow callbacks (`onCopy`, `onPaste`), or unused-import warnings.

- [ ] **Step 15.7: Run the full test suite**

```bash
npm run test
```

Expected: green.

- [ ] **Step 15.8: Commit**

```bash
git add src/features/terminal/components/TerminalPane/Body.tsx
git commit -m "feat(terminal): mount useTerminalClipboard and TerminalContextMenu in TerminalPane Body"
```

---

### Task 16: Pre-merge smoke — start the dev server and run the §7.3 manual verification matrix

**Files:** none (manual QA).

Spec ref: §7.3 (21-row QA matrix).

- [ ] **Step 16.1: Start the Electron dev shell**

```bash
npm run electron:dev
```

This builds the Rust sidecar then runs `vite --mode electron` and launches the Electron app. **Do NOT use `npm run dev` — that runs the bare Vite renderer with no PTY backend, so the terminal pane is empty and rows 1-21 cannot be verified.** Wait for the Electron window to open.

- [ ] **Step 16.2: Verify rows 1-7 (drag, shortcuts, paste)**

For each row in spec §7.3 numbered 1 through 7, perform the action and confirm the expected result. If row 4 (Linux/Win `Ctrl+C` → SIGINT) is on Linux and you can `Ctrl+C` a `sleep 100` and see it interrupt, that's the proof. If row 5 (macOS `Cmd+C` no selection) — verify no spurious clipboard write by inspecting clipboard before/after.

- [ ] **Step 16.3: Verify rows 8-16 (right-click menu)**

For each row, right-click in the terminal and verify the menu opens at the click position with all four items. Try the disabled-Copy state by clicking before selecting any text. Verify Escape and outside-click both dismiss. Verify ArrowDown skips the disabled Copy.

- [ ] **Step 16.4: Verify rows 17-19 (vim mouse-mode)**

Inside a terminal pane, run `vim` then `:set mouse=a`. Try drag without Shift → no selection. Try Shift+drag → selection + auto-copy. Try right-click → menu opens; vim sees a button-2 mousedown (accepted per §5.2).

- [ ] **Step 16.5: Verify rows 20-21 (lifecycle)**

Use `Mod+\` to switch layouts; verify copy still works in each pane post-switch. Close a session tab and reopen it; verify copy works in the new terminal.

- [ ] **Step 16.6: Verify `navigator.clipboard.readText()` works in this Electron build**

Open dev tools in the Electron renderer (`Ctrl+Shift+I` on Linux/Win; `Cmd+Opt+I` on macOS). In the console, run:

```javascript
await navigator.clipboard.readText()
```

Expected: resolves to a string (the current clipboard contents). If it throws or rejects, then QA rows 6 / 11 will fail silently — see spec §7.1 pre-merge gate. Options: wire `onPasteError` to a logger that the user can see, or scope back to legacy `Ctrl+V` only (delete the menu's Paste item and the `Ctrl/Cmd+Shift+V` binding for v1).

- [ ] **Step 16.7: Stop the dev server**

`Ctrl+C` in the terminal where `npm run electron:dev` is running.

- [ ] **Step 16.8: Record QA results in the PR description**

When opening the PR, include a checklist of all 21 rows with pass/fail. Any failures block merge per §7.3.

---

### Task 17: Run the project gates and prepare for PR

**Files:** none.

- [ ] **Step 17.1: Full test suite (final)**

```bash
npm run test
```

- [ ] **Step 17.2: Lint (full project)**

```bash
npm run lint
```

- [ ] **Step 17.3: Format check**

```bash
npm run format:check
```

If it complains, run `npm run format` and commit any formatting changes as a separate `chore: format` commit.

- [ ] **Step 17.4: Type check**

```bash
npm run type-check
```

- [ ] **Step 17.5: Push the branch and open the PR**

```bash
git push -u origin HEAD
```

Open the PR with a body that lists the §7.3 QA matrix rows and their pass/fail status. Cross-link the spec
(`docs/superpowers/specs/2026-05-21-terminal-copy-support-design.md`) and this plan.

---

## Summary of files

| Status   | Path                                                            | Approx. lines |
| -------- | --------------------------------------------------------------- | ------------- |
| Created  | `src/features/terminal/hooks/useTerminalClipboard.ts`           | ~200          |
| Created  | `src/features/terminal/hooks/useTerminalClipboard.test.ts`      | ~600          |
| Created  | `src/features/terminal/components/TerminalContextMenu.tsx`      | ~150          |
| Created  | `src/features/terminal/components/TerminalContextMenu.test.tsx` | ~250          |
| Modified | `src/features/terminal/components/TerminalPane/Body.tsx`        | ~+25          |

Zero changes under `crates/backend/`, `electron/`, or any preload bridge. The `electron/backend-methods.ts` allowlist is untouched.
