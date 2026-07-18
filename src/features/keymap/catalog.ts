import type { Chord, Mod } from './chord'

export type BindingContext =
  | 'global'
  | 'terminal'
  | 'editor'
  | 'diff'
  | 'dock'
  | 'browser'

const c = (code: string, ...mods: Mod[]): Chord => ({
  code,
  mods: new Set(mods),
})

const DIFF_GROUP = 'Diff (when focused)'
type DiffMod = Exclude<Mod, 'Mod'>

interface DiffCommandLiteral<Id extends string> {
  readonly id: Id
  readonly label: string
  readonly group: typeof DIFF_GROUP
  readonly context: 'diff'
  readonly matchPolicy: 'exact'
  readonly rebindable: true
  readonly defaultCombo: Chord
}

const diffCommand = <Id extends string>(
  id: Id,
  label: string,
  code: string,
  ...mods: DiffMod[]
): DiffCommandLiteral<Id> => ({
  id,
  label,
  group: DIFF_GROUP,
  context: 'diff' as const,
  matchPolicy: 'exact' as const,
  rebindable: true as const,
  defaultCombo: c(code, ...mods),
})

const DIFF_CATALOG_LITERAL = [
  diffCommand('diff-line-next', 'Move to next line', 'KeyJ'),
  diffCommand('diff-line-previous', 'Move to previous line', 'KeyK'),
  diffCommand('diff-scroll-page-down', 'Scroll down half page', 'KeyD', 'Ctrl'),
  diffCommand('diff-scroll-page-up', 'Scroll up half page', 'KeyU', 'Ctrl'),
  diffCommand('diff-file-next', 'Next file / search match', 'KeyN'),
  diffCommand('diff-file-previous', 'Previous file / search match', 'KeyP'),
  diffCommand('diff-search-open', 'Open diff search', 'Slash'),
  diffCommand(
    'diff-search-or-visual-cancel',
    'Close search / cancel visual selection',
    'Escape'
  ),
  {
    ...diffCommand('diff-search-commit-next', 'Commit search forward', 'Enter'),
    intentionalShadowWith: ['diff-comment-submit'],
  },
  diffCommand(
    'diff-search-commit-previous',
    'Commit search backward',
    'Enter',
    'Shift'
  ),
  diffCommand('diff-files-toggle', 'Show / hide changed files', 'KeyE'),
  diffCommand('diff-files-pin', 'Pin / unpin changed files', 'KeyE', 'Shift'),
  diffCommand('diff-refresh', 'Refresh diff', 'KeyR'),
  diffCommand('diff-hunk-previous', 'Previous hunk', 'BracketLeft'),
  diffCommand('diff-hunk-next', 'Next hunk', 'BracketRight'),
  diffCommand('diff-side-deletions', 'Move to deletions side', 'KeyH'),
  diffCommand('diff-side-additions', 'Move to additions side', 'KeyL'),
  diffCommand('diff-view-toggle', 'Toggle split / unified view', 'KeyT'),
  diffCommand('diff-comment-line', 'Comment on selected line / range', 'KeyI'),
  diffCommand('diff-comment-file', 'Comment on selected file', 'KeyI', 'Shift'),
  diffCommand('diff-comment-update', 'Edit selected line comment', 'KeyU'),
  diffCommand(
    'diff-file-comment-update',
    'Edit selected file comment',
    'KeyU',
    'Shift'
  ),
  diffCommand('diff-comment-delete', 'Delete selected line comment', 'KeyX'),
  diffCommand(
    'diff-comment-category-previous',
    'Previous comment category',
    'KeyH',
    'Ctrl'
  ),
  diffCommand(
    'diff-comment-category-next',
    'Next comment category',
    'KeyL',
    'Ctrl'
  ),
  diffCommand(
    'diff-comment-insert-newline',
    'Insert comment newline',
    'KeyJ',
    'Ctrl'
  ),
  diffCommand(
    'diff-comment-cursor-up',
    'Move comment cursor up',
    'KeyK',
    'Ctrl'
  ),
  {
    ...diffCommand('diff-comment-submit', 'Submit comment', 'Enter'),
    intentionalShadowWith: ['diff-search-commit-next'],
  },
  {
    ...diffCommand('diff-comment-cancel', 'Cancel comment', 'Escape'),
    intentionalShadowWith: ['diff-search-or-visual-cancel'],
  },
  diffCommand('diff-visual-start', 'Start visual selection', 'KeyV'),
  diffCommand('diff-visual-yank', 'Copy visual selection', 'KeyY'),
  diffCommand('diff-review-finish', 'Finish feedback', 'KeyY', 'Shift'),
  diffCommand('diff-review-request', 'Request agent review', 'Digit2', 'Shift'),
  diffCommand('diff-request-review-scope-file', 'Review this file', 'KeyF'),
  diffCommand(
    'diff-request-review-scope-changelist',
    'Review all changes',
    'KeyA'
  ),
  diffCommand('diff-review-copy', 'Copy review payload', 'KeyC'),
  {
    ...diffCommand(
      'diff-request-review-submit',
      'Delegate review request',
      'KeyY',
      'Shift'
    ),
    intentionalShadowWith: [
      'diff-review-finish',
      'diff-feedback-send',
      'diff-commit-review-submit',
    ],
  },
  {
    ...diffCommand(
      'diff-feedback-send',
      'Send finished feedback',
      'KeyY',
      'Shift'
    ),
    intentionalShadowWith: [
      'diff-review-finish',
      'diff-request-review-submit',
      'diff-commit-review-submit',
    ],
  },
  {
    ...diffCommand(
      'diff-commit-review-submit',
      'Submit commit review',
      'KeyY',
      'Shift'
    ),
    intentionalShadowWith: [
      'diff-review-finish',
      'diff-request-review-submit',
      'diff-feedback-send',
    ],
  },
  {
    ...diffCommand('diff-confirm-accept', 'Accept confirmation', 'KeyY'),
    intentionalShadowWith: [
      'diff-visual-yank',
      'diff-search-commit-next',
      'diff-comment-submit',
    ],
  },
  {
    ...diffCommand('diff-confirm-cancel', 'Cancel confirmation', 'KeyN'),
    intentionalShadowWith: [
      'diff-file-next',
      'diff-search-or-visual-cancel',
      'diff-comment-cancel',
    ],
  },
  diffCommand('diff-hunk-stage', 'Stage / unstage hunk', 'KeyS'),
  diffCommand('diff-hunk-discard', 'Discard hunk', 'KeyD'),
  diffCommand('diff-file-discard', 'Discard file', 'KeyD', 'Shift'),
] as const

