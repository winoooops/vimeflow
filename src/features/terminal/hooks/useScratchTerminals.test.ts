import { test, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactElement } from 'react'
import { useScratchTerminals, type ScratchTarget } from './useScratchTerminals'
import type { FocusedPaneRef } from '../../command-palette/hooks/usePaneRenameChord'
import type { ITerminalService } from '../services/terminalService'
import * as chordRegistry from '../../command-palette/chordRegistry'

const makeFocusedPane = (
  sessionId = 's1',
  paneId = 'p0',
  cwd = '/repo'
): FocusedPaneRef =>
  ({
    pane: { id: paneId, cwd },
    session: { id: sessionId, panes: [{ id: paneId, cwd }] },
  }) as unknown as FocusedPaneRef

const makeService = (): ITerminalService =>
  ({
    spawn: vi
      .fn()
      .mockResolvedValue({ sessionId: 'scratch-pty', pid: 7, cwd: '/repo' }),
    kill: vi.fn().mockResolvedValue(undefined),
    onExit: vi.fn().mockResolvedValue(() => undefined),
  }) as unknown as ITerminalService

// The reconcile effect (VIM-62) keys spawned shells by ptyId; a counter mints a
// distinct id per spawn so a test can assert the right shell was killed/dropped.
const countingSpawn = (): ITerminalService['spawn'] => {
  let n = 0

  return vi.fn().mockImplementation((args: { cwd: string }) => {
    n += 1

    return Promise.resolve({ sessionId: `scratch-${n}`, pid: n, cwd: args.cwd })
  })
}

test('toggle (no target) spawns an ephemeral, no-bridge shell at the focused pane cwd, keyed by pane', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo/projects/vimeflow')

  const { result } = renderHook(() =>
    useScratchTerminals({ service, resolveFocusedPane: () => focused })
  )

  await act(async () => {
    await result.current.toggle()
  })

  expect(service.spawn).toHaveBeenCalledWith(
    expect.objectContaining({
      cwd: '/repo/projects/vimeflow',
      ephemeral: true,
      enableAgentBridge: false,
    })
  )
  expect([...result.current.runningByPane.keys()]).toEqual(['s1:p0'])
  expect(result.current.renderNode).not.toBeNull()
})

test('toggle(target) spawns at the target pane cwd, keyed by that pane (button path)', async () => {
  const service = makeService()
  // Focused pane is p0, but the button targets p1 explicitly.
  const focused = makeFocusedPane('s1', 'p0', '/repo')

  const { result } = renderHook(() =>
    useScratchTerminals({ service, resolveFocusedPane: () => focused })
  )

  const target: ScratchTarget = {
    sessionId: 's1',
    paneId: 'p1',
    cwd: '/repo/other',
  }
  await act(async () => {
    await result.current.toggle(target)
  })

  expect(service.spawn).toHaveBeenCalledWith(
    expect.objectContaining({ cwd: '/repo/other' })
  )
  expect([...result.current.runningByPane.keys()]).toEqual(['s1:p1'])
})

test('different panes get independent shells (keyed per pane)', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  const { result } = renderHook(() =>
    useScratchTerminals({ service, resolveFocusedPane: () => focused })
  )

  // Open each pane's scratch by target (the pane-button / pill path).
  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
  })

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p1', cwd: '/b' })
  })

  expect(service.spawn).toHaveBeenCalledTimes(2)
  expect([...result.current.runningByPane.keys()].sort()).toEqual([
    's1:p0',
    's1:p1',
  ])
})

test('the no-target chord hides a visible scratch instead of switching to the focused pane', async () => {
  const service = makeService()
  let focused = makeFocusedPane('s1', 'p0', '/a')

  const { result } = renderHook(() =>
    useScratchTerminals({ service, resolveFocusedPane: () => focused })
  )

  await act(async () => {
    await result.current.toggle() // chord opens the focused pane p0
  })

  await act(async () => {
    // A pill switches the popup to p1 (which is NOT the focused pane).
    await result.current.toggle({ sessionId: 's1', paneId: 'p1', cwd: '/b' })
  })
  expect(service.spawn).toHaveBeenCalledTimes(2)

  // Focus has moved to a fresh pane p2 with no scratch. The chord must HIDE the
  // visible p1 popup (spec §7 "hides when shown"), not spawn/switch to p2.
  focused = makeFocusedPane('s1', 'p2', '/c')
  await act(async () => {
    await result.current.toggle()
  })

  expect(service.spawn).toHaveBeenCalledTimes(2) // hid — no p2 spawn
})

