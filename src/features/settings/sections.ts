import type {
  AgentAlias,
  KeymapGroup,
  SettingsSection,
  SettingsSubsection,
  SettingsSubsectionId,
  SettingsTarget,
  SettingsTargetId,
} from './types'
import { CATALOG, type CommandId } from '../keymap/catalog'

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

export const SETTINGS_TARGET_IDS = {
  generalCloseWithNoTabs: 'general-close-with-no-tabs',
  generalOnLastWindowClosed: 'general-on-last-window-closed',
  generalUseSystemPathPrompts: 'general-use-system-path-prompts',
  generalUseSystemPrompts: 'general-use-system-prompts',
  generalRedactPrivateValues: 'general-redact-private-values',
  generalCliOpenBehavior: 'general-cli-open-behavior',
  appearanceColorScheme: 'appearance-color-scheme',
  appearanceUiFont: 'appearance-ui-font',
  appearanceReservoirSwell: 'appearance-reservoir-swell',
  terminalFontFamily: 'terminal-font-family',
  keymapPreset: 'keymap-preset',
  agentsManageAliases: 'agents-manage-aliases',
  agentsShellAliases: 'agents-shell-aliases',
} as const satisfies Record<string, SettingsTargetId>

export const keymapCommandTargetId = (id: CommandId): SettingsTargetId =>
  `keymap-command-${id}`

export const keymapStaticTargetId = (id: string): SettingsTargetId =>
  `keymap-static-${id}`

const slugifySubsection = (label: string): string =>
  label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const settingsSubsectionId = (
  section: SettingsSection['id'],
  label: string
): SettingsSubsectionId => `${section}-${slugifySubsection(label)}`

