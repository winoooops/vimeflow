import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  BUILTIN_PANE_LAYOUT_REGISTRY,
  PaneLayoutRegistry,
  createGridTemplate,
} from '@/features/terminal/layout-registry'
import { mockSessions } from '../data/mockSessions'
import type { NotificationRecord } from '@/features/sessions/hooks/useNotificationCenter'
import { SessionsView } from './SessionsView'

const noop = (): void => undefined

const baseProps = {
  sessions: mockSessions,
  activeSessionId: mockSessions[0]?.id ?? null,
  onSessionClick: noop,
  onRemoveSession: noop,
  onRenameSession: noop,
  onReorderSessions: noop,
  layoutRegistry: BUILTIN_PANE_LAYOUT_REGISTRY,
}

describe('SessionsView', () => {
  test('renders the sessions List', () => {
    render(<SessionsView {...baseProps} />)

    expect(screen.getByTestId('sessions-view')).toBeInTheDocument()
    expect(screen.getByTestId('session-list')).toBeInTheDocument()
  })

  test('passes notification records to the active session list', () => {
    const notificationRecords: readonly NotificationRecord[] = [
      {
        id: 'notice-1',
        sessionId: 'sess-1',
        ptyId: 'sess-1',
        reason: 'approval-requested',
        title: 'Approval requested',
        occurredAt: 1,
        read: false,
      },
    ]

    render(
      <SessionsView {...baseProps} notificationRecords={notificationRecords} />
    )

    expect(screen.getByLabelText('Needs your attention')).toBeInTheDocument()
  })

  test('hidden=true applies the `hidden` Tailwind utility class on the testid root', () => {
    render(<SessionsView {...baseProps} hidden />)

    const root = screen.getByTestId('sessions-view')
    expect(root).toHaveClass('hidden')
    expect(root).not.toHaveClass('flex')
  })

  test('hidden=false applies the `flex` utility instead', () => {
    const hidden = false as const

    render(<SessionsView {...baseProps} hidden={hidden} />)

    const root = screen.getByTestId('sessions-view')
    expect(root).toHaveClass('flex')
    expect(root).not.toHaveClass('hidden')
  })

  test('hidden defaults to false (flex applied)', () => {
    render(<SessionsView {...baseProps} />)

    const root = screen.getByTestId('sessions-view')
    expect(root).toHaveClass('flex')
    expect(root).not.toHaveClass('hidden')
  })

  test('renders the active custom layout glyph and pane count', () => {
    render(
      <SessionsView
        {...baseProps}
        sessions={[
          {
            ...mockSessions[0],
            layout: 'custom:template-2x1',
          },
        ]}
        layoutRegistry={new PaneLayoutRegistry([createGridTemplate(2, 1)])}
      />
    )

    expect(screen.getByTestId('session-layout-glyph')).toBeInTheDocument()
    expect(screen.getByTestId('session-pane-count')).toHaveTextContent('2')
  })

  test('threads onFocusPane to active session cards', async () => {
    const onFocusPane = vi.fn()
    const user = userEvent.setup()

    render(
      <SessionsView
        {...baseProps}
        sessions={[
          {
            ...mockSessions[0],
            id: 'sess-1',
            panes: [
              {
                id: 'p1',
                ptyId: 'pty-1',
                cwd: '/tmp/project',
                agentType: 'codex',
                status: 'running',
                agentPhase: 'running',
                active: true,
              },
            ],
          },
        ]}
        onFocusPane={onFocusPane}
      />
    )
    await user.click(screen.getByRole('button', { name: /codex.*running/i }))

    expect(onFocusPane).toHaveBeenCalledWith('sess-1', 'p1')
  })
})
