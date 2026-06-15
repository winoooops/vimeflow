// cspell:ignore winoooops
import { afterEach, describe, test, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AGENTS } from '../../../../agents/registry'
import type { AgentStatus } from '../../types'
import * as useGitStatusModule from '../../../diff/hooks/useGitStatus'
import type { UseGitStatusReturn } from '../../../diff/hooks/useGitStatus'
import {
  clearStatusSnapshots,
  readStatusScrollAnchor,
  writeStatusScrollAnchor,
} from '../../utils/statusSnapshotStore'
import { AgentStatusPanel } from '.'

const inactiveAgentStatus: AgentStatus = {
  isActive: false,
  agentExited: false,
  agentType: null,
  modelId: null,
  modelDisplayName: null,
  version: null,
  sessionId: null,
  agentSessionId: null,
  cwd: null,
  contextWindow: null,
  cost: null,
  rateLimits: null,
  numTurns: 0,
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
  testRun: null,
}

const activeAgentStatus: AgentStatus = {
  ...inactiveAgentStatus,
  isActive: true,
  agentExited: false,
  agentType: 'claude-code',
  modelId: 'claude-3-5-sonnet-20241022',
  modelDisplayName: 'Claude 3.5 Sonnet',
  sessionId: 'sess-1',
  numTurns: 4,
  contextWindow: {
    usedPercentage: 12,
    contextWindowSize: 200_000,
    totalInputTokens: 1_234,
    totalOutputTokens: 567,
    currentUsage: null,
  },
  cost: {
    totalCostUsd: 0.05,
    totalDurationMs: 60_000,
    totalApiDurationMs: 30_000,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
  },
}

vi.mock('../../../diff/hooks/useGitStatus', () => ({
  useGitStatus: (): {
    files: {
      path: string
      status: string
      insertions: number
      deletions: number
      staged: boolean
    }[]
    filesCwd: string
    loading: boolean
    error: null
    refresh: () => void
    idle: boolean
  } => ({
    files: [
      {
        path: 'a.ts',
        status: 'modified',
        insertions: 5,
        deletions: 2,
        staged: false,
      },
      {
        path: 'b.ts',
        status: 'modified',
        insertions: 7,
        deletions: 1,
        staged: false,
      },
    ],
    filesCwd: '/tmp/repo',
    loading: false,
    error: null,
    refresh: vi.fn(),
    idle: false,
  }),
}))

const defaultProps = {
  cwd: '/test',
  onOpenDiff: vi.fn(),
  agent: AGENTS.shell,
  status: 'idle' as const,
  onCollapse: (): void => undefined,
  cacheHistory: [],
}

const createGitStatus = (
  overrides: Partial<UseGitStatusReturn> = {}
): UseGitStatusReturn => ({
  files: [],
  filesCwd: '/tmp/repo',
  loading: false,
  error: null,
  refresh: vi.fn(),
  idle: false,
  ...overrides,
})

