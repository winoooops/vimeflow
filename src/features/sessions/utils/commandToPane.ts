import { AGENTS } from '../../../agents/registry'
import type { PaneKind } from '../types'
import type { CommandId } from '../types'

export interface CommandPaneResult {
  kind: PaneKind
  userLabel?: string
}

// v1: agent picks create a labeled shell pane (no CLI launch); browser → browser
// pane; shell → plain shell. The label makes the intent visible in the header.
export const commandToPane = (command: CommandId): CommandPaneResult => {
  if (command === 'browser') return { kind: 'browser' }
  if (command === 'shell') return { kind: 'shell' }
  return { kind: 'shell', userLabel: AGENTS[command].name }
}