export const KEYMAP_GROUPS: KeymapGroup[] = [
  {
    zone: 'Global',
    bindings: [
      { id: 'palette', label: 'Open command palette', keys: [['Mod', ';']] },
      {
        id: 'new-session',
        label: 'New terminal session',
        keys: (isMac) => (isMac ? [['Mod', 'N']] : [['Mod', 'Shift', 'N']]),
      },
      {
        id: 'session-nav',
        label: 'Previous / next session',
        keys: (isMac) =>
          isMac
            ? [
                ['Mod', '['],
                ['Mod', ']'],
              ]
            : [
                ['Mod', 'Shift', '['],
                ['Mod', 'Shift', ']'],
              ],
      },
      {
        id: 'sidebar',
        label: 'Toggle sidebar',
        keys: (isMac) => (isMac ? [['Mod', 'B']] : [['Mod', 'Shift', 'B']]),
      },
      {
        id: 'sidebar-switch',
        label: 'Sidebar: show sessions / files',
        keys: [
          ['Mod', 'Shift', 'S'],
          ['Mod', 'Shift', 'F'],
        ],
      },
      { id: 'editor', label: 'Focus editor', keys: [['Mod', 'E']] },
      { id: 'diff', label: 'Focus diff', keys: [['Mod', 'G']] },
      {
        id: 'dock',
        label: 'Show / hide editor & diff dock',
        keys: [['Mod', '0']],
      },
      {
        id: 'burner',
        label: 'Toggle burner terminal',
        keys: [['Ctrl', '`']],
      },
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
]
// cspell:enable

const KEYMAP_TARGET_GROUPS = new Set([
  'Global',
  'Panes & Layout',
  'Terminal',
  'Browser',
])

export const SETTINGS_TARGETS: SettingsTarget[] = [
  {
    id: SETTINGS_TARGET_IDS.generalCloseWithNoTabs,
    section: 'general',
    label: 'When Closing With No Tabs',
    hint: "What to do when using the 'close active item' action with no tabs.",
    subsection: 'Window lifecycle',
  },
  {
    id: SETTINGS_TARGET_IDS.generalOnLastWindowClosed,
    section: 'general',
    label: 'On Last Window Closed',
    hint: 'What to do when the last window is closed.',
    subsection: 'Window lifecycle',
  },
  {
    id: SETTINGS_TARGET_IDS.generalUseSystemPathPrompts,
    section: 'general',
    label: 'Use System Path Prompts',
    hint: "Use native OS dialogs for 'Open' and 'Save As'.",
    subsection: 'Prompts',
  },
  {
    id: SETTINGS_TARGET_IDS.generalUseSystemPrompts,
    section: 'general',
    label: 'Use System Prompts',
    hint: 'Use native OS dialogs for confirmations.',
    subsection: 'Prompts',
  },
  {
    id: SETTINGS_TARGET_IDS.generalRedactPrivateValues,
    section: 'general',
    label: 'Redact Private Values',
    hint: 'Hide the values of variables in private files.',
    subsection: 'Privacy',
  },
  {
    id: SETTINGS_TARGET_IDS.generalCliOpenBehavior,
    section: 'general',
    label: 'CLI Default Open Behavior',
    hint: 'How `vf <path>` opens directories when no flag is specified.',
    subsection: 'CLI',
  },
  {
    id: SETTINGS_TARGET_IDS.appearanceColorScheme,
    section: 'appearance',
    label: 'Color Scheme',
    hint: 'The base palette for all surfaces, text, and accents.',
    subsection: 'Theme',
  },
  {
    id: SETTINGS_TARGET_IDS.appearanceUiFont,
    section: 'appearance',
    label: 'Interface Font',
    hint: 'Font used for labels, sidebars, headings, and controls.',
    subsection: 'Fonts',
  },
  {
    id: SETTINGS_TARGET_IDS.appearanceReservoirSwell,
    section: 'appearance',
    label: 'Reservoir Swell',
    hint: 'Hover motion for the context reservoir waterline.',
    subsection: 'Interface',
  },
  {
    id: SETTINGS_TARGET_IDS.terminalFontFamily,
    section: 'terminal',
    label: 'Terminal Font',
    hint: 'Font family used by terminal panes.',
    subsection: 'Typography',
  },
  {
    id: SETTINGS_TARGET_IDS.keymapPreset,
    section: 'keymap',
    label: 'Preset',
    hint: 'Switch between the default Vimeflow binding set and Vim-style bindings.',
    subsection: 'Base Keymap',
  },
  ...CATALOG.filter((cmd) => KEYMAP_TARGET_GROUPS.has(cmd.group)).map(
    (cmd): SettingsTarget => ({
      id: keymapCommandTargetId(cmd.id),
      section: 'keymap',
      label: cmd.label,
      hint: `${cmd.group} shortcut`,
      subsection: cmd.group,
    })
  ),
  ...KEYMAP_GROUPS.filter(
    (group) => group.zone === 'Diff (when focused)'
  ).flatMap((group) =>
    group.bindings.map(
      (binding): SettingsTarget => ({
        id: keymapStaticTargetId(binding.id),
        section: 'keymap',
        label: binding.label,
        hint: `${group.zone} shortcut`,
        subsection: group.zone,
      })
    )
  ),
  {
    id: SETTINGS_TARGET_IDS.agentsManageAliases,
    section: 'agents',
    label: 'Manage agent shell aliases',
    hint: "Vimeflow injects these into each pane's PTY environment.",
    subsection: 'Aliases',
  },
  {
    id: SETTINGS_TARGET_IDS.agentsShellAliases,
    section: 'agents',
    label: 'Shell aliases',
    hint: 'Type the alias in any pane and Vimeflow swaps it for the full agent invocation.',
    subsection: 'Aliases',
  },
]

export const SETTINGS_SUBSECTIONS: SettingsSubsection[] =
  SETTINGS_TARGETS.reduce<SettingsSubsection[]>((subsections, target) => {
    if (target.subsection === undefined) {
      return subsections
    }

    const id = settingsSubsectionId(target.section, target.subsection)
    const existing = subsections.find((subsection) => subsection.id === id)

    if (existing !== undefined) {
      existing.targetIds.push(target.id)

      return subsections
    }

    subsections.push({
      id,
      section: target.section,
      label: target.subsection,
      targetId: target.id,
      targetIds: [target.id],
    })

    return subsections
  }, [])

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
