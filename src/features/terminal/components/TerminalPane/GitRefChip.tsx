// cspell:ignore worktree
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react'
import { Chip } from '@/components/Chip'
import { Menu } from '@/components/Menu'
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
  /**
   * When true, the worktree segment (icon, basename, chevron) hides inside a
   * narrow size-container so the card collapses to branch-only. Opt-in — the
   * chip renders the full ref by default.
   */
  collapsibleWorktree?: boolean
  nativeOverlay?: boolean
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

const useGitRefCopyFeedback = (): {
  copiedKey: GitRefCopyRowKey | null
  handleCopy: (key: GitRefCopyRowKey, value: string) => Promise<boolean>
} => {
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

  const handleCopy = async (
    key: GitRefCopyRowKey,
    value: string
  ): Promise<boolean> => {
    const copied = await writeClipboardText(value)
    if (!copied) {
      return false
    }

    setCopiedKey(key)
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => {
      setCopiedKey(null)
    }, COPY_FEEDBACK_MS)

    return true
  }

  return { copiedKey, handleCopy }
}

interface GitRefCopyRowContentProps {
  row: GitRefCopyRowData
  copied: boolean
}

const GitRefCopyRowContent = ({
  row,
  copied,
}: GitRefCopyRowContentProps): ReactElement => (
  <>
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
  </>
)

const GIT_REF_MENU_ROW_CLASSES =
  'group flex min-h-8 w-full items-center gap-2 rounded-chip px-[7px] py-1.5 text-left text-xs text-on-surface outline-none transition-colors hover:bg-primary-container/[0.12] focus-visible:bg-primary-container/[0.12]'

interface GitRefCopyMenuRowElementsOptions {
  rows: readonly GitRefCopyRowData[]
  copiedKey: GitRefCopyRowKey | null
  onCopy: (key: GitRefCopyRowKey, value: string) => Promise<boolean>
}

const gitRefCopyMenuRowElements = ({
  rows,
  copiedKey,
  onCopy,
}: GitRefCopyMenuRowElementsOptions): ReactElement[] =>
  rows.map((row) => (
    <Menu.Row
      key={row.key}
      label={`Copy ${row.label}`}
      className={GIT_REF_MENU_ROW_CLASSES}
      nativeOverlayIcon={row.icon}
      nativeOverlayDetail={row.value}
      nativeOverlayFeedback="copy"
      onSelect={() => onCopy(row.key, row.value)}
    >
      <GitRefCopyRowContent row={row} copied={copiedKey === row.key} />
    </Menu.Row>
  ))

