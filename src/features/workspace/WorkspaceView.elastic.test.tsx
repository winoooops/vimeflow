import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceView } from './WorkspaceView'

vi.mock('../terminal/components/TerminalPane', () => ({
  TerminalPane: vi.fn(() => (
    <div data-testid="terminal-pane-mock">Mocked TerminalPane</div>
  )),
}))

vi.mock('../agent-status/hooks/useAgentStatus', () => ({
  useAgentStatus: vi.fn(() => ({
    isActive: false,
    agentType: null,
    modelId: null,
    modelDisplayName: null,
    version: null,
    sessionId: null,
    agentSessionId: null,
    contextWindow: null,
    cost: null,
    rateLimits: null,
    numTurns: 0,
    toolCalls: { total: 0, byType: {}, active: null },
    recentToolCalls: [],
    testRun: null,
  })),
}))

vi.mock('../terminal/services/terminalService', () => ({
  createTerminalService: vi.fn(() => ({
    spawn: vi.fn().mockResolvedValue({ sessionId: 'sess-1', pid: 1, cwd: '~' }),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onData: vi.fn((): (() => void) => (): void => {}),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onExit: vi.fn((): (() => void) => (): void => {}),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onError: vi.fn((): (() => void) => (): void => {}),
    listSessions: vi.fn().mockResolvedValue({
      activeSessionId: 'sess-1',
      sessions: [
        {
          id: 'sess-1',
          cwd: '~',
          status: {
            kind: 'Alive',
            pid: 1234,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    }),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    reorderSessions: vi.fn().mockResolvedValue(undefined),
    updateSessionCwd: vi.fn().mockResolvedValue(undefined),
    setSessionActivityPanelCollapsed: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../editor/hooks/useCodeMirror', () => ({
  useCodeMirror: vi.fn(() => ({
    editorView: null,
    updateContent: vi.fn(),
    setContainer: vi.fn(),
  })),
}))

vi.mock('../editor/hooks/useVimMode', () => ({
  useVimMode: vi.fn(() => 'NORMAL'),
}))

vi.mock('../editor/services/languageService', () => ({
  getLanguageExtension: vi.fn(() => []),
}))

vi.mock('../diff/hooks/useGitStatus', () => ({
  useGitStatus: vi.fn(() => ({
    files: [],
    filesCwd: '.',
    loading: false,
    error: null,
    refresh: vi.fn(),
    idle: false,
  })),
}))

vi.mock('../diff/hooks/useFileDiff', () => ({
  useFileDiff: vi.fn(() => ({
    response: null,
    diff: null,
    loading: false,
    error: null,
  })),
}))

vi.mock('@pierre/diffs/react', () => ({
  useWorkerPool: vi.fn(() => null),
  MultiFileDiff: vi.fn(() => <div data-testid="multi-file-diff" />),
}))

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
      unobserve = vi.fn()
    }
  )

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1200,
    height: 800,
    top: 0,
    left: 0,
    right: 1200,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: (): undefined => undefined,
  } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const readDockPanelHeight = (): number =>
  parseInt(screen.getByTestId('dock-panel').style.height, 10)

const readDockPanelWidth = (): number =>
  parseInt(screen.getByTestId('dock-panel').style.width, 10)

describe('WorkspaceView elastic resize size persistence', () => {
  test('vertical size survives dock close and reopen', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    await waitFor(() => {
      expect(screen.getByTestId('dock-panel')).toBeInTheDocument()
    })

    const handle = screen.getByTestId('resize-handle')

    const initialHeight = readDockPanelHeight()

    fireEvent.mouseDown(handle, { clientY: 500 })
    fireEvent.mouseMove(document, { clientY: 400 })
    fireEvent.mouseUp(document)

    await waitFor(() => {
      const nextHeight = readDockPanelHeight()

      expect(nextHeight).toBeGreaterThan(initialHeight)
    })

    const heightAfterResize = readDockPanelHeight()

    await user.click(screen.getByRole('button', { name: /collapse panel/i }))
    expect(screen.queryByTestId('dock-panel')).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /show panel docked bottom/i })
    )

    await waitFor(() => {
      expect(screen.getByTestId('dock-panel')).toBeInTheDocument()
    })

    const heightAfterReopen = readDockPanelHeight()

    expect(heightAfterReopen).toBe(heightAfterResize)
  })

  test('vertical and horizontal sizes are independent across position switches', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    await waitFor(() => {
      expect(screen.getByTestId('dock-panel')).toBeInTheDocument()
    })

    const initialVerticalHeight = readDockPanelHeight()

    await user.click(screen.getByRole('button', { name: /dock: right/i }))

    await waitFor(() => {
      expect(screen.getByTestId('dock-panel')).toHaveAttribute(
        'data-position',
        'right'
      )
    })

    const initialHorizontalWidth = readDockPanelWidth()

    await user.click(screen.getByRole('button', { name: /more dock actions/i }))
    await user.click(screen.getByRole('button', { name: /dock: bottom/i }))

    await waitFor(() => {
      expect(screen.getByTestId('dock-panel')).toHaveAttribute(
        'data-position',
        'bottom'
      )
    })

    const heightAfterSwitch = readDockPanelHeight()

    expect(heightAfterSwitch).toBe(initialVerticalHeight)

    await user.click(screen.getByRole('button', { name: /dock: left/i }))

    await waitFor(() => {
      expect(screen.getByTestId('dock-panel')).toHaveAttribute(
        'data-position',
        'left'
      )
    })

    const widthOnLeft = readDockPanelWidth()

    expect(widthOnLeft).toBe(initialHorizontalWidth)
  })
})
