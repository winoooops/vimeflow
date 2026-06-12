import type { TerminalTheme } from '../types'

/** Convert TerminalTheme to xterm.js ITheme format. */
export const toXtermTheme = (theme: TerminalTheme): Record<string, string> => ({
  foreground: theme.foreground,
  background: theme.background,
  cursor: theme.cursor,
  cursorAccent: theme.cursorAccent,
  selectionBackground: theme.selectionBackground,
  ...(theme.selectionForeground && {
    selectionForeground: theme.selectionForeground,
  }),
  black: theme.black,
  red: theme.red,
  green: theme.green,
  yellow: theme.yellow,
  blue: theme.blue,
  magenta: theme.magenta,
  cyan: theme.cyan,
  white: theme.white,
  brightBlack: theme.brightBlack,
  brightRed: theme.brightRed,
  brightGreen: theme.brightGreen,
  brightYellow: theme.brightYellow,
  brightBlue: theme.brightBlue,
  brightMagenta: theme.brightMagenta,
  brightCyan: theme.brightCyan,
  brightWhite: theme.brightWhite,
})
