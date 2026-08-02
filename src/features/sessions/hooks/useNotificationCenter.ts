import { useCallback, useReducer } from 'react'

const MAX_NOTIFICATION_RECORDS = 50

export type NotificationReason =
  | 'turn-complete'
  | 'approval-requested'
  | 'question-requested'
  | 'agent-error'
  | 'terminal-attention'

export type NotificationCategory = 'need' | 'err'

export interface NotificationInput {
  readonly sessionId: string
  readonly ptyId: string
  readonly reason: NotificationReason
  readonly title: string
  readonly body?: string
  readonly occurredAt: number
  readonly dedupeKey?: string
}

export interface NotificationRecord extends NotificationInput {
  readonly id: string
  readonly read: boolean
}

export interface NotificationCenterState {
  readonly records: readonly NotificationRecord[]
}

export type NotificationCenterAction =
  | { readonly type: 'publish'; readonly record: NotificationRecord }
  | { readonly type: 'mark-read'; readonly id: string }
  | { readonly type: 'mark-all-read' }
  | { readonly type: 'dismiss'; readonly id: string }
  | { readonly type: 'prune-session'; readonly sessionId: string }
  | {
      readonly type: 'prune-pane'
      readonly sessionId: string
      readonly ptyId: string
    }
  | { readonly type: 'clear' }

export interface NotificationCenter {
  readonly records: readonly NotificationRecord[]
  readonly publish: (input: NotificationInput) => void
  readonly markRead: (id: string) => void
  readonly markAllRead: () => void
  readonly dismiss: (id: string) => void
  readonly pruneSession: (sessionId: string) => void
  readonly prunePane: (sessionId: string, ptyId: string) => void
  readonly clear: () => void
}

export const notificationCenterInitialState: NotificationCenterState = {
  records: [],
}

export const notificationCategory = (
  reason: NotificationReason
): NotificationCategory => (reason === 'agent-error' ? 'err' : 'need')

const isDuplicate = (
  records: readonly NotificationRecord[],
  incoming: NotificationRecord
): boolean =>
  incoming.dedupeKey !== undefined &&
  records.some(
    ({ ptyId, dedupeKey }) =>
      ptyId === incoming.ptyId && dedupeKey === incoming.dedupeKey
  )

export const notificationCenterReducer = (
  state: NotificationCenterState,
  action: NotificationCenterAction
): NotificationCenterState => {
  switch (action.type) {
    case 'publish':
      if (isDuplicate(state.records, action.record)) {
        return state
      }

      return {
        records: [action.record, ...state.records].slice(
          0,
          MAX_NOTIFICATION_RECORDS
        ),
      }
    case 'mark-read': {
      const target = state.records.find(({ id }) => id === action.id)
      if (target === undefined || target.read) {
        return state
      }

      return {
        records: state.records.map((item) =>
          item.id === action.id ? { ...item, read: true } : item
        ),
      }
    }
    case 'mark-all-read':
      if (state.records.every(({ read }) => read)) {
        return state
      }

      return {
        records: state.records.map((item) =>
          item.read ? item : { ...item, read: true }
        ),
      }
    case 'dismiss': {
      const records = state.records.filter(({ id }) => id !== action.id)

      return records.length === state.records.length ? state : { records }
    }
    case 'prune-session': {
      const records = state.records.filter(
        ({ sessionId }) => sessionId !== action.sessionId
      )

      return records.length === state.records.length ? state : { records }
    }
    case 'prune-pane': {
      const records = state.records.filter(
        ({ sessionId, ptyId }) =>
          sessionId !== action.sessionId || ptyId !== action.ptyId
      )

      return records.length === state.records.length ? state : { records }
    }
    case 'clear':
      return state.records.length === 0 ? state : notificationCenterInitialState
  }
}

export const unreadNotificationCount = (
  records: readonly NotificationRecord[]
): number => records.filter(({ read }) => !read).length

export const hasUnreadAlert = (
  records: readonly NotificationRecord[]
): boolean =>
  records.some(
    ({ read, reason }) => !read && notificationCategory(reason) === 'err'
  )

export const sessionUnreadCategory = (
  records: readonly NotificationRecord[],
  session: {
    readonly id: string
    readonly panes: readonly { readonly ptyId: string }[]
  }
): NotificationCategory | null => {
  const unread = records.filter(
    (record) =>
      record.sessionId === session.id &&
      !record.read &&
      session.panes.some(({ ptyId }) => ptyId === record.ptyId)
  )

  if (unread.some(({ reason }) => notificationCategory(reason) === 'err')) {
    return 'err'
  }

  return unread.length > 0 ? 'need' : null
}

export const useNotificationCenter = (): NotificationCenter => {
  const [state, dispatch] = useReducer(
    notificationCenterReducer,
    notificationCenterInitialState
  )

  const publish = useCallback((input: NotificationInput): void => {
    dispatch({
      type: 'publish',
      record: {
        ...input,
        id: globalThis.crypto.randomUUID(),
        read: false,
      },
    })
  }, [])

  const markRead = useCallback((id: string): void => {
    dispatch({ type: 'mark-read', id })
  }, [])

  const markAllRead = useCallback((): void => {
    dispatch({ type: 'mark-all-read' })
  }, [])

  const dismiss = useCallback((id: string): void => {
    dispatch({ type: 'dismiss', id })
  }, [])

  const pruneSession = useCallback((sessionId: string): void => {
    dispatch({ type: 'prune-session', sessionId })
  }, [])

  const prunePane = useCallback((sessionId: string, ptyId: string): void => {
    dispatch({ type: 'prune-pane', sessionId, ptyId })
  }, [])

  const clear = useCallback((): void => {
    dispatch({ type: 'clear' })
  }, [])

  return {
    records: state.records,
    publish,
    markRead,
    markAllRead,
    dismiss,
    pruneSession,
    prunePane,
    clear,
  }
}
