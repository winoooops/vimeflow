import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import { useResizable } from '../../hooks/useResizable'

const BOTTOM_PANE_DEFAULT = 320
const BOTTOM_PANE_MIN = 100
const BOTTOM_PANE_MAX = 500

// Arrow-key adjustment step (px). PageUp/PageDown use the larger step.
// Both follow the WAI-ARIA Splitter pattern (interactive separator).
const ARROW_STEP = 8
const PAGE_STEP = 40

export interface SidebarProps {
  /** Top fixed-height region. */
  header?: ReactNode
  /** Middle scroll-eligible region (flex 1). Sidebar provides bounded space; the content's caller owns its own overflow. Required. */
  content: ReactNode
  /**
   * Optional resizable bottom pane below `content`. When present, a
   * horizontal split-resize handle separates `content` from
   * `bottomPane`. When absent, `content` flexes to fill.
   */
  bottomPane?: ReactNode
  /** Bottom fixed-height region (e.g. primary action button). */
  footer?: ReactNode
  /** Initial bottom-pane height in pixels. Default 320. */
  bottomPaneInitialHeight?: number
  /** Minimum bottom-pane height. Default 100. */
  bottomPaneMinHeight?: number
  /** Maximum bottom-pane height. Default 500. */
  bottomPaneMaxHeight?: number
  /** Test hook id. Default 'sidebar'. */
  'data-testid'?: string
}

export const Sidebar = ({
  header = undefined,
  content,
  bottomPane = undefined,
  footer = undefined,
  bottomPaneInitialHeight = BOTTOM_PANE_DEFAULT,
  bottomPaneMinHeight = BOTTOM_PANE_MIN,
  bottomPaneMaxHeight = BOTTOM_PANE_MAX,
  'data-testid': testId = 'sidebar',
}: SidebarProps): ReactElement => {
  const {
    size: bottomHeight,
    isDragging,
    handleMouseDown,
    adjustBy,
  } = useResizable({
    initial: bottomPaneInitialHeight,
    min: bottomPaneMinHeight,
    max: bottomPaneMaxHeight,
    direction: 'vertical',
    invert: true,
  })

  // Keyboard adjustment for the WAI-ARIA splitter (closes #180).
  // ArrowUp grows the bottom pane (consistent with the mouse `invert: true`
  // semantic where dragging up grows the pane); ArrowDown shrinks. Home /
  // End jump to min / max; PageUp / PageDown apply a larger step. Each
  // arm calls preventDefault so the page-scroll default doesn't fire while
  // the separator owns focus.
  const handleSeparatorKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        adjustBy(ARROW_STEP)
        break
      case 'ArrowDown':
        e.preventDefault()
        adjustBy(-ARROW_STEP)
        break
      case 'PageUp':
        e.preventDefault()
        adjustBy(PAGE_STEP)
        break
      case 'PageDown':
        e.preventDefault()
        adjustBy(-PAGE_STEP)
        break
      case 'Home':
        e.preventDefault()
        adjustBy(bottomPaneMinHeight - bottomHeight)
        break
      case 'End':
        e.preventDefault()
        adjustBy(bottomPaneMaxHeight - bottomHeight)
        break
      default:
        // Other keys propagate normally.
        break
    }
  }

  // The slot-rendering rule: a slot's wrapper renders only when the
  // prop is not `null`, `undefined`, or `false`. `0` and `''` are
  // valid ReactNode values that DO render.
  const renderSlot = (slot: ReactNode): boolean =>
    slot !== null && slot !== undefined && slot !== false

  return (
    <div
      className="flex h-full w-full flex-col bg-surface-container-low"
      data-testid={testId}
    >
      {renderSlot(header) && <div className="px-3 pb-2 pt-3">{header}</div>}

      <div className="flex min-h-0 flex-1 flex-col">{content}</div>

      {renderSlot(bottomPane) && (
        <>
          <div
            data-testid="explorer-resize-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-valuenow={bottomHeight}
            aria-valuemin={bottomPaneMinHeight}
            aria-valuemax={bottomPaneMaxHeight}
            aria-label="Resize bottom pane"
            tabIndex={0}
            onMouseDown={handleMouseDown}
            onKeyDown={handleSeparatorKeyDown}
            className={`
              h-1 shrink-0 cursor-row-resize transition-colors
              hover:bg-primary/50 focus-visible:bg-primary/70
              focus-visible:outline-none
              ${isDragging ? 'bg-primary/70' : 'border-t border-white/5'}
            `}
          />
          <div style={{ height: bottomHeight }} className="shrink-0">
            {bottomPane}
          </div>
        </>
      )}

      {renderSlot(footer) && <div className="p-3">{footer}</div>}

      {isDragging && <div className="fixed inset-0 z-50 cursor-row-resize" />}
    </div>
  )
}
