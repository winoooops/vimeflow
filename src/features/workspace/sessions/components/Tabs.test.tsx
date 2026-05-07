import { describe, test, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs } from './Tabs'
import type { Session } from '../../types'

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
    <Tabs
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSelect={handlers.onSelect ?? vi.fn()}
      onClose={handlers.onClose ?? vi.fn()}
      onNew={handlers.onNew ?? vi.fn()}
    />
  )

describe('Tabs', () => {
  test('renders the strip at 38px tall per handoff §4.3', () => {
    renderTabs([buildSession()], 'sess-1')
    const strip = screen.getByTestId('session-tabs')
    expect(strip.className).toContain('h-[38px]')
  })

  test('exposes a tablist for assistive navigation', () => {
    renderTabs([buildSession()], 'sess-1')
    expect(screen.getByRole('tablist')).toHaveAccessibleName('Open sessions')
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

  test('+ button calls onNew', async () => {
    const onNew = vi.fn()
    const user = userEvent.setup()
    renderTabs([buildSession()], 'sess-1', { onNew })
    await user.click(screen.getByRole('button', { name: 'New session' }))
    expect(onNew).toHaveBeenCalledTimes(1)
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

  test('stale (non-null) activeSessionId after flushSync removeSession also falls back to the first visible tab', () => {
    // Repro: useSessionManager.removeSession uses flushSync; there's an
    // intermediate React commit where `sessions` has dropped the removed
    // session but `activeSessionId` still holds its (now-stale) id. No
    // visible tab matches activeSessionId, AND the `null` guard does
    // not fire (id is non-null-but-stale). Without the hasFocusMatch
    // tie-breaker, every tab gets tabIndex=-1 → tablist becomes
    // keyboard-unreachable for that frame.
    const sessions = [
      buildSession({ id: 'a', name: 'auth' }),
      buildSession({ id: 'b', name: 'tests' }),
    ]
    renderTabs(sessions, 'just-removed-session-x')
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
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
})
