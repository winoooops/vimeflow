import {
  act,
  type CSSProperties,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { List } from './List'
import type { Session } from '../types'

interface CapturedReorderItemHandlers {
  onPointerDownCapture?: (event: PointerEvent<HTMLLIElement>) => void
  onPointerMoveCapture?: (event: PointerEvent<HTMLLIElement>) => void
  onPointerUpCapture?: () => void
  onPointerCancelCapture?: () => void
}

const capturedReorderItemHandlers = vi.hoisted(
  (): CapturedReorderItemHandlers[] => []
)

vi.mock('framer-motion', () => {
  interface MockReorderGroupProps {
    children: ReactNode
    className?: string
    'data-testid'?: string
  }

  interface MockReorderItemProps {
    children: ReactNode
    className?: string
    style?: CSSProperties
    layout?: boolean | 'position'
    onPointerDownCapture?: (event: PointerEvent<HTMLLIElement>) => void
    onPointerMoveCapture?: (event: PointerEvent<HTMLLIElement>) => void
    onPointerUpCapture?: () => void
    onPointerCancelCapture?: () => void
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
        'data-testid': testId = undefined,
      }: MockReorderGroupProps): ReactElement => {
        capturedReorderItemHandlers.length = 0

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
        onPointerDownCapture = undefined,
        onPointerMoveCapture = undefined,
        onPointerUpCapture = undefined,
        onPointerCancelCapture = undefined,
        'data-testid': testId = undefined,
        'data-session-id': sessionId = undefined,
        'data-active': active = undefined,
      }: MockReorderItemProps): ReactElement => {
        capturedReorderItemHandlers.push({
          onPointerDownCapture,
          onPointerMoveCapture,
          onPointerUpCapture,
          onPointerCancelCapture,
        })

        return (
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
        )
      },
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
      contextWindow: { used: 0, total: 200000, percentage: 0, emoji: ':)' },
      usage: {
        sessionDuration: 0,
        turnCount: 0,
        messages: { sent: 0, limit: 200 },
        tokens: { input: 0, output: 0, total: 0 },
      },
    },
    ...overrides,
  }) as Session

const pointerEvent = ({
  button = 0,
  clientX,
  clientY,
}: {
  button?: number
  clientX: number
  clientY: number
}): PointerEvent<HTMLLIElement> =>
  ({ button, clientX, clientY }) as PointerEvent<HTMLLIElement>

describe('List reorder motion', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('enables Reorder.Item layout only during drag and settle', () => {
    vi.useFakeTimers()

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
    expect(rows[0]).toHaveAttribute('data-layout', 'false')
    expect(rows[1]).toHaveAttribute('data-layout', 'false')

    capturedReorderItemHandlers[0].onPointerDownCapture?.(
      pointerEvent({ button: 0, clientX: 0, clientY: 0 })
    )

    act(() => {
      capturedReorderItemHandlers[0].onPointerMoveCapture?.(
        pointerEvent({ clientX: 0, clientY: 3 })
      )
    })
    expect(rows[0]).toHaveAttribute('data-layout', 'false')

    act(() => {
      capturedReorderItemHandlers[0].onPointerMoveCapture?.(
        pointerEvent({ clientX: 0, clientY: 5 })
      )
    })

    const draggingRows = screen.getAllByTestId('session-row')
    expect(draggingRows[0]).toHaveAttribute('data-layout', 'position')
    expect(draggingRows[1]).toHaveAttribute('data-layout', 'position')

    act(() => {
      capturedReorderItemHandlers[0].onPointerUpCapture?.()
    })

    expect(screen.getAllByTestId('session-row')[0]).toHaveAttribute(
      'data-layout',
      'position'
    )

    act(() => {
      vi.advanceTimersByTime(260)
    })

    const settledRows = screen.getAllByTestId('session-row')
    expect(settledRows[0]).toHaveAttribute('data-layout', 'false')
    expect(settledRows[1]).toHaveAttribute('data-layout', 'false')
  })
})
