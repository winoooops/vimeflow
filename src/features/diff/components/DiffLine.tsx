import type { ReactElement } from 'react'
import type { DiffLine as DiffLineType } from '../types'

export interface DiffLineProps {
  line: DiffLineType
  isFocused?: boolean
  onRightClick?: () => void
}

export const DiffLine = ({
  line,
  isFocused = false,
  onRightClick = undefined,
}: DiffLineProps): ReactElement => {
  const { type, oldLineNumber, newLineNumber, content, highlights = [] } = line

  // Determine styling based on line type
  const lineTypeClass =
    type === 'added' ? 'diff-added' : type === 'removed' ? 'diff-removed' : ''

  const focusClass = isFocused ? 'bg-surface-bright/20' : ''

  const prefix = type === 'added' ? '+' : type === 'removed' ? '-' : ' '

  const prefixColor =
    type === 'added'
      ? 'text-[#a6e3a1]'
      : type === 'removed'
        ? 'text-[#f38ba8]'
        : 'text-transparent'

  // Parse content with highlights
  const renderContentWithHighlights = (): ReactElement => {
    if (highlights.length === 0) {
      return <>{content.slice(1)}</>
    }

    const highlightClass =
      type === 'added'
        ? 'diff-highlight-added'
        : type === 'removed'
          ? 'diff-highlight-removed'
          : ''

    const parts: ReactElement[] = []
    let lastIndex = 0

    // Sort highlights by start position
    const sortedHighlights = [...highlights].sort((a, b) => a.start - b.start)

    sortedHighlights.forEach((highlight, index) => {
      // Add text before highlight
      if (highlight.start > lastIndex) {
        parts.push(
          <span key={`text-${index}`}>
            {content.slice(lastIndex, highlight.start)}
          </span>
        )
      }

      // Add highlighted text
      parts.push(
        <span key={`highlight-${index}`} className={highlightClass}>
          {content.slice(highlight.start, highlight.end)}
        </span>
      )

      lastIndex = highlight.end
    })

    // Add remaining text
    if (lastIndex < content.length) {
      parts.push(<span key="text-end">{content.slice(lastIndex)}</span>)
    }

    return <>{parts}</>
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    if (onRightClick) {
      e.preventDefault()
      onRightClick()
    }
  }

  return (
    <div
      className={`flex font-mono text-sm hover:bg-surface-bright/20 transition-colors ${lineTypeClass} ${focusClass}`}
      onContextMenu={handleContextMenu}
    >
      {/* Old line number gutter */}
      <div className="w-12 flex-shrink-0 text-right pr-2 font-mono text-on-surface-variant/40 select-none">
        {oldLineNumber ?? ''}
      </div>

      {/* New line number gutter */}
      <div className="w-12 flex-shrink-0 text-right pr-2 font-mono text-on-surface-variant/40 select-none">
        {newLineNumber ?? ''}
      </div>

      {/* Prefix (+/-/ ) */}
      <div className={`w-4 flex-shrink-0 font-mono ${prefixColor} select-none`}>
        {prefix}
      </div>

      {/* Content with word highlights */}
      <div className="flex-1 font-mono">{renderContentWithHighlights()}</div>
    </div>
  )
}
