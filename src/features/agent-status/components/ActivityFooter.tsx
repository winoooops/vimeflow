import type { ReactElement } from 'react'

interface ActivityFooterProps {
  totalDurationMs: number
  numTurns: number
  linesAdded: number
  linesRemoved: number
}

const formatDuration = (ms: number): string => {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`
  }

  return `${minutes}m`
}

const formatLines = (n: number): string => n.toLocaleString('en-US')

export const ActivityFooter = ({
  totalDurationMs,
  numTurns,
  linesAdded,
  linesRemoved,
}: ActivityFooterProps): ReactElement => (
  <div className="mt-auto bg-surface-container-low/40 px-5 py-3">
    <div className="flex items-center justify-between font-mono text-[9px] text-outline">
      <span>{formatDuration(totalDurationMs)}</span>
      <span>
        {formatLines(numTurns)} {numTurns === 1 ? 'turn' : 'turns'}
      </span>
      <span>
        +{formatLines(linesAdded)} / -{formatLines(linesRemoved)}
      </span>
    </div>
  </div>
)

export { formatDuration }
