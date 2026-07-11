import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type NativeOverlayActivityPopoverPayload,
  type NativeOverlayActivityPopoverRequest,
  isNativeOverlayActivityPopoverPayload,
} from '@/components/nativeOverlayActivity'
import type { ActivityEvent } from '../types/activityEvent'

const ACTIVITY_ACTIVATE_ACTION = 'activity:activate'
const CLOSE_DELAY_MS = 150

type NativeActivityAction = () => void

const EMPTY_ACTIONS = new Map<string, NativeActivityAction>()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const containsPoint = (
  rect: NativeOverlayActivityPopoverRequest['anchorRect'],
  x: number,
  y: number
): boolean =>
  x >= rect.x &&
  x <= rect.x + rect.width &&
  y >= rect.y &&
  y <= rect.y + rect.height

export const isNativeActivityPopoverRequest = (
  value: unknown
): value is NativeOverlayActivityPopoverRequest =>
  isRecord(value) &&
  value.kind === 'popover' &&
  isNativeOverlayActivityPopoverPayload(value.payload)

interface NativeActivityPopoverSourceOptions {
  event: ActivityEvent
  ariaLabel: string
  onActivate?: () => void
}

interface NativeActivityPopoverSource {
  payload: NativeOverlayActivityPopoverPayload
  actions: ReadonlyMap<string, NativeActivityAction>
}

export const useNativeActivityPopoverSource = ({
  event,
  ariaLabel,
  onActivate = undefined,
}: NativeActivityPopoverSourceOptions): NativeActivityPopoverSource => {
  const payload = useMemo<NativeOverlayActivityPopoverPayload>(
    () => ({
      kind: 'popover',
      popover: 'activity',
      ariaLabel,
      event,
      ...(onActivate === undefined
        ? {}
        : { activateActionId: ACTIVITY_ACTIVATE_ACTION }),
    }),
    [ariaLabel, event, onActivate]
  )

  const actions = useMemo<ReadonlyMap<string, NativeActivityAction>>(
    () =>
      onActivate === undefined
        ? EMPTY_ACTIONS
        : new Map([[ACTIVITY_ACTIVATE_ACTION, onActivate]]),
    [onActivate]
  )

  return { payload, actions }
}

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
