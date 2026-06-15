import type {
  AgentAlias,
  AppearanceScheme,
  KeymapGroup,
  SettingsSection,
} from './types'

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'keymap', label: 'Keymap', icon: 'keyboard' },
  { id: 'agents', label: 'Coding Agents', icon: 'bolt' },
  { id: 'editor', label: 'Editor', icon: 'code' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'languages', label: 'Languages & Tools', icon: 'data_object' },
  { id: 'search', label: 'Search & Files', icon: 'search' },
  { id: 'window', label: 'Window & Layout', icon: 'grid_view' },
  { id: 'panels', label: 'Panels', icon: 'dock_to_bottom' },
  { id: 'version', label: 'Version Control', icon: 'difference' },
  { id: 'collab', label: 'Collaboration', icon: 'group' },
  { id: 'ai', label: 'AI', icon: 'psychology' },
  { id: 'network', label: 'Network', icon: 'lan' },
]

export const BUILTIN_SCHEMES: AppearanceScheme[] = [
  {
    id: 'obsidian',
    label: 'Obsidian Lens',
    accent: '#cba6f7',
    surface: '#121221',
    text: '#cdc3d1',
  },
  {
    id: 'editorial',
    label: 'Editorial',
    accent: '#a8c8ff',
    surface: '#141424',
    text: '#cdc3d1',
  },
  {
    id: 'dense',
    label: 'Dense',
    accent: '#7defa1',
    surface: '#0d0d1c',
    text: '#cdc3d1',
  },
  {
    id: 'navigator',
    label: 'W.W. Navigator',
    accent: '#c9a55a',
    surface: '#1a1408',
    text: '#d8cbb0',
  },
  {
    id: 'flexoki',
    label: 'Flexoki',
    accent: '#6e4caa',
    surface: '#fffcf0',
    text: '#343331',
  },
]

export const KEYMAP_GROUPS: KeymapGroup[] = [
  {
    zone: 'Global',
    bindings: [
      { id: 'palette', label: 'Open command palette', keys: [['Mod', ';']] },
      {
        id: 'sidebar',
        label: 'Toggle sidebar',
        keys: (isMac) => (isMac ? [['Mod', 'B']] : [['Mod', 'Shift', 'B']]),
      },
      { id: 'editor', label: 'Focus editor', keys: [['Mod', 'E']] },
      { id: 'diff', label: 'Focus diff', keys: [['Mod', 'G']] },
    ],
  },
  {
    zone: 'Panes & Layout',
    bindings: [
      {
        id: 'focus-number',
        label: 'Focus pane by number',
        keys: [
          ['Mod', '1'],
          ['Mod', '2'],
          ['Mod', '3'],
          ['Mod', '4'],
        ],
      },
      {
        id: 'focus-direction',
        label: 'Focus pane left / down / up / right',
        keys: [
          ['Mod', 'Shift', '←'],
          ['Mod', 'Shift', '↓'],
          ['Mod', 'Shift', '↑'],
          ['Mod', 'Shift', '→'],
        ],
      },
      { id: 'cycle-layout', label: 'Cycle layout', keys: [['Mod', '\\']] },
    ],
  },
  {
    zone: 'Terminal',
    bindings: [
      {
        id: 'copy',
        label: 'Copy selection',
        keys: (isMac) => (isMac ? [['Mod', 'C']] : [['Mod', 'Shift', 'C']]),
      },
      { id: 'paste', label: 'Paste', keys: [['Mod', 'Shift', 'V']] },
      {
        id: 'interrupt',
        label: 'Interrupt (sent to the agent)',
        keys: [['Ctrl', 'C']],
      },
    ],
  },
  {
    zone: 'Diff (when focused)',
    bindings: [
      { id: 'diff-nav', label: 'Next / previous file', keys: ['j', 'k'] },
      { id: 'diff-open', label: 'Open file', keys: ['Enter'] },
      { id: 'diff-stage', label: 'Stage / discard', keys: ['Space', 'd'] },
      { id: 'diff-hunk', label: 'Next / previous hunk', keys: ['→', '←'] },
      { id: 'diff-back', label: 'Back to file list', keys: ['Esc'] },
    ],
  },
]

// cspell:disable
export const VIM_KEYMAP_GROUPS: KeymapGroup[] = [
  {
    zone: 'Vim ex-commands (type in the Mod; palette)',
    bindings: [
      { id: 'vim-w', label: 'Save file', keys: [':w'] },
      { id: 'vim-q', label: 'Close pane', keys: [':q'] },
      { id: 'vim-qa', label: 'Close session', keys: [':qa'] },
      { id: 'vim-tabnew', label: 'New session', keys: [':tabnew'] },
      {
        id: 'vim-tab-nav',
        label: 'Next / previous session',
        keys: [':tabn', ':tabp'],
      },
      {
        id: 'vim-layout-cmd',
        label: 'Layout: vsplit / split / only',
        keys: [':vsplit', ':split', ':only'],
      },
      { id: 'vim-edit', label: 'Open a file', keys: [':edit'] },
    ],
  },
  {
    zone: 'Vim leader chords (Mod; then a key)',
    bindings: [
      {
        id: 'vim-hjkl',
        label: 'Focus pane left / down / up / right',
        keys: ['h', 'j', 'k', 'l'],
      },
      { id: 'vim-cycle', label: 'Cycle to next pane', keys: ['w'] },
      { id: 'vim-close', label: 'Close pane', keys: ['c'] },
      {
        id: 'vim-layout-chord',
        label: 'Layout: split / vsplit / only',
        keys: ['s', 'v', 'o'],
      },
    ],
  },
]
// cspell:enable

export const DEFAULT_ALIASES: AgentAlias[] = [
  {
    id: 'a1',
    alias: 'cc',
    agent: 'claude',
    model: 'sonnet-4',
    extra: '--continue',
    account: null,
  },
  {
    id: 'a2',
    alias: 'cdx',
    agent: 'codex',
    model: 'gpt-5-codex',
    extra: '',
    account: null,
  },
  {
    id: 'a3',
    alias: 'gem',
    agent: 'gemini',
    model: 'gemini-2.5',
    extra: '--chat',
    account: null,
  },
]
