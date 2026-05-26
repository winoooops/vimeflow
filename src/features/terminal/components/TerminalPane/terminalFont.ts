export const TERMINAL_FONT_SIZE = 14

// cspell:ignore CaskaydiaCove
export const TERMINAL_FONT_FAMILY = [
  '"JetBrainsMono Nerd Font"',
  '"MesloLGS NF"',
  '"Hack Nerd Font"',
  '"FiraCode Nerd Font"',
  '"CaskaydiaCove NF"',
  '"Cascadia Code NF"',
  '"JetBrains Mono"',
  '"Symbols Nerd Font Mono"',
  '"Symbols Nerd Font"',
  '"Vimeflow Nerd Symbols"',
  '"Cascadia Code"',
  '"Cascadia Mono"',
  'Menlo',
  'Monaco',
  '"Courier New"',
  'Courier',
  'monospace',
].join(', ')

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
