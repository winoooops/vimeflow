# Session Switching Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VS Code-style MRU session switching (`Ctrl+Tab` hold-overlay) and session close (`⌘W` / `Ctrl+Shift+W`), catalog-registered and rebindable from Settings → Keymap.

**Architecture:** Three new global catalog commands drive (1) an MRU switcher overlay built on the shared `Dialog` primitive (which already handles the native-overlay path for Ghostty), fed by an MRU list derived from a new serialized activation-settlement contract in `useActiveSessionController`, and (2) a close shortcut that reuses the sidebar's guarded close-with-successor behavior, hoisted into a shared helper. Spec: `docs/superpowers/specs/2026-07-18-session-switching-keymap-design.md` (Accepted, codex round 7).

**Tech Stack:** React 18 + TypeScript (ESM), Vitest + Testing Library, Electron main-process validators, WebdriverIO e2e.

## Global Constraints

- Work in `worktrees/session-switching-keymap` on branch `feat/session-switching-keymap`. All commands run from that directory.
- Prettier style: no semicolons, single quotes, trailing commas es5. Enforced by pre-commit; run `npm run format:check` before push.
- Explicit return types on ALL exported functions (`@typescript-eslint/explicit-function-return-type` is error-level, applies to hooks and components).
- Arrow-function components only. No `console.log` (`no-console: error`) — the one exception pattern is `console.warn` with an `// eslint-disable-next-line no-console` comment, already used in `useActiveSessionController.ts`.
- Vitest: `test()` not `it()`. EVERY new test file MUST `import { describe, expect, test, vi } from 'vitest'` explicitly — globals compile at runtime but `tsc -b` fails without imports.
- Comments: ONE short line max; never reference tasks, PRs, fixes, or review rounds in code comments.
- Immutability by default: spread, never `.push` on state.
- Every new `.ts`/`.tsx` file gets a colocated `.test.ts`/`.test.tsx`.
- Keybinding invariant: global chords have exactly one super (`Mod` xor `Ctrl`); `Shift`/`Alt` are secondaries.
- Commit subjects: conventional, lowercase after the colon. Each commit message ends with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- Run single test files with `npx vitest run <path>`.

---

### Task 1: Catalog commands + settings group surfaces

**Files:**

- Modify: `src/features/keymap/catalog.ts` (Global group block, lines ~393–422)
- Modify: `src/features/settings/components/panes/KeymapPane.tsx:45-51` (`GROUP_ORDER`)
- Modify: `src/features/settings/sections.ts:122-128` (`KEYMAP_TARGET_GROUPS`)
- Test: `src/features/keymap/catalog.test.ts`, `src/features/settings/sections.test.ts` (append)

**Interfaces:**

- Produces: `CommandId` union gains `'session-switch-next' | 'session-switch-prev' | 'session-close'`. All three: `context: 'global'`, `matchPolicy: 'exact'`, `rebindable: true`, group `'Sessions'`. `new-session`, `session-prev`, `session-next` move to group `'Sessions'`.
- Consumes: `c(code, ...mods)` chord helper already in `catalog.ts`.

- [ ] **Step 1: Write failing tests** — append to `src/features/keymap/catalog.test.ts`:

```typescript
describe('session switching commands', () => {
  test('registers the switcher pair and close command in the Sessions group', () => {
    const next = getCommand('session-switch-next')
    const prev = getCommand('session-switch-prev')
    const close = getCommand('session-close')

    for (const cmd of [next, prev, close]) {
      expect(cmd.group).toBe('Sessions')
      expect(cmd.context).toBe('global')
      expect(cmd.matchPolicy).toBe('exact')
      expect(cmd.rebindable).toBe(true)
    }
  })

  test('switcher defaults are literal Ctrl+Tab on both platforms', () => {
    const next = getCommand('session-switch-next')
    const prev = getCommand('session-switch-prev')
    expect(next.defaultCombo).toEqual({ code: 'Tab', mods: new Set(['Ctrl']) })
    expect(prev.defaultCombo).toEqual({
      code: 'Tab',
      mods: new Set(['Ctrl', 'Shift']),
    })
  })

  test('session-close is Mod+W on mac and Mod+Shift+W elsewhere', () => {
    const combo = getCommand('session-close').defaultCombo
    expect(typeof combo).toBe('function')
    const resolve = combo as (isMac: boolean) => Chord
    expect(resolve(true)).toEqual({ code: 'KeyW', mods: new Set(['Mod']) })
    expect(resolve(false)).toEqual({
      code: 'KeyW',
      mods: new Set(['Mod', 'Shift']),
    })
  })

  test('existing session commands moved to the Sessions group', () => {
    expect(getCommand('new-session').group).toBe('Sessions')
    expect(getCommand('session-prev').group).toBe('Sessions')
    expect(getCommand('session-next').group).toBe('Sessions')
  })

  test('pane digits stay tolerant (layout contract regression guard)', () => {
    for (let digit = 1; digit <= 9; digit += 1) {
      const id = `focus-pane-${digit}` as CommandId
      expect(getCommand(id).matchPolicy).toBe('tolerant')
    }
  })
})
```

Add the imports the block needs if absent: `getCommand`, `type CommandId` from `./catalog`, `type Chord` from `./chord`.

Append to `src/features/settings/sections.test.ts`:

```typescript
describe('Sessions keymap targets', () => {
  test('session switcher commands are searchable settings targets', () => {
    const ids = SETTINGS_TARGETS.map((t) => t.id)
    expect(ids).toContain(keymapCommandTargetId('session-switch-next'))
    expect(ids).toContain(keymapCommandTargetId('session-switch-prev'))
    expect(ids).toContain(keymapCommandTargetId('session-close'))
  })
})
```

