import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import type { Agent } from '@/agents/registry'
import type {
  NativeOverlayActionHandler,
  NativeOverlayNotificationCenterDialogPayload,
  NativeOverlayNotificationCenterItem,
} from '@/components/Popover'
import { preloadNativeOverlay } from '@/components/Popover'
import { agentForPane } from '@/features/sessions/utils/agentForSession'
import type { NotificationRecord } from '../../hooks/useNotificationCenter'
import {
  hasUnreadAlert,
  notificationCategory,
  unreadNotificationCount,
} from '../../hooks/useNotificationCenter'
import type { Session } from '../../types'

const TOAST_DWELL_MS = 4000
const TOAST_WIDTH_PX = 380

export const NOTIFICATION_PANEL_WIDTH_PX = 440

// Intermediary exit beat for the panel card (vfNotificationPanelOut); the
// island's return morph starts at the same moment, so the two crossfade.
const PANEL_EXIT_MS = 160
// Gives the toast shrink morph a head start before the session jump's heavy
// re-render, so Open reads as collapse-then-jump instead of a frozen snap.
const OPEN_JUMP_DELAY_MS = 160

export type IslandStage = 'pill' | 'badge' | 'toast' | 'panel'

// Pill/badge stay content-sized (like v1); toast/panel morph to fixed widths
// via the island's 340ms spring and interpolate-size.
export const ISLAND_STAGE_WIDTH: Readonly<
  Record<IslandStage, number | undefined>
> = {
  pill: undefined,
  badge: undefined,
  toast: TOAST_WIDTH_PX,
  panel: NOTIFICATION_PANEL_WIDTH_PX,
}

