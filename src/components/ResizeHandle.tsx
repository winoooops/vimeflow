import type { CSSProperties, KeyboardEvent, MouseEvent, ReactElement } from 'react'

export interface ResizeHandleProps {
  /** aria-orientation. 'horizontal' separator → ns-resize; 'vertical' → col-resize. */
  orientation: 'horizontal' | 'vertical'
  isDragging: boolean
  ariaValueNow: number
  ariaValueMin: number
  ariaValueMax: number
  ariaLabel?: string
  testId?: string
  onMouseDown: (event: MouseEvent) => void
  onKeyDown: (event: KeyboardEvent) => void
  /** Consumer-owned placement: position offsets, stretch + thickness, z-index. */
  className?: string
  style?: CSSProperties
}

export const ResizeHandle = ({
  orientation,
  isDragging,
  ariaValueNow,
  ariaValueMin,
  ariaValueMax,
  ariaLabel = 'Resize panel',
  testId = 'resize-handle',
  onMouseDown,
  onKeyDown,
  className = '',
  style = undefined,
}: ResizeHandleProps): ReactElement => {
  const cursor =
    orientation === 'horizontal' ? 'cursor-ns-resize' : 'cursor-col-resize'

  return (
    <div
      data-testid={testId}
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      aria-valuenow={ariaValueNow}
      aria-valuemin={ariaValueMin}
      aria-valuemax={ariaValueMax}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      style={style}
      className={`${cursor} transition-colors hover:bg-primary/20 focus:bg-primary/40 focus:outline-none ${
        isDragging ? 'bg-primary/30' : ''
      } ${className}`}
    />
  )
}
