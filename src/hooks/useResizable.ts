import { useState, useCallback, useRef, useEffect } from 'react'

const clampSize = (value: number, min: number, max: number): number =>
  Math.round(Math.min(max, Math.max(min, value)))

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
  /**
   * Controls when drag updates are committed to React state.
   *
   * - `live` keeps the previous behavior: one state update per animation frame.
   * - `commit-on-end` sends frame-coalesced preview sizes to `onDragPreview`
   *   during drag, then commits React state once on mouseup.
   */
  updateMode?: 'live' | 'commit-on-end'
  /**
   * Receives coalesced preview sizes without requiring a React state update.
   * Useful for hot splitter drags that can update a CSS variable directly.
   */
  onDragPreview?: (size: number) => void
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
  updateMode = 'live',
  onDragPreview = undefined,
}: UseResizableOptions): UseResizableResult => {
  // Clamp `initial` on mount so an out-of-range default doesn't briefly
  // surface (in ARIA attributes, in the rendered size) before the first
  // drag triggers the mousemove handler's clamp.
  const [size, setSize] = useState(() => clampSize(initial, min, max))
  const [isDragging, setIsDragging] = useState(false)
  const sizeRef = useRef(size)
  const previewSize = useRef(size)
  const updateModeRef = useRef(updateMode)
  const onDragPreviewRef = useRef(onDragPreview)
  const startPos = useRef(0)
  const startSize = useRef(0)
  const pendingSize = useRef<number | null>(null)
  const animationFrameId = useRef<number | null>(null)

  useEffect(() => {
    sizeRef.current = size
    previewSize.current = size
  }, [size])

  useEffect(() => {
    updateModeRef.current = updateMode
  }, [updateMode])

  useEffect(() => {
    onDragPreviewRef.current = onDragPreview
  }, [onDragPreview])

  const preview = useCallback((nextSize: number): void => {
    if (previewSize.current === nextSize) {
      return
    }

    previewSize.current = nextSize
    onDragPreviewRef.current?.(nextSize)
  }, [])

  const commitSize = useCallback(
    (nextSize: number): void => {
      sizeRef.current = nextSize
      preview(nextSize)

      setSize((currentSize) => {
        if (currentSize === nextSize) {
          return currentSize
        }

        return nextSize
      })
    },
    [preview]
  )

  const flushPendingSize = useCallback((): void => {
    const nextSize = pendingSize.current
    pendingSize.current = null
    animationFrameId.current = null

    if (nextSize === null) {
      return
    }

    if (updateModeRef.current === 'commit-on-end') {
      preview(nextSize)

      return
    }

    commitSize(nextSize)
  }, [commitSize, preview])

  const cancelPendingSize = useCallback((): void => {
    if (animationFrameId.current !== null) {
      window.cancelAnimationFrame(animationFrameId.current)
      animationFrameId.current = null
    }

    pendingSize.current = null
  }, [])

  const scheduleSize = useCallback(
    (nextSize: number): void => {
      const currentSize =
        updateModeRef.current === 'commit-on-end'
          ? previewSize.current
          : sizeRef.current

      if (
        nextSize === pendingSize.current ||
        (pendingSize.current === null && nextSize === currentSize)
      ) {
        return
      }

      pendingSize.current = nextSize

      if (animationFrameId.current !== null) {
        return
      }

      animationFrameId.current = window.requestAnimationFrame(flushPendingSize)
    },
    [flushPendingSize]
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent): void => {
      e.preventDefault()
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY
      startSize.current = sizeRef.current
      previewSize.current = sizeRef.current
      setIsDragging(true)
    },
    [direction]
  )

  useEffect(() => {
    if (!isDragging) {
      return
    }

    const handleMouseMove = (e: MouseEvent): void => {
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY
      const rawDelta = currentPos - startPos.current
      const delta = invert ? -rawDelta : rawDelta

      scheduleSize(clampSize(startSize.current + delta, min, max))
    }

    const handleMouseUp = (): void => {
      if (animationFrameId.current !== null) {
        window.cancelAnimationFrame(animationFrameId.current)
        animationFrameId.current = null
      }

      const finalSize =
        pendingSize.current ??
        (updateModeRef.current === 'commit-on-end' ? previewSize.current : null)
      pendingSize.current = null

      if (finalSize !== null) {
        commitSize(finalSize)
      }

      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return (): void => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [
    isDragging,
    min,
    max,
    direction,
    invert,
    commitSize,
    flushPendingSize,
    scheduleSize,
  ])

  useEffect(
    () => (): void => {
      cancelPendingSize()
    },
    [cancelPendingSize]
  )

  const adjustBy = useCallback(
    (delta: number): void => {
      cancelPendingSize()
      commitSize(clampSize(sizeRef.current + delta, min, max))
    },
    [min, max, cancelPendingSize, commitSize]
  )

  return { size, isDragging, handleMouseDown, adjustBy }
}
