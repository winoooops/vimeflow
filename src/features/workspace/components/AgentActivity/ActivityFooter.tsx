import type { AgentActivity } from '../../types'

interface ActivityFooterProps {
  activity: AgentActivity
}

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`
  }

  if (minutes > 0) {
    return `${minutes}m ${secs}s`
  }

  return `${secs}s`
}

const calculateTotalLines = (
  fileChanges: AgentActivity['fileChanges']
): { added: number; removed: number } =>
  fileChanges.reduce(
    (acc, change) => ({
      added: acc.added + change.linesAdded,
      removed: acc.removed + change.linesRemoved,
    }),
    { added: 0, removed: 0 }
  )

const ActivityFooter = ({
  activity,
}: ActivityFooterProps): React.ReactElement => {
  const { usage, fileChanges } = activity
  const duration = formatDuration(usage.sessionDuration)
  const turns = usage.turnCount === 1 ? '1 turn' : `${usage.turnCount} turns`
  const { added, removed } = calculateTotalLines(fileChanges)

  return (
    <footer
      className="flex items-center gap-2 text-on-surface/60 font-label text-sm"
      role="contentinfo"
    >
      <span>⏱ {duration}</span>
      <span>·</span>
      <span>💬 {turns}</span>
      <span>·</span>
      <span>
        +{added} -{removed}
      </span>
    </footer>
  )
}

export default ActivityFooter