export const GitRefChip = ({
  worktreeName,
  branch,
  cwd = undefined,
  detached = false,
  collapsibleWorktree = false,
  nativeOverlay = false,
}: GitRefChipProps): ReactElement | null => {
  const chipRef = useRef<HTMLSpanElement | null>(null)
  const skipRestoredFocusRef = useRef(false)
  const skipRestoredFocusTimerRef = useRef<number | null>(null)
  const [open, setOpen] = useState(false)

  const [anchorRect, setAnchorRect] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  })
  const { copiedKey, handleCopy } = useGitRefCopyFeedback()

  useEffect(
    () => (): void => {
      if (skipRestoredFocusTimerRef.current !== null) {
        window.clearTimeout(skipRestoredFocusTimerRef.current)
      }
    },
    []
  )

  if (branch === null || branch.length === 0) {
    return null
  }

  const hasWorktree = worktreeName !== null && worktreeName.length > 0
  const tooltipCwd = cwd !== undefined && cwd.length > 0 ? cwd : null
  const copyRows = composeCopyRows(worktreeName, branch, tooltipCwd, detached)

  // `max-w-full` + `min-w-0` cap the chip at its container's width so the
  // branch label truncates with an ellipsis instead of the chip overflowing
  // and being hard-clipped (the Chip primitive is `shrink-0`).
  const frameBase =
    'inline-flex items-center gap-1.5 h-[22px] pl-1.5 pr-2 rounded-chip border min-w-0 max-w-full overflow-hidden outline-none focus:outline-none focus-visible:outline-none'

  // Two-tone coral when detached, per docs/design/git-chip/GitRefChip.html:
  // worktree uses `text-error` (lighter coral), branch uses
  // `text-tertiary` (deeper coral). Despite its name, the `error`
  // theme token (src/theme/) is a coral shade, NOT Catppuccin red.
  const frameClasses = detached
    ? `${frameBase} bg-tertiary/[0.06] border-tertiary/25`
    : `${frameBase} bg-primary-container/[0.06] border-primary-container/20`

  // Collapse the worktree segment to branch-only inside a narrow size-container.
  const worktreeHideClass = collapsibleWorktree ? '@max-[280px]:hidden' : ''

  const wtIconClasses = `material-symbols-outlined text-[13px] shrink-0 ${
    detached ? 'text-error' : 'text-secondary-dim'
  } ${worktreeHideClass}`

  const wtLabelClasses = `font-mono text-[10.5px] max-w-[120px] shrink-0 truncate ${
    detached ? 'text-error' : 'text-secondary-dim'
  } ${worktreeHideClass}`

  const brIconClasses = `material-symbols-outlined text-[13px] shrink-0 ${
    detached ? 'text-tertiary' : 'text-primary-container'
  }`

  const brLabelClasses = `font-medium font-mono text-[10.5px] min-w-0 truncate ${
    detached ? 'text-tertiary' : 'text-on-surface'
  }`

  const updateAnchorRect = (): boolean => {
    const rect = chipRef.current?.getBoundingClientRect()
    if (rect === undefined) {
      return false
    }

    setAnchorRect({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    })

    return true
  }

  const openCopyMenu = (): void => {
    if (updateAnchorRect()) {
      setOpen(true)
    }
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      skipRestoredFocusRef.current = true
      if (skipRestoredFocusTimerRef.current !== null) {
        window.clearTimeout(skipRestoredFocusTimerRef.current)
      }
      skipRestoredFocusTimerRef.current = window.setTimeout(() => {
        skipRestoredFocusRef.current = false
        skipRestoredFocusTimerRef.current = null
      }, 0)
    }

    setOpen(nextOpen)
  }

  const handleFocus = (): void => {
    if (skipRestoredFocusRef.current) {
      skipRestoredFocusRef.current = false
      if (skipRestoredFocusTimerRef.current !== null) {
        window.clearTimeout(skipRestoredFocusTimerRef.current)
        skipRestoredFocusTimerRef.current = null
      }

      return
    }

    openCopyMenu()
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>): void => {
    if (
      event.key !== 'Enter' &&
      event.key !== ' ' &&
      event.key !== 'ArrowDown'
    ) {
      return
    }

    event.preventDefault()
    openCopyMenu()
  }

  return (
    <>
      <Chip
        ref={chipRef}
        data-testid="git-ref-chip"
        role="button"
        aria-label="Git ref details"
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={0}
        tone="custom"
        size="custom"
        radius="chip"
        className={frameClasses}
        onClick={(event): void => {
          event.stopPropagation()
          openCopyMenu()
        }}
        onMouseDown={(event): void => {
          event.stopPropagation()
        }}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
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
              className={`text-outline-variant text-[11px] shrink-0 ${worktreeHideClass}`}
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
      <Menu.Context
        position={anchorRect}
        placement="bottom"
        matchAnchorWidth
        surfaceTone="primary-container-soft"
        open={open}
        onOpenChange={handleOpenChange}
        aria-label="Git ref details"
        nativeOverlay={nativeOverlay}
      >
        {gitRefCopyMenuRowElements({
          rows: copyRows,
          copiedKey,
          onCopy: handleCopy,
        })}
      </Menu.Context>
    </>
  )
}
