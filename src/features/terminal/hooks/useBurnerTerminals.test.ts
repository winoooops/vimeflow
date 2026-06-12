import { test, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { useBurnerTerminals, type BurnerTarget } from './useBurnerTerminals'
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
      .mockResolvedValue({ sessionId: 'burner-pty', pid: 7, cwd: '/repo' }),
    kill: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    onExit: vi.fn().mockResolvedValue(() => undefined),
    onBurnerForeground: vi.fn().mockResolvedValue(() => undefined),
  }) as unknown as ITerminalService

// The hook renders one popup per pane in a Fragment; pull a mounted popup's
// props out so a test can drive its onAlignCwd handler directly.
const firstPopup = (
  renderNode: ReactNode
): ReactElement<{
  open: boolean
  burnerPtyId: string
  onAlignCwd?: () => void
  alignBusy?: boolean
  outOfSync?: boolean
  onCwdChange?: (cwd: string) => void
}> => {
  const fragment = renderNode as ReactElement<{
    children: ReactElement<{
      open: boolean
      burnerPtyId: string
      onAlignCwd?: () => void
      alignBusy?: boolean
      outOfSync?: boolean
      onCwdChange?: (cwd: string) => void
    }>[]
  }>

  return fragment.props.children[0]
}

// The reconcile effect (VIM-62) keys spawned shells by ptyId; a counter mints a
// distinct id per spawn so a test can assert the right shell was killed/dropped.
const countingSpawn = (): ITerminalService['spawn'] => {
  let n = 0

  return vi.fn().mockImplementation((args: { cwd: string }) => {
    n += 1

    return Promise.resolve({ sessionId: `burner-${n}`, pid: n, cwd: args.cwd })
  })
}

test('toggle (no target) spawns an ephemeral, no-bridge shell at the focused pane cwd, keyed by pane', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo/projects/vimeflow')

  const { result } = renderHook(() =>
    useBurnerTerminals({ service, resolveFocusedPane: () => focused })
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
    useBurnerTerminals({ service, resolveFocusedPane: () => focused })
  )

  const target: BurnerTarget = {
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
    useBurnerTerminals({ service, resolveFocusedPane: () => focused })
  )

  // Open each pane's burner by target (the pane-button / pill path).
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

test('the no-target chord hides a visible burner instead of switching to the focused pane', async () => {
  const service = makeService()
  let focused = makeFocusedPane('s1', 'p0', '/a')

  const { result } = renderHook(() =>
    useBurnerTerminals({ service, resolveFocusedPane: () => focused })
  )

  await act(async () => {
    await result.current.toggle() // chord opens the focused pane p0
  })

  await act(async () => {
    // A pill switches the popup to p1 (which is NOT the focused pane).
    await result.current.toggle({ sessionId: 's1', paneId: 'p1', cwd: '/b' })
  })
  expect(service.spawn).toHaveBeenCalledTimes(2)

  // Focus has moved to a fresh pane p2 with no burner. The chord must HIDE the
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
    useBurnerTerminals({ service, resolveFocusedPane: () => focused })
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
    useBurnerTerminals({ service, resolveFocusedPane: () => focused })
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
    useBurnerTerminals({
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
    useBurnerTerminals({ service, resolveFocusedPane: () => null })
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
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      registerPending,
    })
  )

  await act(async () => {
    await result.current.toggle()
  })

  expect(registerPending).toHaveBeenCalledWith('burner-pty')
})

