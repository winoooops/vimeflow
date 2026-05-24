// cspell:ignore worktree
import type { ReactElement } from 'react'
import { Tooltip } from '../../../../components/Tooltip'

export interface GitRefChipProps {
  /** Linked-worktree basename, or null when on the main checkout. */
  worktreeName: string | null
  /** Branch name (PR-A) — or short SHA when HEAD is detached. */
  branch: string | null
  /** Absolute path of the pane's cwd; rendered verbatim as the third tooltip line. */
  cwd?: string
  /** PR-A: optional, always defaults to false. PR-B wires the live value. */
  detached?: boolean
}

/**
 * Compose the chip's tooltip lines. Exported so the per-state wording stays
 * locked in via a pure-function unit test — asserting the rendered floating
 * surface would require driving floating-ui's hover state.
 *
 * Line order: branch (or detached HEAD), worktree (if any), then the full
 * cwd path (if any) verbatim — no home-relative substitution.
 */
export const composeTooltipLines = (
  worktreeName: string | null,
  branch: string,
  cwd: string | null,
  detached: boolean
): string[] => {
  const lines: string[] = [
    `${detached ? 'detached HEAD' : 'branch'}: ${branch}`,
  ]
  if (worktreeName !== null && worktreeName.length > 0) {
    lines.push(`worktree: ${worktreeName}`)
  }
  if (cwd !== null && cwd.length > 0) {
    lines.push(cwd)
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

  // Two-tone coral when detached, per docs/design/git-chip/GitRefChip.html:
  // worktree uses `text-error` (#ffb4ab — lighter coral), branch uses
  // `text-tertiary` (#ff94a5 — deeper coral). Despite its name, `error` in
  // tailwind.config.js is a coral shade, NOT Catppuccin red.
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
          {tooltipLines.map((line) => (
            <div key={line}>{line}</div>
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
