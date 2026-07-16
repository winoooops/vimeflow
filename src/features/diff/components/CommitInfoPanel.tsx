import type { ReactElement } from 'react'
import { Chip } from '@/components/Chip'
import { IconButton } from '@/components/IconButton'
import { ProgressBar } from '@/components/ProgressBar'
import {
  chordToAriaShortcut,
  chordToShortcutInput,
} from '@/features/keymap/displayKey'
import { useKeybindings } from '@/features/keymap/useKeybindings'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'
import { formatShortcut } from '@/lib/formatShortcut'

export interface CommitInfoPanelProps {
  commitHash: string
  commitMessage: string
  authorName: string
  authorAvatar?: string
  timestamp: string
  contextMemoryPercent: number
  tokensProcessedPercent: number
  onSubmitReview: () => void
  isOpen?: boolean
  onToggle?: () => void
}

/**
 * Formats an ISO timestamp as relative time (e.g., "2 hours ago")
 */
const formatRelativeTime = (isoString: string): string => {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffDays > 0) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  }

  if (diffHours > 0) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  }

  if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  }

  return 'just now'
}

/**
 * CommitInfoPanel - Context panel content for the Diff tab
 *
 * Displays commit metadata, author info, progress bars for context memory
 * and token usage, and a CTA button to submit code review.
 *
 * Design reference: app_spec.md "CommitInfoPanel" section
 */
const CommitInfoPanel = ({
  commitHash,
  commitMessage,
  authorName,
  authorAvatar = undefined,
  timestamp,
  contextMemoryPercent,
  tokensProcessedPercent,
  onSubmitReview,
  isOpen = true,
  onToggle = (): void => {
    // Default no-op handler
  },
}: CommitInfoPanelProps): ReactElement => {
  const { bindingFor, matches } = useKeybindings()
  const submitShortcut = bindingFor('diff-commit-review-submit')

  const submitShortcutLabel = formatShortcut(
    chordToShortcutInput(submitShortcut)
  )

  return (
    <>
      {/* Floating reopen button - only visible when panel is collapsed */}
      <IconButton
        icon="chevron_left"
        label="Open commit info panel"
        size="sm"
        onClick={onToggle}
        showTooltip={TOOLTIP_SUPPRESSED} // aria-label already exposes intent at viewport edge
        className={`fixed right-0 top-14 z-30 w-8 h-12 bg-surface-container hover:bg-surface-container-high text-on-surface-variant text-lg rounded-none rounded-l-lg border-l border-y border-outline-variant/10 transition-all duration-300 ${
          isOpen
            ? 'opacity-0 pointer-events-none translate-x-full'
            : 'opacity-100 translate-x-0'
        }`}
      />

      <aside
        role="complementary"
        aria-label="Commit info panel"
        onKeyDownCapture={(event): void => {
          if (matches(event.nativeEvent, 'diff-commit-review-submit')) {
            event.preventDefault()
            event.stopPropagation()
            onSubmitReview()
          }
        }}
        className={`w-[320px] h-screen fixed right-0 top-0 bg-surface-container-low border-l border-outline-variant/15 z-40 overflow-y-auto transition-all duration-300 ${
          isOpen ? '' : 'translate-x-full'
        }`}
      >
        <div className="p-6 space-y-6">
          {/* Section Header */}
          <h2 className="text-[10px] font-bold tracking-widest text-on-surface-variant uppercase flex items-center gap-2">
            <span
              className="material-symbols-outlined text-xs"
              aria-hidden="true"
            >
              history
            </span>
            Commit Info
          </h2>

          {/* Commit Hash Badge */}
          <div>
            <Chip
              tone="custom"
              size="custom"
              radius="chip"
              className="rounded bg-surface-container-highest px-2 py-1 font-label text-xs text-on-surface"
            >
              {commitHash}
            </Chip>
          </div>

          {/* Commit Message */}
          <p className="text-sm font-medium text-on-surface leading-relaxed">
            {commitMessage}
          </p>

          {/* Author Info */}
          <div className="flex items-center gap-3">
            {authorAvatar && (
              <img
                src={authorAvatar}
                alt={`${authorName} avatar`}
                className="w-8 h-8 rounded-full"
              />
            )}
            <div className="flex flex-col">
              <span className="text-xs font-medium text-on-surface">
                {authorName}
              </span>
              <span className="text-[10px] text-on-surface-variant">
                {formatRelativeTime(timestamp)}
              </span>
            </div>
          </div>

          {/* Progress Bars */}
          <div className="space-y-4">
            {/* Context Memory Progress */}
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] font-label text-on-surface-variant">
                <span>Context Memory</span>
                <span>{contextMemoryPercent}%</span>
              </div>
              <ProgressBar
                label="Context Memory"
                value={contextMemoryPercent}
                height="sm"
                tone="secondary"
                gradient
                className="bg-surface-container-highest"
              />
            </div>

            {/* Tokens Processed Progress */}
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] font-label text-on-surface-variant">
                <span>Tokens Processed</span>
                <span>{tokensProcessedPercent}%</span>
              </div>
              <ProgressBar
                label="Tokens Processed"
                value={tokensProcessedPercent}
                height="sm"
                tone="primary"
                gradient
                className="bg-surface-container-highest"
              />
            </div>
          </div>

          {/* Submit Review CTA */}
          <button
            type="button"
            aria-keyshortcuts={chordToAriaShortcut(submitShortcut)}
            onClick={onSubmitReview}
            className="w-full bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-medium py-3 px-4 rounded-lg shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-shadow"
          >
            Submit Review ({submitShortcutLabel})
          </button>
        </div>
      </aside>
    </>
  )
}

export default CommitInfoPanel