test('hiding the popup does not kill the shell', async () => {
  const service = makeService()
  const focused = makeFocusedPane()

  const { result } = renderHook(() =>
    useScratchTerminals({ service, resolveFocusedPane: () => focused })
  )

  await act(async () => {
    await result.current.toggle() // open (spawns)
  })

  await act(async () => {
    await result.current.toggle() // hide (same pane)
  })

  expect(service.kill).not.toHaveBeenCalled()
})

test('renderNode stays non-null when hidden while a shell is alive', async () => {
  const service = makeService()
  const focused = makeFocusedPane()

  const { result } = renderHook(() =>
    useScratchTerminals({ service, resolveFocusedPane: () => focused })
  )

  await act(async () => {
    await result.current.toggle()
  })

  await act(async () => {
    await result.current.toggle() // hide
  })

  expect(result.current.renderNode).not.toBeNull() // keep-mounted (spec §5)
})

test('does not spawn until ready', async () => {
  const service = makeService()
  const focused = makeFocusedPane()

  const { result } = renderHook(() =>
    useScratchTerminals({
      service,
      resolveFocusedPane: () => focused,
      ready: false,
    })
  )

  await act(async () => {
    await result.current.toggle()
  })

  expect(service.spawn).not.toHaveBeenCalled()
})

test('toggle is a no-op when there is no focused pane', async () => {
  const service = makeService()

  const { result } = renderHook(() =>
    useScratchTerminals({ service, resolveFocusedPane: () => null })
  )

  await act(async () => {
    await result.current.toggle()
  })

  expect(service.spawn).not.toHaveBeenCalled()
  expect(result.current.renderNode).toBeNull()
})

test('arms the spawn→attach buffer for the new pty before mounting', async () => {
  const service = makeService()
  const focused = makeFocusedPane()
  const registerPending = vi.fn()

  const { result } = renderHook(() =>
    useScratchTerminals({
      service,
      resolveFocusedPane: () => focused,
      registerPending,
    })
  )

  await act(async () => {
    await result.current.toggle()
  })

  expect(registerPending).toHaveBeenCalledWith('scratch-pty')
})

test('contains a spawn rejection instead of rejecting from the chord path', async () => {
  const service = {
    spawn: vi.fn().mockRejectedValue(new Error('pty cap reached')),
    kill: vi.fn().mockResolvedValue(undefined),
    onExit: vi.fn().mockResolvedValue(() => undefined),
  } as unknown as ITerminalService
  const focused = makeFocusedPane()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

  const { result } = renderHook(() =>
    useScratchTerminals({ service, resolveFocusedPane: () => focused })
  )

  await act(async () => {
    await expect(result.current.toggle()).resolves.toBeUndefined()
  })

  expect([...result.current.runningByPane.keys()]).toEqual([])
  expect(result.current.renderNode).toBeNull()
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})

test('show() does not overwrite a later pane selection when an earlier spawn resolves late', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  let resolveP1: (value: {
    sessionId: string
    pid: number
    cwd: string
  }) => void = () => undefined

  const spawnMock = vi.fn().mockImplementation((args: { cwd: string }) => {
    if (args.cwd === '/a') {
      return Promise.resolve({ sessionId: 'scratch-a', pid: 1, cwd: '/a' })
    }

    return new Promise<{ sessionId: string; pid: number; cwd: string }>(
      (resolve) => {
        resolveP1 = resolve
      }
    )
  })
  service.spawn = spawnMock

  const { result } = renderHook(() =>
    useScratchTerminals({ service, resolveFocusedPane: () => focused })
  )

  // Start p1 (slow spawn), then immediately open p0 (fast spawn).
  await act(async () => {
    const p1Promise = result.current.toggle({
      sessionId: 's1',
      paneId: 'p1',
      cwd: '/b',
    })
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
    resolveP1({ sessionId: 'scratch-b', pid: 2, cwd: '/b' })
    await p1Promise
  })

  expect(spawnMock).toHaveBeenCalledTimes(2)
  expect([...result.current.runningByPane.keys()].sort()).toEqual([
    's1:p0',
    's1:p1',
  ])

  // p0 was opened after p1, so it is the first child (Map insertion order).
  const fragment = result.current.renderNode as ReactElement<{
    children: ReactElement<{ open: boolean }>[]
  }>
  const popups = fragment.props.children

  expect(popups).toHaveLength(2)
  expect(popups[0].props.open).toBe(true) // p0 — visible as the latest intent
  expect(popups[1].props.open).toBe(false) // p1 — hidden despite late resolution
})

