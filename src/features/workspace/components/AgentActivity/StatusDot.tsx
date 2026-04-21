import type { ReactElement } from 'react'
import type { SessionStatus } from '../../types'
import { stateToken } from '../../../../../docs/design/tokens'

interface StatusDotProps {
  state: SessionStatus
  size?: number
  glow?: boolean
}

/**
 * StatusDot component per UNIFIED.md §5.3 and §4.1
 *
 * Renders a status indicator dot with state-specific styling:
 * - Hollow ring for idle and completed states
 * - Solid fill for running, awaiting, and errored states
 * - Pulse animation: 2s for running, 1.4s for awaiting
 * - 3-ring outer shadow glow at ~45% alpha of dot color
 */
const StatusDot = ({
  state,
  size = 8,
  glow = true,
}: StatusDotProps): ReactElement => {
  const token = stateToken[state]
  const isSolid = token.fill === 'solid'
  const hasGlow = glow && token.glow

  // Build CSS classes for the dot
  const dotClasses = [
    'rounded-full',
    'inline-block',
    'transition-all',
    'duration-300',
  ]

  // Add pulse animation if configured
  if (token.pulse) {
    dotClasses.push('animate-pulse')
  }

  // Inline styles for dynamic values
  const style: React.CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    backgroundColor: isSolid ? token.dot : 'transparent',
    border: isSolid ? 'none' : `2px solid ${token.dot}`,
    boxShadow: hasGlow
      ? `0 0 0 2px ${token.dot}40, 0 0 0 4px ${token.dot}30, 0 0 0 6px ${token.dot}20`
      : 'none',
    animationDuration: token.pulse ? `${token.pulse.durationMs}ms` : undefined,
  }

  return (
    <span
      className={dotClasses.join(' ')}
      style={style}
      data-testid="status-dot"
      data-state={state}
      aria-label={`Session ${state}`}
    />
  )
}

export default StatusDot
