import type { ReactElement } from 'react'
import type { Session } from '../../types'
import StatusCard from './StatusCard'
import PinnedMetrics from './PinnedMetrics'
import FilesChanged from './FilesChanged'
import ToolCalls from './ToolCalls'
import Tests from './Tests'
import ActivityFooter from './ActivityFooter'

interface AgentActivityProps {
  session: Session | undefined
}

const AgentActivity = ({ session }: AgentActivityProps): ReactElement => {
  // Render empty state when no session is active
  if (!session) {
    return (
      <div
        data-testid="agent-activity"
        className="w-[280px] h-full bg-surface-container-low flex flex-col items-center justify-center p-4"
      >
        <p className="text-on-surface-variant text-sm">No active session</p>
      </div>
    )
  }

  const { activity } = session

  return (
    <div
      data-testid="agent-activity"
      className="w-[280px] h-full bg-surface-container-low flex flex-col gap-4 p-4 overflow-y-auto"
    >
      <StatusCard session={session} />
      <PinnedMetrics activity={activity} />
      <FilesChanged fileChanges={activity.fileChanges} />
      <ToolCalls toolCalls={activity.toolCalls} />
      <Tests testResults={activity.testResults} />
      <ActivityFooter activity={activity} />
    </div>
  )
}

export default AgentActivity