test('registers a backtick chord that toggles and consumes the event', async () => {
  const service = makeService()
  const focused = makeFocusedPane()

  renderHook(() =>
    useScratchTerminals({ service, resolveFocusedPane: () => focused })
  )

  let consumed = false
  await act(async () => {
    consumed = chordRegistry.dispatch(
      new KeyboardEvent('keydown', { key: '`' })
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  expect(consumed).toBe(true)
  expect(service.spawn).toHaveBeenCalled()
})

// --- PR3 (VIM-62): pane-bound lifecycle via lazy reconciliation ---

test('closing a pane kills + drops its scratch and removes the entry', async () => {
  const service = makeService()
  service.spawn = countingSpawn()
  const dropAllForPty = vi.fn<(ptyId: string) => void>()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  const { result, rerender } = renderHook(
    (props: { live: ReadonlySet<string> }) =>
      useScratchTerminals({
        service,
        resolveFocusedPane: () => focused,
        livePaneKeys: props.live,
        dropAllForPty,
      }),
    { initialProps: { live: new Set<string>(['s1:p0']) } }
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
  })
  expect([...result.current.runningByPane.keys()]).toEqual(['s1:p0'])

  // The host pane closes — its `s1:p0` key drops out of the live set.
  act(() => {
    rerender({ live: new Set<string>() })
  })

  expect(service.kill).toHaveBeenCalledWith({ sessionId: 'scratch-1' })
  expect(dropAllForPty).toHaveBeenCalledWith('scratch-1')
  expect([...result.current.runningByPane.keys()]).toEqual([])
  expect(result.current.renderNode).toBeNull()
})

test('closing a session reaps every scratch in it at once', async () => {
  const service = makeService()
  service.spawn = countingSpawn()
  const dropAllForPty = vi.fn<(ptyId: string) => void>()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  const { result, rerender } = renderHook(
    (props: { live: ReadonlySet<string> }) =>
      useScratchTerminals({
        service,
        resolveFocusedPane: () => focused,
        livePaneKeys: props.live,
        dropAllForPty,
      }),
    { initialProps: { live: new Set<string>(['s1:p0', 's1:p1']) } }
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
  })

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p1', cwd: '/b' })
  })

  expect([...result.current.runningByPane.keys()].sort()).toEqual([
    's1:p0',
    's1:p1',
  ])

  // The whole session closes — both pane keys vanish in the same live-set diff.
  act(() => {
    rerender({ live: new Set<string>() })
  })

  expect(service.kill).toHaveBeenCalledWith({ sessionId: 'scratch-1' })
  expect(service.kill).toHaveBeenCalledWith({ sessionId: 'scratch-2' })
  expect(dropAllForPty.mock.calls.map((call) => call[0]).sort()).toEqual([
    'scratch-1',
    'scratch-2',
  ])
  expect([...result.current.runningByPane.keys()]).toEqual([])
})

test('a pane restart keeps its scratch — the stable key survives a live-set change', async () => {
  const service = makeService()
  service.spawn = countingSpawn()
  const dropAllForPty = vi.fn<(ptyId: string) => void>()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  const { result, rerender } = renderHook(
    (props: { live: ReadonlySet<string> }) =>
      useScratchTerminals({
        service,
        resolveFocusedPane: () => focused,
        livePaneKeys: props.live,
        dropAllForPty,
      }),
    { initialProps: { live: new Set<string>(['s1:p0']) } }
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
  })

  // p0 restarts (its host ptyId rotates) and a sibling p1 opens. The live set
  // changes, but p0's stable `s1:p0` key is still present, so its scratch lives.
  act(() => {
    rerender({ live: new Set<string>(['s1:p0', 's1:p1']) })
  })

  expect(service.kill).not.toHaveBeenCalled()
  expect(dropAllForPty).not.toHaveBeenCalled()
  expect([...result.current.runningByPane.keys()]).toEqual(['s1:p0'])
})

