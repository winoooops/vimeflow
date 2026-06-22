export const TERMINAL_FONT_SIZE = 14

export const DEFAULT_TERMINAL_FONT_FAMILY = 'JetBrains Mono'

// cspell:ignore CaskaydiaCove MesloLGS
export const TERMINAL_FONT_FALLBACK_FAMILIES = [
  'JetBrainsMono Nerd Font',
  'MesloLGS NF',
  'Hack Nerd Font',
  'FiraCode Nerd Font',
  'CaskaydiaCove NF',
  'Cascadia Code NF',
  'JetBrains Mono',
] as const

export const TERMINAL_PLATFORM_FONT_FALLBACK_FAMILIES = [
  'Cascadia Code',
  'Cascadia Mono',
  'Menlo',
  'Monaco',
  'Courier New',
  'Courier',
  'monospace',
] as const

export const TERMINAL_SYMBOL_FALLBACK_FAMILIES = [
  'Symbols Nerd Font Mono',
  'Symbols Nerd Font',
  'Vimeflow Nerd Symbols',
] as const

export const TERMINAL_FONT_PICKER_FAMILIES = [
  DEFAULT_TERMINAL_FONT_FAMILY,
  'JetBrainsMono Nerd Font',
  'Hack Nerd Font',
  'Fira Code',
  'FiraCode Nerd Font',
  'Iosevka',
  'Cascadia Code',
  'Cascadia Mono',
  'Menlo',
  'Monaco',
  'Courier New',
] as const

const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
])

export const normalizeTerminalFontFamily = (family: string): string => {
  const normalized = family.trim().replace(/\s+/g, ' ')

  return normalized || DEFAULT_TERMINAL_FONT_FAMILY
}

const quoteFontFamily = (family: string): string => {
  if (GENERIC_FONT_FAMILIES.has(family.toLowerCase())) {
    return family
  }

  return JSON.stringify(family)
}

export const resolveTerminalFontFamily = (family: string): string => {
  const seen = new Set<string>()

  const stack = [
    normalizeTerminalFontFamily(family),
    ...TERMINAL_FONT_FALLBACK_FAMILIES,
    ...TERMINAL_SYMBOL_FALLBACK_FAMILIES,
    ...TERMINAL_PLATFORM_FONT_FALLBACK_FAMILIES,
  ]

  return stack
    .filter((candidate) => {
      const key = candidate.toLowerCase()
      if (seen.has(key)) {
        return false
      }

      seen.add(key)

      return true
    })
    .map(quoteFontFamily)
    .join(', ')
}

export const TERMINAL_FONT_FAMILY = resolveTerminalFontFamily(
  DEFAULT_TERMINAL_FONT_FAMILY
)

export type TerminalFontLoader = Pick<FontFaceSet, 'load'>

const TERMINAL_TEXT_FONT_SPEC = `${TERMINAL_FONT_SIZE}px "JetBrains Mono"`
const TERMINAL_SYMBOL_FONT_SPEC = `${TERMINAL_FONT_SIZE}px "Vimeflow Nerd Symbols"`
const TERMINAL_SYMBOL_SAMPLE = '\ue0b0\ue0b1\ue0b2\ue0b3\u{f011b}\uf303'

const currentFontLoader = (): TerminalFontLoader | null => {
  if (typeof document === 'undefined') {
    return null
  }

  const fonts = (document as Partial<Pick<Document, 'fonts'>>).fonts

  return fonts ?? null
}

const waitForTerminalFonts = async (
  fontLoader: TerminalFontLoader
): Promise<void> => {
  await Promise.all([
    fontLoader.load(TERMINAL_TEXT_FONT_SPEC),
    fontLoader.load(TERMINAL_SYMBOL_FONT_SPEC, TERMINAL_SYMBOL_SAMPLE),
  ])
}

export const loadTerminalFonts = (
  fontLoader: TerminalFontLoader | null = currentFontLoader()
): Promise<void> | null => {
  if (!fontLoader) {
    return null
  }

  return waitForTerminalFonts(fontLoader)
}
