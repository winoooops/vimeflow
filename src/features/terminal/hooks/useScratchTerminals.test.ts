import { test, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScratchTerminals } from './useScratchTerminals'
import type { Session } from '../../sessions/types'
import type { ITerminalService } from '../services/terminalService'

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