test('a self-exited scratch flips to `exited` but stays mounted while its pane lives', async () => {
  const service = makeService()
  service.spawn = countingSpawn()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  const { result } = renderHook(
    (props: { live: ReadonlySet<string> }) =>
      useScratchTerminals({
        service,
        resolveFocusedPane: () => focused,
        livePaneKeys: props.live,
      }),
    { initialProps: { live: new Set<string>(['s1:p0']) } }
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
  })
  expect(result.current.runningByPane.get('s1:p0')).toBe('running')

  // The shell exits on its own (`exit` / Ctrl-D); the backend emits onExit.
  const exitCb = vi.mocked(service.onExit).mock.calls[0][0]
  act(() => {
    exitCb('scratch-1', 0)
  })

  // Cue goes dark (status !== running), but the pane is alive so reconcile keeps
  // the entry mounted — it's only replaced when the pane is re-opened.
  expect(result.current.runningByPane.get('s1:p0')).toBe('exited')
  expect(result.current.renderNode).not.toBeNull()
})

test('re-opening a self-exited pane spawns a fresh shell and drops the dead buffer', async () => {
  const service = makeService()
  service.spawn = countingSpawn()
  const dropAllForPty = vi.fn<(ptyId: string) => void>()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  const { result } = renderHook(
    (props: { live: ReadonlySet<string> }) =>
      useScratchTerminals({
        service,
        resolveFocusedPane: () => focused,
        livePaneKeys: props.live,
        dropAllForPty,
      }),
    { initialProps: { live: new Set<string>(['s1:p0']) } }
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
  })

  const exitCb = vi.mocked(service.onExit).mock.calls[0][0]
  act(() => {
    exitCb('scratch-1', 0)
  })
  expect(result.current.runningByPane.get('s1:p0')).toBe('exited')

  // Hide the still-visible exited popup, then re-open the same pane.
  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
  })

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
  })

  // spawnIfNeeded saw an `exited` entry: it dropped the dead shell's buffer and
  // spawned a fresh ptyId. The pane key was never dead, so reconcile never ran.
  expect(service.spawn).toHaveBeenCalledTimes(2)
  expect(dropAllForPty).toHaveBeenCalledWith('scratch-1')
  expect(dropAllForPty).toHaveBeenCalledTimes(1)
  expect(result.current.runningByPane.get('s1:p0')).toBe('running')
})

test('a scratch whose pane closes mid-spawn is reaped, not left orphaned', async () => {
  const service = makeService()
  const dropAllForPty = vi.fn<(ptyId: string) => void>()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  // A spawn that stays in flight until the test resolves it by hand.
  let resolveSpawn: (value: {
    sessionId: string
    pid: number
    cwd: string
  }) => void = () => undefined
  service.spawn = vi.fn().mockImplementation(
    () =>
      new Promise<{ sessionId: string; pid: number; cwd: string }>(
        (resolve) => {
          resolveSpawn = resolve
        }
      )
  )

  const { result, rerender } = renderHook(
    (props: { live: ReadonlySet<string> }) =>
      useScratchTerminals({
        service,
        resolveFocusedPane: () => focused,
        livePaneKeys: props.live,
        dropAllForPty,
      }),
    { initialProps: { live: new Set<string>(['s1:p0']) } }
  )

  await act(async () => {
    const togglePromise = result.current.toggle({
      sessionId: 's1',
      paneId: 'p0',
      cwd: '/a',
    })
    // The pane closes while the spawn is still pending — reconcile sees no entry
    // for it yet, so the only `livePaneKeys` change slips past.
    rerender({ live: new Set<string>() })
    // Now the spawn resolves against a pane that is already gone.
    resolveSpawn({ sessionId: 'scratch-1', pid: 1, cwd: '/a' })
    await togglePromise
  })

  // spawnIfNeeded re-checks liveness post-spawn and reaps the orphan instead of
  // tracking a scratch shell for a dead pane.
  expect(service.kill).toHaveBeenCalledWith({ sessionId: 'scratch-1' })
  expect(dropAllForPty).toHaveBeenCalledWith('scratch-1')
  expect([...result.current.runningByPane.keys()]).toEqual([])
  expect(result.current.renderNode).toBeNull()
})

