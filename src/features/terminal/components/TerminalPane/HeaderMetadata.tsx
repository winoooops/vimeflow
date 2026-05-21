// cspell:ignore worktree
import type { ReactElement } from 'react'
import { formatRelativeTime } from '../../../agent-status/utils/relativeTime'
import type { Session } from '../../../sessions/types'

export interface HeaderMetadataProps {
  worktreeName: string | null
  branch: string | null
  added: number
  removed: number
  session: Session
}

export const HeaderMetadata = ({
  worktreeName,
  branch,
  added,
  removed,
  session,
}: HeaderMetadataProps): ReactElement => {
  const hasWorktree = worktreeName !== null && worktreeName.length > 0
  const hasBranch = branch !== null && branch.length > 0
  const hasDeltas = added > 0 || removed > 0
  const hasLeadingMetadata = hasWorktree || hasBranch || hasDeltas

  return (
    <>
      {hasWorktree && (
        <>
          <span className="text-outline-variant/60">·</span>
          <span
            data-testid="worktree-chip"
            title={`worktree: ${worktreeName}`}
            className="inline-flex min-w-0 items-center gap-1 truncate text-on-surface-muted"
          >
            <span aria-hidden="true">🌲</span>
            <span className="truncate">{worktreeName}</span>
          </span>
        </>
      )}
      {hasBranch && (
        <>
          <span className="text-outline-variant/60">·</span>
          <span className="min-w-0 truncate text-on-surface-muted">
            {branch}
          </span>
        </>
      )}
      {hasDeltas && (
        <>
          <span className="text-outline-variant/60">·</span>
          <span className="text-success">+{added}</span>
          <span className="text-error">−{removed}</span>
        </>
      )}
      {hasLeadingMetadata && <span className="text-outline-variant/60">·</span>}
      <span className="whitespace-nowrap text-on-surface-muted">
        {formatRelativeTime(session.lastActivityAt)}
      </span>
    </>
  )
}