(Import `SETTINGS_TARGETS` and `keymapCommandTargetId` from `./sections` if the existing file does not already.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/features/keymap/catalog.test.ts src/features/settings/sections.test.ts`. Expected: FAIL (`unknown command id: session-switch-next`).

- [ ] **Step 3: Implement.** In `catalog.ts`, change the `group` of the existing `new-session`, `session-prev`, `session-next` entries from `'Global'` to `'Sessions'`, then insert after the `session-next` entry:

```typescript
  {
    id: 'session-switch-next',
    label: 'Switch session (MRU)',
    group: 'Sessions',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: c('Tab', 'Ctrl'),
  },
  {
    id: 'session-switch-prev',
    label: 'Switch session backward (MRU)',
    group: 'Sessions',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: c('Tab', 'Ctrl', 'Shift'),
  },
  {
    id: 'session-close',
    label: 'Close session',
    group: 'Sessions',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: (isMac: boolean): Chord =>
      isMac ? c('KeyW', 'Mod') : c('KeyW', 'Mod', 'Shift'),
  },
```

In `KeymapPane.tsx` insert `'Sessions'` into `GROUP_ORDER` after `'Global'`. In `sections.ts` add `'Sessions'` to `KEYMAP_TARGET_GROUPS`.

- [ ] **Step 4: Run the full keymap + settings suites** — `npx vitest run src/features/keymap src/features/settings`. Expected: PASS. If `resolve.test.ts` or `conflicts` fixpoint tests fail, the new chords collide with an existing binding — stop and re-check against the catalog (they must not; `Tab` and `KeyW` are unbound).

- [ ] **Step 5: Commit** — `feat(keymap): add session switcher and close commands to catalog`

---

### Task 2: Serialized activation settlement in the controller

**Files:**

- Modify: `src/features/sessions/hooks/useActiveSessionController.ts` (whole hook)
- Test: `src/features/sessions/hooks/useActiveSessionController.test.ts` (append)

**Interfaces:**

- Produces (consumed by Tasks 3 and 7):

```typescript
export interface UseActiveSessionControllerOptions {
  service: ITerminalService
  sessionsRef: { current: Session[] }
  onActivationCommitted?: (id: string) => void
  onActivationRolledBack?: (id: string | null) => void
}
```

`ActiveSessionController` return shape is unchanged. Contract (spec §4): serialized dispatch — one in-flight, pending coalesces to newest; success settles `lastCommittedId` + fires `onActivationCommitted(id)`; failure with pending fires nothing; failure with nothing pending restores `lastCommittedId` into React state, fires `onActivationRolledBack(restored)` then `onActivationCommitted(restored)` when non-null; `setActiveSessionIdRaw` is a generation barrier (drops pending, invalidates in-flight effects, `lastCommittedId` = raw value, null never notifies).

- [ ] **Step 1: Write failing tests.** Append to the existing test file (reuse its fake-service pattern; the tests below are self-contained with a deferred-promise service):

```typescript
interface Deferred {
  resolve: () => void
  reject: (err: Error) => void
}

const makeDeferredService = (): {
  service: ITerminalService
  calls: string[]
  settlers: Deferred[]
} => {
  const calls: string[] = []
  const settlers: Deferred[] = []
  const service = {
    setActiveSession: (ptyId: string): Promise<void> => {
      calls.push(ptyId)

      return new Promise<void>((resolve, reject) => {
        settlers.push({ resolve: () => resolve(), reject })
      })
    },
  } as unknown as ITerminalService

  return { service, calls, settlers }
}

const liveSession = (id: string, ptyId: string): Session =>
  ({
    id,
    panes: [
      { id: `${id}-p1`, ptyId, kind: 'shell', status: 'running', active: true },
    ],
  }) as unknown as Session

describe('serialized activation settlement', () => {
  test('second activation does not dispatch until the first settles', async () => {
    const { service, calls, settlers } = makeDeferredService()
    const sessionsRef = {
      current: [liveSession('A', 'pty-a'), liveSession('B', 'pty-b')],
    }
    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    act(() => result.current.setActiveSessionId('A'))
    act(() => result.current.setActiveSessionId('B'))
    expect(calls).toEqual(['pty-a'])

    await act(async () => {
      settlers[0].resolve()
      await Promise.resolve()
    })
    expect(calls).toEqual(['pty-a', 'pty-b'])
  })

  test('rapid cycling coalesces to the newest pending target', async () => {
    const { service, calls, settlers } = makeDeferredService()
    const sessionsRef = {
      current: [
        liveSession('A', 'pty-a'),
        liveSession('B', 'pty-b'),
        liveSession('C', 'pty-c'),
      ],
    }
    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    act(() => result.current.setActiveSessionId('A'))
    act(() => result.current.setActiveSessionId('B'))
    act(() => result.current.setActiveSessionId('C'))

    await act(async () => {
      settlers[0].resolve()
      await Promise.resolve()
    })
    expect(calls).toEqual(['pty-a', 'pty-c'])
  })

  test('B succeeds then C fails: all channels land on B', async () => {
    const committed: string[] = []
    const rolledBack: Array<string | null> = []
    const { service, settlers } = makeDeferredService()
    const sessionsRef = {
      current: [liveSession('B', 'pty-b'), liveSession('C', 'pty-c')],
    }
    const { result } = renderHook(() =>
      useActiveSessionController({
        service,
        sessionsRef,
        onActivationCommitted: (id) => committed.push(id),
        onActivationRolledBack: (id) => rolledBack.push(id),
      })
    )

    act(() => result.current.setActiveSessionId('B'))
    act(() => result.current.setActiveSessionId('C'))

    await act(async () => {
      settlers[0].resolve()
      await Promise.resolve()
    })
    await act(async () => {
      settlers[1].reject(new Error('ipc failed'))
      await Promise.resolve()
    })

    expect(result.current.activeSessionId).toBe('B')
    expect(committed).toEqual(['B', 'B'])
    expect(rolledBack).toEqual(['B'])
  })

  test('B fails then C fails: all channels land on the prior committed id', async () => {
    const committed: string[] = []
    const { service, settlers } = makeDeferredService()
    const sessionsRef = {
      current: [
        liveSession('A', 'pty-a'),
        liveSession('B', 'pty-b'),
        liveSession('C', 'pty-c'),
      ],
    }
    const { result } = renderHook(() =>
      useActiveSessionController({
        service,
        sessionsRef,
        onActivationCommitted: (id) => committed.push(id),
      })
    )

    act(() => result.current.setActiveSessionId('A'))
    await act(async () => {
      settlers[0].resolve()
      await Promise.resolve()
    })

    act(() => result.current.setActiveSessionId('B'))
    act(() => result.current.setActiveSessionId('C'))
    await act(async () => {
      settlers[1].reject(new Error('b failed'))
      await Promise.resolve()
    })
    await act(async () => {
      settlers[2].reject(new Error('c failed'))
      await Promise.resolve()
    })

    expect(result.current.activeSessionId).toBe('A')
    expect(committed).toEqual(['A', 'A'])
  })

  test('browser-only activation settles synchronously and commits', () => {
    const committed: string[] = []
    const { service, calls } = makeDeferredService()
    const browserOnly = {
      id: 'W',
      panes: [{ id: 'W-p1', kind: 'browser', status: 'running', active: true }],
    } as unknown as Session
    const sessionsRef = { current: [browserOnly] }
    const { result } = renderHook(() =>
      useActiveSessionController({
        service,
        sessionsRef,
        onActivationCommitted: (id) => committed.push(id),
      })
    )

    act(() => result.current.setActiveSessionId('W'))
    expect(calls).toEqual([])
    expect(committed).toEqual(['W'])
  })

  test('B fails with C pending: C still dispatches and commits', async () => {
    const committed: string[] = []
    const { service, calls, settlers } = makeDeferredService()
    const sessionsRef = {
      current: [liveSession('B', 'pty-b'), liveSession('C', 'pty-c')],
    }
    const { result } = renderHook(() =>
      useActiveSessionController({
        service,
        sessionsRef,
        onActivationCommitted: (id) => committed.push(id),
      })
    )

    act(() => result.current.setActiveSessionId('B'))
    act(() => result.current.setActiveSessionId('C'))
    await act(async () => {
      settlers[0].reject(new Error('b failed'))
      await Promise.resolve()
    })
    await act(async () => {
      settlers[1].resolve()
      await Promise.resolve()
    })

    expect(calls).toEqual(['pty-b', 'pty-c'])
    expect(committed).toEqual(['C'])
    expect(result.current.activeSessionId).toBe('C')
  })

  test('post-barrier request queues behind the stale in-flight ipc', async () => {
    const { service, calls, settlers } = makeDeferredService()
    const sessionsRef = {
      current: [liveSession('A', 'pty-a'), liveSession('B', 'pty-b')],
    }
    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    act(() => result.current.setActiveSessionId('A'))
    act(() => result.current.setActiveSessionIdRaw(null))
    act(() => result.current.setActiveSessionId('B'))
    expect(calls).toEqual(['pty-a'])

    await act(async () => {
      settlers[0].resolve()
      await Promise.resolve()
    })
    expect(calls).toEqual(['pty-a', 'pty-b'])
  })

  test('raw write is a barrier: stale settlement applies nothing, pending drops', async () => {
    const committed: string[] = []
    const { service, calls, settlers } = makeDeferredService()
    const sessionsRef = {
      current: [liveSession('A', 'pty-a'), liveSession('B', 'pty-b')],
    }
    const { result } = renderHook(() =>
      useActiveSessionController({
        service,
        sessionsRef,
        onActivationCommitted: (id) => committed.push(id),
      })
    )

    act(() => result.current.setActiveSessionId('A'))
    act(() => result.current.setActiveSessionId('B'))
    act(() => result.current.setActiveSessionIdRaw(null))

    await act(async () => {
      settlers[0].resolve()
      await Promise.resolve()
    })

    expect(committed).toEqual([])
    expect(result.current.activeSessionId).toBeNull()
    expect(calls).toEqual(['pty-a'])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/features/sessions/hooks/useActiveSessionController.test.ts`. Expected: FAIL (options rejected / calls not serialized).

- [ ] **Step 3: Implement.** Replace the request-id scheme in `useActiveSessionController.ts` with the queue. Full new hook body (preserve the existing session/live-shell resolution comments):

```typescript
export const useActiveSessionController = ({
  service,
  sessionsRef,
  onActivationCommitted = undefined,
  onActivationRolledBack = undefined,
}: UseActiveSessionControllerOptions): ActiveSessionController => {
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    null
  )
  const activeSessionIdRef = useRef(activeSessionId)

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  const generationRef = useRef(0)
  const inFlightRef = useRef<{ id: string; generation: number } | null>(null)
  const pendingIdRef = useRef<string | null>(null)
  const lastCommittedIdRef = useRef<string | null>(null)
  const committedCallbackRef = useRef(onActivationCommitted)
  const rolledBackCallbackRef = useRef(onActivationRolledBack)
  committedCallbackRef.current = onActivationCommitted
  rolledBackCallbackRef.current = onActivationRolledBack

  const dispatchRef = useRef<(id: string) => void>(() => undefined)

  const settleSuccess = useCallback((id: string, generation: number): void => {
    inFlightRef.current = null
    if (generation === generationRef.current) {
      lastCommittedIdRef.current = id
      committedCallbackRef.current?.(id)
    }
    const next = pendingIdRef.current
    pendingIdRef.current = null
    if (next !== null) {
      dispatchRef.current(next)
    }
  }, [])

  const settleFailure = useCallback((generation: number): void => {
    inFlightRef.current = null
    const next = pendingIdRef.current
    pendingIdRef.current = null

    if (generation === generationRef.current && next === null) {
      const restored = lastCommittedIdRef.current
      activeSessionIdRef.current = restored
      setActiveSessionIdState(restored)
      rolledBackCallbackRef.current?.(restored)
      if (restored !== null) {
        committedCallbackRef.current?.(restored)
      }

      return
    }

    if (next !== null) {
      dispatchRef.current(next)
    }
  }, [])

  const dispatch = useCallback(
    (id: string): void => {
      const session = sessionsRef.current.find((s) => s.id === id)
      const generation = generationRef.current
      if (!session) {
        inFlightRef.current = { id, generation }
        settleFailure(generation)

        return
      }

      const activePane = session.panes.find((pane) => pane.active)

      const isLiveShell = (pane: Pane): boolean =>
        isShellPane(pane) && isLiveStatus(pane.status)

      const liveShell =
        activePane && isLiveShell(activePane)
          ? activePane
          : session.panes.find(isLiveShell)

      inFlightRef.current = { id, generation }

      if (liveShell) {
        service
          .setActiveSession(liveShell.ptyId)
          // eslint-disable-next-line promise/prefer-await-to-then
          .then(() => settleSuccess(id, generation))
          // eslint-disable-next-line promise/prefer-await-to-then
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.warn('setActiveSession IPC failed', err)
            settleFailure(generation)
          })

        return
      }

      if (activePane && !isShellPane(activePane)) {
        void focusBrowserPane({ sessionId: session.id, paneId: activePane.id })
      }

      settleSuccess(id, generation)
    },
    [service, sessionsRef, settleFailure, settleSuccess]
  )
  dispatchRef.current = dispatch

  const setActiveSessionId = useCallback(
    (id: string): void => {
      const session = sessionsRef.current.find((s) => s.id === id)
      if (!session) {
        return
      }

      activeSessionIdRef.current = id
      setActiveSessionIdState(id)

      if (inFlightRef.current !== null) {
        pendingIdRef.current = id

        return
      }

      dispatch(id)
    },
    [dispatch, sessionsRef]
  )

  const setActiveSessionIdRaw = useCallback((id: string | null): void => {
    generationRef.current += 1
    pendingIdRef.current = null
    lastCommittedIdRef.current = id
    activeSessionIdRef.current = id
    setActiveSessionIdState(id)
  }, [])

  return {
    activeSessionId,
    setActiveSessionId,
    setActiveSessionIdRaw,
    activeSessionIdRef,
  }
}
```

Update `UseActiveSessionControllerOptions` per the Interfaces block. Note the session-vanished dispatch branch settles as a failure so a pending target still dispatches.

- [ ] **Step 4: Run the sessions suite** — `npx vitest run src/features/sessions`. Expected: PASS, including the pre-existing controller tests (their observable contract — optimistic set, revert on failure — is preserved for the single-request case). If a pre-existing test asserted the old `prev`-capture rollback under overlap, update it to the serialized contract and say so in the commit body.

- [ ] **Step 5: Commit** — `feat(sessions): serialize activation settlement with committed baseline`

---

### Task 3: MRU list + manager integration

**Files:**

- Create: `src/features/sessions/hooks/useSessionMru.ts`
- Test: `src/features/sessions/hooks/useSessionMru.test.ts`
- Modify: `src/features/sessions/hooks/useSessionManager.ts` (`SessionManager` interface ~line 92; controller call ~line 451; return object ~line 3146; options interface)

**Interfaces:**

- Produces:

```typescript
export interface UseSessionMruParams {
  sessions: Session[]
  activeSessionId: string | null
}

export interface SessionMru {
  mruSessionIds: readonly string[]
  recordActivationCommitted: (id: string) => void
}

export const useSessionMru = (params: UseSessionMruParams): SessionMru
```

- `SessionManager` gains `mruSessionIds: readonly string[]`. `useSessionManager`'s options object gains `onActivationRolledBack?: (id: string | null) => void`, threaded into the controller.
- Consumes: Task 2's `onActivationCommitted` controller option; `getVisibleSessions` from `../utils/pickNextVisibleSessionId`.

- [ ] **Step 1: Write failing tests** (`useSessionMru.test.ts`, new file):

```typescript
import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { Session } from '../types'
import { useSessionMru } from './useSessionMru'

const openSession = (id: string): Session =>
  ({
    id,
    panes: [{ id: `${id}-p`, kind: 'shell', status: 'running', active: true }],
  }) as unknown as Session

describe('useSessionMru', () => {
  test('seeds visible order with the active session first', () => {
    const { result } = renderHook(() =>
      useSessionMru({
        sessions: [openSession('A'), openSession('B'), openSession('C')],
        activeSessionId: 'B',
      })
    )

    expect(result.current.mruSessionIds).toEqual(['B', 'A', 'C'])
  })

  test('committed activation moves the id to the front', () => {
    const { result } = renderHook(() =>
      useSessionMru({
        sessions: [openSession('A'), openSession('B'), openSession('C')],
        activeSessionId: 'A',
      })
    )

    act(() => result.current.recordActivationCommitted('C'))
    expect(result.current.mruSessionIds).toEqual(['C', 'A', 'B'])
  })

  test('prunes removed sessions and appends never-seen ones at the back', () => {
    const { result, rerender } = renderHook(
      ({ sessions }: { sessions: Session[] }) =>
        useSessionMru({ sessions, activeSessionId: 'A' }),
      { initialProps: { sessions: [openSession('A'), openSession('B')] } }
    )

    rerender({ sessions: [openSession('A'), openSession('D')] })
    expect(result.current.mruSessionIds).toEqual(['A', 'D'])
  })

  test('committed notification for an unknown id is ignored', () => {
    const { result } = renderHook(() =>
      useSessionMru({
        sessions: [openSession('A')],
        activeSessionId: 'A',
      })
    )

    act(() => result.current.recordActivationCommitted('ghost'))
    expect(result.current.mruSessionIds).toEqual(['A'])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/features/sessions/hooks/useSessionMru.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `useSessionMru.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '../types'
import { getVisibleSessions } from '../utils/pickNextVisibleSessionId'

export interface UseSessionMruParams {
  sessions: Session[]
  activeSessionId: string | null
}

export interface SessionMru {
  mruSessionIds: readonly string[]
  recordActivationCommitted: (id: string) => void
}

// MRU folds over committed state only; activation reorders arrive via the
// controller's committed notification, never by observing optimistic writes.
export const useSessionMru = ({
  sessions,
  activeSessionId,
}: UseSessionMruParams): SessionMru => {
  const [mruSessionIds, setMruSessionIds] = useState<readonly string[]>([])
  const seededRef = useRef(false)
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  useEffect(() => {
    if (!seededRef.current) {
      if (sessions.length === 0) {
        return
      }
      seededRef.current = true
      const visible = getVisibleSessions(sessions, activeSessionId)
      const rest = visible
        .map((s) => s.id)
        .filter((id) => id !== activeSessionId)
      setMruSessionIds(
        activeSessionId !== null ? [activeSessionId, ...rest] : rest
      )

      return
    }

    setMruSessionIds((prev) => {
      const known = new Set(prev)
      const live = new Set(sessions.map((s) => s.id))
      const kept = prev.filter((id) => live.has(id))
      const appended = sessions.map((s) => s.id).filter((id) => !known.has(id))

      return [...kept, ...appended]
    })
  }, [sessions, activeSessionId])

  const recordActivationCommitted = useCallback((id: string): void => {
    if (!sessionsRef.current.some((s) => s.id === id)) {
      return
    }

    setMruSessionIds((prev) => [id, ...prev.filter((other) => other !== id)])
  }, [])

  return { mruSessionIds, recordActivationCommitted }
}
```

- [ ] **Step 4: Wire into the manager.** In `useSessionManager.ts`: add `mruSessionIds: readonly string[]` to the `SessionManager` interface; add `onActivationRolledBack?: (id: string | null) => void` to the manager's options interface (the same object that carries `onTerminalSpawnError`). Above the `useActiveSessionController` call insert:

```typescript
const { mruSessionIds, recordActivationCommitted } = useSessionMru({
  sessions,
  activeSessionId: activeSessionIdForMru,
})
```

Note: if `sessions` state is declared after the controller call, follow the existing declaration order — the MRU hook only needs the values by render time; place the `useSessionMru` call after both `sessions` and `activeSessionId` exist and before the return. Pass the callbacks into the controller:

```typescript
  } = useActiveSessionController({
    service,
    sessionsRef,
    onActivationCommitted: recordActivationCommitted,
    onActivationRolledBack,
  })
```

If `activeSessionId` is only available FROM the controller return (circular), split: call `useSessionMru` after the controller with `activeSessionId` from it, and hand the controller a stable forwarder declared before it:

```typescript
const recordActivationCommittedRef = useRef<(id: string) => void>(() => {})
// in useActiveSessionController options:
//   onActivationCommitted: (id) => recordActivationCommittedRef.current(id)
// after useSessionMru:
recordActivationCommittedRef.current = recordActivationCommitted
```

Use the forwarder variant — it matches the file's existing ref-mirror idiom. Export `mruSessionIds` in the return object at ~line 3146.

- [ ] **Step 5: Run** — `npx vitest run src/features/sessions`. Expected: PASS.

- [ ] **Step 6: Commit** — `feat(sessions): derive session mru from committed activations`

---

### Task 4: Shared close-with-successor helper

**Files:**

- Create: `src/features/sessions/utils/closeSessionWithSuccessor.ts`
- Test: `src/features/sessions/utils/closeSessionWithSuccessor.test.ts`
- Modify: `src/features/sessions/components/List.tsx` (`handleRemoveSession`, lines ~49–100)

**Interfaces:**

- Produces (consumed by Task 7):

```typescript
export interface CloseSessionDeps {
  sessions: Session[]
  activeSessionId: string | null
  removeSession: (id: string) => SessionCloseResult
  activateSession: (id: string) => void
  focusSuccessor?: (id: string) => void
}

export const closeSessionWithSuccessor = (
  sessionId: string,
  deps: CloseSessionDeps
): void
```

- Consumes: `pickNextVisibleSessionId` (successor domain = switchable set, spec §1/§6).

- [ ] **Step 1: Write failing tests:**

```typescript
import { describe, expect, test, vi } from 'vitest'
import type { Session } from '../types'
import { closeSessionWithSuccessor } from './closeSessionWithSuccessor'

const openSession = (id: string): Session =>
  ({
    id,
    panes: [{ id: `${id}-p`, kind: 'shell', status: 'running', active: true }],
  }) as unknown as Session

describe('closeSessionWithSuccessor', () => {
  test('activates the visible successor after removing the active session', () => {
    const activateSession = vi.fn()
    const removeSession = vi.fn().mockReturnValue(undefined)
    closeSessionWithSuccessor('A', {
      sessions: [openSession('A'), openSession('B')],
      activeSessionId: 'A',
      removeSession,
      activateSession,
    })

    expect(removeSession).toHaveBeenCalledWith('A')
    expect(activateSession).toHaveBeenCalledWith('B')
  })

  test('guard cancellation (false) stops successor activation', () => {
    const activateSession = vi.fn()
    closeSessionWithSuccessor('A', {
      sessions: [openSession('A'), openSession('B')],
      activeSessionId: 'A',
      removeSession: vi.fn().mockReturnValue(false),
      activateSession,
    })

    expect(activateSession).not.toHaveBeenCalled()
  })

  test('closing a non-active session never reactivates', () => {
    const activateSession = vi.fn()
    closeSessionWithSuccessor('B', {
      sessions: [openSession('A'), openSession('B')],
      activeSessionId: 'A',
      removeSession: vi.fn().mockReturnValue(undefined),
      activateSession,
    })

    expect(activateSession).not.toHaveBeenCalled()
  })

  test('last session: removal proceeds with no successor', () => {
    const activateSession = vi.fn()
    const removeSession = vi.fn().mockReturnValue(undefined)
    closeSessionWithSuccessor('A', {
      sessions: [openSession('A')],
      activeSessionId: 'A',
      removeSession,
      activateSession,
    })

    expect(removeSession).toHaveBeenCalledWith('A')
    expect(activateSession).not.toHaveBeenCalled()
  })

  test('focusSuccessor receives the successor id', () => {
    const focusSuccessor = vi.fn()
    closeSessionWithSuccessor('A', {
      sessions: [openSession('A'), openSession('B')],
      activeSessionId: 'A',
      removeSession: vi.fn().mockReturnValue(undefined),
      activateSession: vi.fn(),
      focusSuccessor,
    })

    expect(focusSuccessor).toHaveBeenCalledWith('B')
  })
})
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement:**

```typescript
import type { Session, SessionCloseResult } from '../types'
import { pickNextVisibleSessionId } from './pickNextVisibleSessionId'

export interface CloseSessionDeps {
  sessions: Session[]
  activeSessionId: string | null
  removeSession: (id: string) => SessionCloseResult
  activateSession: (id: string) => void
  focusSuccessor?: (id: string) => void
}

// Successor is computed BEFORE removal; the guard's `false` sentinel cancels
// both activation and focus so a declined close changes nothing.
export const closeSessionWithSuccessor = (
  sessionId: string,
  {
    sessions,
    activeSessionId,
    removeSession,
    activateSession,
    focusSuccessor,
  }: CloseSessionDeps
): void => {
  const nextId =
    sessionId === activeSessionId
      ? pickNextVisibleSessionId(sessions, sessionId, activeSessionId)
      : undefined

  const didRemove = removeSession(sessionId)
  if (didRemove === false) {
    return
  }

  if (nextId !== undefined) {
    activateSession(nextId)
    focusSuccessor?.(nextId)
  }
}
```

- [ ] **Step 4: Rewrite `List.tsx`'s `handleRemoveSession`** to delegate (keep the explanatory comment block, condensed):

```typescript
const handleRemoveSession = useCallback(
  (id: string): void => {
    if (!onRemoveSession) {
      return
    }

    closeSessionWithSuccessor(id, {
      sessions,
      activeSessionId,
      removeSession: onRemoveSession,
      activateSession: onSessionClick,
      focusSuccessor: (nextId) => {
        queueMicrotask(() => {
          document.getElementById(`sidebar-activate-${nextId}`)?.focus()
        })
      },
    })
  },
  [activeSessionId, onRemoveSession, onSessionClick, sessions]
)
```

- [ ] **Step 5: Run** — `npx vitest run src/features/sessions/utils src/features/sessions/components/List.test.tsx`. Expected: PASS (List behavior unchanged).

- [ ] **Step 6: Commit** — `refactor(sessions): hoist guarded close-with-successor into shared helper`

---

### Task 5: SessionSwitcher overlay component + native payload type

**Files:**

- Create: `src/features/sessions/components/SessionSwitcher.tsx`
- Test: `src/features/sessions/components/SessionSwitcher.test.tsx`
- Modify: `src/components/base/floating/nativeOverlay.ts` (payload union, ~line 180)

**Interfaces:**

- Produces:

```typescript
export interface SessionSwitcherEntry {
  id: string
  title: string
  agentGlyph: string | null
  isActive: boolean
}

export interface SessionSwitcherProps {
  open: boolean
  entries: SessionSwitcherEntry[]
  selectedIndex: number
  onCommitIndex: (index: number) => void
  onCancel: () => void
}
```

In `nativeOverlay.ts` (consumed by Task 8's host/validator):

```typescript
export interface NativeOverlaySessionSwitcherItem {
  id: string
  title: string
  agentGlyph?: string
  isActive: boolean
}

export interface NativeOverlaySessionSwitcherActions {
  commitIndex: string
  cancel: string
}

export interface NativeOverlaySessionSwitcherDialogPayload {
  kind: 'dialog'
  dialog: 'session-switcher'
  ariaLabel: string
  selectedIndex: number
  items: NativeOverlaySessionSwitcherItem[]
  actions: NativeOverlaySessionSwitcherActions
}
```

and `NativeOverlayDialogPayload` gains `| NativeOverlaySessionSwitcherDialogPayload`.

- Consumes: `Dialog` from `@/components` with `nativeOverlay`, `nativeOverlayPayload`, `nativeOverlayActions` props (the `CommandPalette.tsx` pattern, lines 84–182).

- [ ] **Step 1: Write failing tests:**

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { SessionSwitcher } from './SessionSwitcher'

const entries = [
  { id: 'a', title: 'api server', agentGlyph: null, isActive: true },
  { id: 'b', title: 'docs', agentGlyph: null, isActive: false },
]

describe('SessionSwitcher', () => {
  test('renders MRU entries as options with the selection marked', () => {
    render(
      <SessionSwitcher
        open
        entries={entries}
        selectedIndex={1}
        onCommitIndex={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('listbox')).toHaveAccessibleName(
      'Session switcher'
    )
  })

  test('clicking an entry commits its index', async () => {
    const onCommitIndex = vi.fn()
    render(
      <SessionSwitcher
        open
        entries={entries}
        selectedIndex={1}
        onCommitIndex={onCommitIndex}
        onCancel={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole('option', { name: /docs/ }))
    expect(onCommitIndex).toHaveBeenCalledWith(1)
  })

  test('renders nothing when closed', () => {
    render(
      <SessionSwitcher
        open={false}
        entries={entries}
        selectedIndex={0}
        onCommitIndex={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement.** Add the three payload interfaces + union member to `nativeOverlay.ts` (exact code above). Then the component:

```typescript
import { useCallback, useMemo, type ReactElement } from 'react'
import { Dialog } from '@/components'
import type {
  NativeOverlayActionHandler,
  NativeOverlaySessionSwitcherDialogPayload,
} from '@/components/types'

const NATIVE_ACTION_COMMIT_INDEX = 'session-switcher:commit-index'
const NATIVE_ACTION_CANCEL = 'session-switcher:cancel'

export interface SessionSwitcherEntry {
  id: string
  title: string
  agentGlyph: string | null
  isActive: boolean
}

export interface SessionSwitcherProps {
  open: boolean
  entries: SessionSwitcherEntry[]
  selectedIndex: number
  onCommitIndex: (index: number) => void
  onCancel: () => void
}

export const SessionSwitcher = ({
  open,
  entries,
  selectedIndex,
  onCommitIndex,
  onCancel,
}: SessionSwitcherProps): ReactElement | null => {
  const nativeOverlayPayload =
    useMemo((): NativeOverlaySessionSwitcherDialogPayload => {
      const items = entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        ...(entry.agentGlyph === null ? {} : { agentGlyph: entry.agentGlyph }),
        isActive: entry.isActive,
      }))

      return {
        kind: 'dialog',
        dialog: 'session-switcher',
        ariaLabel: 'Session switcher',
        selectedIndex,
        items,
        actions: {
          commitIndex: NATIVE_ACTION_COMMIT_INDEX,
          cancel: NATIVE_ACTION_CANCEL,
        },
      }
    }, [entries, selectedIndex])

  const nativeOverlayActions = useMemo(
    (): ReadonlyMap<string, NativeOverlayActionHandler> =>
      new Map([
        [
          NATIVE_ACTION_COMMIT_INDEX,
          {
            run: (event): void => {
              if (event?.index !== undefined) {
                onCommitIndex(event.index)
              }
            },
          },
        ],
        [NATIVE_ACTION_CANCEL, { run: (): void => onCancel() }],
      ]),
    [onCancel, onCommitIndex]
  )

  const handleOpenChange = useCallback(
    (isOpen: boolean): void => {
      if (!isOpen) {
        onCancel()
      }
    },
    [onCancel]
  )

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      placement="top"
      size="sm"
      aria-label="Session switcher"
      nativeOverlay
      nativeOverlayPayload={nativeOverlayPayload}
      nativeOverlayActions={nativeOverlayActions}
    >
      <ul role="listbox" aria-label="Session switcher">
        {entries.map((entry, index) => (
          <li key={entry.id}>
            <button
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={
                index === selectedIndex
                  ? 'flex w-full items-center gap-2 rounded-md bg-surface-container-high px-3 py-2 text-left font-body text-sm text-on-surface'
                  : 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left font-body text-sm text-on-surface-muted'
              }
              onClick={() => onCommitIndex(index)}
            >
              <span className="flex-1 truncate">{entry.title}</span>
              {entry.isActive ? (
                <span className="text-xs text-primary">active</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
```

Adjust the two import paths to the project's real export sites (check where `CommandPalette.tsx` imports `Dialog` and `NativeOverlayActionHandler` from and mirror them exactly). If `Dialog` requires a `nativeOverlayPayload` typed as `NativeOverlayDialogPayload`, the Task 5 union change makes this compile.

- [ ] **Step 4: Run** — `npx vitest run src/features/sessions/components/SessionSwitcher.test.tsx`. Expected: PASS. Also `npm run type-check` (the union change touches Dialog/host typing).

- [ ] **Step 5: Commit** — `feat(sessions): add mru session switcher overlay component`

---

### Task 6: Switcher owning hook (open / advance / commit / cancel)

**Files:**

- Create: `src/features/workspace/hooks/useSessionSwitcher.ts`
- Test: `src/features/workspace/hooks/useSessionSwitcher.test.ts`

**Interfaces:**

- Produces (consumed by Task 7):

```typescript
export interface UseSessionSwitcherParams {
  orderedIds: readonly string[]
  matches: (event: KeyboardEvent, id: CommandId) => boolean
  bindingFor: (id: CommandId) => Chord
  onCommit: (sessionId: string) => void
  onCancel: () => void
}

export interface SessionSwitcherController {
  open: boolean
  selectedIndex: number
  commitIndex: (index: number) => void
  cancel: () => void
}
```

- Consumes: `isKeymapCaptureTarget` (`../../keymap/capture`), `DIALOG_SELECTOR`, `TERMINAL_CONTAINER_ID` (`../containerIds`), `Chord` mods.
- Behavior contract (spec §5): statically mounted capture `keydown` + `keyup` listeners gated by refs; open on first chord (next → index 1 when ≥2 entries else 0; prev → last index); advance with wraparound incl. `event.repeat`; commit when the opening chord's **super** modifiers are all released (keyup of Ctrl/Meta) or when any keydown arrives without them (lost-keyup fallback); `Escape`/window-blur cancel; index clamps when `orderedIds` shrinks; zero ids → no-op.

- [ ] **Step 1: Write failing tests:**

```typescript
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { CommandId } from '../../keymap/catalog'
import { useSessionSwitcher } from './useSessionSwitcher'

const ctrlTab = (repeat = false): KeyboardEvent =>
  new KeyboardEvent('keydown', {
    code: 'Tab',
    key: 'Tab',
    ctrlKey: true,
    repeat,
    bubbles: true,
  })

const ctrlShiftTab = (): KeyboardEvent =>
  new KeyboardEvent('keydown', {
    code: 'Tab',
    key: 'Tab',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
  })

const ctrlKeyUp = (): KeyboardEvent =>
  new KeyboardEvent('keyup', {
    code: 'ControlLeft',
    key: 'Control',
    bubbles: true,
  })

const matches = (event: KeyboardEvent, id: CommandId): boolean => {
  if (event.type !== 'keydown' || event.code !== 'Tab' || !event.ctrlKey) {
    return false
  }
  if (id === 'session-switch-next') {
    return !event.shiftKey
  }

  return id === 'session-switch-prev' && event.shiftKey
}

const bindingFor = (id: CommandId) =>
  id === 'session-switch-prev'
    ? { code: 'Tab', mods: new Set(['Ctrl', 'Shift'] as const) }
    : { code: 'Tab', mods: new Set(['Ctrl'] as const) }

const setup = (
  orderedIds: readonly string[],
  onCommit = vi.fn(),
  onCancel = vi.fn()
) => {
  const rendered = renderHook(
    ({ ids }: { ids: readonly string[] }) =>
      useSessionSwitcher({
        orderedIds: ids,
        matches,
        bindingFor: bindingFor as never,
        onCommit,
        onCancel,
      }),
    { initialProps: { ids: orderedIds } }
  )

  return { ...rendered, onCommit, onCancel }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useSessionSwitcher', () => {
  test('quick tap commits the previous session (MRU index 1)', () => {
    const { result, onCommit } = setup(['A', 'B', 'C'])

    act(() => void document.dispatchEvent(ctrlTab()))
    expect(result.current.open).toBe(true)
    expect(result.current.selectedIndex).toBe(1)

    act(() => void document.dispatchEvent(ctrlKeyUp()))
    expect(onCommit).toHaveBeenCalledWith('B')
    expect(result.current.open).toBe(false)
  })

  test('held Ctrl with repeated Tab advances with wraparound', () => {
    const { result } = setup(['A', 'B', 'C'])

    act(() => void document.dispatchEvent(ctrlTab()))
    act(() => void document.dispatchEvent(ctrlTab(true)))
    expect(result.current.selectedIndex).toBe(2)
    act(() => void document.dispatchEvent(ctrlTab(true)))
    expect(result.current.selectedIndex).toBe(0)
  })

  test('ctrl+shift+tab opens selecting the last entry and steps backward', () => {
    const { result } = setup(['A', 'B', 'C'])

    act(() => void document.dispatchEvent(ctrlShiftTab()))
    expect(result.current.selectedIndex).toBe(2)
    act(() => void document.dispatchEvent(ctrlShiftTab()))
    expect(result.current.selectedIndex).toBe(1)
  })

  test('escape cancels without committing', () => {
    const { result, onCommit, onCancel } = setup(['A', 'B'])

    act(() => void document.dispatchEvent(ctrlTab()))
    act(
      () =>
        void document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            bubbles: true,
          })
        )
    )
    expect(onCancel).toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
    expect(result.current.open).toBe(false)
  })

  test('lost keyup: a modifier-free keydown commits like a release', () => {
    const { onCommit } = setup(['A', 'B'])

    act(() => void document.dispatchEvent(ctrlTab()))
    act(
      () =>
        void document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'a',
            code: 'KeyA',
            bubbles: true,
          })
        )
    )
    expect(onCommit).toHaveBeenCalledWith('B')
  })

  test('enter commits the current selection', () => {
    const { onCommit } = setup(['A', 'B', 'C'])

    act(() => void document.dispatchEvent(ctrlTab()))
    act(() => void document.dispatchEvent(ctrlTab(true)))
    act(
      () =>
        void document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            ctrlKey: true,
            bubbles: true,
          })
        )
    )
    expect(onCommit).toHaveBeenCalledWith('C')
  })

  test('window blur cancels', () => {
    const { result, onCancel } = setup(['A', 'B'])

    act(() => void document.dispatchEvent(ctrlTab()))
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(onCancel).toHaveBeenCalled()
    expect(result.current.open).toBe(false)
  })

  test('selection clamps when the list shrinks while open', () => {
    const { result, rerender } = setup(['A', 'B', 'C'])

    act(() => void document.dispatchEvent(ctrlTab()))
    act(() => void document.dispatchEvent(ctrlTab(true)))
    expect(result.current.selectedIndex).toBe(2)

    rerender({ ids: ['A', 'B'] })
    expect(result.current.selectedIndex).toBe(1)
  })

  test('zero sessions: the chord does not open', () => {
    const { result } = setup([])

    act(() => void document.dispatchEvent(ctrlTab()))
    expect(result.current.open).toBe(false)
  })

  test('single session opens inert at index 0', () => {
    const { result } = setup(['A'])

    act(() => void document.dispatchEvent(ctrlTab()))
    expect(result.current.open).toBe(true)
    expect(result.current.selectedIndex).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement** `useSessionSwitcher.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import type { CommandId } from '../../keymap/catalog'
import type { Chord } from '../../keymap/chord'
import { DIALOG_SELECTOR, TERMINAL_CONTAINER_ID } from '../containerIds'

export interface UseSessionSwitcherParams {
  orderedIds: readonly string[]
  matches: (event: KeyboardEvent, id: CommandId) => boolean
  bindingFor: (id: CommandId) => Chord
  onCommit: (sessionId: string) => void
  onCancel: () => void
}

export interface SessionSwitcherController {
  open: boolean
  selectedIndex: number
  commitIndex: (index: number) => void
  cancel: () => void
}

type HoldChecker = (event: KeyboardEvent) => boolean

// Maps the opening chord's super modifiers to live event state so commit
// fires exactly when the user lets go of the hold, on any binding.
const holdCheckerFor = (chord: Chord): HoldChecker => {
  const wantsCtrl = chord.mods.has('Ctrl')
  const wantsMod = chord.mods.has('Mod')

  return (event: KeyboardEvent): boolean =>
    (wantsCtrl && event.ctrlKey) ||
    (wantsMod && (event.metaKey || event.ctrlKey))
}

export const useSessionSwitcher = ({
  orderedIds,
  matches,
  bindingFor,
  onCommit,
  onCancel,
}: UseSessionSwitcherParams): SessionSwitcherController => {
  const [open, setOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const openRef = useRef(open)
  openRef.current = open
  const selectedIndexRef = useRef(selectedIndex)
  selectedIndexRef.current = selectedIndex
  const orderedIdsRef = useRef(orderedIds)
  orderedIdsRef.current = orderedIds
  const matchesRef = useRef(matches)
  matchesRef.current = matches
  const bindingForRef = useRef(bindingFor)
  bindingForRef.current = bindingFor
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  const holdCheckerRef = useRef<HoldChecker | null>(null)

  useEffect(() => {
    if (open && selectedIndex >= orderedIds.length) {
      setSelectedIndex(Math.max(0, orderedIds.length - 1))
    }
  }, [open, orderedIds, selectedIndex])

  const close = useCallback((): void => {
    holdCheckerRef.current = null
    setOpen(false)
    setSelectedIndex(0)
  }, [])

  const commitSelected = useCallback((): void => {
    const id = orderedIdsRef.current[selectedIndexRef.current]
    close()
    if (id !== undefined) {
      onCommitRef.current(id)
    }
  }, [close])

  const commitIndex = useCallback(
    (index: number): void => {
      const id = orderedIdsRef.current[index]
      close()
      if (id !== undefined) {
        onCommitRef.current(id)
      }
    },
    [close]
  )

  const cancel = useCallback((): void => {
    close()
    onCancelRef.current()
  }, [close])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isOpen = openRef.current
      const commandId = matchesRef.current(event, 'session-switch-next')
        ? 'session-switch-next'
        : matchesRef.current(event, 'session-switch-prev')
          ? 'session-switch-prev'
          : null

      if (!isOpen) {
        if (commandId === null) {
          return
        }
        if (isKeymapCaptureTarget(event.target)) {
          return
        }
        if (document.querySelector(DIALOG_SELECTOR)) {
          return
        }
        const target =
          event.target instanceof Element ? event.target : document.body
        const inTerminalZone = !!target.closest(
          `[data-container-id="${TERMINAL_CONTAINER_ID}"]`
        )
        const isTextEntry =
          !!target.closest('input, textarea') ||
          !!target.closest('[contenteditable]') ||
          !!target.closest('[role="textbox"]')
        if (isTextEntry && !inTerminalZone) {
          return
        }

        const ids = orderedIdsRef.current
        if (ids.length === 0) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        holdCheckerRef.current = holdCheckerFor(
          bindingForRef.current(commandId)
        )
        setSelectedIndex(
          commandId === 'session-switch-next'
            ? Math.min(1, ids.length - 1)
            : ids.length - 1
        )
        setOpen(true)

        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancel()

        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        commitSelected()

        return
      }

      if (commandId !== null) {
        event.preventDefault()
        event.stopPropagation()
        const length = orderedIdsRef.current.length
        if (length === 0) {
          cancel()

          return
        }
        const delta = commandId === 'session-switch-next' ? 1 : -1
        setSelectedIndex((previous) => (previous + delta + length) % length)

        return
      }

      if (holdCheckerRef.current && !holdCheckerRef.current(event)) {
        event.preventDefault()
        event.stopPropagation()
        commitSelected()
      }
    }

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (!openRef.current || !holdCheckerRef.current) {
        return
      }
      if (!holdCheckerRef.current(event)) {
        commitSelected()
      }
    }

    const handleBlur = (): void => {
      if (openRef.current) {
        cancel()
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })
    document.addEventListener('keyup', handleKeyUp, { capture: true })
    window.addEventListener('blur', handleBlur)

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
      document.removeEventListener('keyup', handleKeyUp, { capture: true })
      window.removeEventListener('blur', handleBlur)
    }
  }, [cancel, commitSelected])

  return { open, selectedIndex, commitIndex, cancel }
}
```

Note: `keyup` events report the released modifier as already up (`ctrlKey: false` on Ctrl release), so `holdChecker` returning false on keyup means the hold ended.

- [ ] **Step 4: Run** — `npx vitest run src/features/workspace/hooks/useSessionSwitcher.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `feat(workspace): add mru session switcher hook with hold-release commit`

---

### Task 7: Workspace wiring — mount, focus restore, close shortcut, overlay registration

**Files:**

- Create: `src/features/workspace/hooks/useSessionCloseShortcut.ts`
- Test: `src/features/workspace/hooks/useSessionCloseShortcut.test.ts`
- Modify: `src/features/workspace/WorkspaceView.tsx` (manager destructure ~398, hook wiring ~2234, render tree near `<SessionsView>` ~3217)
- Modify: `src/features/workspace/overlays/WorkspaceOverlayRegistrations.tsx`

**Interfaces:**

- Consumes: Task 3 `mruSessionIds` + manager `onActivationRolledBack` option; Task 4 `closeSessionWithSuccessor`; Task 5 `SessionSwitcher`; Task 6 `useSessionSwitcher`; existing `handleSetActiveSessionId`, `handleRemoveSession`, `claimTerminal`, `getVisibleSessions`.
- Produces: `useSessionCloseShortcut({ onCloseActiveSession, matches })` — guard matrix identical to `useSessionNavShortcut`.

- [ ] **Step 1: Write the close-shortcut hook test** (mirror `useSessionNavShortcut.test.ts` structure — copy its DOM guard scaffolding):

```typescript
import { describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { CommandId } from '../../keymap/catalog'
import { useSessionCloseShortcut } from './useSessionCloseShortcut'

const matches = (event: KeyboardEvent, id: CommandId): boolean =>
  id === 'session-close' &&
  event.type === 'keydown' &&
  event.code === 'KeyW' &&
  event.metaKey

describe('useSessionCloseShortcut', () => {
  test('fires on the resolved chord', () => {
    const onCloseActiveSession = vi.fn()
    renderHook(() => useSessionCloseShortcut({ onCloseActiveSession, matches }))

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'KeyW',
        key: 'w',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
    )
    expect(onCloseActiveSession).toHaveBeenCalledTimes(1)
  })

  test('defers while a dialog is open', () => {
    const onCloseActiveSession = vi.fn()
    renderHook(() => useSessionCloseShortcut({ onCloseActiveSession, matches }))

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'KeyW',
        key: 'w',
        metaKey: true,
        bubbles: true,
      })
    )
    dialog.remove()
    expect(onCloseActiveSession).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**, then implement the hook as a structural copy of `useSessionNavShortcut.ts` with a single command:

```typescript
import { useEffect, useRef } from 'react'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import type { CommandId } from '../../keymap/catalog'
import { DIALOG_SELECTOR, TERMINAL_CONTAINER_ID } from '../containerIds'

export interface UseSessionCloseShortcutParams {
  onCloseActiveSession: () => void
  matches: (event: KeyboardEvent, id: CommandId) => boolean
}

export const useSessionCloseShortcut = ({
  onCloseActiveSession,
  matches,
}: UseSessionCloseShortcutParams): void => {
  const onCloseRef = useRef(onCloseActiveSession)
  const matchesRef = useRef(matches)
  onCloseRef.current = onCloseActiveSession
  matchesRef.current = matches

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }
      if (event.repeat) {
        return
      }
      if (!matchesRef.current(event, 'session-close')) {
        return
      }
      if (document.querySelector(DIALOG_SELECTOR)) {
        return
      }

      const target =
        event.target instanceof Element
          ? event.target
          : document.activeElement instanceof Element
            ? document.activeElement
            : document.body

      const inTerminalZone = !!target.closest(
        `[data-container-id="${TERMINAL_CONTAINER_ID}"]`
      )
      const isTextEntry =
        !!target.closest('input, textarea') ||
        !!target.closest('[contenteditable]') ||
        !!target.closest('[role="textbox"]')
      if (isTextEntry && !inTerminalZone) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [])
}
```

- [ ] **Step 3: Wire WorkspaceView.** All additions:

1. Destructure `mruSessionIds` from `useSessionManager(...)` and pass the rollback option. Declare before the manager call:

```typescript
const activationRollbackFocusRef = useRef<() => void>(() => {})
```

and in the manager options: `onActivationRolledBack: () => activationRollbackFocusRef.current()`. After `claimTerminal` is defined: `activationRollbackFocusRef.current = claimTerminal`.

2. Near the `useSessionNavShortcut` wiring (~2234) add:

```typescript
const switchableSessions = useMemo(
  () => getVisibleSessions(sessions, activeSessionId),
  [activeSessionId, sessions]
)

const switcherOrderedIds = useMemo(() => {
  const switchable = new Set(switchableSessions.map((s) => s.id))
  const inMru = mruSessionIds.filter((id) => switchable.has(id))
  const missing = switchableSessions
    .map((s) => s.id)
    .filter((id) => !inMru.includes(id))

  return [...inMru, ...missing]
}, [mruSessionIds, switchableSessions])

const switcherEntries = useMemo(
  () =>
    switcherOrderedIds.flatMap((id) => {
      const session = sessions.find((s) => s.id === id)

      return session
        ? [
            {
              id,
              title: session.name,
              agentGlyph: null,
              isActive: id === activeSessionId,
            },
          ]
        : []
    }),
  [activeSessionId, sessions, switcherOrderedIds]
)

const sessionSwitcher = useSessionSwitcher({
  orderedIds: switcherOrderedIds,
  matches,
  bindingFor,
  onCommit: handleSetActiveSessionId,
  onCancel: claimTerminal,
})

const handleCloseActiveSession = useCallback((): void => {
  if (activeSessionId === null) {
    return
  }

  closeSessionWithSuccessor(activeSessionId, {
    sessions,
    activeSessionId,
    removeSession: handleRemoveSession,
    activateSession: handleSetActiveSessionId,
  })
}, [activeSessionId, handleRemoveSession, handleSetActiveSessionId, sessions])

useSessionCloseShortcut({
  onCloseActiveSession: handleCloseActiveSession,
  matches,
})
```

If `Session`'s display field is not `name`, use the field `SessionCard`/`List` renders (check `Card.tsx`) — the plan's word `title` stays on the switcher side either way.

3. Render `<SessionSwitcher>` next to the other global dialogs (same subtree as the command palette render):

```tsx
<SessionSwitcher
  open={sessionSwitcher.open}
  entries={switcherEntries}
  selectedIndex={sessionSwitcher.selectedIndex}
  onCommitIndex={sessionSwitcher.commitIndex}
  onCancel={sessionSwitcher.cancel}
/>
```

4. `WorkspaceOverlayRegistrations.tsx`: add prop `sessionSwitcherOpen: boolean`, register:

```typescript
useOverlayRegistration({
  id: 'session-switcher',
  plane: 'palette',
  isOpen: sessionSwitcherOpen,
  nativeOcclusion: 'global',
})
```

and pass `sessionSwitcherOpen={sessionSwitcher.open}` at the `WorkspaceOverlayRegistrations` call site in WorkspaceView. Append a registration test to `WorkspaceOverlayRegistrations.test.tsx` following its existing per-overlay cases.

- [ ] **Step 4: Run** — `npx vitest run src/features/workspace`. Expected: PASS. Then `npm run type-check`.

- [ ] **Step 5: Manual smoke (Linux dev)** — `npm run dev` in a terminal, create 3 sessions, verify: quick `Ctrl+Tab` bounces between last two; hold-`Ctrl` + repeated Tab walks the MRU list with the overlay visible; `Escape` cancels; `Ctrl+Shift+W` closes with successor + terminal focus. Report observed behavior in the task summary.

- [ ] **Step 6: Commit** — `feat(workspace): wire session switcher and close shortcut`

---

### Task 8: Native-overlay payload — host render branch + Electron validator

**Files:**

- Modify: `src/components/NativeOverlayHost.tsx` (dialog gate ~line 104, render branch ~line 1250)
- Modify: `electron/native-overlay.ts` (validators ~line 591–640)
- Test: `src/components/NativeOverlayHost.test.tsx`, `electron/native-overlay.test.ts` (append)

**Interfaces:**

- Consumes: `NativeOverlaySessionSwitcherDialogPayload` from Task 5.
- Produces: `isDialogPayload` accepts the `'session-switcher'` discriminant; host renders the switcher list; unknown discriminants still rejected.

- [ ] **Step 1: Write failing validator tests** (append to `electron/native-overlay.test.ts`, following its existing payload-fixture style):

```typescript
const sessionSwitcherPayload = {
  kind: 'dialog',
  dialog: 'session-switcher',
  ariaLabel: 'Session switcher',
  selectedIndex: 1,
  items: [
    { id: 'a', title: 'api', isActive: true },
    { id: 'b', title: 'docs', agentGlyph: 'C', isActive: false },
  ],
  actions: {
    commitIndex: 'session-switcher:commit-index',
    cancel: 'session-switcher:cancel',
  },
}

test('accepts a session-switcher dialog payload', () => {
  // Use the file's existing entry point for payload validation in tests
  // (the same helper the command-palette payload test calls).
  expect(isValidTestPayload(sessionSwitcherPayload)).toBe(true)
})

test('rejects a session-switcher payload with unbounded items', () => {
  const items = Array.from({ length: 501 }, (_, i) => ({
    id: String(i),
    title: 'x',
    isActive: false,
  }))
  expect(isValidTestPayload({ ...sessionSwitcherPayload, items })).toBe(false)
})

test('still rejects unknown dialog discriminants', () => {
  expect(
    isValidTestPayload({ ...sessionSwitcherPayload, dialog: 'mystery' })
  ).toBe(false)
})
```

Replace `isValidTestPayload` with whatever accessor the existing tests use to reach the validation path (they exist for `command-palette` — reuse verbatim).

- [ ] **Step 2: Run to verify failure**, then implement in `electron/native-overlay.ts` (place next to the other dialog validators; mirror the payload interfaces locally the way the file mirrors the command-palette ones):

```typescript
const MAX_SESSION_SWITCHER_ITEMS = 500

const isSessionSwitcherItem = (
  value: unknown
): value is NativeOverlaySessionSwitcherItem =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.title) &&
  (value.agentGlyph === undefined || typeof value.agentGlyph === 'string') &&
  typeof value.isActive === 'boolean'

const isSessionSwitcherActions = (
  value: unknown
): value is NativeOverlaySessionSwitcherActions =>
  isRecord(value) && isString(value.commitIndex) && isString(value.cancel)

const isSessionSwitcherDialogPayload = (
  value: unknown
): value is NativeOverlaySessionSwitcherDialogPayload =>
  isRecord(value) &&
  value.dialog === 'session-switcher' &&
  isString(value.ariaLabel) &&
  isFiniteNumber(value.selectedIndex) &&
  value.selectedIndex >= 0 &&
  isBoundedArray(
    value.items,
    MAX_SESSION_SWITCHER_ITEMS,
    isSessionSwitcherItem
  ) &&
  isSessionSwitcherActions(value.actions)
```

and extend the union check:

```typescript
const isDialogPayload = (value: unknown): value is NativeOverlayDialogPayload =>
  isRecord(value) &&
  value.kind === 'dialog' &&
  (isCommandPaletteDialogPayload(value) ||
    isNewSessionDialogPayload(value) ||
    isSessionSwitcherDialogPayload(value))
```

(If the file imports payload types from the renderer module, import the two new types the same way; if it re-declares them locally, re-declare.)

- [ ] **Step 3: Host render branch.** In `NativeOverlayHost.tsx`, extend the dialog-kind gate at ~line 104 to include `'session-switcher'`, and add a render branch beside the `new-session` one at ~line 1250:

```tsx
if (request.payload.dialog === 'session-switcher') {
  const { items, selectedIndex, actions, ariaLabel } = request.payload

  return (
    <ul
      role="listbox"
      aria-label={ariaLabel}
      className="flex flex-col gap-1 p-2"
    >
      {items.map((item, index) => (
        <li key={item.id}>
          <button
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            className={
              index === selectedIndex
                ? 'flex w-full items-center gap-2 rounded-md bg-surface-container-high px-3 py-2 text-left font-body text-sm text-on-surface'
                : 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left font-body text-sm text-on-surface-muted'
            }
            onClick={() => sendAction(actions.commitIndex, { index })}
          >
            <span className="flex-1 truncate">{item.title}</span>
            {item.isActive ? (
              <span className="text-xs text-primary">active</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  )
}
```

Use the host's actual action-dispatch helper in place of `sendAction` (the mechanism the command-palette branch uses to emit `{ index }` action events). Append a host test rendering this payload and asserting the options + selected state, patterned on the existing `new-session` host test.

- [ ] **Step 4: Run** — `npx vitest run src/components/NativeOverlayHost.test.tsx electron/native-overlay.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `feat(overlay): render session switcher through the native overlay path`

---

### Task 9: macOS File menu drops the ⌘W accelerator

**Files:**

- Modify: `electron/edit-menu.ts:29` (`role: 'fileMenu'`)
- Test: `electron/edit-menu.test.ts` (append)

- [ ] **Step 1: Write failing test:**

```typescript
test('mac file menu ships without a close accelerator', () => {
  const template = createApplicationMenuTemplate('darwin')
  const fileEntry = template.find(
    (item) => item.label === 'File' || item.role === 'fileMenu'
  )

  expect(fileEntry).toBeDefined()
  expect(fileEntry?.role).toBeUndefined()
  const submenu = fileEntry?.submenu as MenuItemConstructorOptions[]
  const accelerators = submenu.map((item) => item.accelerator)
  expect(accelerators).not.toContain('CmdOrCtrl+W')
  expect(submenu.every((item) => item.role !== 'close')).toBe(true)
})
```

- [ ] **Step 2: Run to verify failure** (`fileEntry.role` is `'fileMenu'`), then replace `{ role: 'fileMenu' }` in the darwin template with:

```typescript
// Explicit File menu: the fileMenu role registers Close ⌘W, which now
// belongs to the in-app session-close shortcut.
{
  label: 'File',
  submenu: [
    {
      label: 'Close Window',
      click: (_item, focusedWindow): void => {
        focusedWindow?.close()
      },
    },
  ],
},
```

(Match the `click` signature to Electron's `MenuItemConstructorOptions` — if the second parameter is typed `BaseWindow | undefined`, keep the optional call.)

- [ ] **Step 3: Run** — `npx vitest run electron/edit-menu.test.ts`. Expected: PASS.

- [ ] **Step 4: Commit** — `fix(electron): drop mac close-window accelerator in favor of session close`

---

### Task 10: Input-surface forwarding

**Files:**

- Modify: `electron/browser-pane.ts:406` (`BROWSER_WORKSPACE_SHORTCUT_IDS_TO_FORWARD`)
- Test: `electron/browser-pane.test.ts` (append)
- Verify (no expected change): `electron/ghostty-native-shared.ts` `shouldRefocusGhosttyAfterWorkspaceShortcut` treats `dialogOpen: true` as "do not refocus" — the switcher `Dialog` matches `DIALOG_SELECTOR`, so the existing check covers the hold phase. Add a test only if missing.

- [ ] **Step 1: Add the three ids** to the forward set, keeping it alphabetized:

```typescript
  'session-close',
  'session-next',
  'session-prev',
  'session-switch-next',
  'session-switch-prev',
```

- [ ] **Step 2: Append a forwarding test** to `electron/browser-pane.test.ts` following the existing `shouldForwardBrowserWorkspaceShortcut` cases: assert all three new ids forward, and that an unknown id still does not.

- [ ] **Step 3: Ghostty check.** Read `shouldRefocusGhosttyAfterWorkspaceShortcut` in `electron/ghostty-native-shared.ts`. Confirm `dialogOpen === true` returns false (no refocus). If its test file lacks that case, add:

```typescript
test('an open dialog suppresses ghostty refocus', () => {
  expect(
    shouldRefocusGhosttyAfterWorkspaceShortcut({
      activeGhosttyPane: true,
      dockHasFocus: false,
      dialogOpen: true,
    })
  ).toBe(false)
})
```

Also confirm (read, no code): the Ghostty snapshot matcher forwards by resolved catalog binding, so the three new commands need no per-id registration there. Note the confirmation in the commit body.

- [ ] **Step 4: Run** — `npx vitest run electron/browser-pane.test.ts electron/ghostty-native-shared.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `feat(electron): forward session switcher shortcuts from browser panes`

---

### Task 11: E2E coverage + full gates

**Files:**

- Modify: `tests/e2e/terminal/specs/keymap-bindings.spec.ts` (append; reuse `fireKey`, add `fireKeyUp`)

- [ ] **Step 1: Add a keyup helper** beside `fireKey`:

```typescript
const fireKeyUp = async (init: KeyInit): Promise<void> => {
  await browser.execute((i: KeyInit) => {
    const { modKey, ...eventInit } = i
    void modKey
    document.dispatchEvent(
      new KeyboardEvent('keyup', {
        ...eventInit,
        bubbles: true,
        cancelable: true,
      })
    )
  }, init)
}
```

- [ ] **Step 2: Append the spec block** (follow the file's session-setup helpers — `createNewSessionWithDefaults`):

```typescript
describe('session switcher (Ctrl+Tab MRU)', () => {
  it('quick tap bounces to the previously active session', async () => {
    await createNewSessionWithDefaults(browser)
    await createNewSessionWithDefaults(browser)

    const before = await activeSessionLabel()
    await fireKey({ key: 'Tab', code: 'Tab', ctrlKey: true })
    await fireKeyUp({ key: 'Control', code: 'ControlLeft' })

    await browser.waitUntil(
      async () => (await activeSessionLabel()) !== before,
      { timeoutMsg: 'active session did not change after Ctrl+Tab tap' }
    )

    await fireKey({ key: 'Tab', code: 'Tab', ctrlKey: true })
    await fireKeyUp({ key: 'Control', code: 'ControlLeft' })
    await browser.waitUntil(
      async () => (await activeSessionLabel()) === before,
      { timeoutMsg: 'second tap did not bounce back' }
    )
  })

  it('holding ctrl shows the switcher overlay and escape cancels', async () => {
    await fireKey({ key: 'Tab', code: 'Tab', ctrlKey: true })
    const listbox = await browser.$(
      '[role="listbox"][aria-label="Session switcher"]'
    )
    await listbox.waitForExist()

    await fireKey({ key: 'Escape', code: 'Escape' })
    await browser.waitUntil(async () => !(await listbox.isExisting()), {
      timeoutMsg: 'switcher did not close on escape',
    })
  })
})
```

`activeSessionLabel()` — implement with whatever selector the suite already uses for the active session in the sidebar (there is an existing active-session assertion pattern in the terminal suite; reuse it). Note: WDIO specs in this suite use `it()` — follow the surrounding file's convention, the vitest `test()` rule does not apply to `tests/e2e/`.

- [ ] **Step 3: Run the e2e suite** — `npm run test:e2e:all` if the environment supports it; otherwise run the terminal suite per its `wdio.conf.ts` and record the result honestly (CI runs it as the "E2E smoke suite (Linux)" gate; a chromedriver-download flake there is known — rerun, do not override).

- [ ] **Step 4: Full gates from the worktree:**

```bash
npm run lint
npm run type-check
npm run test
npm run format:check
npm run build
```

Expected: all green. `format:check` failures → `npm run format` and re-stage.

- [ ] **Step 5: Commit** — `test(e2e): cover session switcher tap, hold, and cancel`

---

## Execution notes

- Task order: 1 → 2 → 3 → 4 → (5, 6 in either order) → 7 → 8 → 9 → 10 → 11. Tasks 9 and 10 are independent of 5–8 and can interleave.
- Line numbers are from branch `feat/session-switching-keymap` at commit `8c2f5f3c`; re-locate by the quoted identifiers if drift occurs.
- The spec is authoritative for behavior questions: `docs/superpowers/specs/2026-07-18-session-switching-keymap-design.md`. Notably §4 (settlement rules), §5 (switcher contract), §8 (do NOT add digit-jump commands).
- After all tasks: run `codex review` against the branch before any PR (repo convention), and check `git status` for stray `src/bindings/` changes after codex runs (`git checkout -- src/bindings/` if dirtied).
