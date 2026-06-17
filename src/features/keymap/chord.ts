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

// Canonical token: mods in fixed order then code, joined by '+'. e.g. 'Mod+Shift+ArrowLeft'.
export const formatChord = (chord: Chord): string =>
  [...MOD_ORDER.filter((mod) => chord.mods.has(mod)), chord.code].join('+')

// Parse a canonical token back to a Chord. Returns null on anything malformed,
// unknown, duplicated, or carrying both supers (Mod + literal Ctrl is
// unsatisfiable, §5.1) — so a hand-edited settings.json degrades to "default".
export const parseChord = (token: string): Chord | null => {
  const parts = token.split('+')
  const code = parts.pop()
  if (code === undefined || code === '') {
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
// invariant for a rebindable binding (§5.1, §6.2).
export const exactlyOneSuper = (chord: Chord): boolean =>
  chord.mods.has('Mod') !== chord.mods.has('Ctrl')
