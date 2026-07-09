import type { Chord, Mod } from './chord'
import type { ShortcutInput } from '../../lib/formatShortcut'

// event.code → the friendly key token formatShortcut understands. Letters and
// digits are derived; symbols/arrows are mapped. Named keys (Enter, Space,
// Escape, Tab) pass through unchanged — formatShortcut maps them by name.
const CODE_DISPLAY: ReadonlyMap<string, string> = new Map([
  ['Backslash', '\\'],
  ['Semicolon', ';'],
  ['Backquote', '`'],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['ArrowLeft', '←'],
  ['ArrowRight', '→'],
  ['ArrowUp', '↑'],
  ['ArrowDown', '↓'],
])

const MOD_DISPLAY_ORDER: readonly Mod[] = ['Mod', 'Ctrl', 'Alt', 'Shift']

const codeToDisplay = (code: string): string => {
  const mapped = CODE_DISPLAY.get(code)
  if (mapped !== undefined) {
    return mapped
  }
  const digit = /^Digit(\d)$/.exec(code)
  if (digit !== null) {
    return digit[1]
  }
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter !== null) {
    return letter[1]
  }

  return code
}

export const chordToShortcutInput = (chord: Chord): ShortcutInput => [
  ...MOD_DISPLAY_ORDER.filter((mod) => chord.mods.has(mod)),
  codeToDisplay(chord.code),
]