test('a spawn whose pane id is reused mid-flight is reaped, not attached to the new pane', async () => {
  const service = makeService()
  const dropAllForPty = vi.fn<(ptyId: string) => void>()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  let resolveSpawn: (value: {
    sessionId: string
    pid: number
    cwd: string
  }) => void = () => undefined
  service.spawn = vi.fn().mockImplementation(
    () =>
      new Promise<{ sessionId: string; pid: number; cwd: string }>(
        (resolve) => {
          resolveSpawn = resolve
        }
      )
  )

  const { result, rerender } = renderHook(
    (props: { live: ReadonlySet<string> }) =>
      useScratchTerminals({
        service,
        resolveFocusedPane: () => focused,
        livePaneKeys: props.live,
        dropAllForPty,
      }),
    { initialProps: { live: new Set<string>(['s1:p0']) } }
  )

  let togglePromise: Promise<void> = Promise.resolve()
  act(() => {
    togglePromise = result.current.toggle({
      sessionId: 's1',
      paneId: 'p0',
      cwd: '/a',
    })
  })

  // p0 closes — its in-flight spawn is invalidated...
  act(() => {
    rerender({ live: new Set<string>() })
  })

  // ...then a brand-new pane reuses the freed `p0` id (live set looks unchanged).
  act(() => {
    rerender({ live: new Set<string>(['s1:p0']) })
  })

  await act(async () => {
    resolveSpawn({ sessionId: 'scratch-1', pid: 1, cwd: '/a' })
    await togglePromise
  })

  // The reused-id pane must NOT inherit the old request's scratch shell.
  expect(service.kill).toHaveBeenCalledWith({ sessionId: 'scratch-1' })
  expect(dropAllForPty).toHaveBeenCalledWith('scratch-1')
  expect([...result.current.runningByPane.keys()]).toEqual([])
  expect(result.current.renderNode).toBeNull()
})

test('a failed in-flight spawn does not leave a tombstone that kills a later valid spawn', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/a')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

  // First spawn stays pending until rejected; the second resolves normally.
  let rejectFirst: (err: Error) => void = () => undefined
  let call = 0
  service.spawn = vi.fn().mockImplementation((args: { cwd: string }) => {
    call += 1
    if (call === 1) {
      return new Promise<{ sessionId: string; pid: number; cwd: string }>(
        (_resolve, reject) => {
          rejectFirst = reject
        }
      )
    }

    return Promise.resolve({ sessionId: 'scratch-2', pid: 2, cwd: args.cwd })
  })

  const { result, rerender } = renderHook(
    (props: { live: ReadonlySet<string> }) =>
      useScratchTerminals({
        service,
        resolveFocusedPane: () => focused,
        livePaneKeys: props.live,
      }),
    { initialProps: { live: new Set<string>(['s1:p0']) } }
  )

  let togglePromise: Promise<void> = Promise.resolve()
  act(() => {
    togglePromise = result.current.toggle({
      sessionId: 's1',
      paneId: 'p0',
      cwd: '/a',
    })
  })

  // p0 closes mid-spawn — its in-flight spawn is invalidated.
  act(() => {
    rerender({ live: new Set<string>() })
  })

  // The spawn then fails; the tombstone must be cleared, not left behind.
  await act(async () => {
    rejectFirst(new Error('pty cap reached'))
    await togglePromise
  })

  // A new pane reuses `p0` and opens a scratch — it must spawn and survive.
  act(() => {
    rerender({ live: new Set<string>(['s1:p0']) })
  })

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
  })

  expect(service.kill).not.toHaveBeenCalled()
  expect(result.current.runningByPane.get('s1:p0')).toBe('running')
  warn.mockRestore()
})