test('contains a spawn rejection instead of rejecting from the chord path', async () => {
  const service = {
    spawn: vi.fn().mockRejectedValue(new Error('pty cap reached')),
    kill: vi.fn().mockResolvedValue(undefined),
    onExit: vi.fn().mockResolvedValue(() => undefined),
    onBurnerForeground: vi.fn().mockResolvedValue(() => undefined),
  } as unknown as ITerminalService
  const focused = makeFocusedPane()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

  const { result } = renderHook(() =>
    useBurnerTerminals({ service, resolveFocusedPane: () => focused })
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
      return Promise.resolve({ sessionId: 'burner-a', pid: 1, cwd: '/a' })
    }

    return new Promise<{ sessionId: string; pid: number; cwd: string }>(
      (resolve) => {
        resolveP1 = resolve
      }
    )
  })
  service.spawn = spawnMock

  const { result } = renderHook(() =>
    useBurnerTerminals({ service, resolveFocusedPane: () => focused })
  )

  // Start p1 (slow spawn), then immediately open p0 (fast spawn).
  await act(async () => {
    const p1Promise = result.current.toggle({
      sessionId: 's1',
      paneId: 'p1',
      cwd: '/b',
    })
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
    resolveP1({ sessionId: 'burner-b', pid: 2, cwd: '/b' })
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
    useBurnerTerminals({ service, resolveFocusedPane: () => focused })
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

test('closing a pane kills + drops its burner and removes the entry', async () => {
  const service = makeService()
  service.spawn = countingSpawn()
  const dropAllForPty = vi.fn<(ptyId: string) => void>()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  const { result, rerender } = renderHook(
    (props: { live: ReadonlySet<string> }) =>
      useBurnerTerminals({
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

  expect(service.kill).toHaveBeenCalledWith({ sessionId: 'burner-1' })
  expect(dropAllForPty).toHaveBeenCalledWith('burner-1')
  expect([...result.current.runningByPane.keys()]).toEqual([])
  expect(result.current.renderNode).toBeNull()
})

test('closing a session reaps every burner in it at once', async () => {
  const service = makeService()
  service.spawn = countingSpawn()
  const dropAllForPty = vi.fn<(ptyId: string) => void>()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  const { result, rerender } = renderHook(
    (props: { live: ReadonlySet<string> }) =>
      useBurnerTerminals({
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

  expect(service.kill).toHaveBeenCalledWith({ sessionId: 'burner-1' })
  expect(service.kill).toHaveBeenCalledWith({ sessionId: 'burner-2' })
  expect(dropAllForPty.mock.calls.map((call) => call[0]).sort()).toEqual([
    'burner-1',
    'burner-2',
  ])
  expect([...result.current.runningByPane.keys()]).toEqual([])
})

test('a pane restart keeps its burner — the stable key survives a live-set change', async () => {
  const service = makeService()
  service.spawn = countingSpawn()
  const dropAllForPty = vi.fn<(ptyId: string) => void>()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  const { result, rerender } = renderHook(
    (props: { live: ReadonlySet<string> }) =>
      useBurnerTerminals({
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
  // changes, but p0's stable `s1:p0` key is still present, so its burner lives.
  act(() => {
    rerender({ live: new Set<string>(['s1:p0', 's1:p1']) })
  })

  expect(service.kill).not.toHaveBeenCalled()
  expect(dropAllForPty).not.toHaveBeenCalled()
  expect([...result.current.runningByPane.keys()]).toEqual(['s1:p0'])
})

test('a self-exited burner flips to `exited` but stays mounted while its pane lives', async () => {
  const service = makeService()
  service.spawn = countingSpawn()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  const { result } = renderHook(
    (props: { live: ReadonlySet<string> }) =>
      useBurnerTerminals({
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
    exitCb('burner-1', 0)
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
      useBurnerTerminals({
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
    exitCb('burner-1', 0)
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
  expect(dropAllForPty).toHaveBeenCalledWith('burner-1')
  expect(dropAllForPty).toHaveBeenCalledTimes(1)
  expect(result.current.runningByPane.get('s1:p0')).toBe('running')
})

test('a burner whose pane closes mid-spawn is reaped, not left orphaned', async () => {
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
      useBurnerTerminals({
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
    resolveSpawn({ sessionId: 'burner-1', pid: 1, cwd: '/a' })
    await togglePromise
  })

  // spawnIfNeeded re-checks liveness post-spawn and reaps the orphan instead of
  // tracking a burner shell for a dead pane.
  expect(service.kill).toHaveBeenCalledWith({ sessionId: 'burner-1' })
  expect(dropAllForPty).toHaveBeenCalledWith('burner-1')
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
      useBurnerTerminals({
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
    resolveSpawn({ sessionId: 'burner-1', pid: 1, cwd: '/a' })
    await togglePromise
  })

  // The reused-id pane must NOT inherit the old request's burner shell.
  expect(service.kill).toHaveBeenCalledWith({ sessionId: 'burner-1' })
  expect(dropAllForPty).toHaveBeenCalledWith('burner-1')
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

    return Promise.resolve({ sessionId: 'burner-2', pid: 2, cwd: args.cwd })
  })

  const { result, rerender } = renderHook(
    (props: { live: ReadonlySet<string> }) =>
      useBurnerTerminals({
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

  // A new pane reuses `p0` and opens a burner — it must spawn and survive.
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

// --- VIM-71: honest "running" cue from foreground-process detection ---

test('a burner-foreground running event lights the pane as active', async () => {
  const service = makeService()
  service.spawn = countingSpawn()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  const { result } = renderHook(() =>
    useBurnerTerminals({ service, resolveFocusedPane: () => focused })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
  })
  // A freshly-spawned shell is idle at its prompt — not active.
  expect(result.current.activeByPane.get('s1:p0')).toBe(false)

  // The backend reports a foreground command started in burner-1.
  const fgCb = vi.mocked(service.onBurnerForeground).mock.calls[0][0]
  act(() => {
    fgCb('burner-1', true)
  })

  expect(result.current.activeByPane.get('s1:p0')).toBe(true)
})

test('a burner-foreground idle event clears the active cue', async () => {
  const service = makeService()
  service.spawn = countingSpawn()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  const { result } = renderHook(() =>
    useBurnerTerminals({ service, resolveFocusedPane: () => focused })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
  })
  const fgCb = vi.mocked(service.onBurnerForeground).mock.calls[0][0]
  act(() => {
    fgCb('burner-1', true)
  })
  expect(result.current.activeByPane.get('s1:p0')).toBe(true)

  act(() => {
    fgCb('burner-1', false)
  })
  expect(result.current.activeByPane.get('s1:p0')).toBe(false)
})

test('a self-exited burner clears its active cue', async () => {
  const service = makeService()
  service.spawn = countingSpawn()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  const { result } = renderHook(() =>
    useBurnerTerminals({ service, resolveFocusedPane: () => focused })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
  })
  const fgCb = vi.mocked(service.onBurnerForeground).mock.calls[0][0]
  act(() => {
    fgCb('burner-1', true)
  })
  expect(result.current.activeByPane.get('s1:p0')).toBe(true)

  // The shell exits while a command was "running" — the cue must go dark.
  const exitCb = vi.mocked(service.onExit).mock.calls[0][0]
  act(() => {
    exitCb('burner-1', 0)
  })

  expect(result.current.activeByPane.get('s1:p0')).toBe(false)
})

test('a foreground event arriving after exit does not re-light a dead burner', async () => {
  const service = makeService()
  service.spawn = countingSpawn()
  const focused = makeFocusedPane('s1', 'p0', '/a')

  const { result } = renderHook(() =>
    useBurnerTerminals({ service, resolveFocusedPane: () => focused })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/a' })
  })
  const fgCb = vi.mocked(service.onBurnerForeground).mock.calls[0][0]
  const exitCb = vi.mocked(service.onExit).mock.calls[0][0]

  // The shell exits, then a stale foreground=true event arrives — the poll loop
  // and the PTY reader are independent tasks and can deliver out of order.
  act(() => {
    exitCb('burner-1', 0)
  })

  act(() => {
    fgCb('burner-1', true)
  })

  expect(result.current.activeByPane.get('s1:p0')).toBe(false)
  expect(result.current.runningByPane.get('s1:p0')).toBe('exited')
})

// --- VIM-81: align the burner to the host pane's current cwd ---

test('the align callback writes `cd <live host cwd>` + Enter to the burner pty', async () => {
  const service = makeService() // spawns the burner at /repo
  const focused = makeFocusedPane('s1', 'p0', '/repo')
  // The host pane has since navigated away from the spawn cwd.
  const livePaneCwds = new Map([['s1:p0', '/repo/projects/simple-tui']])

  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      livePaneCwds,
    })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })

  act(() => {
    firstPopup(result.current.renderNode).props.onAlignCwd?.()
  })

  // The LIVE pane cwd is sent, not the stale spawn cwd (/repo). The \x05\x15
  // prefix (Ctrl-E, Ctrl-U) clears any half-typed input so the cd runs clean.
  expect(service.write).toHaveBeenCalledWith({
    sessionId: 'burner-pty',
    data: "\x05\x15cd '/repo/projects/simple-tui'\r",
  })
})

test('the align callback prefers the agent cwd over the live host cwd', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo')
  const livePaneCwds = new Map([['s1:p0', '/repo']])

  const agentPaneCwds = new Map([
    ['s1:p0', '/repo/.claude/worktrees/agent-task'],
  ])

  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      livePaneCwds,
      agentPaneCwds,
    })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })

  act(() => {
    firstPopup(result.current.renderNode).props.onAlignCwd?.()
  })

  expect(service.write).toHaveBeenCalledWith({
    sessionId: 'burner-pty',
    data: "\x05\x15cd '/repo/.claude/worktrees/agent-task'\r",
  })
})

test('the align callback falls back to the live host cwd when no agent cwd is available', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo')
  const livePaneCwds = new Map([['s1:p0', '/repo/current-shell-pwd']])
  const agentPaneCwds = new Map([['s1:other', '/repo/.claude/worktrees/task']])

  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      livePaneCwds,
      agentPaneCwds,
    })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })

  act(() => {
    firstPopup(result.current.renderNode).props.onAlignCwd?.()
  })

  expect(service.write).toHaveBeenCalledWith({
    sessionId: 'burner-pty',
    data: "\x05\x15cd '/repo/current-shell-pwd'\r",
  })
})

test('the align callback resolves the latest host cwd at click-time, not a stale snapshot', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo')

  const { result, rerender } = renderHook(
    (props: { cwds: ReadonlyMap<string, string> }) =>
      useBurnerTerminals({
        service,
        resolveFocusedPane: () => focused,
        livePaneCwds: props.cwds,
      }),
    { initialProps: { cwds: new Map([['s1:p0', '/repo/first']]) } }
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })

  // The host pane navigates after the burner is open (OSC 7 moves pane.cwd).
  act(() => {
    rerender({ cwds: new Map([['s1:p0', '/repo/second']]) })
  })

  act(() => {
    firstPopup(result.current.renderNode).props.onAlignCwd?.()
  })

  expect(service.write).toHaveBeenCalledWith({
    sessionId: 'burner-pty',
    data: "\x05\x15cd '/repo/second'\r",
  })
})

