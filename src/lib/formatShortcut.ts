// Single source of truth for keyboard-shortcut display strings used in
// tooltips. The behavior side of shortcuts lives in feature hooks
// (`useDockShortcuts`, `usePaneShortcuts`); this is the *display* side.
//
// Key conventions:
// - `'Mod'` is the platform-conditional super key — renders as `⌘` on
//   macOS, `Ctrl` elsewhere. Match the modifier hooks already use so the
//   visible string can't drift from the wired behavior.
// - Mac chord renders without separators (`⌘E`) per Apple HIG.
// - Non-Mac chord uses `+` separators (`Ctrl+E`) per common convention
//   on Linux/Windows.

const MAC_KEY_DISPLAY: ReadonlyMap<string, string> = new Map([
  ['Mod', '⌘'],
  ['Cmd', '⌘'],
  ['Meta', '⌘'],
  ['Ctrl', '⌃'],
  ['Control', '⌃'],
  ['Alt', '⌥'],
  ['Option', '⌥'],
  ['Shift', '⇧'],
  ['Enter', '⏎'],
  ['Return', '⏎'],
  ['Backspace', '⌫'],
  ['Delete', '⌦'],
  ['Tab', '⇥'],
  ['Escape', '⎋'],
  ['Esc', '⎋'],
  ['ArrowUp', '↑'],
  ['ArrowDown', '↓'],
  ['ArrowLeft', '←'],
  ['ArrowRight', '→'],
  ['Space', '␣'],
])

const NON_MAC_KEY_DISPLAY: ReadonlyMap<string, string> = new Map([
  ['Mod', 'Ctrl'],
  ['Cmd', 'Ctrl'],
  ['Meta', 'Ctrl'],
  ['Ctrl', 'Ctrl'],
  ['Control', 'Ctrl'],
  ['Alt', 'Alt'],
  ['Option', 'Alt'],
  ['Shift', 'Shift'],
])

export type ShortcutKey = string

export type ShortcutInput = ShortcutKey | readonly ShortcutKey[]

export const isMacPlatform = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false
  }

  const uad = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData
  // Mirrors the deprecation guard already used in
  // `WorkspaceView.derivePaneShortcutModifier` — `userAgentData.platform`
  // is the spec-supported successor, but `navigator.platform` is still
  // populated on every shell Vimeflow ships against today.
  const detected = (uad?.platform ?? navigator.platform).toLowerCase()

  return detected.startsWith('mac')
}

const toKeyList = (shortcut: ShortcutInput): readonly ShortcutKey[] =>
  typeof shortcut === 'string' ? [shortcut] : shortcut

export const formatShortcut = (
  shortcut: ShortcutInput,
  options: { isMac?: boolean } = {}
): string => {
  const isMac = options.isMac ?? isMacPlatform()
  const keys = toKeyList(shortcut)
  const table = isMac ? MAC_KEY_DISPLAY : NON_MAC_KEY_DISPLAY
  const separator = isMac ? '' : '+'

  return keys.map((key) => table.get(key) ?? key).join(separator)
}