describe('AgentStatusPanel', () => {
  afterEach(() => {
    clearStatusSnapshots()
  })

  test('renders at 280px width when agent is not active', () => {
    render(
      <AgentStatusPanel {...defaultProps} agentStatus={inactiveAgentStatus} />
    )
    const panel = screen.getByTestId('agent-status-panel')
    expect(panel.style.width).toBe('280px')
  })

  test('renders at 280px width when agent is active', () => {
    render(
      <AgentStatusPanel {...defaultProps} agentStatus={activeAgentStatus} />
    )
    const panel = screen.getByTestId('agent-status-panel')
    expect(panel.style.width).toBe('280px')
  })

  test('keeps inactive context and cache placeholders mounted', () => {
    render(
      <AgentStatusPanel {...defaultProps} agentStatus={inactiveAgentStatus} />
    )

    expect(screen.getByText(/CURRENT CONTEXT/)).toBeInTheDocument()
    expect(screen.getByTestId('context-percentage')).toHaveTextContent('\u2014')
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
    expect(screen.getByText(/No activity yet/i)).toBeInTheDocument()
  })

  test('has overflow-hidden to clip content inside the fixed panel', () => {
    render(
      <AgentStatusPanel {...defaultProps} agentStatus={inactiveAgentStatus} />
    )
    const panel = screen.getByTestId('agent-status-panel')
    expect(panel).toHaveClass('overflow-hidden')
  })

  test('does not render StatusCard inside the panel', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={activeAgentStatus}
        cwd="/tmp/repo"
        onOpenDiff={vi.fn()}
      />
    )

    expect(screen.queryByTestId('agent-status-card')).not.toBeInTheDocument()
  })

  test('does not render the deprecated bottom metrics strip', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={activeAgentStatus}
        cwd="/tmp/repo"
        onOpenDiff={vi.fn()}
      />
    )

    expect(screen.queryByText('4 turns')).not.toBeInTheDocument()
    expect(screen.queryByText('1m')).not.toBeInTheDocument()
    expect(screen.queryByText('+12 / -3')).not.toBeInTheDocument()
  })

  test('uses shared git status when provided by the parent', () => {
    // Spy on the internal hook so we can assert it was called with
    // `enabled: false` — the load-bearing invariant of the lifted-state
    // refactor (parent-provided gitStatus must disable the child's
    // own watcher to prevent duplicate `start_git_watcher` IPCs).
    // The module-level `vi.mock` factory above can't satisfy this
    // assertion because it is not a `vi.fn()` — vi.spyOn here gives
    // us a proper call-args record while still falling through to the
    // module mock for the actual return shape.
    const useGitStatusSpy = vi.spyOn(useGitStatusModule, 'useGitStatus')

    try {
      render(
        <AgentStatusPanel
          {...defaultProps}
          agentStatus={activeAgentStatus}
          cwd="/tmp/repo"
          onOpenDiff={vi.fn()}
          gitStatus={{
            files: [
              {
                path: 'shared.ts',
                status: 'modified',
                insertions: 20,
                deletions: 4,
                staged: false,
              },
            ],
            filesCwd: '/tmp/repo',
            loading: false,
            error: null,
            refresh: vi.fn(),
            idle: false,
          }}
        />
      )

      expect(screen.getByText('+20 / -4')).toBeInTheDocument()
      // Watcher-deduplication invariant: when parent injects gitStatus,
      // the internal hook must run with enabled: false so no duplicate
      // start_git_watcher IPC fires.
      expect(useGitStatusSpy).toHaveBeenCalledWith(
        '/tmp/repo',
        expect.objectContaining({ enabled: false })
      )
    } finally {
      // Guarantee spy cleanup even if render() or any expect() above
      // throws — without this guard, an inline spy leaks past the
      // failing test and inflates call counts on every subsequent
      // test that consumes the same module export.
      useGitStatusSpy.mockRestore()
    }
  })

  test('renders ToolCallSummary and ActivityFeed inside the scrollable region', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={{
          ...activeAgentStatus,
          toolCalls: {
            total: 1,
            byType: { Edit: 1 },
            active: null,
          },
          recentToolCalls: [
            {
              id: 'r-1',
              tool: 'Edit',
              args: 'src/foo.ts',
              status: 'done',
              durationMs: 100,
              timestamp: '2026-04-22T11:59:42Z',
              isTestFile: false,
            },
          ],
        }}
      />
    )

    const toolCallsHeader = screen.getByRole('button', { name: /tool calls/i })

    const activityHeader = screen.getByRole('button', {
      name: /activity\s*1/i,
    })

    expect(toolCallsHeader.compareDocumentPosition(activityHeader)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  test('keeps ToolCallSummary consumer mounted alongside the ActivityFeed', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={{
          ...activeAgentStatus,
          toolCalls: {
            total: 1,
            byType: { Edit: 1 },
            active: null,
          },
          recentToolCalls: [
            {
              id: 'r-1',
              tool: 'Edit',
              args: 'src/foo.ts',
              status: 'done',
              durationMs: 100,
              timestamp: '2026-04-22T11:59:42Z',
              isTestFile: false,
            },
          ],
        }}
      />
    )

    expect(screen.getAllByText('Edit').length).toBeGreaterThan(0)
    expect(
      screen.getByRole('button', { name: /activity\s*1/i })
    ).toBeInTheDocument()
  })

  test('renders TokenCache populated with the canonical hit rate', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={{
          ...activeAgentStatus,
          contextWindow: {
            usedPercentage: 10,
            contextWindowSize: 200000,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            currentUsage: {
              inputTokens: 700,
              outputTokens: 0,
              cacheCreationInputTokens: 1800,
              cacheReadInputTokens: 7500,
            },
          },
        }}
      />
    )

    const percent = screen.getByTestId('token-cache-percent')
    expect(percent).toHaveTextContent('75')
  })

  test('renders TokenCache empty state when currentUsage is null', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={{
          ...activeAgentStatus,
          contextWindow: null,
        }}
      />
    )

    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  test('mounts TokenCache between ContextBucket and the scrollable region', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        cacheHistory={[42, 75]}
        agentStatus={{
          ...activeAgentStatus,
          contextWindow: {
            usedPercentage: 10,
            contextWindowSize: 200000,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            currentUsage: {
              inputTokens: 700,
              outputTokens: 0,
              cacheCreationInputTokens: 1800,
              cacheReadInputTokens: 7500,
            },
          },
        }}
      />
    )

    const panel = screen.getByTestId('agent-status-panel')
    const tokenCache = screen.getByTestId('token-cache')
    const context = screen.getByText(/CURRENT CONTEXT/)

    /* eslint-disable testing-library/no-node-access */
    const scrollable = panel.querySelector('.overflow-y-auto')
    expect(scrollable).not.toBeNull()

    expect(
      context.compareDocumentPosition(tokenCache) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    expect(
      tokenCache.compareDocumentPosition(scrollable as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    /* eslint-enable testing-library/no-node-access */

    // Sparkline renders when history is present.
    expect(screen.getByTestId('token-cache-sparkline')).toBeInTheDocument()
  })

  test('restores and stores the pane scroll anchor', () => {
    writeStatusScrollAnchor('pty-pane-1', 148)

    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={activeAgentStatus}
        snapshotKey="pty-pane-1"
      />
    )

    const panel = screen.getByTestId('agent-status-panel')

    /* eslint-disable testing-library/no-node-access */
    const scrollable = panel.querySelector('.overflow-y-auto')
    expect(scrollable).toBeInstanceOf(HTMLDivElement)

    const scrollContainer = scrollable as HTMLDivElement
    expect(scrollContainer.scrollTop).toBe(148)

    scrollContainer.scrollTop = 260
    fireEvent.scroll(scrollContainer)
    /* eslint-enable testing-library/no-node-access */

    expect(readStatusScrollAnchor('pty-pane-1')).toBe(260)
  })

  test('preserves the visual scroll anchor when new activity prepends above history', () => {
    const oldHistoryStatus: AgentStatus = {
      ...activeAgentStatus,
      toolCalls: {
        total: 1,
        byType: { Read: 1 },
        active: null,
      },
      recentToolCalls: [
        {
          id: 'old-read',
          tool: 'Read',
          args: 'src/old.ts',
          status: 'done',
          durationMs: 100,
          timestamp: '2026-04-22T11:59:00Z',
          isTestFile: false,
        },
      ],
    }

    const { rerender } = render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={oldHistoryStatus}
        snapshotKey="pty-pane-1"
      />
    )

    const panel = screen.getByTestId('agent-status-panel')

    /* eslint-disable testing-library/no-node-access */
    const scrollContainer = panel.querySelector('.overflow-y-auto')
    expect(scrollContainer).toBeInstanceOf(HTMLDivElement)

    let scrollHeight = 500
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })

    const scrollElement = scrollContainer as HTMLDivElement
    scrollElement.scrollTop = 120
    fireEvent.scroll(scrollElement)

    scrollHeight = 560
    rerender(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={{
          ...oldHistoryStatus,
          toolCalls: {
            total: 2,
            byType: { Read: 2 },
            active: null,
          },
          recentToolCalls: [
            {
              id: 'new-read',
              tool: 'Read',
              args: 'src/new.ts',
              status: 'done',
              durationMs: 90,
              timestamp: '2026-04-22T12:00:00Z',
              isTestFile: false,
            },
            ...oldHistoryStatus.recentToolCalls,
          ],
        }}
        snapshotKey="pty-pane-1"
      />
    )
    /* eslint-enable testing-library/no-node-access */

    expect(scrollElement.scrollTop).toBe(180)
    expect(readStatusScrollAnchor('pty-pane-1')).toBe(180)
  })

  test('compensates by total scroll growth when multiple rows prepend at once', () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight'
    )
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: 30,
    })

    const oldHistoryStatus: AgentStatus = {
      ...activeAgentStatus,
      toolCalls: {
        total: 1,
        byType: { Read: 1 },
        active: null,
      },
      recentToolCalls: [
        {
          id: 'old-read',
          tool: 'Read',
          args: 'src/old.ts',
          status: 'done',
          durationMs: 100,
          timestamp: '2026-04-22T11:59:00Z',
          isTestFile: false,
        },
      ],
    }

    const { rerender } = render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={oldHistoryStatus}
        snapshotKey="pty-pane-1"
      />
    )

    const panel = screen.getByTestId('agent-status-panel')

    /* eslint-disable testing-library/no-node-access */
    const scrollContainer = panel.querySelector('.overflow-y-auto')
    expect(scrollContainer).toBeInstanceOf(HTMLDivElement)

    let scrollHeight = 500
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })

    const scrollElement = scrollContainer as HTMLDivElement
    scrollElement.scrollTop = 120
    fireEvent.scroll(scrollElement)

    scrollHeight = 620
    rerender(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={{
          ...oldHistoryStatus,
          toolCalls: {
            total: 4,
            byType: { Read: 4 },
            active: null,
          },
          recentToolCalls: [
            {
              id: 'new-read-3',
              tool: 'Read',
              args: 'src/new3.ts',
              status: 'done',
              durationMs: 70,
              timestamp: '2026-04-22T12:02:00Z',
              isTestFile: false,
            },
            {
              id: 'new-read-2',
              tool: 'Read',
              args: 'src/new2.ts',
              status: 'done',
              durationMs: 80,
              timestamp: '2026-04-22T12:01:00Z',
              isTestFile: false,
            },
            {
              id: 'new-read-1',
              tool: 'Read',
              args: 'src/new1.ts',
              status: 'done',
              durationMs: 90,
              timestamp: '2026-04-22T12:00:00Z',
              isTestFile: false,
            },
            ...oldHistoryStatus.recentToolCalls,
          ],
        }}
        snapshotKey="pty-pane-1"
      />
    )
    /* eslint-enable testing-library/no-node-access */

    expect(scrollElement.scrollTop).toBe(240)
    expect(readStatusScrollAnchor('pty-pane-1')).toBe(240)

    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetHeight',
        originalOffsetHeight
      )
    }
  })

  test('preserves the visual scroll anchor when prepending replaces the oldest row', () => {
    const cappedHistoryStatus: AgentStatus = {
      ...activeAgentStatus,
      toolCalls: {
        total: 2,
        byType: { Read: 2 },
        active: null,
      },
      recentToolCalls: [
        {
          id: 'middle-read',
          tool: 'Read',
          args: 'src/middle.ts',
          status: 'done',
          durationMs: 100,
          timestamp: '2026-04-22T11:59:30Z',
          isTestFile: false,
        },
        {
          id: 'old-read',
          tool: 'Read',
          args: 'src/old.ts',
          status: 'done',
          durationMs: 100,
          timestamp: '2026-04-22T11:58:00Z',
          isTestFile: false,
        },
      ],
    }

    const { rerender } = render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={cappedHistoryStatus}
        snapshotKey="pty-pane-1"
      />
    )

    const panel = screen.getByTestId('agent-status-panel')

    /* eslint-disable testing-library/no-node-access */
    const scrollContainer = panel.querySelector('.overflow-y-auto')
    expect(scrollContainer).toBeInstanceOf(HTMLDivElement)

    let scrollHeight = 500
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })

    const scrollElement = scrollContainer as HTMLDivElement
    scrollElement.scrollTop = 120
    fireEvent.scroll(scrollElement)

    scrollHeight = 560
    rerender(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={{
          ...cappedHistoryStatus,
          toolCalls: {
            total: 3,
            byType: { Read: 3 },
            active: null,
          },
          recentToolCalls: [
            {
              id: 'new-read',
              tool: 'Read',
              args: 'src/new.ts',
              status: 'done',
              durationMs: 90,
              timestamp: '2026-04-22T12:00:00Z',
              isTestFile: false,
            },
            {
              id: 'middle-read',
              tool: 'Read',
              args: 'src/middle.ts',
              status: 'done',
              durationMs: 100,
              timestamp: '2026-04-22T11:59:30Z',
              isTestFile: false,
            },
          ],
        }}
        snapshotKey="pty-pane-1"
      />
    )
    /* eslint-enable testing-library/no-node-access */

    expect(scrollElement.scrollTop).toBe(180)
    expect(readStatusScrollAnchor('pty-pane-1')).toBe(180)
  })

  test('compensates by inserted row height when total scroll height does not grow', () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight'
    )
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: 60,
    })

    const cappedHistoryStatus: AgentStatus = {
      ...activeAgentStatus,
      toolCalls: {
        total: 2,
        byType: { Read: 2 },
        active: null,
      },
      recentToolCalls: [
        {
          id: 'middle-read',
          tool: 'Read',
          args: 'src/middle.ts',
          status: 'done',
          durationMs: 100,
          timestamp: '2026-04-22T11:59:30Z',
          isTestFile: false,
        },
        {
          id: 'old-read',
          tool: 'Read',
          args: 'src/old.ts',
          status: 'done',
          durationMs: 100,
          timestamp: '2026-04-22T11:58:00Z',
          isTestFile: false,
        },
      ],
    }

    const { rerender } = render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={cappedHistoryStatus}
        snapshotKey="pty-pane-1"
      />
    )

    const panel = screen.getByTestId('agent-status-panel')

    /* eslint-disable testing-library/no-node-access */
    const scrollContainer = panel.querySelector('.overflow-y-auto')
    expect(scrollContainer).toBeInstanceOf(HTMLDivElement)

    const scrollHeight = 500
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })

    const scrollElement = scrollContainer as HTMLDivElement
    scrollElement.scrollTop = 120
    fireEvent.scroll(scrollElement)

    rerender(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={{
          ...cappedHistoryStatus,
          toolCalls: {
            total: 3,
            byType: { Read: 3 },
            active: null,
          },
          recentToolCalls: [
            {
              id: 'new-read',
              tool: 'Read',
              args: 'src/new.ts',
              status: 'done',
              durationMs: 90,
              timestamp: '2026-04-22T12:00:00Z',
              isTestFile: false,
            },
            {
              id: 'middle-read',
              tool: 'Read',
              args: 'src/middle.ts',
              status: 'done',
              durationMs: 100,
              timestamp: '2026-04-22T11:59:30Z',
              isTestFile: false,
            },
          ],
        }}
        snapshotKey="pty-pane-1"
      />
    )
    /* eslint-enable testing-library/no-node-access */

    expect(scrollElement.scrollTop).toBe(180)
    expect(readStatusScrollAnchor('pty-pane-1')).toBe(180)

    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetHeight',
        originalOffsetHeight
      )
    }
  })

  test('does not adjust scroll when a lower sidebar section grows', () => {
    const emptyGitStatus = {
      files: [],
      filesCwd: '/tmp/repo',
      loading: false,
      error: null,
      refresh: vi.fn(),
      idle: false,
    }

    const { rerender } = render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        gitStatus={emptyGitStatus}
        agentStatus={activeAgentStatus}
        snapshotKey="pty-pane-1"
      />
    )

    const panel = screen.getByTestId('agent-status-panel')

    /* eslint-disable testing-library/no-node-access */
    const scrollContainer = panel.querySelector('.overflow-y-auto')
    expect(scrollContainer).toBeInstanceOf(HTMLDivElement)

    let scrollHeight = 500
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })

    const scrollElement = scrollContainer as HTMLDivElement
    scrollElement.scrollTop = 120
    fireEvent.scroll(scrollElement)

    scrollHeight = 560
    rerender(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        gitStatus={{
          ...emptyGitStatus,
          files: [
            {
              path: 'later.ts',
              status: 'modified',
              insertions: 4,
              deletions: 1,
              staged: false,
            },
          ],
        }}
        agentStatus={activeAgentStatus}
        snapshotKey="pty-pane-1"
      />
    )
    /* eslint-enable testing-library/no-node-access */

    expect(scrollElement.scrollTop).toBe(120)
    expect(readStatusScrollAnchor('pty-pane-1')).toBe(120)
  })

  test('retains the previous content body while a cold target pane is refreshing', () => {
    const richStatus: AgentStatus = {
      ...activeAgentStatus,
      sessionId: 'pty-pane-1',
      toolCalls: {
        total: 1,
        byType: { Read: 1 },
        active: null,
      },
      recentToolCalls: [
        {
          id: 'old-read',
          tool: 'Read',
          args: 'src/retained.ts',
          status: 'done',
          durationMs: 100,
          timestamp: '2026-04-22T11:59:00Z',
          isTestFile: false,
        },
      ],
    }

    const coldStatus: AgentStatus = {
      ...inactiveAgentStatus,
      sessionId: 'pty-pane-2',
    }

    const { rerender } = render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={richStatus}
        cacheHistory={[75]}
        cwd="/tmp/repo"
        gitStatus={createGitStatus()}
        snapshotKey="pty-pane-1"
      />
    )

    rerender(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={coldStatus}
        cacheHistory={[]}
        cwd="/tmp/other"
        gitStatus={createGitStatus({ filesCwd: '/tmp/other' })}
        isRefreshing
        snapshotKey="pty-pane-2"
      />
    )

    expect(
      screen.getByRole('button', { name: /activity\s*1/i })
    ).toBeInTheDocument()
    expect(screen.getByText('src/retained.ts')).toBeInTheDocument()
    expect(screen.queryByText(/No activity yet/i)).not.toBeInTheDocument()
    expect(
      screen.getByTestId('agent-status-panel-body-refresh-indicator')
    ).toBeInTheDocument()

    expect(
      screen.getByTestId('agent-status-panel-scroll-region')
    ).toHaveAttribute('data-body-phase', 'fetching')
  })

  test('releases the retained body after refresh settles', () => {
    const richStatus: AgentStatus = {
      ...activeAgentStatus,
      sessionId: 'pty-pane-1',
      toolCalls: {
        total: 1,
        byType: { Read: 1 },
        active: null,
      },
      recentToolCalls: [
        {
          id: 'old-read',
          tool: 'Read',
          args: 'src/retained.ts',
          status: 'done',
          durationMs: 100,
          timestamp: '2026-04-22T11:59:00Z',
          isTestFile: false,
        },
      ],
    }

    const coldStatus: AgentStatus = {
      ...inactiveAgentStatus,
      sessionId: 'pty-pane-2',
    }

    const { rerender } = render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={richStatus}
        cwd="/tmp/repo"
        gitStatus={createGitStatus()}
        snapshotKey="pty-pane-1"
      />
    )

    rerender(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={coldStatus}
        cwd="/tmp/other"
        gitStatus={createGitStatus({ filesCwd: '/tmp/other' })}
        isRefreshing
        snapshotKey="pty-pane-2"
      />
    )

    rerender(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={coldStatus}
        cwd="/tmp/other"
        gitStatus={createGitStatus({ filesCwd: '/tmp/other' })}
        snapshotKey="pty-pane-2"
      />
    )

    expect(screen.queryByText('src/retained.ts')).not.toBeInTheDocument()
    expect(screen.getByText(/No activity yet/i)).toBeInTheDocument()
    expect(
      screen.queryByTestId('agent-status-panel-body-refresh-indicator')
    ).not.toBeInTheDocument()

    expect(
      screen.getByTestId('agent-status-panel-scroll-region')
    ).toHaveAttribute('data-body-phase', 'fresh')
  })

  test('shows fixed body skeletons on a cold load with no retained content', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={{
          ...inactiveAgentStatus,
          sessionId: 'pty-pane-1',
        }}
        gitStatus={createGitStatus()}
        isRefreshing
        snapshotKey="pty-pane-1"
      />
    )

    expect(
      screen.getByTestId('agent-status-panel-overview-loading')
    ).toBeInTheDocument()

    expect(
      screen.getByTestId('agent-status-panel-body-loading')
    ).toBeInTheDocument()
    expect(screen.queryByText(/No activity yet/i)).not.toBeInTheDocument()
    expect(screen.getByText('Loading agent status')).toHaveAttribute(
      'aria-live',
      'polite'
    )
  })

  test('renders Header above the body with the provided agent status and onCollapse', async () => {
    const onCollapse = vi.fn()
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={inactiveAgentStatus}
        cwd="/home/x"
        agent={AGENTS.claude}
        status="idle"
        onCollapse={onCollapse}
      />
    )

    const header = screen.getByTestId('agent-status-panel-header')
    const body = screen.getByTestId('token-cache')
    expect(
      header.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    await userEvent.click(
      screen.getByRole('button', { name: /collapse activity panel/i })
    )
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  test('passes refreshing state into the fixed header affordance', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        agentStatus={activeAgentStatus}
        isRefreshing
      />
    )

    expect(screen.getByText('fetching latest')).toBeInTheDocument()
    expect(screen.getByText('Fetching latest agent status')).toHaveAttribute(
      'aria-live',
      'polite'
    )
  })
})

