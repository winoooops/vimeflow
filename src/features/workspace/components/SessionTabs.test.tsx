import { describe, test, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionTabs } from './SessionTabs'
import type { Session } from '../types'

const buildSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'sess-1',
  projectId: 'proj-1',
  name: 'auth refactor',
  status: 'running',
  workingDirectory: '~',
  agentType: 'claude-code',
  createdAt: '2026-05-06T00:00:00Z',
  lastActivityAt: '2026-05-06T00:00:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 200_000, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 200 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
  ...overrides,
})

const renderTabs = (
  sessions: Session[],
  activeSessionId: string | null,
  handlers: Partial<{
    onSelect: (id: string) => void
    onClose: (id: string) => void
    onNew: () => void
  }> = {}
): ReturnType<typeof render> =>
  render(
    <SessionTabs
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSelect={handlers.onSelect ?? vi.fn()}
      onClose={handlers.onClose ?? vi.fn()}
      onNew={handlers.onNew ?? vi.fn()}
    />
  )

describe('SessionTabs', () => {
  test('renders the strip at 38px tall per handoff §4.3', () => {
    renderTabs([buildSession()], 'sess-1')
    const strip = screen.getByTestId('session-tabs')
    expect(strip.className).toContain('h-[38px]')
  })

  test('exposes a tablist for assistive navigation', () => {
    renderTabs([buildSession()], 'sess-1')
    expect(screen.getByRole('tablist')).toHaveAccessibleName('Open sessions')
  })

  test('each tab carries aria-controls + id pointing at its TerminalZone panel', () => {
    renderTabs([buildSession({ id: 'sess-x' })], 'sess-x')
    const tab = screen.getByRole('tab')
    expect(tab).toHaveAttribute('id', 'session-tab-sess-x')
    expect(tab).toHaveAttribute('aria-controls', 'session-panel-sess-x')
  })

  test('tablist owns ONLY tab children (WAI-ARIA §3.27)', () => {
    // The "+" button and trailing flex spacer must live OUTSIDE the
    // tablist so screen readers don't iterate them in the arrow-key
    // cycle as fourth/fifth tabs.
    renderTabs(
      [
        buildSession({ id: 'a', name: 'auth' }),
        buildSession({ id: 'b', name: 'tests' }),
      ],
      'a'
    )
    const tablist = screen.getByRole('tablist')
    const newSessionBtn = screen.getByRole('button', { name: 'New session' })

    expect(within(tablist).getAllByRole('tab')).toHaveLength(2)
    expect(
      within(tablist).queryByRole('button', { name: 'New session' })
    ).toBeNull()
    expect(tablist.contains(newSessionBtn)).toBe(false)
  })

  test('renders one tab per open session (running + paused)', () => {
    const sessions: Session[] = [
      buildSession({ id: 'a', status: 'running', name: 'auth' }),
      buildSession({ id: 'b', status: 'paused', name: 'tests' }),
      buildSession({ id: 'c', status: 'completed', name: 'closed' }),
      buildSession({ id: 'd', status: 'errored', name: 'broken' }),
    ]
    renderTabs(sessions, 'a')
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveTextContent('auth')
    expect(tabs[1]).toHaveTextContent('tests')
  })

  test('marks the active tab with aria-selected and the lift offset', () => {
    const sessions = [
      buildSession({ id: 'a', name: 'auth' }),
      buildSession({ id: 'b', name: 'tests' }),
    ]
    renderTabs(sessions, 'b')
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    // Active tab uses negative margin-bottom to lift into the canvas below.
    expect(tabs[1].className).toContain('-mb-px')
  })

  test('active tab paints the agent accent stripe along the top', () => {
    const sessions = [buildSession({ id: 'a', agentType: 'codex' })]
    renderTabs(sessions, 'a')
    const tab = screen.getByRole('tab')

    const stripe = within(tab)
      .getAllByText('', { selector: '[aria-hidden="true"]' })
      .find((el): el is HTMLSpanElement => el.tagName === 'SPAN')

    expect(stripe).toBeDefined()
    // codex accent #7defa1 → rgb(125,239,161); inline so color follows agent.
    expect(stripe?.style.background).toBe('rgb(125, 239, 161)')
  })

  test('clicking a tab calls onSelect with the session id', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    const sessions = [
      buildSession({ id: 'a', name: 'auth' }),
      buildSession({ id: 'b', name: 'tests' }),
    ]
    renderTabs(sessions, 'a', { onSelect })
    await user.click(screen.getAllByRole('tab')[1])
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  test('close button calls onClose without selecting the tab', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    const sessions = [buildSession({ id: 'a', name: 'auth' })]
    renderTabs(sessions, 'a', { onSelect, onClose })

    const closeBtn = within(screen.getByRole('tab')).getByRole('button', {
      name: /close auth/i,
    })
    await user.click(closeBtn)
    expect(onClose).toHaveBeenCalledWith('a')
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('+ button calls onNew', async () => {
    const onNew = vi.fn()
    const user = userEvent.setup()
    renderTabs([buildSession()], 'sess-1', { onNew })
    await user.click(screen.getByRole('button', { name: 'New session' }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  test('keyboard activation: Enter/Space on a focused tab calls onSelect', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    const sessions = [
      buildSession({ id: 'a', name: 'auth' }),
      buildSession({ id: 'b', name: 'tests' }),
    ]
    renderTabs(sessions, 'a', { onSelect })

    const inactiveTab = screen.getAllByRole('tab')[1]
    inactiveTab.focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenLastCalledWith('b')

    await user.keyboard(' ')
    expect(onSelect).toHaveBeenLastCalledWith('b')
  })

  test('only the active tab carries tabIndex=0 (roving focus)', () => {
    const sessions = [
      buildSession({ id: 'a', name: 'auth' }),
      buildSession({ id: 'b', name: 'tests' }),
    ]
    renderTabs(sessions, 'a')
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
  })

  test('inactive tab close button is removed from the natural Tab order', () => {
    // Roving tabindex must extend to interactive descendants — otherwise
    // Tab navigation lands on close buttons of tabs the user can't see.
    const sessions = [
      buildSession({ id: 'a', name: 'auth' }),
      buildSession({ id: 'b', name: 'tests' }),
    ]
    renderTabs(sessions, 'a')
    const closeBtns = screen.getAllByRole('button', { name: /^Close / })
    expect(closeBtns[0]).toHaveAttribute('tabindex', '0')
    expect(closeBtns[1]).toHaveAttribute('tabindex', '-1')
  })

  test('renders a status pip alongside the running session title', () => {
    const sessions = [buildSession({ id: 'a', status: 'running' })]
    renderTabs(sessions, 'a')
    const tab = screen.getByRole('tab')
    const pip = within(tab).getByTestId('status-dot')
    expect(pip).toHaveAttribute('data-status', 'running')
  })

  test('agent glyph chip shows the registry glyph (claude → ∴)', () => {
    renderTabs([buildSession({ agentType: 'claude-code' })], 'sess-1')
    const tab = screen.getByRole('tab')
    expect(within(tab).getByText('∴')).toBeInTheDocument()
  })

  test('falls back to shell glyph for unknown agent types (generic)', () => {
    renderTabs([buildSession({ agentType: 'generic' })], 'sess-1')
    const tab = screen.getByRole('tab')
    expect(within(tab).getByText('$')).toBeInTheDocument()
  })

  test('with no open sessions and no active id, only the + button renders', () => {
    const sessions = [
      buildSession({ id: 'a', status: 'completed' }),
      buildSession({ id: 'b', status: 'errored' }),
    ]
    renderTabs(sessions, null)
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(
      screen.getByRole('button', { name: 'New session' })
    ).toBeInTheDocument()
  })

  test('closing the active tab pre-selects the next VISIBLE tab', async () => {
    // Without pre-select, useSessionManager's fallback can land on a
    // hidden completed/errored session that sits between two open
    // ones in the underlying sessions array. Pre-select keeps the
    // selection on a tab the user can actually see.
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()

    const sessions = [
      buildSession({ id: 'C', status: 'running', name: 'first' }),
      buildSession({ id: 'B', status: 'completed', name: 'hidden recent' }),
      buildSession({ id: 'A', status: 'running', name: 'last' }),
    ]
    renderTabs(sessions, 'C', { onSelect, onClose })

    const closeC = within(screen.getAllByRole('tab')[0]).getByRole('button', {
      name: /close first/i,
    })
    await user.click(closeC)

    // Visible-order next tab is 'A' (B is filtered out of the strip).
    expect(onSelect).toHaveBeenCalledWith('A')
    expect(onClose).toHaveBeenCalledWith('C')
  })

  test('closing an inactive tab does NOT change selection', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()

    const sessions = [
      buildSession({ id: 'a', name: 'auth' }),
      buildSession({ id: 'b', name: 'tests' }),
    ]
    renderTabs(sessions, 'a', { onSelect, onClose })

    const closeB = within(screen.getAllByRole('tab')[1]).getByRole('button', {
      name: /close tests/i,
    })
    await user.click(closeB)

    expect(onClose).toHaveBeenCalledWith('b')
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('keeps the active session in the strip even after its PTY exits', () => {
    // useSessionManager keeps activeSessionId on a session whose PTY
    // exited so TerminalZone can show the Restart pane. Dropping that
    // tab would leave the visible pane with no selected tab.
    const sessions = [
      buildSession({ id: 'a', status: 'completed', name: 'just exited' }),
      buildSession({ id: 'b', status: 'running', name: 'still alive' }),
    ]
    renderTabs(sessions, 'a')
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveTextContent('just exited')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })

  test('ArrowRight moves DOM focus only — does not switch the active session', async () => {
    // Manual-activation pattern (WAI-ARIA tabs): arrow keys move focus
    // for scanning; Enter/Space commits the activation.
    const onSelect = vi.fn()
    const user = userEvent.setup()

    const sessions = [
      buildSession({ id: 'a', name: 'auth' }),
      buildSession({ id: 'b', name: 'tests' }),
      buildSession({ id: 'c', name: 'docs' }),
    ]
    renderTabs(sessions, 'a', { onSelect })

    const tabs = screen.getAllByRole('tab')
    tabs[0].focus()
    await user.keyboard('{ArrowRight}')

    expect(tabs[1]).toHaveFocus()
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('ArrowLeft wraps focus to the last tab without activating it', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    const sessions = [
      buildSession({ id: 'a', name: 'auth' }),
      buildSession({ id: 'b', name: 'tests' }),
      buildSession({ id: 'c', name: 'docs' }),
    ]
    renderTabs(sessions, 'a', { onSelect })

    const tabs = screen.getAllByRole('tab')
    tabs[0].focus()
    await user.keyboard('{ArrowLeft}')

    expect(tabs[2]).toHaveFocus()
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('Enter on a focused inactive tab activates it (manual activation)', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    const sessions = [
      buildSession({ id: 'a', name: 'auth' }),
      buildSession({ id: 'b', name: 'tests' }),
    ]
    renderTabs(sessions, 'a', { onSelect })

    const tabs = screen.getAllByRole('tab')
    // Simulate user arrow-keying to inactive tab and pressing Enter.
    tabs[1].focus()
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith('b')
  })

  test('Enter on a focused close button closes that tab without re-selecting', async () => {
    // Cycle-3 P2: child key events were bubbling to the parent tab
    // handler, so Enter on the close X also called onSelect and
    // prevented the close. Now: tab handler ignores bubbled keys.
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()

    renderTabs([buildSession({ id: 'a', name: 'auth' })], 'a', {
      onSelect,
      onClose,
    })

    const closeBtn = within(screen.getByRole('tab')).getByRole('button', {
      name: /close auth/i,
    })
    closeBtn.focus()
    await user.keyboard('{Enter}')

    expect(onClose).toHaveBeenCalledWith('a')
    expect(onSelect).not.toHaveBeenCalled()
  })
})
