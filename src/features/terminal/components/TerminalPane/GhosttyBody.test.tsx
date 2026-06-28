// cspell:ignore Ghostty
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ITerminalService } from '../../services/terminalService'
import {
  destroyNativeGhostty,
  focusNativeGhostty,
  sendNativeGhosttyData,
  updateNativeGhostty,
} from '../../nativeGhosttyClient'
import { GhosttyBody } from './GhosttyBody'

const backendListeners = new Map<string, (payload: unknown) => void>()
let outputListener: ((sessionId: string, data: string) => void) | null = null

vi.mock('../../../../lib/backend', () => ({
  listen: vi.fn((event: string, callback: (payload: unknown) => void) => {
    backendListeners.set(event, callback)

    return Promise.resolve(() => backendListeners.delete(event))
  }),
}))

vi.mock('../../nativeGhosttyClient', () => {
  const mockSendNativeGhosttyData = vi.fn(() => Promise.resolve())

  return {
    attachNativeGhosttyOutput: vi.fn(
      (
        service: {
          onData: (
            listener: (sessionId: string, data: string) => void
          ) => Promise<() => void>
        },
        request: { sessionId: string; paneId: string },
        options: { onOutput?: (data: string) => void } = {}
      ) =>
        service.onData((_sessionId: string, data: string) => {
          options.onOutput?.(data)
          void mockSendNativeGhosttyData({ ...request, data })
        })
    ),
    destroyNativeGhostty: vi.fn(() => Promise.resolve()),
    focusNativeGhostty: vi.fn(() => Promise.resolve()),
    sendNativeGhosttyData: mockSendNativeGhosttyData,
    updateNativeGhostty: vi.fn(() => Promise.resolve(true)),
  }
})

const createService = (): ITerminalService =>
  ({
    onData: vi.fn((listener: (sessionId: string, data: string) => void) => {
      outputListener = listener

      return Promise.resolve(vi.fn())
    }),
  }) as unknown as ITerminalService

const inactive = false

describe('GhosttyBody', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    backendListeners.clear()
    outputListener = null
  })

  test('keeps native surface mounted when pane loses focus', async () => {
    const service = createService()
    const paneRef = { sessionId: 'pty-1', paneId: 'pane-1' }

    const { rerender, unmount } = render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={service}
      />
    )

    await waitFor(() => {
      expect(updateNativeGhostty).toHaveBeenCalledWith(
        expect.objectContaining({ ...paneRef, visible: true })
      )
    })
    expect(focusNativeGhostty).toHaveBeenCalledWith(paneRef)

    rerender(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active={inactive}
        service={service}
      />
    )

    expect(destroyNativeGhostty).not.toHaveBeenCalled()

    unmount()

    expect(destroyNativeGhostty).toHaveBeenCalledWith(paneRef)
  })

  test('reports unavailable when native update is disabled', async () => {
    vi.mocked(updateNativeGhostty).mockResolvedValueOnce(false)
    const onUnavailable = vi.fn()

    render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
        onUnavailable={onUnavailable}
      />
    )

    await waitFor(() => {
      expect(onUnavailable).toHaveBeenCalledTimes(1)
    })
  })

  test('writes restored replay output to the native pane', async () => {
    render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
        restoredFrom={{
          sessionId: 'pty-1',
          cwd: '/tmp',
          pid: 42,
          replayData: 'historical output',
          replayEndOffset: 17,
          bufferedEvents: [
            { data: 'buffered output', offsetStart: 17, byteLen: 15 },
          ],
        }}
      />
    )

    await waitFor(() => {
      expect(sendNativeGhosttyData).toHaveBeenCalledWith({
        sessionId: 'pty-1',
        paneId: 'pane-1',
        data: 'historical output',
      })
    })

    expect(sendNativeGhosttyData).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'pane-1',
      data: 'buffered output',
    })
  })

  test('tracks native input command submissions', async () => {
    const onCommandSubmit = vi.fn()

    render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
        onCommandSubmit={onCommandSubmit}
      />
    )

    await waitFor(() => {
      expect(backendListeners.has('ghostty-native-input')).toBe(true)
    })

    backendListeners.get('ghostty-native-input')?.({
      sessionId: 'pty-1',
      paneId: 'pane-1',
      data: '/clear\r',
    })

    expect(onCommandSubmit).toHaveBeenCalledWith('pty-1', '/clear')
  })

  test('tracks cwd changes from native output OSC 7 sequences', async () => {
    const onCwdChange = vi.fn()

    render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(outputListener).not.toBeNull()
    })

    outputListener?.('pty-1', '\u001b]7;file:///repo/live\u0007')

    expect(onCwdChange).toHaveBeenCalledWith('/repo/live')
    expect(sendNativeGhosttyData).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'pane-1',
      data: '\u001b]7;file:///repo/live\u0007',
    })
  })
})
