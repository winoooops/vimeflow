import type { ReactElement } from 'react'
import { useAgentStatus } from '../hooks/useAgentStatus'
import { ToolCallSummary } from './ToolCallSummary'
import { RecentToolCalls } from './RecentToolCalls'
import { FilesChanged } from './FilesChanged'
import { TestResults } from './TestResults'
import { ActivityFooter } from './ActivityFooter'
import type { FileChangeItem } from './FilesChanged'

interface AgentStatusPanelProps {
  sessionId: string | null
}

// TODO: derive from tool calls in useAgentStatus hook
const placeholderFiles: FileChangeItem[] = []
const placeholderTests = { passed: 0, failed: 0, total: 0 }

export const AgentStatusPanel = ({
  sessionId,
}: AgentStatusPanelProps): ReactElement => {
  const status = useAgentStatus(sessionId)

  return (
    <div
      data-testid="agent-status-panel"
      className="flex h-full flex-col overflow-hidden bg-surface-container"
      style={{
        width: status.isActive ? '280px' : '0px',
        transition: status.isActive
          ? 'width 200ms ease-in'
          : 'width 200ms ease-out',
      }}
    >
      {/* StatusCard + BudgetMetrics — sub-spec 5 */}
      {/* ContextBucket — sub-spec 6 */}

      <div className="flex-1 overflow-y-auto">
        <ToolCallSummary
          total={status.toolCalls.total}
          byType={status.toolCalls.byType}
          active={status.toolCalls.active}
        />
        <RecentToolCalls calls={status.recentToolCalls} />
        <FilesChanged files={placeholderFiles} />
        <TestResults
          passed={placeholderTests.passed}
          failed={placeholderTests.failed}
          total={placeholderTests.total}
        />
      </div>

      <ActivityFooter
        totalDurationMs={status.cost?.totalDurationMs ?? 0}
        turnCount={0}
        linesAdded={status.cost?.totalLinesAdded ?? 0}
        linesRemoved={status.cost?.totalLinesRemoved ?? 0}
      />
    </div>
  )
}

export default AgentStatusPanel
