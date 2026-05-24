// cspell:ignore worktree
import type { ReactElement } from 'react'
import { Tooltip } from '../../../../components/Tooltip'

export interface GitRefChipProps {
  /** Linked-worktree basename, or null when on the main checkout. */
  worktreeName: string | null
  /** Branch name (PR-A) — or short SHA when HEAD is detached. */
  branch: string | null
  /** Absolute path of the pane's cwd; rendered home-relative in the tooltip. */
  cwd?: string
  /** PR-A: optional, always defaults to false. PR-B wires the live value. */
  detached?: boolean
}

/**
 * Replace a leading `/home/<user>/` or `/Users/<user>/` prefix with `~/` so
 * the tooltip's cwd line stays readable. Anything else (relative paths,
 * Windows paths, system-root paths) passes through unchanged.
 */
const formatCwdRelative = (cwd: string): string => {
  // The capture group requires at least one char after the username segment
  // (so `/home/will` with no trailing slash is left as-is, while `/home/will/`
  // and `/home/will/foo` both produce `~/` and `~/foo`).
  const homeMatch = /^\/(?:home|Users)\/[^/]+(\/.*)$/.exec(cwd)
  if (homeMatch === null) {
    return cwd
  }

  return '~' + homeMatch[1]
}

/**
 * Compose the chip's tooltip lines. Exported so the four-state wording stays
 * locked in via a pure-function unit test — asserting the rendered floating
 * surface would require driving floating-ui's hover state.
 *
 * Line order: worktree (if any), branch (or detached HEAD), cwd (if any).
 */
export const composeTooltipLines = (
  worktreeName: string | null,
  branch: string,
  cwd: string | null,
  detached: boolean
): string[] => {
  const lines: string[] = []
  if (worktreeName !== null && worktreeName.length > 0) {
    lines.push(`worktree: ${worktreeName}`)
  }
  lines.push(`${detached ? 'detached HEAD' : 'branch'}: ${branch}`)
  if (cwd !== null && cwd.length > 0) {
    lines.push(formatCwdRelative(cwd))
  }

  return lines
}

export const GitRefChip = ({
  worktreeName,
  branch,
  cwd = undefined,
  detached = false,
}: GitRefChipProps): ReactElement | null => {
  if (branch === null || branch.length === 0) {
    return null
  }

  const hasWorktree = worktreeName !== null && worktreeName.length > 0
  const tooltipCwd = cwd !== undefined && cwd.length > 0 ? cwd : null

  const tooltipLines = composeTooltipLines(
    worktreeName,
    branch,
    tooltipCwd,
    detached
  )

  const frameBase =
    'inline-flex items-center gap-1.5 h-[22px] pl-1.5 pr-2 rounded-chip border max-w-[340px] overflow-hidden'

  const frameClasses = detached
    ? `${frameBase} bg-tertiary/[0.06] border-tertiary/25`
    : `${frameBase} bg-primary-container/[0.06] border-primary-container/20`

  const wtIconClasses = `material-symbols-outlined text-[13px] shrink-0 ${
    detached ? 'text-error' : 'text-secondary-dim'
  }`

  const wtLabelClasses = `font-mono text-[10.5px] max-w-[120px] shrink-0 truncate ${
    detached ? 'text-error' : 'text-secondary-dim'
  }`

  const brIconClasses = `material-symbols-outlined text-[13px] shrink-0 ${
    detached ? 'text-tertiary' : 'text-primary-container'
  }`

  const brLabelClasses = `font-medium font-mono text-[10.5px] min-w-0 truncate ${
    detached ? 'text-tertiary' : 'text-on-surface'
  }`

  return (
    <Tooltip
      content={
        <div
          data-testid="git-ref-chip-tooltip"
          className="flex flex-col gap-0.5 font-mono text-[11px] break-all"
        >
          {tooltipLines.map((line, idx) => (
            <div key={idx}>{line}</div>
          ))}
        </div>
      }
      placement="bottom"
    >
      <span data-testid="git-ref-chip" className={frameClasses}>
        {hasWorktree && (
          <>
            <span
              data-testid="git-ref-chip-wt-icon"
              aria-hidden="true"
              className={wtIconClasses}
            >
              account_tree
            </span>
            <span
              data-testid="git-ref-chip-wt-label"
              className={wtLabelClasses}
            >
              {worktreeName}
            </span>
            <span
              data-testid="git-ref-chip-chevron"
              className="text-outline-variant text-[11px] shrink-0"
            >
              ›
            </span>
          </>
        )}
        <span
          data-testid="git-ref-chip-br-icon"
          aria-hidden="true"
          className={brIconClasses}
        >
          fork_right
        </span>
        <span data-testid="git-ref-chip-br-label" className={brLabelClasses}>
          {branch}
        </span>
      </span>
    </Tooltip>
  )
}
