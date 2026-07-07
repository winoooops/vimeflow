import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * Tracks an element's live pixel width via ResizeObserver, ignoring zero
 * (unmeasured / hidden) readings. Returns null until the first positive
 * measurement.
 *
 * Used to drive width-responsive React state — e.g. the pane's auto-collapse —
 * that CSS container queries can express visually but cannot feed back into
 * component state (the chevron and the status-bar render gate).
 */
export const usePaneWidth = <T extends Element>(
  ref: RefObject<T | null>
): number | null => {
  const [width, setWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const record = (next: number): void => {
      if (next > 0) {
        setWidth(next)
      }
    }

    record(element.clientWidth)

    const observer = new ResizeObserver((entries) => {
      // ResizeObserver always reports an entry for the single observed element.
      record(entries[0].contentRect.width)
    })
    observer.observe(element)

    return (): void => observer.disconnect()
  }, [ref])

  return width
}
