// cspell:ignore ghostty
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { NativeOverlayRequest } from '@/components/Popover'
import { useNotificationIslandStage } from '@/features/sessions/components/notification/useNotificationIslandStage'
import type { NotificationRecord } from '../../hooks/useNotificationCenter'
import type { Session } from '../../types'
import { NotificationIsland } from './NotificationIsland'

const session = (id: string, name: string): Session => ({
  id,
  projectId: `project-${id}`,
  name,
  open: true,
  status: 'running',
  workingDirectory: `/tmp/${id}`,
  agentType: id === 'session-2' ? 'codex' : 'claude-code',
  layout: 'single',
  panes: [
    {
      id: 'p0',
      ptyId: `pty-${id}`,
      cwd: `/tmp/${id}`,
      agentType: id === 'session-2' ? 'codex' : 'claude-code',
      status: 'running',
      active: true,
    },
  ],
  createdAt: '2026-07-31T00:00:00Z',
  lastActivityAt: '2026-07-31T00:00:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 1, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 1 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
})

const notification = (
  id: string,
  overrides: Partial<NotificationRecord> = {}
): NotificationRecord => ({
  id,
  sessionId: 'session-1',
  ptyId: 'pty-session-1',
  reason: 'turn-complete',
  title: 'Claude finished',
  body: 'Review the completed work',
  occurredAt: Date.now(),
  read: false,
  ...overrides,
})

const props = (
  records: readonly NotificationRecord[]
): React.ComponentProps<typeof NotificationIsland> => ({
  records,
  sessions: [session('session-1', 'Payments'), session('session-2', 'Search')],
  onOpen: vi.fn(),
  onDismiss: vi.fn(),
  onMarkAllRead: vi.fn(),
  onClear: vi.fn(),
  children: <span>Indicators</span>,
})

let restorePlatform: (() => void) | null = null

const setNavigatorPlatform = (platform: string): void => {
  restorePlatform?.()
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'platform')

  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  })

  restorePlatform = (): void => {
    if (original === undefined) {
      delete (window.navigator as unknown as { platform?: string }).platform

      return
    }

    Object.defineProperty(window.navigator, 'platform', original)
  }
}

const installNativeOverlayBridge = (): {
  open: ReturnType<typeof vi.fn>
  preload: ReturnType<typeof vi.fn>
  emitAction: (event: unknown) => void
} => {
  const open = vi.fn(() => Promise.resolve({ accepted: true }))
  const preload = vi.fn(() => Promise.resolve({ accepted: true }))
  let actionListener: ((event: unknown) => void) | null = null

  window.vimeflow = {
    invoke: <T,>(): Promise<T> => Promise.resolve(null as T),
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    nativeOverlay: {
      open,
      close: vi.fn(() => Promise.resolve()),
      preload,
      actionResult: vi.fn(() => Promise.resolve()),
      resume: vi.fn(() => Promise.resolve()),
      onAction: vi.fn((callback: (event: unknown) => void) => {
        actionListener = callback

        return vi.fn()
      }),
      onClose: vi.fn(() => vi.fn()),
    },
  }

  return {
    open,
    preload,
    emitAction: (event): void => actionListener?.(event),
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  restorePlatform?.()
  restorePlatform = null
  delete window.vimeflow
})

