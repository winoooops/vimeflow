// cspell:ignore worktree
import type { ReactElement } from 'react'
import { formatRelativeTime } from '../../../agent-status/utils/relativeTime'
import type { Session } from '../../../sessions/types'
import { GitRefChip } from './GitRefChip'

export interface HeaderMetadataProps {
  worktreeName: string | null
  branch: string | null
  cwd?: string
  added: number
  removed: number
  session: Session
}

export const HeaderMetadata = ({
  worktreeName,
  branch,
  cwd = undefined,
  added,
  removed,
  session,
}: HeaderMetadataProps): ReactElement => {
  const hasGitRef = branch !== null && branch.length > 0
  const hasDeltas = added > 0 || removed > 0
  const hasLeadingMetadata = hasGitRef || hasDeltas

  return (
    <>
      {hasGitRef && (
        <>
          <span className="text-outline-variant/60">·</span>
          <GitRefChip worktreeName={worktreeName} branch={branch} cwd={cwd} />
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