describe('AgentStatusPanel — live action card', () => {
  const runningEditStatus: AgentStatus = {
    ...activeAgentStatus,
    cwd: '/tmp/repo',
    toolCalls: {
      total: 1,
      byType: { Edit: 1 },
      active: {
        tool: 'Edit',
        args: 'a.ts',
        startedAt: '2026-04-22T11:59:42Z',
        toolUseId: 'live-1',
      },
    },
    recentToolCalls: [],
  }

  test('renders the NOW live-action card while a tool call is active', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        agentStatus={runningEditStatus}
      />
    )

    expect(screen.getByText('NOW')).toBeInTheDocument()
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  test('does not duplicate a running exec_command in Tool Calls and NOW', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        agentStatus={{
          ...activeAgentStatus,
          toolCalls: {
            total: 0,
            byType: {},
            active: {
              tool: 'exec_command',
              args: '{"cmd":"gh pr view 420 --repo winoooops/vimeflow"}',
              startedAt: '2026-04-22T11:59:42Z',
              toolUseId: 'cmd-1',
            },
          },
          recentToolCalls: [],
        }}
      />
    )

    expect(screen.getByTestId('live-action-card')).toBeInTheDocument()
    expect(screen.queryByTestId('active-tool-indicator')).toBeNull()
    expect(
      screen.getAllByText(/gh pr view 420 --repo winoooops\/vimeflow/)
    ).toHaveLength(1)
  })

  test('omits the live card when no tool call is active', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        agentStatus={activeAgentStatus}
      />
    )

    expect(screen.queryByText('NOW')).not.toBeInTheDocument()
    expect(screen.queryByTestId('live-action-card')).not.toBeInTheDocument()
  })

  test('moves a completed exec_command into activity history', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        agentStatus={{
          ...activeAgentStatus,
          toolCalls: {
            total: 1,
            byType: { exec_command: 1 },
            active: null,
          },
          recentToolCalls: [
            {
              id: 'cmd-1',
              tool: 'exec_command',
              args: '{"cmd":"gh pr view 420 --repo winoooops/vimeflow"}',
              status: 'done',
              durationMs: 500,
              timestamp: '2026-04-22T12:00:00Z',
              isTestFile: false,
            },
          ],
        }}
      />
    )

    expect(screen.queryByText('NOW')).not.toBeInTheDocument()
    expect(screen.queryByTestId('live-action-card')).toBeNull()
    expect(
      screen.getByRole('button', { name: /activity\s*1/i })
    ).toBeInTheDocument()

    expect(screen.getByRole('article')).toHaveTextContent(
      'gh pr view 420 --repo winoooops/vimeflow'
    )
  })

  test('does not also list the running action in the activity feed', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        agentStatus={{
          ...runningEditStatus,
          recentToolCalls: [
            {
              id: 'r-1',
              tool: 'Read',
              args: 'b.ts',
              status: 'done',
              durationMs: 100,
              timestamp: '2026-04-22T11:59:00Z',
              isTestFile: false,
            },
          ],
        }}
      />
    )

    // 1 active + 1 recent: the active row is promoted to the NOW card, so the
    // feed lists only the single recent event (count 1, not 2).
    expect(
      screen.getByRole('button', { name: /activity\s*1/i })
    ).toBeInTheDocument()
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  test('shows the real git diff counts on the live card', () => {
    render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        agentStatus={runningEditStatus}
      />
    )

    const card = screen.getByTestId('live-action-card')
    expect(within(card).getByText('+5')).toBeInTheDocument()
    expect(within(card).getByText('−2')).toBeInTheDocument()
  })

  test('clicking the live card opens the running file diff in the dock', async () => {
    const onOpenDiff = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        onOpenDiff={onOpenDiff}
        agentStatus={runningEditStatus}
      />
    )

    await user.click(screen.getByTestId('live-action-card'))

    expect(onOpenDiff).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a.ts' })
    )
  })

  test('matches by absolute tool path and opens the repo-relative diff', async () => {
    const onOpenDiff = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentStatusPanel
        {...defaultProps}
        cwd="/tmp/repo"
        onOpenDiff={onOpenDiff}
        agentStatus={{
          ...runningEditStatus,
          toolCalls: {
            total: 1,
            byType: { Edit: 1 },
            active: {
              tool: 'Edit',
              args: '/tmp/repo/a.ts',
              startedAt: '2026-04-22T11:59:42Z',
              toolUseId: 'live-abs',
            },
          },
        }}
      />
    )

    const card = screen.getByTestId('live-action-card')
    // diff counts resolve from git status despite the absolute tool path
    expect(within(card).getByText('+5')).toBeInTheDocument()

    await user.click(card)
    // opened with the repo-relative path the diff viewer requires, not absolute
    expect(onOpenDiff).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a.ts' })
    )
  })
})
