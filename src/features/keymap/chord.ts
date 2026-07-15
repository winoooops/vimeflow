// A single keyboard chord: one physical key + its modifier set (spec §5.1).
// `'Mod'` is the platform super (⌘ on macOS, Ctrl elsewhere); `'Ctrl'` is a
// literal Control on every platform. SP1 = single chord only (no sequences).
export type Mod = 'Mod' | 'Ctrl' | 'Shift' | 'Alt'

export interface Chord {
  code: string // KeyboardEvent.code — physical key, layout-safe
  mods: ReadonlySet<Mod>
}

const MOD_ORDER: readonly Mod[] = ['Mod', 'Ctrl', 'Alt', 'Shift']
const MOD_SET: ReadonlySet<string> = new Set(MOD_ORDER)

const NAMED_CODE_SET: ReadonlySet<string> = new Set([
  'Abort',
  'Backquote',
  'Backslash',
  'BracketLeft',
  'BracketRight',
  'Comma',
  'Equal',
  'Minus',
  'Period',
  'Quote',
  'Semicolon',
  'Slash',
  'Backspace',
  'ContextMenu',
  'Enter',
  'Space',
  'Tab',
  'Delete',
  'End',
  'Help',
  'Hiragana',
  'Home',
  'Insert',
  'PageDown',
  'PageUp',
  'Convert',
  'Escape',
  'Eject',
  'KanaMode',
  'Katakana',
  'NonConvert',
  'PrintScreen',
  'Pause',
  'Power',
  'Resume',
  'Sleep',
  'Suspend',
  'WakeUp',
  'Again',
  'Copy',
  'Cut',
  'Find',
  'Open',
  'Paste',
  'Props',
  'Select',
  'Undo',
])

const CODE_PATTERN =
  /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Lang[1-5]|Arrow(?:Down|Left|Right|Up)|Volume(?:Down|Mute|Up)|Numpad(?:[0-9]|[A-Z][A-Za-z0-9]*)|(?:AudioVolume|Browser|Intl|Launch|Media)[A-Z][A-Za-z0-9]*)$/

const isUsableCode = (code: string): boolean =>
  NAMED_CODE_SET.has(code) || CODE_PATTERN.test(code)

// Canonical token: mods in fixed order then code, joined by '+'. e.g. 'Mod+Shift+ArrowLeft'.
export const formatChord = (chord: Chord): string =>
  [...MOD_ORDER.filter((mod) => chord.mods.has(mod)), chord.code].join('+')

// Parse a canonical token back to a Chord. Returns null on anything malformed,
// unknown, duplicated, or carrying both supers (Mod + literal Ctrl is
// unsatisfiable, §5.1) — so a hand-edited settings.json degrades to "default".
export const parseChord = (token: string): Chord | null => {
  const parts = token.split('+')
  const code = parts.pop()
  if (code === undefined || !isUsableCode(code)) {
    return null
  }
  const mods = new Set<Mod>()
  for (const part of parts) {
    if (!MOD_SET.has(part) || mods.has(part as Mod)) {
      return null
    }
    mods.add(part as Mod)
  }
  if (mods.has('Mod') && mods.has('Ctrl')) {
    return null
  }

  return { code, mods }
}

// Exactly one super present (Mod xor literal Ctrl) — the terminal-safety
// invariant for global rebindable bindings (§5.1, §6.2). Focus-scoped Diff
// bindings may omit both; resolve.ts owns that context exception.
export const exactlyOneSuper = (chord: Chord): boolean =>
  chord.mods.has('Mod') !== chord.mods.has('Ctrl')
