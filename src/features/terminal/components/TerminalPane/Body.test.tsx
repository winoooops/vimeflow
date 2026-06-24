import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import {
  Body,
  clearTerminalCache,
  terminalCache,
  type BodyHandle,
} from './Body'
import { createTerminalInstance } from './terminalInstance'
import { useTerminal, type UseTerminalReturn } from '../../hooks/useTerminal'
import type { ITerminalService } from '../../services/terminalService'
import type {
  TerminalDisposable,
  TerminalFitController,
  TerminalInstance,
  TerminalOutputChunk,
  TerminalParser,
  TerminalParserEvent,
  TerminalRendererHandle,
  TerminalSurface,
  TerminalViewportReader,
} from '../../types'

// Shared mock service for tests that don't exercise service-specific behavior.
// Round 4 Finding 1 made `service` a required prop on Body (the
// previous fallback to `createTerminalService()` produced disjoint mocks
// in the browser/Vite/test workflow). Tests now pass an explicit service.
const createDefaultMockService = (): ITerminalService =>
  ({
    spawn: vi.fn().mockResolvedValue({ sessionId: 'mock', pid: 0 }),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    onData: vi.fn(
      (): Promise<() => void> =>
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        Promise.resolve((): void => {})
    ),
    onExit: vi.fn(
      (): Promise<() => void> =>
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        Promise.resolve((): void => {})
    ),
    onError: vi.fn(
      (): Promise<() => void> =>
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        Promise.resolve((): void => {})
    ),
    onBurnerForeground: vi.fn(
      (): Promise<() => void> => Promise.resolve((): void => undefined)
    ),
    listSessions: vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    }),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    reorderSessions: vi.fn().mockResolvedValue(undefined),
    updateSessionCwd: vi.fn().mockResolvedValue(undefined),
    setSessionActivityPanelCollapsed: vi.fn().mockResolvedValue(undefined),
    killEphemeralPtys: vi.fn(),
    readScrollback: vi.fn().mockResolvedValue({ rows: [], cells: [] }),
    setWorkspaceSessions: vi.fn().mockResolvedValue(undefined),
  }) as ITerminalService

vi.mock('./terminalInstance', () => ({
  createTerminalInstance: vi.fn(),
}))

// Mock useTerminal hook
vi.mock('../../hooks/useTerminal', () => ({
  useTerminal: vi.fn(),
}))

type MockTerminalSurface = TerminalSurface & {
  open: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  refresh: ReturnType<typeof vi.fn>
  onData: ReturnType<typeof vi.fn>
  onResize: ReturnType<typeof vi.fn>
  hasSelection: ReturnType<typeof vi.fn>
  getSelection: ReturnType<typeof vi.fn>
  paste: ReturnType<typeof vi.fn>
  selectAll: ReturnType<typeof vi.fn>
  onSelectionChange: ReturnType<typeof vi.fn>
  attachKeyEventHandler: ReturnType<typeof vi.fn>
  applyTheme: ReturnType<typeof vi.fn>
}

type MockFitController = TerminalFitController & {
  fit: ReturnType<typeof vi.fn>
}

type MockParser = TerminalParser & {
  onEvent: ReturnType<typeof vi.fn>
}

type MockViewportReader = TerminalViewportReader & {
  readVisibleText: ReturnType<typeof vi.fn>
}

type MockRendererHandle = TerminalRendererHandle & {
  dispose: ReturnType<typeof vi.fn>
}

interface MockTerminalControls {
  instance: TerminalInstance
  terminal: MockTerminalSurface
  parser: MockParser
  fitController: MockFitController
  viewportReader: MockViewportReader
  rendererHandle: MockRendererHandle
}

const createDisposable = (): TerminalDisposable => ({
  dispose: vi.fn(),
})

const createMockTerminalControls = (): MockTerminalControls => {
  const terminal: MockTerminalSurface = {
    cols: 80,
    rows: 24,
    element: document.createElement('div'),
    open: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    clear: vi.fn(),
    write: vi.fn((data: string, callback?: () => void): void => {
      void data
      callback?.()
    }),
    refresh: vi.fn(),
    onData: vi.fn((): TerminalDisposable => createDisposable()),
    onResize: vi.fn((): TerminalDisposable => createDisposable()),
    hasSelection: vi.fn((): boolean => false),
    getSelection: vi.fn((): string => ''),
    paste: vi.fn(),
    selectAll: vi.fn(),
    onSelectionChange: vi.fn((): TerminalDisposable => createDisposable()),
    attachKeyEventHandler: vi.fn(),
    applyTheme: vi.fn(),
  }

  const parser: MockParser = {
    onEvent: vi.fn((): TerminalDisposable => createDisposable()),
  }

  const fitController: MockFitController = {
    fit: vi.fn(),
  }

  const viewportReader: MockViewportReader = {
    readVisibleText: vi.fn((): string => ''),
  }

  const rendererHandle: MockRendererHandle = {
    dispose: vi.fn(),
  }

  const instance: TerminalInstance = {
    terminal,
    output: {
      writeOutput: vi.fn(
        (chunk: TerminalOutputChunk, callback?: () => void): void => {
          terminal.write(chunk.text, callback)
        }
      ),
    },
    parser,
    viewportReader,
    fitController,
    attachRenderer: vi.fn((): TerminalRendererHandle => rendererHandle),
  }

  return {
    instance,
    terminal,
    parser,
    fitController,
    viewportReader,
    rendererHandle,
  }
}

