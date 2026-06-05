import { test, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
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
  }) as unknown as ITerminalService

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
