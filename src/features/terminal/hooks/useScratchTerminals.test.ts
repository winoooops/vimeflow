import { test, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScratchTerminals } from './useScratchTerminals'
import type { Session } from '../../sessions/types'
import type { ITerminalService } from '../services/terminalService'
import * as chordRegistry from '../../command-palette/chordRegistry'

const makeSession = (id = 's1', workingDirectory = '/repo'): Session =>
  ({ id, workingDirectory }) as unknown as Session

const makeService = (): ITerminalService =>
  ({
    spawn: vi
      .fn()
      .mockResolvedValue({ sessionId: 'scratch-pty', pid: 7, cwd: '/repo' }),
    kill: vi.fn().mockResolvedValue(undefined),
  }) as unknown as ITerminalService

test('toggle spawns an ephemeral, no-bridge shell at the session workingDirectory', async () => {
  const service = makeService()
  const session = makeSession()

  const { result } = renderHook(() =>
    useScratchTerminals({ service, resolveActiveSession: () => session })
  )

  await act(async () => {
    await result.current.toggle()
  })

  expect(service.spawn).toHaveBeenCalledWith(
    expect.objectContaining({
      cwd: '/repo',
      ephemeral: true,
      enableAgentBridge: false,
    })
  )
  expect([...result.current.running.keys()]).toEqual(['s1'])
  expect(result.current.renderNode).not.toBeNull()
})

test('hiding the popup does not kill the shell', async () => {
  const service = makeService()
  const session = makeSession()

  const { result } = renderHook(() =>
    useScratchTerminals({ service, resolveActiveSession: () => session })
  )

  await act(async () => {
    await result.current.toggle() // open (spawns)
  })

  await act(async () => {
    await result.current.toggle() // hide
  })

  expect(service.kill).not.toHaveBeenCalled()
})

test('renderNode stays non-null when hidden while a shell is alive', async () => {
  const service = makeService()
  const session = makeSession()

  const { result } = renderHook(() =>
    useScratchTerminals({ service, resolveActiveSession: () => session })
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
  const session = makeSession()

  const { result } = renderHook(() =>
    useScratchTerminals({
      service,
      resolveActiveSession: () => session,
      ready: false,
    })
  )

  await act(async () => {
    await result.current.toggle()
  })

  expect(service.spawn).not.toHaveBeenCalled()
})

test('toggle is a no-op when there is no active session', async () => {
  const service = makeService()

  const { result } = renderHook(() =>
    useScratchTerminals({ service, resolveActiveSession: () => null })
  )

  await act(async () => {
    await result.current.toggle()
  })

  expect(service.spawn).not.toHaveBeenCalled()
  expect(result.current.renderNode).toBeNull()
})

test('arms the spawn→attach buffer for the new pty before mounting', async () => {
  const service = makeService()
  const session = makeSession()
  const registerPending = vi.fn()

  const { result } = renderHook(() =>
    useScratchTerminals({
      service,
      resolveActiveSession: () => session,
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
  const session = makeSession()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

  const { result } = renderHook(() =>
    useScratchTerminals({ service, resolveActiveSession: () => session })
  )

  await act(async () => {
    await expect(result.current.toggle()).resolves.toBeUndefined()
  })

  expect([...result.current.running.keys()]).toEqual([])
  expect(result.current.renderNode).toBeNull()
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})

test('registers a backtick chord that toggles and consumes the event', async () => {
  const service = makeService()
  const session = makeSession()

  renderHook(() =>
    useScratchTerminals({ service, resolveActiveSession: () => session })
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
