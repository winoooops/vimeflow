import type {
  AgentAlias,
  AppearanceScheme,
  KeymapBinding,
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

export const KEYMAPS: KeymapBinding[] = [
  { id: 'open_palette', label: 'Open command palette', keys: ['⌘', 'K'] },
  { id: 'focus_pane_1', label: 'Focus pane 1', keys: ['⌘', '1'] },
  { id: 'focus_pane_2', label: 'Focus pane 2', keys: ['⌘', '2'] },
  { id: 'focus_pane_3', label: 'Focus pane 3', keys: ['⌘', '3'] },
  { id: 'focus_pane_4', label: 'Focus pane 4', keys: ['⌘', '4'] },
  { id: 'toggle_split', label: 'Toggle split layout', keys: ['⌘', '\\'] },
  { id: 'new_session', label: 'New agent session', keys: ['⌘', 'T'] },
  { id: 'close_pane', label: 'Close focused pane', keys: ['⌘', 'W'] },
  { id: 'open_settings', label: 'Open settings', keys: ['⌘', ','] },
  { id: 'toggle_dock', label: 'Show/hide editor & diff', keys: ['⌘', 'J'] },
  { id: 'next_pane', label: 'Next pane', keys: ['⌘', '⇥'] },
  { id: 'pause_agent', label: 'Pause focused agent', keys: ['⌃', 'C'] },
]

export const DEFAULT_ALIASES: AgentAlias[] = [
  {
    id: 'a1',
    alias: 'cc',
    agent: 'claude',
    model: 'sonnet-4',
    extra: '--continue',
  },
  {
    id: 'a2',
    alias: 'cdx',
    agent: 'codex',
    model: 'gpt-5-codex',
    extra: '',
  },
  {
    id: 'a3',
    alias: 'gem',
    agent: 'gemini',
    model: 'gemini-2.5',
    extra: '--chat',
  },
]
