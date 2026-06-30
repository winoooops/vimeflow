// cspell:ignore worktree
import type { ReactElement } from 'react'
import { formatRelativeTime } from '../../../agent-status/utils/relativeTime'
import { GitRefChip } from './GitRefChip'

export interface PaneStatusBarProps {
  worktreeName: string | null
  branch: string | null
  cwd?: string
  nativeOverlay?: boolean
  added: number
  removed: number
  lastActivityAt: string
}

/**
 * Minimal-height bottom bar carrying the pane's git ref, line-change deltas,
 * and last-activity time. Rendered only when the pane header is expanded.
 *
 * The bar is a size container that sheds the lowest-priority info first as it
 * narrows, so the branch is never crammed against the metadata:
 *   - < 512px: drop the LOC deltas
 *   - < 384px: drop the last-activity time
 *   - < 280px: collapse the git card to branch-only (hide the worktree segment)
 *
 * The bar never self-hides on width — the parent (index.tsx) renders it only
 * when the pane is expanded (!isCollapsed), so its visibility stays coupled to
 * the collapsed state instead of a separate width floor.
 */
export const PaneStatusBar = ({
  worktreeName,
  branch,
  cwd = undefined,
  nativeOverlay = false,
  added,
  removed,
  lastActivityAt,
}: PaneStatusBarProps): ReactElement => {
  const hasDeltas = added > 0 || removed > 0

  return (
    <div
      data-testid="terminal-pane-status-bar"
      className="flex shrink-0 items-center gap-3 border-t border-outline-variant/[0.18] px-3 py-1 font-mono text-[10.5px] [container-type:inline-size]"
    >
      {/* Ref group is hard-bounded to the leftover space and clips, so the
       * always-visible time on the right is never overlapped. */}
      <div
        data-testid="terminal-pane-status-bar-ref"
        className="flex min-w-0 flex-1 items-center overflow-hidden"
      >
        <GitRefChip
          worktreeName={worktreeName}
          branch={branch}
          cwd={cwd}
          collapsibleWorktree
          nativeOverlay={nativeOverlay}
        />
      </div>

      <div
        data-testid="terminal-pane-status-bar-meta"
        className="flex shrink-0 items-center gap-2 text-on-surface-muted"
      >
        {hasDeltas && (
          // LOC deltas drop out on a narrow pane so they never collide with a
          // clipped branch; the time below stays as the always-on cue.
          <span
            data-testid="terminal-pane-status-bar-loc"
            className="flex items-center gap-2 @max-[512px]:hidden"
          >
            <span className="text-success">+{added}</span>
            <span className="text-error">−{removed}</span>
          </span>
        )}
        <span className="whitespace-nowrap @max-[384px]:hidden">
          {formatRelativeTime(lastActivityAt)}
        </span>
      </div>
    </div>
  )
}
