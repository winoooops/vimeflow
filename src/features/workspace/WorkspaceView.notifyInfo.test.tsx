import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceView } from './WorkspaceView'

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

describe('WorkspaceView × notifyInfo banner', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const dispatchPaletteCommand = async (verb: string): Promise<void> => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: ':', ctrlKey: true })
      )
    })
    await screen.findByRole('dialog')

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, verb)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
  }

  test('banner appears when :goto receives an out-of-range position', async () => {
    render(<WorkspaceView />)

    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBeGreaterThan(0)
    })

    await dispatchPaletteCommand(':goto 99')

    await waitFor(() => {
      expect(screen.getByText(/No tab at position 99/)).toBeInTheDocument()
    })
  })

  test('banner auto-dismisses after 5 seconds', async () => {
    render(<WorkspaceView />)

    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBeGreaterThan(0)
    })

    await dispatchPaletteCommand(':split-vertical')

    expect(
      screen.getByText('Split panes not yet implemented')
    ).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5001)
    })

    await waitFor(() => {
      expect(
        screen.queryByText('Split panes not yet implemented')
      ).not.toBeInTheDocument()
    })
  })

  test('banner dismisses on click', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<WorkspaceView />)

    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-pane').length).toBeGreaterThan(0)
    })

    await dispatchPaletteCommand(':split-horizontal')

    expect(
      screen.getByText('Split panes not yet implemented')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(
      screen.queryByText('Split panes not yet implemented')
    ).not.toBeInTheDocument()
  })
})
