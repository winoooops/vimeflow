import type { Pane } from '../types'

export const isShellPane = (pane: Pane): boolean =>
  (pane.kind ?? 'shell') === 'shell'

export const isBrowserPane = (pane: Pane): boolean => pane.kind === 'browser'
