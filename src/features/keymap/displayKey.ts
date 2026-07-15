import type { Chord, Mod } from './chord'
import { isMacPlatform } from '../../lib/formatShortcut'

// event.code → the friendly key token formatShortcut understands. Letters and
// digits are derived; symbols/arrows are mapped. Named keys (Enter, Space,
// Escape, Tab) pass through unchanged — formatShortcut maps them by name.
const CODE_DISPLAY: ReadonlyMap<string, string> = new Map([
  ['Backslash', '\\'],
  ['Semicolon', ';'],
  ['Backquote', '`'],
  ['Slash', '/'],
  ['Comma', ','],
  ['Period', '.'],
  ['Minus', '-'],
  ['Equal', '='],
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

export const chordToShortcutInput = (chord: Chord): readonly string[] => [
  ...MOD_DISPLAY_ORDER.filter((mod) => chord.mods.has(mod)),
  codeToDisplay(chord.code),
]

export const chordToKeycapShortcut = (
  chord: Chord,
  isMac = isMacPlatform()
): string[] =>
  chordToShortcutInput(chord).map((key) => {
    if (key === 'Mod') {
      return isMac ? '⌘' : 'Ctrl'
    }
    if (key === 'Ctrl') {
      return isMac ? '⌃' : 'Ctrl'
    }
    if (key === 'Alt') {
      return isMac ? '⌥' : 'Alt'
    }
    if (key === 'Shift') {
      return '⇧'
    }

    return key
  })

const codeToAriaKey = (code: string, shifted: boolean): string => {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter !== null) {
    return shifted ? letter[1] : letter[1].toLowerCase()
  }

  if (code.startsWith('Arrow')) {
    return code
  }

  return codeToDisplay(code)
}

export const chordToAriaShortcut = (
  chord: Chord,
  isMac = isMacPlatform()
): string => {
  const modifiers = MOD_DISPLAY_ORDER.filter((mod) => chord.mods.has(mod)).map(
    (mod) => {
      if (mod === 'Mod') {
        return isMac ? 'Meta' : 'Control'
      }
      if (mod === 'Ctrl') {
        return 'Control'
      }

      return mod
    }
  )

  return [
    ...modifiers,
    codeToAriaKey(chord.code, chord.mods.has('Shift')),
  ].join('+')
}
