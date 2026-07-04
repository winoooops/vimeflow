// cspell:ignore Ghostty
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flexoki, obsidianLens, themeService } from '../../../../theme'
import type { ITerminalService } from '../../services/terminalService'
import type { NativeGhosttyDataRequest } from '../../nativeGhosttyClient'
import {
  destroyNativeGhostty,
  focusNativeGhostty,
  sendNativeGhosttyData,
  updateNativeGhostty,
} from '../../nativeGhosttyClient'
import { registerPtySession, unregisterPtySession } from '../../ptySessionMap'
import {
  GhosttyBody,
  nativeGhosttyBoundsFromRect,
  nativeGhosttyCornerRadiusFromCssPixels,
} from './GhosttyBody'

const backendListeners = new Map<string, (payload: unknown) => void>()

let outputListener:
  | ((
      sessionId: string,
      data: string,
      offsetStart: number,
      byteLen: number
    ) => void)
  | null = null

vi.mock('../../../../lib/backend', () => ({
  listen: vi.fn((event: string, callback: (payload: unknown) => void) => {
    backendListeners.set(event, callback)

    return Promise.resolve(() => backendListeners.delete(event))
  }),
}))

vi.mock('../../nativeGhosttyClient', () => {
  const mockSendNativeGhosttyData = vi.fn<
    (request: NativeGhosttyDataRequest) => Promise<boolean>
  >(() => Promise.resolve(true))

  return {
    attachNativeGhosttyOutput: vi.fn(
      (
        service: {
          onData: (
            listener: (
              sessionId: string,
              data: string,
              offsetStart: number,
              byteLen: number
            ) => void
          ) => Promise<() => void>
        },
        request: { sessionId: string; paneId: string },
        options: {
          onOutput?: (
            data: string,
            offsetStart: number,
            byteLen: number
          ) => boolean | void
          onUnavailable?: () => void
        } = {}
      ) =>
        service.onData((_sessionId, data, offsetStart, byteLen) => {
          if (options.onOutput?.(data, offsetStart, byteLen) === false) {
            return
          }

          void (async (): Promise<void> => {
            const enabled = await mockSendNativeGhosttyData({
              ...request,
              data,
            })
            if (!enabled) {
              options.onUnavailable?.()
            }
          })()
        })
    ),
    destroyNativeGhostty: vi.fn(() => Promise.resolve()),
    focusNativeGhostty: vi.fn(() => Promise.resolve(true)),
    sendNativeGhosttyData: mockSendNativeGhosttyData,
    updateNativeGhostty: vi.fn(() => Promise.resolve(true)),
  }
})

vi.mock('../../ptySessionMap', () => ({
  registerPtySession: vi.fn(),
  unregisterPtySession: vi.fn(),
}))

const createService = (): ITerminalService =>
  ({
    write: vi.fn(() => Promise.resolve()),
    onData: vi.fn(
      (
        listener: (
          sessionId: string,
          data: string,
          offsetStart: number,
          byteLen: number
        ) => void
      ) => {
        outputListener = listener

        return Promise.resolve(vi.fn())
      }
    ),
  }) as unknown as ITerminalService

const inactive = false

const rect = (x: number, y: number, width: number, height: number): DOMRect =>
  ({
    x,
    y,
    width,
    height,
  }) as DOMRect