// Virtual point under the island's top edge; the panel card hangs from it so
// no empty strip lingers above the panel in the panel stage.
interface PanelAnchorPoint {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

// Frozen copy of the last shown toast so the exit morph replays real content
// instead of unmounting mid-transition.
export interface ToastDisplay {
  readonly record: NotificationRecord
  readonly sessionName: string
  readonly agent: Agent
}

export interface UseNotificationIslandStageOptions {
  readonly records: readonly NotificationRecord[]
  readonly sessions: readonly Session[]
  readonly onOpen: (id: string) => void
  readonly onDismiss: (id: string) => void
  readonly onMarkAllRead: () => void
  readonly onClear: () => void
}

export interface NotificationIslandModel {
  readonly stage: IslandStage
  readonly stripHidden: boolean
  readonly unread: number
  readonly unreadAlert: boolean
  readonly displayToast: ToastDisplay | null
  readonly coalescedCount: number
  readonly freshId: string | null
  readonly panelOpen: boolean
  readonly panelClosing: boolean
  readonly panelAnchor: PanelAnchorPoint | null
  readonly nativeOverlayActive: boolean
  readonly panelItems: readonly NativeOverlayNotificationCenterItem[]
  readonly notificationPayload: NativeOverlayNotificationCenterDialogPayload
  readonly nativeActions: ReadonlyMap<string, NativeOverlayActionHandler>
  readonly rootRef: RefObject<HTMLElement | null>
  readonly bellRef: RefObject<HTMLButtonElement | null>
  readonly toastButtonRef: RefObject<HTMLButtonElement | null>
  readonly togglePanel: () => void
  readonly openPanel: () => void
  readonly closePanel: () => void
  readonly handlePanelOpenChange: (open: boolean) => void
  readonly setNativeOverlayActive: (active: boolean) => void
  readonly openRecord: (id: string) => void
  readonly dismissRecord: (id: string) => void
  readonly closeToast: () => void
  readonly holdToastDwell: () => void
  readonly startToastDwell: () => void
}

const resolveIslandStage = (
  hasRecords: boolean,
  panelOpen: boolean,
  hasToast: boolean
): IslandStage => {
  if (!hasRecords) {
    return 'pill'
  }

  if (panelOpen) {
    return 'panel'
  }

  return hasToast ? 'toast' : 'badge'
}

// The island's whole four-stage behavior — arrival detection, dwell timing,
// coalescing, read/dismiss routing, panel anchoring, and focus management —
// so NotificationIsland stays a readable composition of bell, toast, and
// panel pieces.
export const useNotificationIslandStage = ({
  records,
  sessions,
  onOpen,
  onDismiss,
  onMarkAllRead,
  onClear,
}: UseNotificationIslandStageOptions): NotificationIslandModel => {
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions]
  )

  const visibleRecords = useMemo(
    () =>
      records.filter((record) =>
        sessionsById
          .get(record.sessionId)
          ?.panes.some(({ ptyId }) => ptyId === record.ptyId)
      ),
    [records, sessionsById]
  )

  const panelItems = useMemo<readonly NativeOverlayNotificationCenterItem[]>(
    () =>
      visibleRecords.flatMap((record) => {
        const session = sessionsById.get(record.sessionId)
        const pane = session?.panes.find(({ ptyId }) => ptyId === record.ptyId)
        if (session === undefined || pane === undefined) {
          return []
        }

        return [
          {
            id: record.id,
            kind: notificationCategory(record.reason),
            title: record.title,
            ...(record.body === undefined ? {} : { body: record.body }),
            sessionName: session.name,
            agentId: agentForPane(pane).id,
            occurredAt: record.occurredAt,
            read: record.read,
            openActionId: `notification:open:${record.id}`,
            dismissActionId: `notification:dismiss:${record.id}`,
          },
        ]
      }),
    [sessionsById, visibleRecords]
  )
  const rootRef = useRef<HTMLElement | null>(null)
  const bellRef = useRef<HTMLButtonElement | null>(null)
  const toastButtonRef = useRef<HTMLButtonElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const freshTimerRef = useRef<number | null>(null)
  const toastIdRef = useRef<string | null>(null)
  const lastToastRef = useRef<ToastDisplay | null>(null)
  const openTimerRef = useRef<number | null>(null)
  const panelExitTimerRef = useRef<number | null>(null)
  const wasPanelOpenRef = useRef(false)
  const restoreBellFocusRef = useRef(true)
  const seenIdsRef = useRef(new Set(visibleRecords.map(({ id }) => id)))
  const [toastId, setToastId] = useState<string | null>(null)
  const [coalescedCount, setCoalescedCount] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelClosing, setPanelClosing] = useState(false)
  const [panelAnchor, setPanelAnchor] = useState<PanelAnchorPoint | null>(null)
  const [freshId, setFreshId] = useState<string | null>(null)
  const [pingArrivalId, setPingArrivalId] = useState<string | null>(null)
  const [nativeOverlayActive, setNativeOverlayActive] = useState(false)

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Warm the native overlay layer once the panel can actually show content.
  // Creating hidden native overlay windows during an empty app boot can disturb
  // Electron E2E window targeting before any notification surface is usable.
  useEffect(() => {
    if (visibleRecords.length === 0) {
      return
    }

    preloadNativeOverlay()
  }, [visibleRecords.length])

  const closeToast = useCallback((): void => {
    clearTimer()
    toastIdRef.current = null
    setToastId(null)
    setCoalescedCount(0)
  }, [clearTimer])

  const startToastDwell = useCallback((): void => {
    clearTimer()
    timerRef.current = window.setTimeout(closeToast, TOAST_DWELL_MS)
  }, [clearTimer, closeToast])

  const cancelPanelExit = useCallback((): void => {
    if (panelExitTimerRef.current !== null) {
      window.clearTimeout(panelExitTimerRef.current)
      panelExitTimerRef.current = null
    }
    setPanelClosing(false)
  }, [])

  // All panel closes route through the intermediary exit beat: the card
  // plays vfNotificationPanelOut while the island's return morph starts
  // underneath it (stage already left 'panel'). Reduced motion collapses
  // the beat to 1ms like every other island transition.
  const closePanel = useCallback((): void => {
    if (!panelOpen || panelExitTimerRef.current !== null) {
      return
    }

    const exitMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 1
      : PANEL_EXIT_MS
    setPanelClosing(true)
    panelExitTimerRef.current = window.setTimeout(() => {
      panelExitTimerRef.current = null
      setPanelClosing(false)
      setPanelOpen(false)
    }, exitMs)
  }, [panelOpen])

  useEffect(
    () => (): void => {
      clearTimer()
      if (freshTimerRef.current !== null) {
        window.clearTimeout(freshTimerRef.current)
      }
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current)
      }
      if (panelExitTimerRef.current !== null) {
        window.clearTimeout(panelExitTimerRef.current)
      }
    },
    [clearTimer]
  )

  useEffect(() => {
    if (visibleRecords.length === 0) {
      seenIdsRef.current = new Set()
      closeToast()
      setFreshId(null)
      cancelPanelExit()
      setPanelOpen(false)
      lastToastRef.current = null

      return
    }

    const arrivals = visibleRecords.filter(
      ({ id }) => !seenIdsRef.current.has(id)
    )
    seenIdsRef.current = new Set([
      ...seenIdsRef.current,
      ...visibleRecords.map(({ id }) => id),
    ])

    if (arrivals.length === 0) {
      return
    }

    const newest = arrivals[0]

    setCoalescedCount((current) =>
      toastIdRef.current === null
        ? arrivals.length - 1
        : current + arrivals.length
    )
    toastIdRef.current = newest.id
    setToastId(newest.id)
    setFreshId(newest.id)
    setPingArrivalId(newest.id)
    if (freshTimerRef.current !== null) {
      window.clearTimeout(freshTimerRef.current)
    }
    freshTimerRef.current = window.setTimeout(() => {
      freshTimerRef.current = null
      setFreshId(null)
    }, 300)
    cancelPanelExit()
    setPanelOpen(false)
    startToastDwell()
  }, [cancelPanelExit, closeToast, startToastDwell, visibleRecords])

  useEffect(() => {
    if (toastId === null) {
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeToast()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return (): void => window.removeEventListener('keydown', onKeyDown)
  }, [closeToast, toastId])

  useEffect(() => {
    if (
      toastId !== null &&
      document.activeElement instanceof Node &&
      rootRef.current?.contains(document.activeElement)
    ) {
      toastButtonRef.current?.focus()
    }
  }, [toastId])

  useEffect(() => {
    if (toastId === null) {
      return
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        rootRef.current?.contains(event.target)
      ) {
        return
      }

      closeToast()
    }

    document.addEventListener('pointerdown', onPointerDown)

    return (): void =>
      document.removeEventListener('pointerdown', onPointerDown)
  }, [closeToast, toastId])

  const openPanel = useCallback((): void => {
    cancelPanelExit()

    const rect = rootRef.current?.getBoundingClientRect()
    if (rect !== undefined) {
      // Anchor to the island's top-center point: the card opens where the
      // island sits, and the (center-invariant) morph can't drift it.
      setPanelAnchor({
        x: rect.x + rect.width / 2,
        y: rect.y,
        width: 0,
        height: 0,
      })
    }

    closeToast()
    setPanelOpen(true)
  }, [cancelPanelExit, closeToast])

  const togglePanel = useCallback((): void => {
    closeToast()
    if (panelOpen) {
      closePanel()
    } else {
      openPanel()
    }
  }, [closePanel, closeToast, openPanel, panelOpen])

  // Popover's onOpenChange: opening is immediate; closing always goes
  // through the intermediary exit beat.
  const handlePanelOpenChange = useCallback(
    (open: boolean): void => {
      if (open) {
        setPanelOpen(true)
      } else {
        closePanel()
      }
    },
    [closePanel]
  )

  const openRecord = useCallback(
    (id: string): void => {
      restoreBellFocusRef.current = false
      closeToast()
      closePanel()
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current)
      }
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null
        onOpen(id)
      }, OPEN_JUMP_DELAY_MS)
    },
    [closePanel, closeToast, onOpen]
  )

  const dismissRecord = useCallback(
    (id: string): void => {
      onDismiss(id)
      if (toastId === id) {
        closeToast()
      }
    },
    [closeToast, onDismiss, toastId]
  )

  const notificationPayload =
    useMemo<NativeOverlayNotificationCenterDialogPayload>(
      () => ({
        kind: 'dialog',
        dialog: 'notification-center',
        ariaLabel: 'Notification center',
        items: [...panelItems],
        actions: {
          markAllRead: 'notification:mark-all-read',
          clear: 'notification:clear',
          close: 'notification:close',
        },
      }),
      [panelItems]
    )

  const nativeActions = useMemo<
    ReadonlyMap<string, NativeOverlayActionHandler>
  >(() => {
    const actions = new Map<string, NativeOverlayActionHandler>([
      [
        notificationPayload.actions.markAllRead,
        { retainSession: true, run: onMarkAllRead },
      ],
      [
        notificationPayload.actions.clear,
        (): void => {
          onClear()
          setPanelOpen(false)
        },
      ],
      // Plain (non-retain) handler: the surface closes immediately like every
      // other native close; the exit beat only animates the island's return.
      [
        notificationPayload.actions.close,
        (): void => {
          closePanel()
        },
      ],
    ])

    for (const item of notificationPayload.items) {
      actions.set(item.openActionId, (): void => openRecord(item.id))
      actions.set(item.dismissActionId, {
        retainSession: true,
        run: (): void => dismissRecord(item.id),
      })
    }

    return actions
  }, [
    closePanel,
    dismissRecord,
    notificationPayload,
    onClear,
    onMarkAllRead,
    openRecord,
  ])

  useEffect(() => {
    if (panelOpen) {
      restoreBellFocusRef.current = true
    } else if (wasPanelOpenRef.current) {
      const restoreBellFocus = restoreBellFocusRef.current
      restoreBellFocusRef.current = true
      if (restoreBellFocus) {
        // focusVisible: false keeps the focus move (keyboard/AT users land
        // back on the bell) without matching :focus-visible — an Escape
        // close would otherwise leave a "navigation" ring on the bell. The
        // property is missing from this TS lib's FocusOptions, hence the
        // widened type (supported in Chromium/WebKit).
        const focusOptions: FocusOptions & { focusVisible?: boolean } = {
          focusVisible: false,
        }
        queueMicrotask(() => bellRef.current?.focus(focusOptions))
      }
    }
    wasPanelOpenRef.current = panelOpen
  }, [panelOpen])

  // Replays the 420ms bell ping on every arrival. Done imperatively (remove,
  // reflow, re-add) instead of remounting so a focused bell keeps its focus.
  useEffect(() => {
    if (pingArrivalId === null) {
      return
    }

    const button = bellRef.current
    if (button === null) {
      return
    }

    button.classList.remove('vf-notification-bell-ping')
    void button.offsetWidth
    button.classList.add('vf-notification-bell-ping')
  }, [pingArrivalId])

  const unread = unreadNotificationCount(visibleRecords)
  const unreadAlert = hasUnreadAlert(visibleRecords)
  const toastRecord = visibleRecords.find(({ id }) => id === toastId)

  const stage = resolveIslandStage(
    visibleRecords.length > 0,
    panelOpen && !panelClosing,
    toastRecord !== undefined
  )

  const toastSession =
    toastRecord === undefined
      ? undefined
      : sessionsById.get(toastRecord.sessionId)

  const toastPane = toastSession?.panes.find(
    ({ ptyId }) => ptyId === toastRecord?.ptyId
  )

  const toastAgent =
    toastPane === undefined ? undefined : agentForPane(toastPane)

  useEffect(() => {
    if (
      toastRecord !== undefined &&
      toastSession !== undefined &&
      toastAgent !== undefined
    ) {
      lastToastRef.current = {
        record: toastRecord,
        sessionName: toastSession.name,
        agent: toastAgent,
      }
    }
  }, [toastAgent, toastRecord, toastSession])

  const displayToast =
    toastRecord !== undefined &&
    toastSession !== undefined &&
    toastAgent !== undefined
      ? {
          record: toastRecord,
          sessionName: toastSession.name,
          agent: toastAgent,
        }
      : lastToastRef.current

  return {
    stage,
    stripHidden: stage === 'toast' || stage === 'panel',
    unread,
    unreadAlert,
    displayToast,
    coalescedCount,
    freshId,
    panelOpen,
    panelClosing,
    panelAnchor,
    nativeOverlayActive,
    panelItems,
    notificationPayload,
    nativeActions,
    rootRef,
    bellRef,
    toastButtonRef,
    togglePanel,
    openPanel,
    closePanel,
    handlePanelOpenChange,
    setNativeOverlayActive,
    openRecord,
    dismissRecord,
    closeToast,
    holdToastDwell: clearTimer,
    startToastDwell,
  }
}