// PR1 migrated usePaneShortcuts (the focus-pane / cycle-layout commands) and
// useDockToggleShortcut. PR2 migrates the remaining workspace hooks. PR3
// migrates the command-palette direct toggle and leader prefix. Their
// defaultCombo MUST equal today's hardcoded combos (resolve.test asserts this).
// Terminal-owned rows remain display-only. Diff bindings are focus-scoped;
// normal-mode handlers ignore text entry, while editor commands opt in.
const CATALOG_LITERAL = [
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
    id: 'focus-pane-5',
    label: 'Focus pane 5',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('Digit5', 'Mod'),
  },
  {
    id: 'focus-pane-6',
    label: 'Focus pane 6',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('Digit6', 'Mod'),
  },
  {
    id: 'focus-pane-7',
    label: 'Focus pane 7',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('Digit7', 'Mod'),
  },
  {
    id: 'focus-pane-8',
    label: 'Focus pane 8',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('Digit8', 'Mod'),
  },
  {
    id: 'focus-pane-9',
    label: 'Focus pane 9',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('Digit9', 'Mod'),
  },
  {
    id: 'focus-pane-left',
    label: 'Focus pane left',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('ArrowLeft', 'Ctrl'),
  },
  {
    id: 'focus-pane-down',
    label: 'Focus pane down',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('ArrowDown', 'Ctrl'),
  },
  {
    id: 'focus-pane-up',
    label: 'Focus pane up',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('ArrowUp', 'Ctrl'),
  },
  {
    id: 'focus-pane-right',
    label: 'Focus pane right',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'tolerant',
    rebindable: true,
    defaultCombo: c('ArrowRight', 'Ctrl'),
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
  {
    id: 'single-pane-focus',
    label: 'Toggle active-pane focus',
    group: 'Panes & Layout',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: c('KeyZ', 'Mod'),
  },

  // ── Global (MIGRATED — rebindable except fixed settings shortcuts) ──
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
    id: 'activity-panel-toggle',
    label: 'Show / hide agent activity panel',
    group: 'Global',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: (isMac: boolean): Chord =>
      isMac ? c('KeyR', 'Mod') : c('KeyR', 'Mod', 'Shift'),
  },
  {
    id: 'palette',
    label: 'Open command palette',
    group: 'Global',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    intentionalShadowWith: ['palette-leader'],
    defaultCombo: c('Semicolon', 'Mod'),
  },
  {
    id: 'palette-leader',
    label: 'Command palette leader',
    group: 'Global',
    context: 'global',
    matchPolicy: 'exact',
    rebindable: true,
    intentionalShadowWith: ['palette'],
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

  // ── Browser (focus-scoped) ──
  {
    id: 'browser-location',
    label: 'Focus browser address bar',
    group: 'Browser',
    context: 'browser',
    matchPolicy: 'exact',
    rebindable: true,
    defaultCombo: c('KeyL', 'Mod'),
  },
  ...DIFF_CATALOG_LITERAL,
] as const

export type CommandId = (typeof CATALOG_LITERAL)[number]['id']

export type DiffCommandId = (typeof DIFF_CATALOG_LITERAL)[number]['id']

export interface CommandDescriptor {
  readonly id: CommandId
  readonly label: string
  readonly group: string
  readonly context: BindingContext
  readonly matchPolicy: 'exact' | 'tolerant'
  readonly defaultCombo: Chord | ((isMac: boolean) => Chord)
  readonly rebindable: boolean
  readonly preserveStoredOverrides?: boolean
  readonly intentionalShadow?: boolean
  readonly intentionalShadowWith?: readonly CommandId[]
}

export interface DiffCommandDescriptor extends CommandDescriptor {
  readonly id: DiffCommandId
  readonly context: 'diff'
  readonly defaultCombo: Chord
  readonly rebindable: true
}

// Exported catalog is widened to CommandDescriptor so consumers see a uniform
// array type, while CommandId is derived from the literal catalog above. This
// breaks the circular dependency and lets intentionalShadowWith reject typos
// at compile time.
export const CATALOG: readonly CommandDescriptor[] = CATALOG_LITERAL

export const DIFF_COMMANDS: readonly DiffCommandDescriptor[] =
  DIFF_CATALOG_LITERAL

const BY_ID = new Map<CommandId, CommandDescriptor>(
  CATALOG.map((cmd) => [cmd.id, cmd])
)

export const getCommand = (id: CommandId): CommandDescriptor => {
  const cmd = BY_ID.get(id)
  if (cmd === undefined) {
    throw new Error(`unknown command id: ${id}`)
  }

  return cmd
}
