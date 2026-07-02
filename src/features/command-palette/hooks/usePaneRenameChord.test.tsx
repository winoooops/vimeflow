// cspell:ignore Ghostty ghostty
import userEvent from '@testing-library/user-event'
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ReactElement } from 'react'
import { AgentRenameError } from '../../../lib/backend'
import type { Pane, Session } from '../../sessions/types'
import * as chordRegistry from '../chordRegistry'
import { usePaneRenameChord, type FocusedPaneRef } from './usePaneRenameChord'

const mockRenameAgentSession = vi.hoisted(() => vi.fn())

const mockFocusNativeGhostty = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(true))
)

vi.mock('../../../lib/backend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/backend')>()

  return {
    ...actual,
    renameAgentSession: mockRenameAgentSession,
  }
})

vi.mock('../../terminal/nativeGhosttyClient', () => ({
  focusNativeGhostty: mockFocusNativeGhostty,
}))

const makePane = (overrides: Partial<Pane> = {}): Pane => ({
  id: 'p0',
  ptyId: 'pty-1',
  cwd: '/tmp',
  agentType: 'claude-code',
  status: 'running',
  active: true,
  ...overrides,
})

const makeSession = (pane: Pane): Session => ({
  id: 's0',
  projectId: 'p1',
  name: 'fallback-name',
  status: 'running',
  workingDirectory: '/tmp',
  agentType: pane.agentType,
  layout: 'single',
  activityPanelCollapsed: false,
  panes: [pane],
  createdAt: '2026-05-08T10:00:00Z',
  lastActivityAt: '2026-05-08T11:55:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 200 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
})

const makeFocusedRef = (paneOverrides: Partial<Pane> = {}): FocusedPaneRef => {
  const pane = makePane(paneOverrides)

  return { pane, session: makeSession(pane) }
}

const mockSetPaneUserLabel = vi.fn()

interface SetPaneUserLabelOptions {
  ifCurrentLabel?: string | undefined
}

type SetPaneUserLabel = (
  ptyId: string,
  label: string | undefined,
  options?: SetPaneUserLabelOptions
) => void

const Harness = ({
  resolveFocusedPane,
  setPaneUserLabel = mockSetPaneUserLabel,
}: {
  resolveFocusedPane: () => FocusedPaneRef | null
  setPaneUserLabel?: SetPaneUserLabel
}): ReactElement => {
  const { renderNode } = usePaneRenameChord(
    resolveFocusedPane,
    setPaneUserLabel
  )

  return <>{renderNode}</>
}

