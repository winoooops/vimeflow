import { isMacPlatform, type ShortcutKey } from '../../lib/formatShortcut'

// Re-export so the workspace command builder reads platform detection through
// the command-palette surface rather than the lib directly.
export { isMacPlatform } from '../../lib/formatShortcut'

export type CommandPaletteShortcutModifier = 'ctrl' | 'meta'

export const COMMAND_PALETTE_SHORTCUT_KEYS = [
  'Mod',
  ';',
] as const satisfies readonly ShortcutKey[]

export const commandPaletteShortcutModifierForPlatform = (
  platform: string
): CommandPaletteShortcutModifier =>
  platform.toLowerCase().startsWith('mac') ? 'meta' : 'ctrl'

export const getCommandPaletteShortcutModifier =
  (): CommandPaletteShortcutModifier => (isMacPlatform() ? 'meta' : 'ctrl')

export const isCommandPaletteToggle = (
  event: KeyboardEvent,
  modifier: CommandPaletteShortcutModifier = getCommandPaletteShortcutModifier()
): boolean => {
  const expectedModifier =
    modifier === 'meta'
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey

  return (
    expectedModifier && !event.altKey && !event.shiftKey && event.key === ';'
  )
}
