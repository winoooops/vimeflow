import { useCallback, useEffect, useRef, useState } from 'react'
import type { NativeOverlayActivityPopoverRequest } from './nativeOverlayActivity'

const CLOSE_DELAY_MS = 150

const containsPoint = (
  rect: NativeOverlayActivityPopoverRequest['anchorRect'],
  x: number,
  y: number
): boolean =>
  x >= rect.x &&
  x <= rect.x + rect.width &&
  y >= rect.y &&
  y <= rect.y + rect.height

interface NativeActivityPopoverHostOptions {
  request: NativeOverlayActivityPopoverRequest
  close: () => void
}

interface NativeActivityPopoverHost {
  now: Date
  activateActionId: string | undefined
  dismissWhen: (event: MouseEvent) => boolean
}

export const useNativeActivityPopoverHost = ({
  request,
  close,
}: NativeActivityPopoverHostOptions): NativeActivityPopoverHost => {
  const [now, setNow] = useState(() => new Date())
  const closeTimerRef = useRef<number | null>(null)

  const cancelClose = useCallback((): void => {
    if (closeTimerRef.current === null) {
      return
    }

    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const scheduleClose = useCallback((): void => {
    if (closeTimerRef.current !== null) {
      return
    }

    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      close()
    }, CLOSE_DELAY_MS)
  }, [close])

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 1000)

    return (): void => window.clearInterval(tick)
  }, [])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent): void => {
      const card = document.querySelector<HTMLElement>('[role="dialog"]')

      const isOverCard =
        card !== null &&
        containsPoint(
          card.getBoundingClientRect(),
          event.clientX,
          event.clientY
        )

      if (
        isOverCard ||
        containsPoint(request.anchorRect, event.clientX, event.clientY)
      ) {
        cancelClose()

        return
      }

      scheduleClose()
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.documentElement.addEventListener('mouseleave', scheduleClose)

    return (): void => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.documentElement.removeEventListener('mouseleave', scheduleClose)
      cancelClose()
    }
  }, [cancelClose, request.anchorRect, scheduleClose])

  const dismissWhen = useCallback((event: MouseEvent): boolean => {
    const target = event.target

    return !(
      target instanceof Element &&
      target.closest('[data-native-activity-anchor]') !== null
    )
  }, [])

  return {
    now,
    activateActionId: request.payload.activateActionId,
    dismissWhen,
  }
}