test('quotes the cwd so spaces and apostrophes survive as one cd argument', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo')
  const livePaneCwds = new Map([['s1:p0', "/repo/my proj's dir"]])

  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      livePaneCwds,
    })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })

  act(() => {
    firstPopup(result.current.renderNode).props.onAlignCwd?.()
  })

  // POSIX single-quote escaping: a literal ' becomes '\'' , whole path wrapped.
  expect(service.write).toHaveBeenCalledWith({
    sessionId: 'burner-pty',
    data: "\x05\x15cd '/repo/my proj'\\''s dir'\r",
  })
})

test('refuses to align when the host cwd contains terminal control bytes', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo')
  // cwd comes from OSC 7 / agent state (untrusted). A Ctrl-U (\x15) embedded in
  // a dir name survives shell quoting but is acted on by the line editor — it
  // would clear the prefixed `cd '` and run the rest. Refuse, don't inject.
  const livePaneCwds = new Map([['s1:p0', '/tmp/\x15echo pwned #']])

  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      livePaneCwds,
    })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })

  act(() => {
    firstPopup(result.current.renderNode).props.onAlignCwd?.()
  })

  expect(service.write).not.toHaveBeenCalled()
})

test('the align callback is a no-op when the host pane has no live cwd', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo')
  // Map is wired but this pane's key is absent (cwd not resolvable).
  const livePaneCwds = new Map<string, string>([['s1:other', '/x']])

  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      livePaneCwds,
    })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })

  act(() => {
    firstPopup(result.current.renderNode).props.onAlignCwd?.()
  })

  expect(service.write).not.toHaveBeenCalled()
})

