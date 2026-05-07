import type { ReactElement, ReactNode } from 'react'
import { useResizable } from '../../hooks/useResizable'

const BOTTOM_PANE_DEFAULT = 320
const BOTTOM_PANE_MIN = 100
const BOTTOM_PANE_MAX = 500

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
  } = useResizable({
    initial: bottomPaneInitialHeight,
    min: bottomPaneMinHeight,
    max: bottomPaneMaxHeight,
    direction: 'vertical',
    invert: true,
  })

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
            onMouseDown={handleMouseDown}
            className={`
              h-1 shrink-0 cursor-row-resize transition-colors hover:bg-primary/50
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
