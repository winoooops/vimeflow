import type { Chord } from './chord'

export type BindingContext =
  | 'global'
  | 'terminal'
  | 'editor'
  | 'diff'
  | 'dock'
  | 'browser'

export interface CommandDescriptor {
  readonly id: string
  readonly label: string
  readonly group: string
  readonly context: BindingContext
  readonly matchPolicy: 'exact' | 'tolerant'
  readonly defaultCombo: Chord | ((isMac: boolean) => Chord)
  readonly rebindable: boolean
  readonly preserveStoredOverrides?: boolean
  readonly intentionalShadow?: boolean
}

const c = (
  code: string,
  ...mods: ('Mod' | 'Ctrl' | 'Shift' | 'Alt')[]
): Chord => ({ code, mods: new Set(mods) })

// PR1 migrated usePaneShortcuts (the focus-pane / cycle-layout commands) and
// useDockToggleShortcut. PR2 migrates the remaining workspace hooks. Their
// defaultCombo MUST equal today's hardcoded combos (resolve.test asserts this).
// Terminal-owned rows and the SP3-owned palette leader remain display-only.
export const CATALOG = [
  // ── Panes & Layout (MIGRATED — rebindable) ──
  {
    id: 'focus-pane-1',
    label: 'Focus pane 1',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('Digit1', 'Mod'),
  },
  {
    id: 'focus-pane-2',
    label: 'Focus pane 2',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('Digit2', 'Mod'),
  },
  {
    id: 'focus-pane-3',
    label: 'Focus pane 3',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('Digit3', 'Mod'),
  },
  {
    id: 'focus-pane-4',
    label: 'Focus pane 4',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('Digit4', 'Mod'),
  },
  {
    id: 'focus-pane-left',
    label: 'Focus pane left',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('ArrowLeft', 'Mod', 'Shift'),
  },
  {
    id: 'focus-pane-down',
    label: 'Focus pane down',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('ArrowDown', 'Mod', 'Shift'),
  },
  {
    id: 'focus-pane-up',
    label: 'Focus pane up',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('ArrowUp', 'Mod', 'Shift'),
  },
  {
    id: 'focus-pane-right',
    label: 'Focus pane right',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('ArrowRight', 'Mod', 'Shift'),
  },
  {
    id: 'cycle-layout',
    label: 'Cycle layout',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('Backslash', 'Mod'),
  },

  // ── Global (dock-toggle MIGRATED; others display-only until PR2/SP3) ──
  {
    id: 'dock-toggle',
    label: 'Show / hide editor & diff dock',
    group: 'Global',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('Digit0', 'Mod'),
  },
  {
    id: 'palette',
    label: 'Open command palette',
    group: 'Global',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: false,
    defaultCombo: c('Semicolon', 'Mod'),
  },
  {
    id: 'settings',
    label: 'Open settings',
    group: 'Global',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: false,
    preserveStoredOverrides: true,
    defaultCombo: c('Comma', 'Mod'),
  },
  {
    id: 'settings-control',
    label: 'Open settings (Control)',
    group: 'Reserved',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: false,
    preserveStoredOverrides: true,
    intentionalShadow: true,
    defaultCombo: c('Comma', 'Ctrl'),
  },
  {
    id: 'new-session',
    label: 'New terminal session',
    group: 'Global',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: (isMac: boolean): Chord =>
      isMac ? c('KeyN', 'Mod') : c('KeyN', 'Mod', 'Shift'),
  },
  {
    id: 'session-prev',
    label: 'Previous session',
    group: 'Global',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: (isMac: boolean): Chord =>
      isMac ? c('BracketLeft', 'Mod') : c('BracketLeft', 'Mod', 'Shift'),
  },
  {
    id: 'session-next',
    label: 'Next session',
    group: 'Global',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: (isMac: boolean): Chord =>
      isMac ? c('BracketRight', 'Mod') : c('BracketRight', 'Mod', 'Shift'),
  },
  {
    id: 'sidebar-toggle',
    label: 'Toggle sidebar',
    group: 'Global',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: (isMac: boolean): Chord =>
      isMac ? c('KeyB', 'Mod') : c('KeyB', 'Mod', 'Shift'),
  },
  {
    id: 'sidebar-sessions',
    label: 'Sidebar: show sessions',
    group: 'Global',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: c('KeyS', 'Mod', 'Shift'),
  },
  {
    id: 'sidebar-files',
    label: 'Sidebar: show files',
    group: 'Global',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: c('KeyF', 'Mod', 'Shift'),
  },
  {
    id: 'focus-editor',
    label: 'Focus editor',
    group: 'Global',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: c('KeyE', 'Mod'),
  },
  {
    id: 'focus-diff',
    label: 'Focus diff',
    group: 'Global',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: c('KeyG', 'Mod'),
  },
  {
    id: 'burner-toggle',
    label: 'Toggle burner terminal',
    group: 'Global',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: c('Backquote', 'Ctrl'),
  },

  // ── Terminal (display-only; xterm-owned copy/paste/interrupt) ──
  {
    id: 'terminal-copy',
    label: 'Copy selection',
    group: 'Terminal',
    context: 'terminal',
    matchPolicy: 'exact',
    rebindable: false,
    defaultCombo: (isMac: boolean): Chord =>
      isMac ? c('KeyC', 'Mod') : c('KeyC', 'Mod', 'Shift'),
  },
  {
    id: 'terminal-paste',
    label: 'Paste',
    group: 'Terminal',
    context: 'terminal',
    matchPolicy: 'exact',
    rebindable: false,
    defaultCombo: c('KeyV', 'Mod', 'Shift'),
  },
  {
    id: 'terminal-interrupt',
    label: 'Interrupt (sent to the agent)',
    group: 'Terminal',
    context: 'terminal',
    matchPolicy: 'exact',
    rebindable: false,
    defaultCombo: c('KeyC', 'Ctrl'),
  },

  // ── Browser (display-only; browser chrome owns address-bar focus) ──
  {
    id: 'browser-location',
    label: 'Focus browser address bar',
    group: 'Browser',
    context: 'browser',
    matchPolicy: 'exact',
    rebindable: false,
    preserveStoredOverrides: true,
    defaultCombo: c('KeyL', 'Mod'),
  },
] as const satisfies readonly CommandDescriptor[]

export type CommandId = (typeof CATALOG)[number]['id']

const BY_ID = new Map<string, CommandDescriptor>(
  CATALOG.map((cmd) => [cmd.id, cmd])
)

export const getCommand = (id: CommandId): CommandDescriptor => {
  const cmd = BY_ID.get(id)
  if (cmd === undefined) {
    throw new Error(`unknown command id: ${id}`)
  }

  return cmd
}
