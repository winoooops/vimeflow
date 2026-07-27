import { useMemo } from 'react'
import { type NativeOverlayActivityPopoverPayload } from '@/components/nativeOverlayActivity'
import type { ActivityEvent } from '../types/activityEvent'

export { isNativeActivityPopoverRequest } from '@/components/nativeOverlayActivity'

export { useNativeActivityPopoverHost } from '@/components/useNativeActivityPopoverHost'

const ACTIVITY_ACTIVATE_ACTION = 'activity:activate'
const ACTIVITY_SHOW_DIFF_ACTION = 'activity:show-diff'

type NativeActivityAction = () => void

const EMPTY_ACTIONS = new Map<string, NativeActivityAction>()

interface NativeActivityPopoverSourceOptions {
  event: ActivityEvent
  ariaLabel: string
  onActivate?: () => void
  onShowDiff?: () => void
  showDiffShortcut?: string
  showDiffAriaShortcut?: string
}

interface NativeActivityPopoverSource {
  payload: NativeOverlayActivityPopoverPayload
  actions: ReadonlyMap<string, NativeActivityAction>
}

export const useNativeActivityPopoverSource = ({
  event,
  ariaLabel,
  onActivate = undefined,
  onShowDiff = undefined,
  showDiffShortcut = undefined,
  showDiffAriaShortcut = undefined,
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
      ...(onShowDiff === undefined
        ? {}
        : {
            showDiffActionId: ACTIVITY_SHOW_DIFF_ACTION,
            showDiffShortcut,
            showDiffAriaShortcut,
          }),
    }),
    [
      ariaLabel,
      event,
      onActivate,
      onShowDiff,
      showDiffAriaShortcut,
      showDiffShortcut,
    ]
  )

  const actions = useMemo<ReadonlyMap<string, NativeActivityAction>>(
    () =>
      onActivate === undefined && onShowDiff === undefined
        ? EMPTY_ACTIONS
        : new Map([
            ...(onActivate === undefined
              ? []
              : [[ACTIVITY_ACTIVATE_ACTION, onActivate] as const]),
            ...(onShowDiff === undefined
              ? []
              : [[ACTIVITY_SHOW_DIFF_ACTION, onShowDiff] as const]),
          ]),
    [onActivate, onShowDiff]
  )

  return { payload, actions }
}
