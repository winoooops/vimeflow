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

  test('tab has explicit aria-label so descendant labels do not pollute its name', () => {
    // Without aria-label on the tab, ARIA name computation accumulates
    // descendant labels — the close button's "Close <name>" and the
    // StatusDot's "Status running" would both fold into the tab's
    // computed name. An explicit aria-label pins it to just session.name.
    renderTabs([buildSession({ id: 'a', name: 'auth refactor' })], 'a')
    expect(screen.getByRole('tab')).toHaveAccessibleName('auth refactor')
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

  test('null activeSessionId falls back to the first visible tab (roving entry)', () => {
    // Without the fallback, every tab gets tabIndex=-1 and keyboard
    // users skip the entire tablist. The strip must always have one
    // entry point as long as `open` is non-empty.
    const sessions = [
      buildSession({ id: 'a', name: 'auth' }),
      buildSession({ id: 'b', name: 'tests' }),
    ]
    renderTabs(sessions, null)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
  })

  test('close buttons are always tabIndex=-1 (single Tab stop in tablist)', () => {
    // WAI-ARIA tabs §3.27: the entire tablist is exactly one Tab stop.
    // Interactive descendants (close X) are reached via Delete/Backspace
    // on the focused tab, not via Tab. Both active AND inactive close
    // buttons must be tabIndex=-1 so Tab passes through to the tabpanel.
    const sessions = [
      buildSession({ id: 'a', name: 'auth' }),
      buildSession({ id: 'b', name: 'tests' }),
    ]
    renderTabs(sessions, 'a')
    const closeBtns = screen.getAllByRole('button', { name: /^Close / })
    expect(closeBtns[0]).toHaveAttribute('tabindex', '-1')
    expect(closeBtns[1]).toHaveAttribute('tabindex', '-1')
  })

  test('Delete on the focused tab calls onClose (browser-tab convention)', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    const sessions = [buildSession({ id: 'a', name: 'auth' })]
    renderTabs(sessions, 'a', { onClose })

    const tab = screen.getByRole('tab')
    tab.focus()
    await user.keyboard('{Delete}')
    expect(onClose).toHaveBeenCalledWith('a')
  })

  test('Backspace on the focused tab also calls onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    const sessions = [buildSession({ id: 'a', name: 'auth' })]
    renderTabs(sessions, 'a', { onClose })

    const tab = screen.getByRole('tab')
    tab.focus()
    await user.keyboard('{Backspace}')
    expect(onClose).toHaveBeenCalledWith('a')
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

  test('keyboard close moves DOM focus to the new active tab (WAI-ARIA §4.4.3)', async () => {
    // Without focus restoration, the browser drops focus to <body> when
    // the close button is removed mid-render. Keyboard users would have
    // to re-Tab into the strip after every close.
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()

    const sessions = [
      buildSession({ id: 'a', name: 'auth' }),
      buildSession({ id: 'b', name: 'tests' }),
    ]
    renderTabs(sessions, 'a', { onSelect, onClose })

    const tabs = screen.getAllByRole('tab')

    const closeBtn = within(tabs[0]).getByRole('button', {
      name: /^Close auth/,
    })
    closeBtn.focus()
    await user.keyboard('{Enter}')

    expect(onClose).toHaveBeenCalledWith('a')
    expect(onSelect).toHaveBeenCalledWith('b')
    // Wait a microtask for the queueMicrotask focus call.
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve)
    })
    // The renderer mock leaves 'a' in the tablist (onClose is a vi.fn());
    // verifying focus by id avoids that mismatch — the new active tab is
    // 'b' regardless of what the parent does with the closed session.
    expect(screen.getByRole('tab', { name: 'tests' })).toHaveFocus()
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
    // Order matters: useSessionManager.removeSession uses flushSync
    // internally and applies its own setActiveSessionId mid-call. If
    // onSelect ran first, that flushSync would overwrite our visible-
    // order pick. Locking the contract so a refactor can't silently
    // re-introduce the bug.
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      onSelect.mock.invocationCallOrder[0]
    )
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

  test('ArrowLeft / ArrowRight do nothing inside a focused tab', async () => {
    // Tab-strip arrow cycling belongs on a global keybinding (see the
    // stub note in SessionTabs.tsx). Removing the in-component handler
    // keeps the focused tab stable when the user accidentally arrows
    // while focus is parked on the strip.
    const onSelect = vi.fn()
    const user = userEvent.setup()

    const sessions = [
      buildSession({ id: 'a', name: 'auth' }),
      buildSession({ id: 'b', name: 'tests' }),
    ]
    renderTabs(sessions, 'a', { onSelect })

    const tabs = screen.getAllByRole('tab')
    tabs[0].focus()
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowLeft}')

    expect(tabs[0]).toHaveFocus()
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
