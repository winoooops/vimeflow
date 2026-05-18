export const TERMINAL_CONTAINER_ID = 'terminal' as const

export const DOCK_CONTAINER_ID = 'dock' as const

export type FocusTarget = 'terminal' | 'editor' | 'diff'

export const DIALOG_SELECTOR =
  '[role="dialog"]:not([hidden]):not([aria-hidden="true"]),[role="alertdialog"]:not([hidden]):not([aria-hidden="true"])'
