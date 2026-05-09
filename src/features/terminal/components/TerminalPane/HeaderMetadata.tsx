import type { ReactElement } from 'react'
import { formatRelativeTime } from '../../../agent-status/utils/relativeTime'
import type { Session } from '../../../sessions/types'

export interface HeaderMetadataProps {
  branch: string | null
  added: number
  removed: number
  session: Session
}

export const HeaderMetadata = ({
  branch,
  added,
  removed,
  session,
}: HeaderMetadataProps): ReactElement => (
  <>
    {branch && (
      <>
        <span className="text-outline-variant/60">·</span>
        <span className="min-w-0 truncate text-on-surface-muted">{branch}</span>
      </>
    )}
    <span className="text-outline-variant/60">·</span>
    <span className="text-success">+{added}</span>
    <span className="text-error">−{removed}</span>
    <span className="text-outline-variant/60">·</span>
    <span className="whitespace-nowrap text-on-surface-muted">
      {formatRelativeTime(session.lastActivityAt)}
    </span>
  </>
)
