import {
  act,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { List } from './List'
import type { Session } from '../types'

const capturedReorderGroupHandlers = vi.hoisted(
  (): { onReorder?: (sessions: Session[]) => void } => ({})
)

vi.mock('framer-motion', () => {
  interface MockReorderGroupProps {
    children: ReactNode
    className?: string
    onReorder?: (sessions: Session[]) => void
    'data-testid'?: string
  }

  interface MockReorderItemProps {
    children: ReactNode
    className?: string
    style?: CSSProperties
    layout?: boolean | 'position'
    'data-testid'?: string
    'data-session-id'?: string
    'data-active'?: boolean
  }

  interface MockMotionDivProps {
    children: ReactNode
    className?: string
    layoutScroll?: boolean
    'data-testid'?: string
  }

  return {
    Reorder: {
      Group: ({
        children,
        className = undefined,
        onReorder = undefined,
        'data-testid': testId = undefined,
      }: MockReorderGroupProps): ReactElement => {
        capturedReorderGroupHandlers.onReorder = onReorder

        return (
          <ul className={className} data-testid={testId}>
            {children}
          </ul>
        )
      },
      Item: ({
        children,
        className = undefined,
        style = undefined,
        layout = undefined,
        'data-testid': testId = undefined,
        'data-session-id': sessionId = undefined,
        'data-active': active = undefined,
      }: MockReorderItemProps): ReactElement => (
        <li
          className={className}
          data-active={active === undefined ? undefined : String(active)}
          data-layout={layout === false ? 'false' : (layout ?? 'unset')}
          data-session-id={sessionId}
          data-testid={testId}
          style={style}
        >
          {children}
        </li>
      ),
    },
    motion: {
      div: ({
        children,
        className = undefined,
        'data-testid': testId = undefined,
      }: MockMotionDivProps): ReactElement => (
        <div className={className} data-testid={testId}>
          {children}
        </div>
      ),
    },
  }
})

const session = (overrides: Partial<Session> = {}): Session =>
  ({
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'auth middleware',
    status: 'running',
    workingDirectory: '/home/user/projects/Vimeflow',
    agentType: 'claude-code',
    layout: 'single',
    activityPanelCollapsed: false,
    terminalPid: 12345,
    panes: [
      {
        id: 'p0',
        ptyId: 'sess-1',
        cwd: '/home/user/projects/Vimeflow',
        agentType: 'claude-code',
        status: 'running',
        active: true,
        pid: 12345,
      },
    ],
    createdAt: '2026-04-07T03:45:00Z',
    lastActivityAt: '2026-04-07T03:45:00Z',
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
    ...overrides,
  }) as Session

describe('List reorder motion', () => {
  test('keeps Reorder.Item layout projection enabled while idle', () => {
    render(
      <List
        sessions={[
          session({ id: 'sess-1', name: 'first' }),
          session({ id: 'sess-2', name: 'second' }),
        ]}
        activeSessionId="sess-1"
        onSessionClick={vi.fn()}
      />
    )

    const rows = screen.getAllByTestId('session-row')

    expect(rows[0]).toHaveAttribute('data-layout', 'position')
    expect(rows[1]).toHaveAttribute('data-layout', 'position')
  })

  test('commits native reordered active rows immediately with recent suffix', () => {
    const first = session({ id: 'sess-1', name: 'first' })
    const second = session({ id: 'sess-2', name: 'second' })

    const recent = session({
      id: 'sess-3',
      name: 'recent',
      status: 'completed',
      panes: [
        {
          id: 'p0',
          ptyId: 'sess-3',
          cwd: '/home/user/projects/Vimeflow',
          agentType: 'claude-code',
          status: 'completed',
          active: true,
        },
      ],
    })
    const onReorderSessions = vi.fn<(sessions: Session[]) => void>()

    render(
      <List
        sessions={[first, second, recent]}
        activeSessionId="sess-1"
        onSessionClick={vi.fn()}
        onReorderSessions={onReorderSessions}
      />
    )

    act(() => {
      capturedReorderGroupHandlers.onReorder?.([second, first])
    })

    expect(onReorderSessions).toHaveBeenCalledTimes(1)
    const [committedSessions] = onReorderSessions.mock.calls[0]

    expect(committedSessions.map(({ id }) => id)).toEqual([
      'sess-2',
      'sess-1',
      'sess-3',
    ])
  })
})
