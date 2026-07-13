import { AGENTS } from '../../../agents/registry'
import type { CommandId, PaneKind } from '../types'

export interface CommandPaneResult {
  kind: PaneKind
  userLabel?: string
}

// Agent picks create a labeled shell pane; useSessionManager writes the chosen
// canonical launcher or configured alias after the PTY is registered. Browser
// and plain-shell picks need no launcher metadata here.
export const commandToPane = (command: CommandId): CommandPaneResult => {
  if (command === 'browser') {
    return { kind: 'browser' }
  }

  if (command === 'shell') {
    return { kind: 'shell' }
  }

  return { kind: 'shell', userLabel: AGENTS[command].name }
}