test('the align callback does not write to a self-exited burner', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo')
  const livePaneCwds = new Map([['s1:p0', '/repo/moved']])

  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      livePaneCwds,
    })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })

  // The shell exits on its own before the user presses align.
  const exitCb = vi.mocked(service.onExit).mock.calls[0][0]
  act(() => {
    exitCb('burner-pty', 0)
  })

  act(() => {
    firstPopup(result.current.renderNode).props.onAlignCwd?.()
  })

  expect(service.write).not.toHaveBeenCalled()
})

test('no align callback is wired into the popup when livePaneCwds is not provided', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo')

  const { result } = renderHook(() =>
    useBurnerTerminals({ service, resolveFocusedPane: () => focused })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })

  expect(firstPopup(result.current.renderNode).props.onAlignCwd).toBeUndefined()
})

test('the align callback is a no-op while a foreground command is running', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo')
  const livePaneCwds = new Map([['s1:p0', '/repo/moved']])

  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      livePaneCwds,
    })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })

  // A foreground command starts (VIM-71 active cue) — the shell is not at its
  // prompt, so a `cd` would land in the running program's stdin, not the shell.
  const fgCb = vi.mocked(service.onBurnerForeground).mock.calls[0][0]
  act(() => {
    fgCb('burner-pty', true)
  })

  act(() => {
    firstPopup(result.current.renderNode).props.onAlignCwd?.()
  })

  expect(service.write).not.toHaveBeenCalled()
})

