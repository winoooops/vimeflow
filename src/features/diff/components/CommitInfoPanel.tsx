import type { ReactElement } from 'react'

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
}: CommitInfoPanelProps): ReactElement => (
  <>
    {/* Floating reopen button - only visible when panel is collapsed */}
    <button
      onClick={onToggle}
      aria-label="Open commit info panel"
      className={`fixed right-0 top-14 z-30 w-8 h-12 bg-surface-container hover:bg-surface-container-high rounded-l-lg border-l border-y border-outline-variant/10 transition-all duration-300 flex items-center justify-center ${
        isOpen
          ? 'opacity-0 pointer-events-none translate-x-full'
          : 'opacity-100 translate-x-0'
      }`}
      type="button"
    >
      <span className="material-symbols-outlined text-on-surface-variant text-lg">
        chevron_left
      </span>
    </button>

    <aside
      role="complementary"
      aria-label="Commit info panel"
      className={`w-[320px] h-screen fixed right-0 top-0 bg-[#1a1a2a] border-l border-[#4a444f]/15 z-40 overflow-y-auto thin-scrollbar transition-all duration-300 ${
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
          <span className="font-label bg-surface-container-highest px-2 py-1 rounded text-xs text-on-surface">
            {commitHash}
          </span>
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
            <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-secondary to-secondary-container rounded-full"
                style={{ width: `${contextMemoryPercent}%` }}
              />
            </div>
          </div>

          {/* Tokens Processed Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-[10px] font-label text-on-surface-variant">
              <span>Tokens Processed</span>
              <span>{tokensProcessedPercent}%</span>
            </div>
            <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary-container rounded-full"
                style={{ width: `${tokensProcessedPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Submit Review CTA */}
        <button
          onClick={onSubmitReview}
          className="w-full bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-medium py-3 px-4 rounded-lg shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-shadow"
        >
          Submit Review
        </button>
      </div>
    </aside>
  </>
)

export default CommitInfoPanel