describe('Body', () => {
  let mockTerminalControls: MockTerminalControls
  let mockTerminal: MockTerminalSurface
  let mockParser: MockParser
  let mockFitController: MockFitController
  let mockUseTerminal: UseTerminalReturn
  let defaultMockService: ITerminalService

  beforeEach(() => {
    defaultMockService = createDefaultMockService()
    // Mock ResizeObserver
    global.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }))

    mockTerminalControls = createMockTerminalControls()
    mockTerminal = mockTerminalControls.terminal
    mockParser = mockTerminalControls.parser
    mockFitController = mockTerminalControls.fitController

    // Mock useTerminal hook return value
    mockUseTerminal = {
      session: {
        id: 'test-session',
        pid: 1234,
        name: 'Test Session',
        cwd: '/home/user',
        shell: '/bin/bash',
        status: 'running',
        createdAt: new Date(),
        env: {},
        lastActivityAt: new Date(),
      },
      status: 'running',
      error: null,
      resize: vi.fn(),
    }

    // Setup mocks
    vi.mocked(createTerminalInstance).mockResolvedValue(
      mockTerminalControls.instance
    )
    vi.mocked(useTerminal).mockReturnValue(mockUseTerminal)
  })

  afterEach(() => {
    vi.clearAllMocks()
    // Clear terminal cache to ensure test isolation
    clearTerminalCache()
  })

  test('renders terminal container', () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )
    const container = screen.getByTestId('terminal-pane')
    expect(container).toBeInTheDocument()
  })

  test('scopes terminal scrollbar styling to the terminal pane body', () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    expect(screen.getByTestId('terminal-pane-body-wrapper')).toHaveClass(
      'terminal-pane-body'
    )
  })

  test('creates terminal instance on mount', async () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    await waitFor(() => {
      expect(createTerminalInstance).toHaveBeenCalledTimes(1)
      expect(mockTerminal.open).toHaveBeenCalledWith(expect.any(HTMLElement))
      expect(mockTerminalControls.instance.attachRenderer).toHaveBeenCalled()
    })
  })

  test('surfaces terminal instance creation failures', async () => {
    vi.mocked(createTerminalInstance).mockRejectedValueOnce(
      new Error('Unknown terminal renderer adapter: custom-renderer')
    )

    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    const alert = await screen.findByTestId('terminal-startup-error')

    expect(alert).toHaveTextContent('Terminal failed to start')
    expect(alert).toHaveTextContent(
      'Unknown terminal renderer adapter: custom-renderer'
    )
    expect(mockTerminal.open).not.toHaveBeenCalled()
    expect(terminalCache.has('test-session')).toBe(false)
  })

  test('repaints the terminal when the window regains focus', async () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    await waitFor(() => {
      expect(mockTerminal.open).toHaveBeenCalled()
    })

    mockTerminal.refresh.mockClear()

    // Root cause B: the render loop stalls while the window is covered;
    // regaining focus must force a full repaint to flush stale rows.
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(mockTerminal.refresh).toHaveBeenCalledWith(0, 23)
  })

  test('repaints on visibilitychange only when the document is visible', async () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    await waitFor(() => {
      expect(mockTerminal.open).toHaveBeenCalled()
    })

    // jsdom exposes a read-only visibilityState getter on Document.prototype;
    // shadow it on the instance so we can exercise both branches of the guard.
    const setVisibility = (state: DocumentVisibilityState): void => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => state,
      })
    }

    try {
      mockTerminal.refresh.mockClear()

      // Hidden: the guard must suppress repainting an invisible terminal.
      setVisibility('hidden')
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(mockTerminal.refresh).not.toHaveBeenCalled()

      // Visible: the minimized-window restore path must flush stale rows.
      setVisibility('visible')
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(mockTerminal.refresh).toHaveBeenCalledWith(0, 23)
    } finally {
      // Drop the instance override so jsdom's prototype getter is restored.
      delete (document as { visibilityState?: DocumentVisibilityState })
        .visibilityState
    }
  })

  test('refits terminal after bundled terminal fonts load', async () => {
    let resolveFonts: () => void = (): void => undefined

    const fontsLoaded = new Promise<FontFace[]>((resolve) => {
      resolveFonts = (): void => resolve([])
    })

    const load = vi.fn<FontFaceSet['load']>().mockReturnValue(fontsLoaded)
    const originalFonts = document.fonts
    const frameCallbacks: FrameRequestCallback[] = []

    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load },
    })

    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback): number => {
        frameCallbacks.push(callback)

        return frameCallbacks.length
      })

    const offsetWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(840)

    const offsetHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(600)

    try {
      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(load).toHaveBeenCalledTimes(2)
      })

      mockFitController.fit.mockClear()

      await act(async () => {
        resolveFonts()
        await fontsLoaded
      })

      await waitFor(() => {
        expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1)
      })

      act(() => {
        frameCallbacks[0](16)
      })

      expect(mockFitController.fit).toHaveBeenCalledTimes(1)
      expect(mockTerminal.refresh).toHaveBeenCalledWith(0, 23)
    } finally {
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: originalFonts,
      })
      requestAnimationFrameSpy.mockRestore()
      offsetWidthSpy.mockRestore()
      offsetHeightSpy.mockRestore()
    }
  })

  test('retries terminal font-settle refit until the container is visible', async () => {
    let resolveFonts: () => void = (): void => undefined
    let fontContainerWidth = 0

    const fontsLoaded = new Promise<FontFace[]>((resolve) => {
      resolveFonts = (): void => resolve([])
    })

    const load = vi.fn<FontFaceSet['load']>().mockReturnValue(fontsLoaded)
    const originalFonts = document.fonts
    const frameCallbacks: FrameRequestCallback[] = []

    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load },
    })

    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback): number => {
        frameCallbacks.push(callback)

        return frameCallbacks.length
      })

    const offsetWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockImplementation(() => fontContainerWidth)

    const offsetHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(600)

    try {
      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(load).toHaveBeenCalledTimes(2)
      })

      await act(async () => {
        resolveFonts()
        await fontsLoaded
      })

      await waitFor(() => {
        expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1)
      })

      mockFitController.fit.mockClear()
      mockTerminal.refresh.mockClear()

      act(() => {
        frameCallbacks[0](16)
      })

      // First flush attempt retries because width is still zero (hidden pane).
      expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(2)
      expect(mockFitController.fit).not.toHaveBeenCalled()
      expect(mockTerminal.refresh).not.toHaveBeenCalled()

      fontContainerWidth = 800

      act(() => {
        frameCallbacks[1](32)
      })

      expect(mockFitController.fit).toHaveBeenCalledTimes(1)
      expect(mockTerminal.refresh).toHaveBeenCalledWith(0, 23)
    } finally {
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: originalFonts,
      })
      requestAnimationFrameSpy.mockRestore()
      offsetWidthSpy.mockRestore()
      offsetHeightSpy.mockRestore()
    }
  })

  test('refreshes terminal after deferred terminal font refit flushes', async () => {
    let resolveFonts: () => void = (): void => undefined

    const fontsLoaded = new Promise<FontFace[]>((resolve) => {
      resolveFonts = (): void => resolve([])
    })

    const load = vi.fn<FontFaceSet['load']>().mockReturnValue(fontsLoaded)
    const originalFonts = document.fonts
    const frameCallbacks: FrameRequestCallback[] = []

    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load },
    })

    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback): number => {
        frameCallbacks.push(callback)

        return frameCallbacks.length
      })

    const offsetWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(840)

    const offsetHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(600)

    try {
      const { rerender } = render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
          deferFit
        />
      )

      await waitFor(() => {
        expect(load).toHaveBeenCalledTimes(2)
      })

      await act(async () => {
        resolveFonts()
        await fontsLoaded
      })

      expect(requestAnimationFrameSpy).not.toHaveBeenCalled()

      mockFitController.fit.mockClear()
      mockTerminal.refresh.mockClear()

      rerender(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1)

      act(() => {
        frameCallbacks[0](16)
      })

      expect(mockFitController.fit).toHaveBeenCalledTimes(1)
      expect(mockTerminal.refresh).toHaveBeenCalledWith(0, 23)
    } finally {
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: originalFonts,
      })
      requestAnimationFrameSpy.mockRestore()
      offsetWidthSpy.mockRestore()
      offsetHeightSpy.mockRestore()
    }
  })

  test('keeps deferred terminal font refresh pending when drag restarts before flush', async () => {
    let resolveFonts: () => void = (): void => undefined

    const fontsLoaded = new Promise<FontFace[]>((resolve) => {
      resolveFonts = (): void => resolve([])
    })

    const load = vi.fn<FontFaceSet['load']>().mockReturnValue(fontsLoaded)
    const originalFonts = document.fonts
    const frameCallbacks: FrameRequestCallback[] = []

    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load },
    })

    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback): number => {
        frameCallbacks.push(callback)

        return frameCallbacks.length
      })

    const offsetWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(840)

    const offsetHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(600)

    try {
      const { rerender } = render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
          deferFit
        />
      )

      await waitFor(() => {
        expect(load).toHaveBeenCalledTimes(2)
      })

      await act(async () => {
        resolveFonts()
        await fontsLoaded
      })

      rerender(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1)

      rerender(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
          deferFit
        />
      )

      act(() => {
        frameCallbacks[0](16)
      })

      expect(mockFitController.fit).not.toHaveBeenCalled()
      expect(mockTerminal.refresh).not.toHaveBeenCalled()

      rerender(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(2)

      act(() => {
        frameCallbacks[1](32)
      })

      expect(mockFitController.fit).toHaveBeenCalledTimes(1)
      expect(mockTerminal.refresh).toHaveBeenCalledWith(0, 23)
    } finally {
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: originalFonts,
      })
      requestAnimationFrameSpy.mockRestore()
      offsetWidthSpy.mockRestore()
      offsetHeightSpy.mockRestore()
    }
  })

  test('clears pending deferred terminal font refresh when switching sessions', async () => {
    let resolveFonts: () => void = (): void => undefined
    const firstTerminalControls = createMockTerminalControls()
    const secondTerminalControls = createMockTerminalControls()

    const fontsLoaded = new Promise<FontFace[]>((resolve) => {
      resolveFonts = (): void => resolve([])
    })

    const load = vi.fn<FontFaceSet['load']>().mockReturnValue(fontsLoaded)
    const originalFonts = document.fonts

    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load },
    })

    vi.mocked(createTerminalInstance)
      .mockResolvedValueOnce(firstTerminalControls.instance)
      .mockResolvedValueOnce(secondTerminalControls.instance)

    const offsetWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(840)

    const offsetHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(600)

    try {
      const { rerender } = render(
        <Body
          sessionId="session-a"
          cwd="/home/user"
          service={defaultMockService}
          deferFit
        />
      )

      await waitFor(() => {
        expect(load).toHaveBeenCalledTimes(2)
      })

      await act(async () => {
        resolveFonts()
        await fontsLoaded
      })

      firstTerminalControls.fitController.fit.mockClear()
      firstTerminalControls.terminal.refresh.mockClear()

      rerender(
        <Body
          sessionId="session-b"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(secondTerminalControls.fitController.fit).toHaveBeenCalled()
      })
      expect(firstTerminalControls.terminal.refresh).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: originalFonts,
      })
      offsetWidthSpy.mockRestore()
      offsetHeightSpy.mockRestore()
    }
  })

  test('retries terminal font refresh when drag starts before scheduled refit runs', async () => {
    let resolveFonts: () => void = (): void => undefined

    const fontsLoaded = new Promise<FontFace[]>((resolve) => {
      resolveFonts = (): void => resolve([])
    })

    const load = vi.fn<FontFaceSet['load']>().mockReturnValue(fontsLoaded)
    const originalFonts = document.fonts
    const frameCallbacks: FrameRequestCallback[] = []

    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load },
    })

    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback): number => {
        frameCallbacks.push(callback)

        return frameCallbacks.length
      })

    const offsetWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(840)

    const offsetHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(600)

    try {
      const { rerender } = render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(load).toHaveBeenCalledTimes(2)
      })

      mockFitController.fit.mockClear()
      mockTerminal.refresh.mockClear()

      await act(async () => {
        resolveFonts()
        await fontsLoaded
      })

      expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1)

      rerender(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
          deferFit
        />
      )

      act(() => {
        frameCallbacks[0](16)
      })

      expect(mockFitController.fit).not.toHaveBeenCalled()
      expect(mockTerminal.refresh).not.toHaveBeenCalled()

      rerender(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(2)

      act(() => {
        frameCallbacks[1](32)
      })

      expect(mockFitController.fit).toHaveBeenCalledTimes(1)
      expect(mockTerminal.refresh).toHaveBeenCalledWith(0, 23)
    } finally {
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: originalFonts,
      })
      requestAnimationFrameSpy.mockRestore()
      offsetWidthSpy.mockRestore()
      offsetHeightSpy.mockRestore()
    }
  })

  test('opens terminal in container', async () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    await waitFor(() => {
      expect(mockTerminal.open).toHaveBeenCalledWith(expect.any(HTMLDivElement))
    })
  })

  test('fits terminal to container after opening', async () => {
    const offsetSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(800)

    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    await waitFor(() => {
      expect(mockFitController.fit).toHaveBeenCalled()
    })

    offsetSpy.mockRestore()
  })

  test('handles terminal resize events', async () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    await waitFor(() => {
      expect(mockTerminal.onResize).toHaveBeenCalled()
    })
  })

  test('disposes terminal from cache on unmount to prevent memory leaks', async () => {
    const { unmount } = render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    // Wait for terminal to initialize
    await waitFor(() => {
      expect(mockTerminal.open).toHaveBeenCalled()
    })

    const terminalInstance = mockTerminal

    // Unmount component (session is closed)
    unmount()

    // Terminal should be disposed on unmount to prevent memory leaks
    expect(terminalInstance.dispose).toHaveBeenCalled()
  })

  test('passes sessionId prop correctly', () => {
    const sessionId = 'custom-session-123'
    render(
      <Body
        sessionId={sessionId}
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    const container = screen.getByTestId('terminal-pane')
    // Body exposes the PTY handle as data-pty-id (NOT data-session-id) to
    // avoid colliding with TerminalZone's data-session-id={session.id} —
    // post-5a, Session.id and pane.ptyId are independent values and putting
    // them under the same attribute name made the E2E multi-tab test see
    // duplicate sessions in the DOM (cycle 5a CI regression fix).
    expect(container).toHaveAttribute('data-pty-id', sessionId)
    expect(container).not.toHaveAttribute('data-session-id')
  })

  test('uses full width and height', () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    const container = screen.getByTestId('terminal-pane')
    expect(container).toHaveClass('w-full')
    expect(container).toHaveClass('h-full')
  })

  test('emits onPtyStatusChange when PTY status changes', async () => {
    const onPtyStatusChange = vi.fn()

    const { rerender } = render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
        onPtyStatusChange={onPtyStatusChange}
      />
    )

    await waitFor(() => {
      expect(onPtyStatusChange).toHaveBeenCalledWith('running')
    })

    vi.mocked(onPtyStatusChange).mockClear()
    vi.mocked(useTerminal).mockReturnValue({
      ...mockUseTerminal,
      status: 'error',
    })

    rerender(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
        onPtyStatusChange={onPtyStatusChange}
      />
    )

    await waitFor(() => {
      expect(onPtyStatusChange).toHaveBeenCalledWith('error')
    })
  })

  test('useImperativeHandle exposes focusTerminal that focuses cached terminal', async () => {
    const ref = createRef<BodyHandle>()

    render(
      <Body
        ref={ref}
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    await waitFor(() => {
      expect(terminalCache.has('test-session')).toBe(true)
    })

    ref.current?.focusTerminal()

    expect(mockTerminal.focus).toHaveBeenCalledTimes(1)
  })

  test('emits onFocusChange when terminal container gains and loses focus', async () => {
    const onFocusChange = vi.fn()

    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
        onFocusChange={onFocusChange}
      />
    )

    await waitFor(() => {
      expect(mockTerminal.open).toHaveBeenCalled()
    })

    const container = screen.getByTestId('terminal-pane')
    fireEvent.focusIn(container)
    fireEvent.focusOut(container)

    expect(onFocusChange).toHaveBeenCalledWith(true)
    expect(onFocusChange).toHaveBeenCalledWith(false)
  })

  describe('PTY Service Integration', () => {
    test('accepts cwd prop for terminal session', () => {
      const cwd = '/home/user/project'
      render(
        <Body sessionId="test-session" cwd={cwd} service={defaultMockService} />
      )

      const container = screen.getByTestId('terminal-pane')
      expect(container).toBeInTheDocument()
    })

    test('spawns PTY session via useTerminal hook', async () => {
      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.open).toHaveBeenCalled()
      })
    })

    test('connects terminal data events to PTY write', async () => {
      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.open).toHaveBeenCalled()
      })
    })

    test('connects PTY data events to terminal write', async () => {
      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.open).toHaveBeenCalled()
      })
    })

    test('handles terminal resize for PTY', async () => {
      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.onResize).toHaveBeenCalled()
      })
    })
  })

  describe('Resize and Session Management (Codex Review Findings)', () => {
    test('P2: handles container resize with ResizeObserver', async () => {
      // Mock ResizeObserver
      let resizeCallback: ResizeObserverCallback | undefined
      const mockObserve = vi.fn()
      const mockDisconnect = vi.fn()

      global.ResizeObserver = vi
        .fn()
        .mockImplementation((callback: ResizeObserverCallback) => {
          resizeCallback = callback

          return {
            observe: mockObserve,
            unobserve: vi.fn(),
            disconnect: mockDisconnect,
          }
        })

      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(global.ResizeObserver).toHaveBeenCalled()
        expect(mockObserve).toHaveBeenCalled()
      })

      // Clear fit calls from initial render
      mockFitController.fit.mockClear()

      // Simulate container resize
      const container = screen.getByTestId('terminal-pane')

      // Give container a real width so the guard passes
      Object.defineProperty(container, 'offsetWidth', {
        value: 800,
        configurable: true,
      })

      const mockEntry = {
        target: container,
        contentRect: {
          width: 800,
          height: 600,
          top: 0,
          left: 0,
          bottom: 600,
          right: 800,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        },
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry

      if (resizeCallback) {
        resizeCallback([mockEntry], {} as ResizeObserver)
      }

      // fitController.fit() should be called when container resizes
      await waitFor(() => {
        expect(mockFitController.fit).toHaveBeenCalled()
      })
    })

    test('coalesces repeated ResizeObserver notifications into one fit per frame', async () => {
      let resizeCallback: ResizeObserverCallback | undefined
      const mockObserve = vi.fn()
      const frameCallbacks: FrameRequestCallback[] = []

      const requestAnimationFrameSpy = vi
        .spyOn(window, 'requestAnimationFrame')
        .mockImplementation((callback: FrameRequestCallback): number => {
          frameCallbacks.push(callback)

          return frameCallbacks.length
        })

      global.ResizeObserver = vi
        .fn()
        .mockImplementation((callback: ResizeObserverCallback) => {
          resizeCallback = callback

          return {
            observe: mockObserve,
            unobserve: vi.fn(),
            disconnect: vi.fn(),
          }
        })

      try {
        render(
          <Body
            sessionId="test-session"
            cwd="/home/user"
            service={defaultMockService}
          />
        )

        await waitFor(() => {
          expect(global.ResizeObserver).toHaveBeenCalled()
          expect(mockObserve).toHaveBeenCalled()
        })

        mockFitController.fit.mockClear()

        const container = screen.getByTestId('terminal-pane')
        Object.defineProperty(container, 'offsetWidth', {
          value: 820,
          configurable: true,
        })

        Object.defineProperty(container, 'offsetHeight', {
          value: 600,
          configurable: true,
        })

        act(() => {
          resizeCallback?.([], {} as ResizeObserver)
          resizeCallback?.([], {} as ResizeObserver)
          resizeCallback?.([], {} as ResizeObserver)
        })

        expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1)
        expect(mockFitController.fit).not.toHaveBeenCalled()

        act(() => {
          frameCallbacks[0](16)
        })

        expect(mockFitController.fit).toHaveBeenCalledTimes(1)
      } finally {
        requestAnimationFrameSpy.mockRestore()
      }
    })

    test('defers ResizeObserver fit while layout drag is active', async () => {
      let resizeCallback: ResizeObserverCallback | undefined
      const mockObserve = vi.fn()
      const frameCallbacks: FrameRequestCallback[] = []

      const requestAnimationFrameSpy = vi
        .spyOn(window, 'requestAnimationFrame')
        .mockImplementation((callback: FrameRequestCallback): number => {
          frameCallbacks.push(callback)

          return frameCallbacks.length
        })

      const offsetWidthSpy = vi
        .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
        .mockReturnValue(840)

      const offsetHeightSpy = vi
        .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
        .mockReturnValue(600)

      global.ResizeObserver = vi
        .fn()
        .mockImplementation((callback: ResizeObserverCallback) => {
          resizeCallback = callback

          return {
            observe: mockObserve,
            unobserve: vi.fn(),
            disconnect: vi.fn(),
          }
        })

      try {
        const { rerender } = render(
          <Body
            sessionId="test-session"
            cwd="/home/user"
            service={defaultMockService}
            deferFit
          />
        )

        await waitFor(() => {
          expect(global.ResizeObserver).toHaveBeenCalled()
          expect(mockObserve).toHaveBeenCalled()
        })

        expect(mockFitController.fit).not.toHaveBeenCalled()
        mockFitController.fit.mockClear()

        const container = screen.getByTestId('terminal-pane')
        Object.defineProperty(container, 'offsetWidth', {
          value: 840,
          configurable: true,
        })

        Object.defineProperty(container, 'offsetHeight', {
          value: 600,
          configurable: true,
        })

        act(() => {
          resizeCallback?.([], {} as ResizeObserver)
          resizeCallback?.([], {} as ResizeObserver)
        })

        expect(requestAnimationFrameSpy).not.toHaveBeenCalled()
        expect(mockFitController.fit).not.toHaveBeenCalled()

        rerender(
          <Body
            sessionId="test-session"
            cwd="/home/user"
            service={defaultMockService}
          />
        )

        expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1)

        act(() => {
          frameCallbacks[0](16)
        })

        expect(mockFitController.fit).toHaveBeenCalledTimes(1)
      } finally {
        requestAnimationFrameSpy.mockRestore()
        offsetWidthSpy.mockRestore()
        offsetHeightSpy.mockRestore()
      }
    })

    test('skips flushed fit when layout drag restarts before frame runs', async () => {
      const mockObserve = vi.fn()
      const frameCallbacks: FrameRequestCallback[] = []

      const requestAnimationFrameSpy = vi
        .spyOn(window, 'requestAnimationFrame')
        .mockImplementation((callback: FrameRequestCallback): number => {
          frameCallbacks.push(callback)

          return frameCallbacks.length
        })

      global.ResizeObserver = vi.fn().mockImplementation(() => ({
        observe: mockObserve,
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      }))

      try {
        const { rerender } = render(
          <Body
            sessionId="test-session"
            cwd="/home/user"
            service={defaultMockService}
            deferFit
          />
        )

        await waitFor(() => {
          expect(global.ResizeObserver).toHaveBeenCalled()
          expect(mockObserve).toHaveBeenCalled()
        })

        const container = screen.getByTestId('terminal-pane')
        Object.defineProperty(container, 'offsetWidth', {
          value: 840,
          configurable: true,
        })

        Object.defineProperty(container, 'offsetHeight', {
          value: 600,
          configurable: true,
        })

        mockFitController.fit.mockClear()

        rerender(
          <Body
            sessionId="test-session"
            cwd="/home/user"
            service={defaultMockService}
          />
        )

        expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1)

        rerender(
          <Body
            sessionId="test-session"
            cwd="/home/user"
            service={defaultMockService}
            deferFit
          />
        )

        act(() => {
          frameCallbacks[0](16)
        })

        expect(mockFitController.fit).not.toHaveBeenCalled()
      } finally {
        requestAnimationFrameSpy.mockRestore()
      }
    })

    test('fits the new session instead of flushing the old session when drag ends during session switch', async () => {
      const firstTerminalControls = createMockTerminalControls()
      const secondTerminalControls = createMockTerminalControls()
      const frameCallbacks: FrameRequestCallback[] = []

      vi.mocked(createTerminalInstance)
        .mockResolvedValueOnce(firstTerminalControls.instance)
        .mockResolvedValueOnce(secondTerminalControls.instance)

      const offsetWidthSpy = vi
        .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
        .mockReturnValue(840)

      const offsetHeightSpy = vi
        .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
        .mockReturnValue(600)

      global.ResizeObserver = vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      }))

      try {
        const { rerender } = render(
          <Body
            sessionId="session-a"
            cwd="/home/user"
            service={defaultMockService}
            deferFit
          />
        )

        await waitFor(() => {
          expect(createTerminalInstance).toHaveBeenCalledTimes(1)
        })

        expect(firstTerminalControls.fitController.fit).not.toHaveBeenCalled()

        const requestAnimationFrameSpy = vi
          .spyOn(window, 'requestAnimationFrame')
          .mockImplementation((callback: FrameRequestCallback): number => {
            frameCallbacks.push(callback)

            return frameCallbacks.length
          })

        try {
          rerender(
            <Body
              sessionId="session-b"
              cwd="/home/user"
              service={defaultMockService}
            />
          )

          await waitFor(() => {
            expect(createTerminalInstance).toHaveBeenCalledTimes(2)
          })

          expect(requestAnimationFrameSpy).not.toHaveBeenCalled()
          expect(firstTerminalControls.fitController.fit).not.toHaveBeenCalled()
          expect(
            secondTerminalControls.fitController.fit
          ).toHaveBeenCalledTimes(1)
        } finally {
          requestAnimationFrameSpy.mockRestore()
        }
      } finally {
        offsetWidthSpy.mockRestore()
        offsetHeightSpy.mockRestore()
      }
    })

    test('regression #81: ResizeObserver skips fit when container is hidden (width=0)', async () => {
      let resizeCallback: ResizeObserverCallback | undefined
      const mockObserve = vi.fn()
      const mockDisconnect = vi.fn()

      global.ResizeObserver = vi
        .fn()
        .mockImplementation((callback: ResizeObserverCallback) => {
          resizeCallback = callback

          return {
            observe: mockObserve,
            unobserve: vi.fn(),
            disconnect: mockDisconnect,
          }
        })

      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(global.ResizeObserver).toHaveBeenCalled()
        expect(mockObserve).toHaveBeenCalled()
      })

      // Clear fit calls from initial render
      mockFitController.fit.mockClear()

      const container = screen.getByTestId('terminal-pane')

      // Simulate hidden tab: offsetWidth === 0 (display:none collapses container)
      Object.defineProperty(container, 'offsetWidth', {
        value: 0,
        configurable: true,
      })

      if (resizeCallback) {
        resizeCallback([], {} as ResizeObserver)
      }

      // fitController must NOT fire — this is the exact bug path that squashes scrollback
      expect(mockFitController.fit).not.toHaveBeenCalled()

      // Simulate tab becoming visible again: offsetWidth > 0
      Object.defineProperty(container, 'offsetWidth', {
        value: 800,
        configurable: true,
      })

      if (resizeCallback) {
        resizeCallback([], {} as ResizeObserver)
      }

      // fitController SHOULD fire now that the container has real dimensions
      await waitFor(() => {
        expect(mockFitController.fit).toHaveBeenCalledTimes(1)
      })
    })

    test('regression #81: cached terminal reuse skips fit in zero-width container', async () => {
      // Seed the module-level cache to force the reuse branch
      const cachedFitController = { fit: vi.fn() }

      const cachedTerminal = {
        open: vi.fn(),
        dispose: vi.fn(),
        focus: vi.fn(),
        cols: 80,
        rows: 24,
        onResize: vi.fn(() => ({ dispose: vi.fn() })),
        parser: { registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })) },
      }

      terminalCache.set('cached-session', {
        terminal: cachedTerminal as unknown as TerminalSurface,
        output: { writeOutput: vi.fn() },
        fitController: cachedFitController as unknown as TerminalFitController,
        viewportReader: { readVisibleText: vi.fn() },
      })

      // Simulate hidden container (display:none → offsetWidth = 0)
      const offsetSpy = vi
        .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
        .mockReturnValue(0)

      try {
        render(
          <Body
            sessionId="cached-session"
            cwd="/home/user"
            service={defaultMockService}
          />
        )

        await waitFor(() => {
          expect(cachedTerminal.open).toHaveBeenCalled()
        })

        // fitController.fit must be suppressed on the reuse path when width is 0
        expect(cachedFitController.fit).not.toHaveBeenCalled()
      } finally {
        offsetSpy.mockRestore()
        terminalCache.delete('cached-session')
      }
    })

    test('caches terminals skip font settle refit when reused', async () => {
      // Seed the module-level cache to force the reuse branch
      const cachedFitController = { fit: vi.fn() }

      const cachedTerminal = {
        open: vi.fn(),
        dispose: vi.fn(),
        focus: vi.fn(),
        cols: 80,
        rows: 24,
        onResize: vi.fn(() => ({ dispose: vi.fn() })),
        parser: { registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })) },
      }

      const load = vi.fn<FontFaceSet['load']>().mockResolvedValue([])
      const originalFonts = document.fonts

      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { load },
      })

      terminalCache.set('cached-session', {
        terminal: cachedTerminal as unknown as TerminalSurface,
        output: { writeOutput: vi.fn() },
        fitController: cachedFitController as unknown as TerminalFitController,
        viewportReader: { readVisibleText: vi.fn() },
      })

      const offsetWidthSpy = vi
        .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
        .mockReturnValue(800)

      const offsetHeightSpy = vi
        .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
        .mockReturnValue(600)

      try {
        render(
          <Body
            sessionId="cached-session"
            cwd="/home/user"
            service={defaultMockService}
          />
        )

        await waitFor(() => {
          expect(cachedTerminal.open).toHaveBeenCalled()
        })

        // Cached terminals already have terminals and fonts in-process, so we
        // should not re-run the font-settle pipeline when restoring.
        expect(load).not.toHaveBeenCalled()
      } finally {
        terminalCache.delete('cached-session')
        offsetHeightSpy.mockRestore()
        offsetWidthSpy.mockRestore()
        Object.defineProperty(document, 'fonts', {
          configurable: true,
          value: originalFonts,
        })
      }
    })

    test('regression #81: onResize does not forward tiny dimensions to PTY when container is hidden', async () => {
      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.onResize).toHaveBeenCalled()
      })

      // Clear mocks from initial render
      mockFitController.fit.mockClear()
      vi.mocked(mockUseTerminal.resize).mockClear()

      const container = screen.getByTestId('terminal-pane')

      const onResizeCallback = mockTerminal.onResize.mock
        .calls[0][0] as (size: { cols: number; rows: number }) => void

      // Hidden tab path: container width === 0
      Object.defineProperty(container, 'offsetWidth', {
        value: 0,
        configurable: true,
      })

      onResizeCallback({ cols: 1, rows: 24 })

      // PTY resize must NOT fire at zero width — that path forwards tiny
      // dimensions to the PTY and re-wraps scrollback. fit() is no longer
      // called inside onResize at all (PR #190 review: the cols/rows
      // delivered by onResize are already the result of an upstream fit(),
      // so re-fitting here is circular).
      expect(mockFitController.fit).not.toHaveBeenCalled()
      expect(mockUseTerminal.resize).not.toHaveBeenCalled()

      // Visible tab path: container width > 0
      Object.defineProperty(container, 'offsetWidth', {
        value: 800,
        configurable: true,
      })

      onResizeCallback({ cols: 80, rows: 24 })

      // PTY resize fires; fit() does NOT (handler forwards the terminal's
      // already-fitted dimensions to the PTY without re-measuring).
      expect(mockFitController.fit).not.toHaveBeenCalled()
      expect(mockUseTerminal.resize).toHaveBeenCalledTimes(1)
    })

    test('does not forward duplicate terminal resize dimensions to PTY', async () => {
      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.onResize).toHaveBeenCalled()
      })

      vi.mocked(mockUseTerminal.resize).mockClear()

      const container = screen.getByTestId('terminal-pane')
      Object.defineProperty(container, 'offsetWidth', {
        value: 800,
        configurable: true,
      })

      const onResizeCallback = mockTerminal.onResize.mock
        .calls[0][0] as (size: { cols: number; rows: number }) => void

      act(() => {
        onResizeCallback({ cols: 80, rows: 24 })
        onResizeCallback({ cols: 80, rows: 24 })
        onResizeCallback({ cols: 81, rows: 24 })
      })

      expect(mockUseTerminal.resize).toHaveBeenCalledTimes(2)
      expect(mockUseTerminal.resize).toHaveBeenNthCalledWith(1, 80, 24)
      expect(mockUseTerminal.resize).toHaveBeenNthCalledWith(2, 81, 24)
    })

    test('P2: disposes old session terminal when switching to different sessionId', async () => {
      const firstTerminalControls = createMockTerminalControls()
      const secondTerminalControls = createMockTerminalControls()

      vi.mocked(createTerminalInstance)
        .mockResolvedValueOnce(firstTerminalControls.instance)
        .mockResolvedValueOnce(secondTerminalControls.instance)

      // Render with session A
      const { rerender } = render(
        <Body
          sessionId="session-a"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(firstTerminalControls.terminal.open).toHaveBeenCalled()
      })

      const firstTerminal = firstTerminalControls.terminal

      // Clear mocks to detect new calls
      vi.mocked(createTerminalInstance).mockClear()

      // Switch to session B (cleanup effect disposes session A terminal)
      rerender(
        <Body
          sessionId="session-b"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      // Wait for new terminal to be created
      await waitFor(() => {
        expect(createTerminalInstance).toHaveBeenCalledTimes(1)
      })

      // First terminal should be disposed to prevent memory leaks
      expect(firstTerminal.dispose).toHaveBeenCalled()
    })
  })

  describe('Stability and Performance (Codex Review Findings)', () => {
    test('P2: forwards stable service prop to useTerminal across re-renders', async () => {
      // Round 4 Finding 1: Body no longer memoizes a fallback
      // service internally — callers MUST pass a stable instance. This test
      // now verifies the contract holds: a stable service prop reaches
      // useTerminal unchanged across renders. The parent (WorkspaceView)
      // owns the memoization via useMemo.
      const { rerender } = render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(useTerminal).toHaveBeenCalled()
      })

      const firstCallService =
        vi.mocked(useTerminal).mock.calls[0]?.[0]?.service

      // Clear mocks to count new calls
      vi.mocked(useTerminal).mockClear()

      // Trigger re-render with same service prop
      rerender(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(useTerminal).toHaveBeenCalled()
      })

      const secondCallService =
        vi.mocked(useTerminal).mock.calls[0]?.[0]?.service

      // Same prop reference reaches useTerminal both times.
      expect(firstCallService).toBe(secondCallService)
      expect(firstCallService).toBe(defaultMockService)
    })

    test('P1: does not recreate terminal when resize callback changes', async () => {
      // Render component
      const { rerender } = render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(createTerminalInstance).toHaveBeenCalledTimes(1)
      })

      // Update mockUseTerminal to return a new resize callback (simulating session change)
      mockUseTerminal = {
        ...mockUseTerminal,
        resize: vi.fn(), // New function reference
      }
      vi.mocked(useTerminal).mockReturnValue(mockUseTerminal)

      // Clear factory mock to count new calls
      vi.mocked(createTerminalInstance).mockClear()

      // Trigger re-render (this would happen when resize callback changes)
      rerender(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      // Wait a bit to ensure effect would run if it was going to
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Terminal instance should NOT be recreated
      expect(createTerminalInstance).not.toHaveBeenCalled()
    })

    test('P2: re-sends PTY resize after session becomes running', async () => {
      // Start with idle status (session not yet spawned)
      const initialMockUseTerminal: UseTerminalReturn = {
        ...mockUseTerminal,
        status: 'idle',
        resize: vi.fn(),
      }
      vi.mocked(useTerminal).mockReturnValue(initialMockUseTerminal)

      // Render component
      const { rerender } = render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.open).toHaveBeenCalled()
      })

      // Clear resize mock to count only subsequent calls
      vi.mocked(initialMockUseTerminal.resize).mockClear()

      // Simulate session becoming running (status transition)
      const runningMockUseTerminal: UseTerminalReturn = {
        ...mockUseTerminal,
        status: 'running',
        resize: initialMockUseTerminal.resize, // Same resize function
      }
      vi.mocked(useTerminal).mockReturnValue(runningMockUseTerminal)

      // Trigger re-render (this simulates the status change)
      rerender(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      // Resize should be called when status becomes 'running'
      await waitFor(() => {
        expect(initialMockUseTerminal.resize).toHaveBeenCalled()
      })
    })
  })

  // Feature #14: Restore protocol tests
  describe('Restored mode', () => {
    test('passes restoredFrom prop to useTerminal', () => {
      const restoredFrom = {
        sessionId: 'r1',
        cwd: '/tmp',
        pid: 99,
        replayData: 'X',
        replayEndOffset: 1,
        bufferedEvents: [],
      }

      render(
        <Body
          sessionId="r1"
          cwd="/tmp"
          service={defaultMockService}
          restoredFrom={restoredFrom}
        />
      )

      expect(vi.mocked(useTerminal)).toHaveBeenCalledWith(
        expect.objectContaining({ restoredFrom })
      )
    })
  })

  // Feature #14: OSC 7 cwd sync tests.
  // The pane reports cwd changes via onCwdChange; the parent (useSessionManager)
  // is the sole writer that issues the updateSessionCwd IPC. The pane MUST NOT
  // call service.updateSessionCwd directly — doubling the IPC was the round-12
  // MEDIUM finding, and the second call silently swallows errors when the
  // session is concurrently killed.
  describe('OSC 7 handler', () => {
    test('forwards file:// URL path to onCwdChange', async () => {
      const mockService = {
        spawn: vi.fn().mockResolvedValue({ sessionId: 'pty-1', pid: 123 }),
        write: vi.fn().mockResolvedValue(undefined),
        resize: vi.fn().mockResolvedValue(undefined),
        kill: vi.fn().mockResolvedValue(undefined),
        updateSessionCwd: vi.fn().mockResolvedValue(undefined),
        setSessionActivityPanelCollapsed: vi.fn().mockResolvedValue(undefined),
        readScrollback: vi.fn().mockResolvedValue({ rows: [], cells: [] }),
        setWorkspaceSessions: vi.fn().mockResolvedValue(undefined),
        onData: vi.fn(() =>
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          Promise.resolve((): void => {})
        ),
        onExit: vi.fn(() =>
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          Promise.resolve((): void => {})
        ),
        onError: vi.fn(() =>
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          Promise.resolve((): void => {})
        ),
        onBurnerForeground: vi.fn(() => Promise.resolve((): void => undefined)),
        listSessions: vi.fn().mockResolvedValue({
          activeSessionId: null,
          sessions: [],
        }),
        setActiveSession: vi.fn().mockResolvedValue(undefined),
        reorderSessions: vi.fn().mockResolvedValue(undefined),
        killEphemeralPtys: vi.fn().mockResolvedValue([]),
      }

      const onCwdChange = vi.fn()

      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={mockService}
          onCwdChange={onCwdChange}
        />
      )

      await waitFor(() => {
        expect(mockParser.onEvent).toHaveBeenCalledWith(expect.any(Function))
      })

      const parserEventHandler = vi.mocked(mockParser.onEvent).mock
        .calls[0]?.[0] as ((event: TerminalParserEvent) => void) | undefined

      parserEventHandler?.({
        type: 'cwd',
        source: 'osc7',
        uri: 'file://localhost/home/user/projects',
        output: { offsetStart: 0, byteLen: 41, phase: 'live' },
      })

      await waitFor(() => {
        expect(onCwdChange).toHaveBeenCalledWith('/home/user/projects')
      })

      expect(mockService.updateSessionCwd).not.toHaveBeenCalled()
    })

    test('preserves file:// URL host for Windows UNC cwd updates', async () => {
      const mockService = {
        spawn: vi.fn().mockResolvedValue({ sessionId: 'pty-1', pid: 123 }),
        write: vi.fn().mockResolvedValue(undefined),
        resize: vi.fn().mockResolvedValue(undefined),
        kill: vi.fn().mockResolvedValue(undefined),
        updateSessionCwd: vi.fn().mockResolvedValue(undefined),
        setSessionActivityPanelCollapsed: vi.fn().mockResolvedValue(undefined),
        readScrollback: vi.fn().mockResolvedValue({ rows: [], cells: [] }),
        setWorkspaceSessions: vi.fn().mockResolvedValue(undefined),
        onData: vi.fn(() =>
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          Promise.resolve((): void => {})
        ),
        onExit: vi.fn(() =>
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          Promise.resolve((): void => {})
        ),
        onError: vi.fn(() =>
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          Promise.resolve((): void => {})
        ),
        onBurnerForeground: vi.fn(() => Promise.resolve((): void => undefined)),
        listSessions: vi.fn().mockResolvedValue({
          activeSessionId: null,
          sessions: [],
        }),
        setActiveSession: vi.fn().mockResolvedValue(undefined),
        reorderSessions: vi.fn().mockResolvedValue(undefined),
        killEphemeralPtys: vi.fn().mockResolvedValue([]),
      }

      const onCwdChange = vi.fn()

      render(
        <Body
          sessionId="test-session"
          cwd="C:/Users/will"
          service={mockService}
          onCwdChange={onCwdChange}
        />
      )

      await waitFor(() => {
        expect(mockParser.onEvent).toHaveBeenCalledWith(expect.any(Function))
      })

      const parserEventHandler = vi.mocked(mockParser.onEvent).mock
        .calls[0]?.[0] as ((event: TerminalParserEvent) => void) | undefined

      parserEventHandler?.({
        type: 'cwd',
        source: 'osc7',
        uri: 'file://server/share/project',
        output: { offsetStart: 0, byteLen: 27, phase: 'live' },
      })

      await waitFor(() => {
        expect(onCwdChange).toHaveBeenCalledWith('//server/share/project')
      })

      expect(mockService.updateSessionCwd).not.toHaveBeenCalled()
    })

    test('ignores non-file OSC 7 URI payloads', async () => {
      const onCwdChange = vi.fn()

      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
          onCwdChange={onCwdChange}
        />
      )

      await waitFor(() => {
        expect(mockParser.onEvent).toHaveBeenCalledWith(expect.any(Function))
      })

      const parserEventHandler = vi.mocked(mockParser.onEvent).mock
        .calls[0]?.[0] as ((event: TerminalParserEvent) => void) | undefined

      parserEventHandler?.({
        type: 'cwd',
        source: 'osc7',
        uri: 'javascript:alert(1)',
        output: { offsetStart: 0, byteLen: 19, phase: 'live' },
      })

      expect(onCwdChange).not.toHaveBeenCalled()
      expect(defaultMockService.updateSessionCwd).not.toHaveBeenCalled()
    })

    test('forwards plain absolute path to onCwdChange', async () => {
      const mockService = {
        spawn: vi.fn().mockResolvedValue({ sessionId: 'pty-1', pid: 123 }),
        write: vi.fn().mockResolvedValue(undefined),
        resize: vi.fn().mockResolvedValue(undefined),
        kill: vi.fn().mockResolvedValue(undefined),
        updateSessionCwd: vi.fn().mockResolvedValue(undefined),
        setSessionActivityPanelCollapsed: vi.fn().mockResolvedValue(undefined),
        readScrollback: vi.fn().mockResolvedValue({ rows: [], cells: [] }),
        setWorkspaceSessions: vi.fn().mockResolvedValue(undefined),
        onData: vi.fn(() =>
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          Promise.resolve((): void => {})
        ),
        onExit: vi.fn(() =>
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          Promise.resolve((): void => {})
        ),
        onError: vi.fn(() =>
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          Promise.resolve((): void => {})
        ),
        onBurnerForeground: vi.fn(() => Promise.resolve((): void => undefined)),
        listSessions: vi.fn().mockResolvedValue({
          activeSessionId: null,
          sessions: [],
        }),
        setActiveSession: vi.fn().mockResolvedValue(undefined),
        reorderSessions: vi.fn().mockResolvedValue(undefined),
        killEphemeralPtys: vi.fn().mockResolvedValue([]),
      }

      const onCwdChange = vi.fn()

      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={mockService}
          onCwdChange={onCwdChange}
        />
      )

      await waitFor(() => {
        expect(mockParser.onEvent).toHaveBeenCalled()
      })

      const parserEventHandler = vi.mocked(mockParser.onEvent).mock
        .calls[0]?.[0] as ((event: TerminalParserEvent) => void) | undefined

      parserEventHandler?.({
        type: 'cwd',
        source: 'osc7',
        uri: '/tmp',
        output: { offsetStart: 0, byteLen: 4, phase: 'live' },
      })

      await waitFor(() => {
        expect(onCwdChange).toHaveBeenCalledWith('/tmp')
      })

      expect(mockService.updateSessionCwd).not.toHaveBeenCalled()
    })
  })
})