describe('usePaneRenameChord', () => {
  beforeEach(() => {
    chordRegistry._resetForTest()
    mockRenameAgentSession.mockReset()
    mockFocusNativeGhostty.mockClear()
    mockSetPaneUserLabel.mockReset()
  })

  test('palette toggle then r with focused pane opens rename input', () => {
    const focused = makeFocusedRef({ agentTitle: 'old title' })

    render(<Harness resolveFocusedPane={() => focused} />)

    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    expect(screen.getByRole('textbox')).toHaveValue('old title')
  })

  test('chord with no focused pane is a no-op', () => {
    const { result } = renderHook(() =>
      usePaneRenameChord(() => null, mockSetPaneUserLabel)
    )

    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    expect(result.current.renderNode).toBeNull()
  })

  test('openPaneRename opens rename input for an explicit pane', () => {
    const focused = makeFocusedRef({ agentTitle: 'explicit title' })

    const { result } = renderHook(() =>
      usePaneRenameChord(() => null, mockSetPaneUserLabel)
    )

    act(() => {
      expect(result.current.openPaneRename(focused)).toBe(true)
    })

    render(<>{result.current.renderNode}</>)

    expect(screen.getByRole('textbox')).toHaveValue('explicit title')
  })

  test('onSubmit suppresses expected unsupported-agent failure for local-only panes', async () => {
    const user = userEvent.setup()
    mockRenameAgentSession.mockRejectedValueOnce(
      new AgentRenameError(
        'agent type Aider does not support /rename',
        'unsupported-agent'
      )
    )
    const focused = makeFocusedRef({ agentType: 'aider' })

    render(<Harness resolveFocusedPane={() => focused} />)
    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'new')
    await user.keyboard('{Enter}')

    expect(mockSetPaneUserLabel).toHaveBeenCalledWith('pty-1', 'new')
    expect(mockRenameAgentSession).toHaveBeenCalledWith('pty-1', 'new')

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('onSubmit rolls back no-live-agent failure for rename-capable panes', async () => {
    const user = userEvent.setup()
    mockRenameAgentSession.mockRejectedValueOnce(
      new AgentRenameError('no live agent', 'no-live-agent')
    )

    const focused = makeFocusedRef({
      agentType: 'claude-code',
      ptyId: 'pty-claude',
    })

    render(<Harness resolveFocusedPane={() => focused} />)
    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'new')
    await user.keyboard('{Enter}')

    expect(mockSetPaneUserLabel).toHaveBeenCalledWith('pty-claude', 'new')
    expect(mockRenameAgentSession).toHaveBeenCalledWith('pty-claude', 'new')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'failed to send /rename: no live agent'
    )
    expect(screen.getByRole('alert')).toHaveClass('sr-only')
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')

    expect(mockSetPaneUserLabel).toHaveBeenLastCalledWith(
      'pty-claude',
      undefined,
      { ifCurrentLabel: 'new' }
    )
  })

  test('blur during pending submit preserves inline IPC failure until cancel', async () => {
    const user = userEvent.setup()
    let rejectRename: ((error: Error) => void) | null = null
    mockRenameAgentSession.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectRename = reject
      })
    )
    const focused = makeFocusedRef()

    render(<Harness resolveFocusedPane={() => focused} />)
    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    const input = screen.getByRole('textbox')
    await user.tripleClick(input)
    await user.keyboard('new-title{Enter}')

    act(() => {
      input.blur()
    })

    expect(screen.getByRole('textbox')).toBeInTheDocument()

    await act(async () => {
      if (!rejectRename) {
        throw new Error('rename promise reject was not captured')
      }
      rejectRename(new Error('pty write failed'))
      await Promise.resolve()
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'failed to send /rename: pty write failed'
    )
    expect(screen.getByRole('alert')).toHaveClass('sr-only')

    expect(mockSetPaneUserLabel).toHaveBeenLastCalledWith('pty-1', undefined, {
      ifCurrentLabel: 'new-title',
    })

    const failedInput = screen.getByRole('textbox')
    failedInput.focus()
    act(() => {
      failedInput.blur()
    })

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveClass('sr-only')

    screen.getByRole('textbox').focus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('duplicate submit while rename is pending sends one backend request', async () => {
    const user = userEvent.setup()
    let resolveRename: (() => void) | null = null
    mockRenameAgentSession.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRename = resolve
      })
    )
    const focused = makeFocusedRef()

    render(<Harness resolveFocusedPane={() => focused} />)
    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    const input = screen.getByRole('textbox')
    await user.tripleClick(input)
    await user.keyboard('new-title{Enter}{Enter}')

    expect(mockSetPaneUserLabel).toHaveBeenCalledTimes(1)
    expect(mockSetPaneUserLabel).toHaveBeenCalledWith('pty-1', 'new-title')
    expect(mockRenameAgentSession).toHaveBeenCalledTimes(1)
    expect(mockRenameAgentSession).toHaveBeenCalledWith('pty-1', 'new-title')

    await act(async () => {
      if (!resolveRename) {
        throw new Error('rename promise resolve was not captured')
      }
      resolveRename()
      await Promise.resolve()
    })
  })

  test('chord during pending submit does not switch rename targets', async () => {
    const user = userEvent.setup()
    let resolveRename: (() => void) | null = null
    mockRenameAgentSession.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRename = resolve
      })
    )
    let focused = makeFocusedRef({
      ptyId: 'pty-1',
      agentTitle: 'first-title',
    })

    render(<Harness resolveFocusedPane={() => focused} />)
    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    const input = screen.getByRole('textbox')
    await user.tripleClick(input)
    await user.keyboard('submitted-title{Enter}')

    focused = makeFocusedRef({
      ptyId: 'pty-2',
      agentTitle: 'second-title',
    })

    let wasHandled = true
    act(() => {
      wasHandled = chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    expect(wasHandled).toBe(false)
    expect(screen.getByRole('textbox')).toHaveValue('submitted-title')

    await act(async () => {
      if (!resolveRename) {
        throw new Error('rename promise resolve was not captured')
      }
      resolveRename()
      await Promise.resolve()
    })

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  test('rejected submit does not clear a newer user label', async () => {
    const user = userEvent.setup()
    let rejectRename: ((error: Error) => void) | null = null
    let currentLabel: string | undefined

    const setPaneUserLabel = vi.fn<SetPaneUserLabel>(
      (ptyId, label, options): void => {
        void ptyId
        if (
          options !== undefined &&
          'ifCurrentLabel' in options &&
          currentLabel !== options.ifCurrentLabel
        ) {
          return
        }

        const trimmed = label?.trim()
        currentLabel = trimmed && trimmed.length > 0 ? trimmed : undefined
      }
    )

    mockRenameAgentSession.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectRename = reject
      })
    )

    const focused = makeFocusedRef({
      ptyId: 'pty-1',
      agentTitle: 'first-title',
    })

    render(
      <Harness
        resolveFocusedPane={() => focused}
        setPaneUserLabel={setPaneUserLabel}
      />
    )

    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    const input = screen.getByRole('textbox')
    await user.tripleClick(input)
    await user.keyboard('submitted-title{Enter}')

    expect(currentLabel).toBe('submitted-title')
    currentLabel = 'palette-title'

    await act(async () => {
      if (!rejectRename) {
        throw new Error('rename promise reject was not captured')
      }
      rejectRename(new Error('pty write failed'))
      await Promise.resolve()
    })

    expect(currentLabel).toBe('palette-title')
    expect(setPaneUserLabel).toHaveBeenLastCalledWith('pty-1', undefined, {
      ifCurrentLabel: 'submitted-title',
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'failed to send /rename: pty write failed'
    )
    expect(screen.getByRole('alert')).toHaveClass('sr-only')
  })

  test('cancel clears the rename target', async () => {
    const user = userEvent.setup()
    const focused = makeFocusedRef()

    render(<Harness resolveFocusedPane={() => focused} />)
    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    screen.getByRole('textbox').focus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(mockFocusNativeGhostty).toHaveBeenCalledWith({
      sessionId: 'pty-1',
      paneId: 'p0',
    })
  })

  test('successful submit restores native pane focus', async () => {
    const user = userEvent.setup()
    mockRenameAgentSession.mockResolvedValueOnce(undefined)
    const focused = makeFocusedRef({ ptyId: 'pty-submit' })

    render(<Harness resolveFocusedPane={() => focused} />)
    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    const input = screen.getByRole('textbox')
    await user.tripleClick(input)
    await user.keyboard('renamed{Enter}')

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    expect(mockFocusNativeGhostty).toHaveBeenCalledWith({
      sessionId: 'pty-submit',
      paneId: 'p0',
    })
  })

  test('shell pane asks backend and suppresses no-live-agent failure', async () => {
    const user = userEvent.setup()
    mockRenameAgentSession.mockRejectedValueOnce(
      new AgentRenameError('no live agent', 'no-live-agent')
    )

    const focused = makeFocusedRef({
      ptyId: 'pty-shell',
      agentType: 'generic',
    })

    render(<Harness resolveFocusedPane={() => focused} />)
    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    const input = screen.getByRole('textbox')
    await user.tripleClick(input)
    await user.keyboard('add{Enter}')

    expect(mockSetPaneUserLabel).toHaveBeenCalledWith('pty-shell', 'add')
    expect(mockRenameAgentSession).toHaveBeenCalledWith('pty-shell', 'add')

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('submit asks backend even while focused pane still looks generic', async () => {
    const user = userEvent.setup()
    mockRenameAgentSession.mockRejectedValueOnce(
      new AgentRenameError('no live agent', 'no-live-agent')
    )

    const focused = makeFocusedRef({
      ptyId: 'pty-race',
      agentType: 'generic',
    })

    render(<Harness resolveFocusedPane={() => focused} />)
    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    const input = screen.getByRole('textbox')
    await user.tripleClick(input)
    await user.keyboard('race-fixed{Enter}')

    expect(mockSetPaneUserLabel).toHaveBeenCalledWith('pty-race', 'race-fixed')
    expect(mockRenameAgentSession).toHaveBeenCalledWith(
      'pty-race',
      'race-fixed'
    )

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })
  })

  test('claude pane sets userLabel AND calls renameAgentSession', async () => {
    const user = userEvent.setup()
    mockRenameAgentSession.mockResolvedValueOnce(undefined)

    const focused = makeFocusedRef({
      ptyId: 'pty-claude',
      agentType: 'claude-code',
    })

    render(<Harness resolveFocusedPane={() => focused} />)
    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    const input = screen.getByRole('textbox')
    await user.tripleClick(input)
    await user.keyboard('my-feature{Enter}')

    expect(mockSetPaneUserLabel).toHaveBeenCalledWith(
      'pty-claude',
      'my-feature'
    )

    expect(mockRenameAgentSession).toHaveBeenCalledWith(
      'pty-claude',
      'my-feature'
    )
  })
})
