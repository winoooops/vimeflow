import userEvent from '@testing-library/user-event'
import { act, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { Pane, Session } from '../../sessions/types'
import * as chordRegistry from '../chordRegistry'
import { usePaneRenameChord, type FocusedPaneRef } from './usePaneRenameChord'

const mockRenameAgentSession = vi.hoisted(() => vi.fn())

vi.mock('../../../lib/backend', () => ({
  renameAgentSession: mockRenameAgentSession,
}))

const makePane = (overrides: Partial<Pane> = {}): Pane => ({
  id: 'p0',
  ptyId: 'pty-1',
  cwd: '/tmp',
  agentType: 'claude-code',
  status: 'running',
  active: true,
  activityPanelCollapsed: null,
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

const Harness = ({
  resolveFocusedPane,
}: {
  resolveFocusedPane: () => FocusedPaneRef | null
}): ReactElement => {
  const { renderNode } = usePaneRenameChord(resolveFocusedPane)

  return <>{renderNode}</>
}

describe('usePaneRenameChord', () => {
  beforeEach(() => {
    chordRegistry._resetForTest()
    mockRenameAgentSession.mockReset()
  })

  test('Ctrl+: then r with focused pane opens rename input', () => {
    const focused = makeFocusedRef({ agentTitle: 'old title' })

    render(<Harness resolveFocusedPane={() => focused} />)

    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    expect(screen.getByRole('textbox')).toHaveValue('old title')
  })

  test('chord with no focused pane is a no-op', () => {
    const { result } = renderHook(() => usePaneRenameChord(() => null))

    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    expect(result.current.renderNode).toBeNull()
  })

  test('onSubmit surfaces a does not support error inline', async () => {
    const user = userEvent.setup()
    mockRenameAgentSession.mockRejectedValueOnce(
      new Error('agent type Aider does not support /rename')
    )
    const focused = makeFocusedRef()

    render(<Harness resolveFocusedPane={() => focused} />)
    act(() => {
      chordRegistry.dispatch({ key: 'r' } as KeyboardEvent)
    })

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'new')
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "this agent doesn't support /rename"
    )
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
  })
})
