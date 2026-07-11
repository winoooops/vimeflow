import { useMemo } from 'react'
import { type NativeOverlayActivityPopoverPayload } from '@/components/nativeOverlayActivity'
import type { ActivityEvent } from '../types/activityEvent'

export { isNativeActivityPopoverRequest } from '@/components/nativeOverlayActivity'

export { useNativeActivityPopoverHost } from '@/components/useNativeActivityPopoverHost'

const ACTIVITY_ACTIVATE_ACTION = 'activity:activate'

type NativeActivityAction = () => void

const EMPTY_ACTIONS = new Map<string, NativeActivityAction>()

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