describe('NotificationIsland', () => {
  test('renders only the indicator strip before any notification exists', () => {
    render(<NotificationIsland {...props([])} />)

    expect(screen.getByText('Indicators')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Notifications/ })
    ).not.toBeInTheDocument()
  })

  test('renders the resting badge without replaying existing records as a toast', () => {
    render(
      <NotificationIsland
        {...props([
          notification('error', { reason: 'agent-error' }),
          notification('read', { read: true }),
        ])}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Notifications, 1 unread' })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Indicators')).toBeInTheDocument()
  })

  test('coalesces arrivals into one four-second toast', () => {
    vi.useFakeTimers()
    const initialProps = props([])
    const { rerender } = render(<NotificationIsland {...initialProps} />)

    rerender(
      <NotificationIsland {...initialProps} records={[notification('first')]} />
    )

    const island = screen.getByRole('navigation', { name: 'Open sessions' })
    expect(island).toHaveAttribute('data-state', 'toast')
    expect(island).toHaveStyle({ width: '380px' })
    expect(screen.getByRole('status')).toHaveTextContent('Claude finished')

    // The compressed strip drops out of the a11y tree while the toast is up.
    const indicators = within(island).getByTestId('notification-indicators')
    expect(indicators).toHaveClass('vf-notification-indicators')
    expect(indicators).toHaveAttribute('inert')
    expect(
      within(island).queryByRole('button', { name: /Notifications/ })
    ).not.toBeInTheDocument()

    rerender(
      <NotificationIsland
        {...initialProps}
        records={[
          notification('second', {
            sessionId: 'session-2',
            ptyId: 'pty-session-2',
            title: 'Codex needs approval',
            reason: 'approval-requested',
          }),
          notification('first'),
        ]}
      />
    )

    expect(screen.getByRole('status')).toHaveTextContent('Codex needs approval')
    expect(screen.getByText('+1')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Indicators')).toBeInTheDocument()
    expect(island).toHaveAttribute('data-state', 'badge')
  })

  test('resolves notification icons from the target pane', () => {
    const multiPaneSession: Session = {
      ...session('session-1', 'Payments'),
      agentType: 'claude-code',
      panes: [
        {
          id: 'claude-pane',
          ptyId: 'pty-claude',
          cwd: '/tmp/session-1',
          agentType: 'claude-code',
          status: 'running',
          active: true,
        },
        {
          id: 'codex-pane',
          ptyId: 'pty-codex',
          cwd: '/tmp/session-1',
          agentType: 'codex',
          status: 'running',
          active: false,
        },
      ],
    }

    const callbacks = {
      onOpen: vi.fn(),
      onDismiss: vi.fn(),
      onMarkAllRead: vi.fn(),
      onClear: vi.fn(),
    }

    const { result, rerender } = renderHook(
      ({ records }: { records: readonly NotificationRecord[] }) =>
        useNotificationIslandStage({
          records,
          sessions: [multiPaneSession],
          ...callbacks,
        }),
      { initialProps: { records: [] as readonly NotificationRecord[] } }
    )

    rerender({
      records: [
        notification('codex-finished', {
          ptyId: 'pty-codex',
          title: 'Codex finished',
        }),
      ],
    })

    expect(result.current.displayToast?.agent.id).toBe('codex')
    expect(result.current.panelItems[0]?.agentId).toBe('codex')
  })

  test('pauses the toast dwell while the pointer is inside', () => {
    vi.useFakeTimers()
    const initialProps = props([])
    const { rerender } = render(<NotificationIsland {...initialProps} />)

    rerender(
      <NotificationIsland {...initialProps} records={[notification('first')]} />
    )

    fireEvent.pointerEnter(screen.getByRole('status'))
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()

    fireEvent.pointerLeave(screen.getByRole('status'))
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('keeps inside pointerdown open and collapses toast on outside pointerdown', () => {
    const initialProps = props([])
    const { rerender } = render(<NotificationIsland {...initialProps} />)

    rerender(
      <NotificationIsland {...initialProps} records={[notification('first')]} />
    )

    fireEvent.pointerDown(screen.getByRole('status'))
    expect(screen.getByRole('status')).toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('keeps one mounted anchor when the toast opens the panel', async () => {
    const initialProps = props([])
    const { rerender } = render(<NotificationIsland {...initialProps} />)

    rerender(
      <NotificationIsland {...initialProps} records={[notification('first')]} />
    )

    const anchor = screen.getByRole('navigation', { name: 'Open sessions' })
    await userEvent.click(
      screen.getByRole('button', {
        name: /Open notification center for Claude finished/,
      })
    )

    expect(
      screen.getByRole('dialog', { name: 'Notification center' })
    ).toBeInTheDocument()

    expect(anchor).toHaveAttribute('data-state', 'panel')
    expect(screen.getByRole('navigation', { name: 'Open sessions' })).toBe(
      anchor
    )
  })

  test('moves focus out of the indicator strip when an arrival takes over', () => {
    const initialProps = props([notification('existing')])
    const { rerender } = render(<NotificationIsland {...initialProps} />)

    act(() => {
      screen.getByRole('button', { name: 'Notifications, 1 unread' }).focus()
    })

    rerender(
      <NotificationIsland
        {...initialProps}
        records={[notification('new'), notification('existing')]}
      />
    )

    expect(
      screen.getByRole('button', {
        name: /Open notification center for Claude finished/,
      })
    ).toHaveFocus()
  })

  test('animates only the fresh row and clears freshness after 300ms', () => {
    vi.useFakeTimers()
    const initialProps = props([])
    const { rerender } = render(<NotificationIsland {...initialProps} />)

    rerender(
      <NotificationIsland {...initialProps} records={[notification('fresh')]} />
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: /Open notification center for Claude finished/,
      })
    )

    expect(screen.getByTestId('notification-row-fresh')).toHaveClass(
      'vf-notification-row'
    )

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(screen.getByTestId('notification-row-fresh')).not.toHaveClass(
      'vf-notification-row'
    )
  })

  test('hides records whose target PTY pane no longer exists', () => {
    render(
      <NotificationIsland
        {...props([
          notification('stale', {
            ptyId: 'pty-that-was-removed',
          }),
        ])}
      />
    )

    expect(screen.getByText('Indicators')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Notifications/ })
    ).not.toBeInTheDocument()
  })

  test('keeps the panel on the floating layer above the dock (z-50)', async () => {
    render(<NotificationIsland {...props([notification('need')])} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Notifications, 1 unread' })
    )

    // The custom className replaces GLASS_SURFACE's default, which carries
    // the layer — without z-50 the portaled panel paints under the z-30 dock.
    expect(
      screen.getByRole('dialog', { name: 'Notification center' })
    ).toHaveClass('z-50')
  })

  test('does not move focus into the panel when it opens', async () => {
    render(<NotificationIsland {...props([notification('need')])} />)

    const bell = screen.getByRole('button', { name: 'Notifications, 1 unread' })
    await userEvent.click(bell)

    expect(
      screen.getByRole('dialog', { name: 'Notification center' })
    ).toBeInTheDocument()
    expect(bell).toHaveFocus()
  })

  test('closes the panel from the header close button through the exit beat', async () => {
    render(<NotificationIsland {...props([notification('need')])} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Notifications, 1 unread' })
    )

    expect(
      screen.getByRole('dialog', { name: 'Notification center' })
    ).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Close notification center' })
    )

    // The card rolls up first (intermediary exit beat), then unmounts.
    expect(
      screen.getByRole('dialog', { name: 'Notification center' })
    ).toHaveClass('vf-notification-panel-closing')

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Notification center' })
      ).not.toBeInTheDocument()
    )
  })

  test('opens the grouped panel without marking records read', async () => {
    const handlers = props([
      notification('need'),
      notification('error', {
        sessionId: 'session-2',
        ptyId: 'pty-session-2',
        reason: 'agent-error',
        title: 'Codex failed',
      }),
    ])
    render(<NotificationIsland {...handlers} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Notifications, 2 unread' })
    )

    expect(
      screen.getByRole('dialog', { name: 'Notification center' })
    ).toBeInTheDocument()

    expect(
      screen.queryByRole('heading', { name: 'Needs you' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Alerts' })).toBeVisible()
    expect(handlers.onOpen).not.toHaveBeenCalled()
    expect(handlers.onMarkAllRead).not.toHaveBeenCalled()
  })

  test('restores bell focus on dismiss but preserves terminal focus on open', async () => {
    const outside = document.createElement('button')
    outside.textContent = 'Outside'
    document.body.appendChild(outside)

    const { unmount } = render(
      <NotificationIsland {...props([notification('need')])} />
    )

    const bell = screen.getByRole('button', {
      name: 'Notifications, 1 unread',
    })
    await userEvent.click(bell)
    await userEvent.click(outside)
    outside.remove()
    await waitFor(() => expect(bell).toHaveFocus())

    unmount()

    const handlers = {
      ...props([notification('need')]),
      children: (
        <button type="button" data-testid="terminal">
          Terminal
        </button>
      ),
      onOpen: vi.fn(() => {
        screen.getByTestId('terminal').focus()
      }),
    }
    render(<NotificationIsland {...handlers} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Notifications, 1 unread' })
    )

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Open Claude finished in Payments',
      })
    )

    await waitFor(() => expect(screen.getByTestId('terminal')).toHaveFocus())
  })

  test('closes the panel on Escape without painting a focus ring on the bell', async () => {
    render(<NotificationIsland {...props([notification('need')])} />)

    const bell = screen.getByRole('button', {
      name: 'Notifications, 1 unread',
    })
    const focusSpy = vi.spyOn(bell, 'focus')

    await userEvent.click(bell)
    expect(
      screen.getByRole('dialog', { name: 'Notification center' })
    ).toBeInTheDocument()

    // userEvent's own click focused the bell with a plain focus(); only the
    // Escape-close path is under test.
    focusSpy.mockClear()

    // fireEvent, not userEvent.keyboard: the modal focus manager inerts the
    // island subtree while the panel is open, and userEvent refuses to send
    // keys to an inert focused element (a real browser still delivers Esc).
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Notification center' })
      ).not.toBeInTheDocument()
    )

    // Focus still returns to the bell, but only via focusVisible: false so
    // the keyboard focus ring never appears after an Escape close.
    await waitFor(() => expect(bell).toHaveFocus())
    expect(focusSpy).toHaveBeenCalledWith({ focusVisible: false })
    expect(focusSpy).not.toHaveBeenCalledWith()

    focusSpy.mockRestore()
  })

  test('routes row, dismiss, mark-all, and clear actions by stable id', async () => {
    const handlers = props([notification('need')])
    render(<NotificationIsland {...handlers} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Notifications, 1 unread' })
    )

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Dismiss Claude finished in Payments',
      })
    )
    expect(handlers.onDismiss).toHaveBeenCalledWith('need')

    await userEvent.click(
      screen.getByRole('button', { name: 'Mark all read (1)' })
    )
    expect(handlers.onMarkAllRead).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(handlers.onClear).toHaveBeenCalledOnce()

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Open Claude finished in Payments',
      })
    )
    await waitFor(() => expect(handlers.onOpen).toHaveBeenCalledWith('need'))
  })

  test('routes notification actions through the native Ghostty overlay', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const bridge = installNativeOverlayBridge()

    const handlers = {
      ...props([notification('need')]),
      sessions: [session('session-1', 'x'.repeat(161))],
    }

    render(<NotificationIsland {...handlers} />)

    expect(bridge.preload).toHaveBeenCalledOnce()

    await userEvent.click(
      screen.getByRole('button', { name: 'Notifications, 1 unread' })
    )

    await waitFor(() => expect(bridge.open).toHaveBeenCalledOnce())
    expect(
      screen.queryByRole('dialog', { name: 'Notification center' })
    ).not.toBeInTheDocument()

    const request = bridge.open.mock.calls[0]?.[0] as
      | NativeOverlayRequest
      | undefined
    if (request === undefined) {
      throw new Error('expected native notification center request')
    }

    expect(request).toMatchObject({
      kind: 'dialog',
      placement: 'bottom',
      payload: {
        dialog: 'notification-center',
        items: [
          {
            id: 'need',
            agentId: 'claude',
            sessionName: 'x'.repeat(160),
            openActionId: 'notification:open:need',
            dismissActionId: 'notification:dismiss:need',
          },
        ],
      },
    })

    await waitFor(() =>
      expect(
        screen.getByRole('navigation', { name: 'Open sessions' })
      ).toHaveAttribute('data-native-overlay-active', 'true')
    )

    act(() => {
      bridge.emitAction({
        surfaceId: request.surfaceId,
        actionId: 'notification:dismiss:need',
        closeOnSelect: false,
      })
    })

    expect(handlers.onDismiss).toHaveBeenCalledWith('need')
  })

  test('does not preload native overlay windows before notifications exist', () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const bridge = installNativeOverlayBridge()

    render(<NotificationIsland {...props([])} />)

    expect(bridge.preload).not.toHaveBeenCalled()
  })
})