test('marks the popup align button busy while a foreground command runs', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo')
  const livePaneCwds = new Map([['s1:p0', '/repo/moved']])

  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      livePaneCwds,
    })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })
  // Idle at the prompt — the button is available.
  expect(firstPopup(result.current.renderNode).props.alignBusy).toBe(false)

  const fgCb = vi.mocked(service.onBurnerForeground).mock.calls[0][0]
  act(() => {
    fgCb('burner-pty', true)
  })

  // A command is running — the popup is told to disable the align button.
  expect(firstPopup(result.current.renderNode).props.alignBusy).toBe(true)
})

test('removes the align affordance once the burner has exited', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo')
  const livePaneCwds = new Map([['s1:p0', '/repo/moved']])

  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      livePaneCwds,
    })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })
  expect(firstPopup(result.current.renderNode).props.onAlignCwd).toBeDefined()

  // The shell exits on its own — a dead shell can't cd, so drop the button
  // rather than leave an enabled control that silently no-ops.
  const exitCb = vi.mocked(service.onExit).mock.calls[0][0]
  act(() => {
    exitCb('burner-pty', 0)
  })

  expect(firstPopup(result.current.renderNode).props.onAlignCwd).toBeUndefined()
})

// --- VIM-94: out-of-sync highlight from burner cwd tracking ---

test('marks the align button out-of-sync when the burner cwd differs from the host', async () => {
  const service = makeService() // spawns at /repo
  const focused = makeFocusedPane('s1', 'p0', '/repo')
  const livePaneCwds = new Map([['s1:p0', '/repo']])

  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      livePaneCwds,
    })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })
  // Spawned at the host cwd → in sync.
  expect(firstPopup(result.current.renderNode).props.outOfSync).toBe(false)

  // The burner cd's elsewhere (its own OSC 7 fires) → out of sync.
  act(() => {
    firstPopup(result.current.renderNode).props.onCwdChange?.('/repo/sub')
  })
  expect(firstPopup(result.current.renderNode).props.outOfSync).toBe(true)

  // Synced back (the cd lands, or the user cd's back) → highlight clears.
  act(() => {
    firstPopup(result.current.renderNode).props.onCwdChange?.('/repo')
  })
  expect(firstPopup(result.current.renderNode).props.outOfSync).toBe(false)
})

test('the host pane moving makes the burner out-of-sync', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo')

  const { result, rerender } = renderHook(
    (props: { cwds: ReadonlyMap<string, string> }) =>
      useBurnerTerminals({
        service,
        resolveFocusedPane: () => focused,
        livePaneCwds: props.cwds,
      }),
    { initialProps: { cwds: new Map([['s1:p0', '/repo']]) } }
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })
  expect(firstPopup(result.current.renderNode).props.outOfSync).toBe(false)

  // The host pane navigates while the burner stays at /repo → out of sync.
  act(() => {
    rerender({ cwds: new Map([['s1:p0', '/other']]) })
  })
  expect(firstPopup(result.current.renderNode).props.outOfSync).toBe(true)
})

test('marks the align button out-of-sync against the agent cwd when one is available', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo')
  const livePaneCwds = new Map([['s1:p0', '/repo']])
  const agentPaneCwds = new Map([['s1:p0', '/repo/worktree']])

  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      livePaneCwds,
      agentPaneCwds,
    })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })

  expect(firstPopup(result.current.renderNode).props.outOfSync).toBe(true)

  act(() => {
    firstPopup(result.current.renderNode).props.onCwdChange?.('/repo/worktree')
  })

  expect(firstPopup(result.current.renderNode).props.outOfSync).toBe(false)
})

test('a trailing-slash-only difference is not treated as out-of-sync', async () => {
  const service = makeService()
  const focused = makeFocusedPane('s1', 'p0', '/repo')
  const livePaneCwds = new Map([['s1:p0', '/repo']])

  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      livePaneCwds,
    })
  )

  await act(async () => {
    await result.current.toggle({ sessionId: 's1', paneId: 'p0', cwd: '/repo' })
  })

  act(() => {
    firstPopup(result.current.renderNode).props.onCwdChange?.('/repo/')
  })
  expect(firstPopup(result.current.renderNode).props.outOfSync).toBe(false)
})