describe('GhosttyBody', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    backendListeners.clear()
    outputListener = null
    themeService.apply('obsidian-lens')
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

  test('sends displayed theme background to native frame updates', async () => {
    render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
      />
    )

    await waitFor(() => {
      expect(updateNativeGhostty).toHaveBeenCalledWith(
        expect.objectContaining({
          backgroundColor: obsidianLens.terminal.background,
        })
      )
    })

    vi.mocked(updateNativeGhostty).mockClear()
    act(() => {
      themeService.preview('flexoki')
    })

    await waitFor(() => {
      expect(updateNativeGhostty).toHaveBeenCalledWith(
        expect.objectContaining({
          backgroundColor: flexoki.terminal.background,
        })
      )
    })
    expect(themeService.current().id).toBe('obsidian-lens')
  })

  test('sends bottom corner radius to native frame updates', async () => {
    render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
        bottomCornerRadius={10}
      />
    )

    await waitFor(() => {
      expect(updateNativeGhostty).toHaveBeenCalledWith(
        expect.objectContaining({ bottomCornerRadius: 10 })
      )
    })
  })

  test('scales bottom corner radius to native window points', async () => {
    vi.stubGlobal('innerWidth', 1533)
    vi.stubGlobal('outerWidth', 1400)

    render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
        bottomCornerRadius={10}
      />
    )

    await waitFor(() => {
      expect(updateNativeGhostty).toHaveBeenCalledWith(
        expect.objectContaining({ bottomCornerRadius: expect.any(Number) })
      )
    })

    const radius =
      vi.mocked(updateNativeGhostty).mock.calls[0][0].bottomCornerRadius

    expect(radius).toBeCloseTo(9.132419438995434)
  })

  test('keeps native frame bounds unchanged when renderer CSS pixels match window points', () => {
    expect(
      nativeGhosttyBoundsFromRect(rect(10, 20, 300, 200), {
        innerWidth: 1400,
        innerHeight: 900,
        outerWidth: 1400,
        outerHeight: 900,
      })
    ).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    })
  })

  test('converts zoomed renderer CSS pixels to native window points', () => {
    expect(
      nativeGhosttyBoundsFromRect(rect(282, 85, 477, 836), {
        innerWidth: 1533,
        innerHeight: 985,
        outerWidth: 1400,
        outerHeight: 900,
      })
    ).toEqual({
      x: 257.5342465753425,
      y: 77.66497461928934,
      width: 435.61643835616434,
      height: 763.8578680203045,
    })
  })

  test('converts CSS corner radius to native window points', () => {
    expect(
      nativeGhosttyCornerRadiusFromCssPixels(10, {
        innerWidth: 1533,
        innerHeight: 985,
        outerWidth: 1400,
        outerHeight: 900,
      })
    ).toBeCloseTo(9.13242)
  })

  test('falls back to unscaled native frame bounds when viewport metrics are unavailable', () => {
    expect(
      nativeGhosttyBoundsFromRect(rect(10, 20, 300, 200), {
        innerWidth: 0,
        innerHeight: Number.NaN,
        outerWidth: 1400,
        outerHeight: 900,
      })
    ).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    })
  })

  test('sends shortcut context with native frame updates', async () => {
    const shortcutContext = {
      paneIds: ['pane-1', 'pane-2'],
      activePaneId: 'pane-1',
    }

    render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        shortcutContext={shortcutContext}
        service={createService()}
      />
    )

    await waitFor(() => {
      expect(updateNativeGhostty).toHaveBeenCalledWith(
        expect.objectContaining({ shortcutContext })
      )
    })
  })

  test('sends native frame updates when only shortcut context changes', async () => {
    const firstShortcutContext = {
      paneIds: ['pane-1', 'pane-2'],
      activePaneId: 'pane-1',
    }

    const nextShortcutContext = {
      paneIds: ['pane-1', 'pane-2'],
      activePaneId: 'pane-2',
    }

    const { rerender } = render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        shortcutContext={firstShortcutContext}
        service={createService()}
      />
    )

    await waitFor(() => {
      expect(updateNativeGhostty).toHaveBeenCalledWith(
        expect.objectContaining({ shortcutContext: firstShortcutContext })
      )
    })
    vi.mocked(updateNativeGhostty).mockClear()

    rerender(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        shortcutContext={nextShortcutContext}
        service={createService()}
      />
    )

    await waitFor(() => {
      expect(updateNativeGhostty).toHaveBeenCalledWith(
        expect.objectContaining({ shortcutContext: nextShortcutContext })
      )
    })
  })

  test('tracks native frame updates until resize callbacks go quiet', async () => {
    let resizeCallback: ResizeObserverCallback | null = null
    let now = 1_000
    const frameCallbacks: FrameRequestCallback[] = []

    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)

    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)

        return frameCallbacks.length
      })

    vi.stubGlobal(
      'ResizeObserver',
      vi.fn().mockImplementation((callback: ResizeObserverCallback) => {
        resizeCallback = callback

        return {
          observe: vi.fn(),
          unobserve: vi.fn(),
          disconnect: vi.fn(),
        }
      })
    )

    render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
      />
    )

    await waitFor(() => {
      expect(updateNativeGhostty).toHaveBeenCalledTimes(1)
    })
    vi.mocked(updateNativeGhostty).mockClear()

    act(() => {
      resizeCallback?.([], {} as ResizeObserver)
      resizeCallback?.([], {} as ResizeObserver)
      resizeCallback?.([], {} as ResizeObserver)
    })

    expect(updateNativeGhostty).toHaveBeenCalledTimes(0)
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      now = 1_016
      frameCallbacks.shift()?.(0)
      await Promise.resolve()
    })

    expect(updateNativeGhostty).toHaveBeenCalledTimes(0)
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(2)

    act(() => {
      now = 1_060
      resizeCallback?.([], {} as ResizeObserver)
    })

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(2)

    await act(async () => {
      now = 1_130
      frameCallbacks.shift()?.(16)
      await Promise.resolve()
    })

    expect(updateNativeGhostty).toHaveBeenCalledTimes(0)
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(3)

    await act(async () => {
      now = 1_195
      frameCallbacks.shift()?.(32)
      await Promise.resolve()
    })

    expect(updateNativeGhostty).toHaveBeenCalledTimes(0)
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(3)

    dateNowSpy.mockRestore()
    requestAnimationFrameSpy.mockRestore()
  })

  test('dedupes resize observer updates by rounded native frame', async () => {
    let resizeCallback: ResizeObserverCallback | null = null

    vi.stubGlobal(
      'ResizeObserver',
      vi.fn().mockImplementation((callback: ResizeObserverCallback) => {
        resizeCallback = callback

        return {
          observe: vi.fn(),
          unobserve: vi.fn(),
          disconnect: vi.fn(),
        }
      })
    )

    render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
      />
    )

    await waitFor(() => {
      expect(updateNativeGhostty).toHaveBeenCalledTimes(1)
    })
    vi.mocked(updateNativeGhostty).mockClear()

    const node = screen.getByTestId('native-ghostty-pane')
    node.getBoundingClientRect = vi.fn(() => rect(10.4, 20.4, 300.4, 200.4))

    act(() => {
      resizeCallback?.([], {} as ResizeObserver)
    })

    expect(updateNativeGhostty).toHaveBeenCalledTimes(1)
    expect(updateNativeGhostty).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bounds: { x: 10.4, y: 20.4, width: 300.4, height: 200.4 },
        parentHeight: window.outerHeight,
      })
    )

    node.getBoundingClientRect = vi.fn(() => rect(10.49, 20.49, 300.49, 200.49))

    act(() => {
      resizeCallback?.([], {} as ResizeObserver)
    })

    expect(updateNativeGhostty).toHaveBeenCalledTimes(1)

    node.getBoundingClientRect = vi.fn(() => rect(10.6, 20.6, 300.6, 200.6))

    act(() => {
      resizeCallback?.([], {} as ResizeObserver)
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(updateNativeGhostty).toHaveBeenCalledTimes(2)
    expect(updateNativeGhostty).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bounds: { x: 10.6, y: 20.6, width: 300.6, height: 200.6 },
      })
    )
  })

  test('coalesces native frame updates while one IPC request is in flight', async () => {
    let resizeCallback: ResizeObserverCallback | null = null
    let resolveFirstResize: ((enabled: boolean) => void) | undefined

    vi.stubGlobal(
      'ResizeObserver',
      vi.fn().mockImplementation((callback: ResizeObserverCallback) => {
        resizeCallback = callback

        return {
          observe: vi.fn(),
          unobserve: vi.fn(),
          disconnect: vi.fn(),
        }
      })
    )

    render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
      />
    )

    await waitFor(() => {
      expect(updateNativeGhostty).toHaveBeenCalledTimes(1)
    })
    vi.mocked(updateNativeGhostty).mockClear()
    vi.mocked(updateNativeGhostty).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirstResize = resolve
      })
    )

    const node = screen.getByTestId('native-ghostty-pane')
    node.getBoundingClientRect = vi.fn(() => rect(10, 20, 300, 200))

    act(() => {
      resizeCallback?.([], {} as ResizeObserver)
    })

    expect(updateNativeGhostty).toHaveBeenCalledTimes(1)

    node.getBoundingClientRect = vi.fn(() => rect(15, 20, 300, 200))
    act(() => {
      resizeCallback?.([], {} as ResizeObserver)
    })

    node.getBoundingClientRect = vi.fn(() => rect(25, 20, 300, 200))
    act(() => {
      resizeCallback?.([], {} as ResizeObserver)
    })

    expect(updateNativeGhostty).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirstResize?.(true)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(updateNativeGhostty).toHaveBeenCalledTimes(2)
    expect(updateNativeGhostty).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bounds: { x: 25, y: 20, width: 300, height: 200 },
      })
    )
  })

  test('absorbs native destroy failures during unmount cleanup', async () => {
    vi.mocked(destroyNativeGhostty).mockRejectedValueOnce(new Error('disposed'))

    const { unmount } = render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
      />
    )

    unmount()
    await Promise.resolve()

    expect(destroyNativeGhostty).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'pane-1',
    })
  })

  test('registers the pty session mapping while mounted', () => {
    const { rerender, unmount } = render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
      />
    )

    expect(registerPtySession).toHaveBeenCalledWith('pty-1', 'pty-1', '/tmp')

    rerender(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/repo"
        active
        service={createService()}
      />
    )

    expect(unregisterPtySession).toHaveBeenCalledWith('pty-1')
    expect(registerPtySession).toHaveBeenCalledWith('pty-1', 'pty-1', '/repo')

    unmount()

    expect(unregisterPtySession).toHaveBeenLastCalledWith('pty-1')
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

  test('reports unavailable when native data is disabled', async () => {
    vi.mocked(sendNativeGhosttyData).mockResolvedValueOnce(false)
    const onUnavailable = vi.fn()

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
          bufferedEvents: [],
        }}
        onUnavailable={onUnavailable}
      />
    )

    await waitFor(() => {
      expect(onUnavailable).toHaveBeenCalledTimes(1)
    })
  })

  test('reports unavailable when native data IPC rejects', async () => {
    vi.mocked(sendNativeGhosttyData).mockRejectedValueOnce(
      new Error('ipc unavailable')
    )
    const onUnavailable = vi.fn()

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
          bufferedEvents: [],
        }}
        onUnavailable={onUnavailable}
      />
    )

    await waitFor(() => {
      expect(onUnavailable).toHaveBeenCalledTimes(1)
    })
  })

  test('reports unavailable when native focus IPC rejects', async () => {
    vi.mocked(focusNativeGhostty).mockRejectedValueOnce(
      new Error('ipc unavailable')
    )
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

  test('does not register pane-ready after unmount during restore replay', async () => {
    let resolveReplay: ((enabled: boolean) => void) | undefined
    vi.mocked(sendNativeGhosttyData).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReplay = resolve
      })
    )
    const onPaneReady = vi.fn(() => vi.fn())

    const { unmount } = render(
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
        onPaneReady={onPaneReady}
      />
    )

    await waitFor(() => {
      expect(sendNativeGhosttyData).toHaveBeenCalledWith({
        sessionId: 'pty-1',
        paneId: 'pane-1',
        data: 'historical output',
      })
    })

    unmount()

    await act(async () => {
      resolveReplay?.(true)
      await Promise.resolve()
    })

    expect(onPaneReady).not.toHaveBeenCalled()
    expect(sendNativeGhosttyData).not.toHaveBeenCalledWith({
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

  test('requests pane activation from native focus events', async () => {
    const onRequestActive = vi.fn()
    const onRequestFocus = vi.fn()

    render(
      <GhosttyBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active={inactive}
        service={createService()}
        onRequestActive={onRequestActive}
        onRequestFocus={onRequestFocus}
      />
    )

    await waitFor(() => {
      expect(backendListeners.has('ghostty-native-focus')).toBe(true)
    })

    act(() => {
      backendListeners.get('ghostty-native-focus')?.({
        sessionId: 'pty-1',
        paneId: 'pane-1',
      })
    })

    expect(onRequestFocus).toHaveBeenCalledOnce()
    expect(onRequestActive).toHaveBeenCalledOnce()
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

    outputListener?.('pty-1', '\u001b]7;file:///repo/live\u0007', 0, 26)

    expect(onCwdChange).toHaveBeenCalledWith('/repo/live')
    expect(sendNativeGhosttyData).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'pane-1',
      data: '\u001b]7;file:///repo/live\u0007',
    })
  })

  test('skips pane-ready drain events already covered by restored output', async () => {
    let drain:
      | ((data: string, offsetStart: number, byteLen: number) => void)
      | undefined

    const onPaneReady = vi.fn((_ptyId, handler) => {
      drain = handler

      return vi.fn()
    })

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
        onPaneReady={onPaneReady}
      />
    )

    await waitFor(() => {
      expect(drain).toBeDefined()
    })

    vi.mocked(sendNativeGhosttyData).mockClear()
    drain?.('buffered output', 17, 15)
    drain?.('next output', 32, 11)

    expect(sendNativeGhosttyData).not.toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'pane-1',
      data: 'buffered output',
    })

    expect(sendNativeGhosttyData).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'pane-1',
      data: 'next output',
    })
  })
})
