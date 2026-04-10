import { useState, useCallback, useRef, useEffect } from 'react'

export interface UseResizableOptions {
  initial: number
  min: number
  max: number
  direction?: 'horizontal' | 'vertical'
  /**
   * Invert the delta direction. Use this for panels whose drag handle
   * is on the opposite edge from the one that grows when the panel
   * expands — e.g. a bottom-anchored drawer with its drag handle on
   * the top edge, where dragging UP (`clientY` decreases) should grow
   * the panel, not shrink it.
   */
  invert?: boolean
}

export interface UseResizableResult {
  size: number
  isDragging: boolean
  handleMouseDown: (e: React.MouseEvent) => void
  /**
   * Programmatically adjust the size by `delta` pixels, clamped to
   * `[min, max]`. Used for keyboard-driven resize (arrow keys on the
   * separator handle) since the hook otherwise only exposes
   * mouse-driven adjustment.
   */
  adjustBy: (delta: number) => void
}

export const useResizable = ({
  initial,
  min,
  max,
  direction = 'horizontal',
  invert = false,
}: UseResizableOptions): UseResizableResult => {
  const [size, setSize] = useState(initial)
  const [isDragging, setIsDragging] = useState(false)
  const startPos = useRef(0)
  const startSize = useRef(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent): void => {
      e.preventDefault()
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY
      startSize.current = size
      setIsDragging(true)
    },
    [size, direction]
  )

  useEffect(() => {
    if (!isDragging) {
      return
    }

    const handleMouseMove = (e: MouseEvent): void => {
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY
      const rawDelta = currentPos - startPos.current
      const delta = invert ? -rawDelta : rawDelta

      const newSize = Math.round(
        Math.min(max, Math.max(min, startSize.current + delta))
      )
      setSize(newSize)
    }

    const handleMouseUp = (): void => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return (): void => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, min, max, direction, invert])

  const adjustBy = useCallback(
    (delta: number): void => {
      setSize((current) =>
        Math.round(Math.min(max, Math.max(min, current + delta)))
      )
    },
    [min, max]
  )

  return { size, isDragging, handleMouseDown, adjustBy }
}
