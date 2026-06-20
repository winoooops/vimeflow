// cspell:ignore worktree
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Chip } from '@/components/Chip'
import { Tooltip } from '@/components/Tooltip'
import { writeClipboardText } from '@/lib/clipboard'

export interface GitRefChipProps {
  /** Linked-worktree basename, or null when on the main checkout. */
  worktreeName: string | null
  /** Branch name (PR-A) — or short SHA when HEAD is detached. */
  branch: string | null
  /** Absolute path of the pane's cwd; shown and click-to-copy as the popover's path row. */
  cwd?: string
  /** PR-A: optional, always defaults to false. PR-B wires the live value. */
  detached?: boolean
}

export type GitRefCopyRowKey = 'worktree' | 'path' | 'branch'

export interface GitRefCopyRowData {
  key: GitRefCopyRowKey
  /** Material Symbols glyph name for the leading icon. */
  icon: string
  /** Tailwind color class for the leading icon (two-tone coral when detached). */
  iconClassName: string
  /** Micro uppercase label shown above the value. */
  label: string
  /** The copyable value. */
  value: string
}

/**
 * Build the copy popover's rows, in display order: worktree (only when set) →
 * path (only when a cwd is available) → branch (always). Detached flips the
 * branch label to `detached head` and recolors the worktree/branch icons to
 * the two-tone coral used by the chip itself.
 *
 * Exported as a pure function so the per-state contract (rows, order, icons,
 * labels, colors) is locked by a unit test — the popover only renders on hover
 * through a portal, so asserting it against the DOM would mean driving the
 * floating surface's hover state.
 */
export const composeCopyRows = (
  worktreeName: string | null,
  branch: string,
  cwd: string | null,
  detached: boolean
): GitRefCopyRowData[] => {
  const worktreeRow: GitRefCopyRowData | null =
    worktreeName !== null && worktreeName.length > 0
      ? {
          key: 'worktree',
          icon: 'account_tree',
          iconClassName: detached ? 'text-error' : 'text-secondary-dim',
          label: 'worktree',
          value: worktreeName,
        }
      : null

  const pathRow: GitRefCopyRowData | null =
    cwd !== null && cwd.length > 0
      ? {
          key: 'path',
          icon: 'folder_open',
          iconClassName: 'text-on-surface-variant',
          label: 'path',
          value: cwd,
        }
      : null

  const branchRow: GitRefCopyRowData = {
    key: 'branch',
    icon: 'fork_right',
    iconClassName: detached ? 'text-tertiary' : 'text-primary-container',
    label: detached ? 'detached head' : 'branch',
    value: branch,
  }

  return [worktreeRow, pathRow, branchRow].filter(
    (row): row is GitRefCopyRowData => row !== null
  )
}

/** How long a copied row shows its green check before reverting. */
const COPY_FEEDBACK_MS = 1300

interface GitRefCopyRowProps {
  row: GitRefCopyRowData
  copied: boolean
  onCopy: (key: GitRefCopyRowKey, value: string) => void
}

// One click-to-copy row: leading icon · stacked micro label + mono value
// (truncates when long) · trailing copy glyph that flips to a check while
// copied. The whole row is the button — clicking anywhere copies the value.
const GitRefCopyRow = ({
  row,
  copied,
  onCopy,
}: GitRefCopyRowProps): ReactElement => (
  <button
    type="button"
    aria-label={`Copy ${row.label}`}
    onClick={(event) => {
      // The popover renders in a portal, so React still bubbles this click to
      // the pane's focus handler — stop it so copying never refocuses the pane.
      event.stopPropagation()
      onCopy(row.key, row.value)
    }}
    className="group flex w-full items-center gap-2 rounded-chip px-[7px] py-1.5 text-left hover:bg-primary-container/[0.12]"
  >
    <span
      aria-hidden="true"
      className={`material-symbols-outlined shrink-0 text-[13px] ${row.iconClassName}`}
    >
      {row.icon}
    </span>
    <span className="flex min-w-0 flex-1 flex-col gap-px">
      <span className="font-sans text-[8.5px] uppercase tracking-[0.09em] text-on-surface-muted">
        {row.label}
      </span>
      <span className="truncate font-mono text-[11px] text-on-surface">
        {row.value}
      </span>
    </span>
    <span
      aria-hidden="true"
      className={`material-symbols-outlined shrink-0 text-[13px] ${
        copied
          ? 'text-success'
          : 'text-on-surface-muted group-hover:text-on-surface-variant'
      }`}
    >
      {copied ? 'check' : 'content_copy'}
    </span>
  </button>
)

export interface GitRefCopyRowsProps {
  worktreeName: string | null
  branch: string
  cwd: string | null
  detached?: boolean
}

/**
 * Interactive content of the chip's copy popover — one click-to-copy row per
 * ref fact, with a transient green check on the row just copied. Rendered as
 * the chip's `bare interactive` Tooltip surface; exported so the row + copy
 * behavior is unit-testable without driving the floating surface's hover state
 * (the Tooltip only mounts this on hover, through a portal).
 */
export const GitRefCopyRows = ({
  worktreeName,
  branch,
  cwd,
  detached = false,
}: GitRefCopyRowsProps): ReactElement => {
  const [copiedKey, setCopiedKey] = useState<GitRefCopyRowKey | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const clearPending = (): void => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }

    return clearPending
  }, [])

  const handleCopy = (key: GitRefCopyRowKey, value: string): void => {
    // Fire-and-forget — writeClipboardText swallows its own failures and falls
    // back to execCommand, so the check is shown optimistically on click.
    void writeClipboardText(value)
    setCopiedKey(key)
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => {
      setCopiedKey(null)
    }, COPY_FEEDBACK_MS)
  }

  return (
    <div className="flex flex-col">
      {composeCopyRows(worktreeName, branch, cwd, detached).map((row) => (
        <GitRefCopyRow
          key={row.key}
          row={row}
          copied={copiedKey === row.key}
          onCopy={handleCopy}
        />
      ))}
    </div>
  )
}

// The copy popover reuses the "Tweaks panel" floating chrome (same family as
// the activity-details card): a 244px glass card with an accent-bright hairline
// border, soft modal shadow, and a subtle slide-in. All semantic tokens, so it
// recolors across every theme.
const GIT_REF_TIP_SURFACE =
  'w-[244px] rounded-pane border border-primary/20 bg-surface-container/[0.92] p-1 shadow-modal backdrop-blur-[20px] backdrop-saturate-150 animate-vf-tip-in'

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

  const frameBase =
    'inline-flex items-center gap-1.5 h-[22px] pl-1.5 pr-2 rounded-chip border max-w-[340px] overflow-hidden'

  // Two-tone coral when detached, per docs/design/git-chip/GitRefChip.html:
  // worktree uses `text-error` (lighter coral), branch uses
  // `text-tertiary` (deeper coral). Despite its name, the `error`
  // theme token (src/theme/) is a coral shade, NOT Catppuccin red.
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
      bare
      interactive
      ariaLabel="Git ref details"
      placement="bottom"
      className={GIT_REF_TIP_SURFACE}
      content={
        <GitRefCopyRows
          worktreeName={worktreeName}
          branch={branch}
          cwd={tooltipCwd}
          detached={detached}
        />
      }
    >
      <Chip
        data-testid="git-ref-chip"
        tone="custom"
        size="custom"
        radius="chip"
        className={frameClasses}
      >
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
      </Chip>
    </Tooltip>
  )
}
