// cspell:ignore worktree
import type { ReactElement } from 'react'
import { Tooltip } from '../../../../components/Tooltip'

export interface GitRefChipProps {
  /** Linked-worktree basename, or null when on the main checkout. */
  worktreeName: string | null
  /** Branch name (PR-A) — or short SHA when HEAD is detached. */
  branch: string | null
  /** PR-A: optional, always defaults to false. PR-B wires the live value. */
  detached?: boolean
}

/**
 * Compose the chip's hover tooltip text. Exported so it can be unit-tested
 * as a pure function — the four-state wording is part of the chip's
 * documented contract (spec §3.5), and asserting it on the rendered DOM
 * would require driving floating-ui's hover state.
 */
export const composeTooltipContent = (
  worktreeName: string | null,
  branch: string,
  detached: boolean
): string => {
  const branchLabel = detached ? 'detached HEAD' : 'branch'
  if (worktreeName !== null && worktreeName.length > 0) {
    return `worktree: ${worktreeName} · ${branchLabel}: ${branch}`
  }

  return `${branchLabel}: ${branch}`
}

export const GitRefChip = ({
  worktreeName,
  branch,
  detached = false,
}: GitRefChipProps): ReactElement | null => {
  if (branch === null || branch.length === 0) {
    return null
  }

  const hasWorktree = worktreeName !== null && worktreeName.length > 0

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
      content={composeTooltipContent(worktreeName, branch, detached)}
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
