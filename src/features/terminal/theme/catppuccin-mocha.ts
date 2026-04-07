import type { TerminalTheme } from '../types'

/**
 * Catppuccin Mocha color palette for xterm.js
 * Source: https://github.com/catppuccin/catppuccin
 */
export const catppuccinMocha: TerminalTheme = {
  // Base colors
  foreground: '#cdd6f4', // Text
  background: '#1e1e2e', // Base
  cursor: '#f5e0dc', // Rosewater
  cursorAccent: '#1e1e2e', // Base
  selectionBackground: '#585b70', // Surface 2

  // ANSI colors
  black: '#45475a', // Surface 1
  red: '#f38ba8', // Red
  green: '#a6e3a1', // Green
  yellow: '#f9e2af', // Yellow
  blue: '#89b4fa', // Blue
  magenta: '#f5c2e7', // Pink
  cyan: '#94e2d5', // Teal
  white: '#bac2de', // Subtext 1

  // ANSI bright colors
  brightBlack: '#585b70', // Surface 2
  brightRed: '#f38ba8', // Red
  brightGreen: '#a6e3a1', // Green
  brightYellow: '#f9e2af', // Yellow
  brightBlue: '#89b4fa', // Blue
  brightMagenta: '#f5c2e7', // Pink
  brightCyan: '#94e2d5', // Teal
  brightWhite: '#a6adc8', // Subtext 0
}

/**
 * Convert TerminalTheme to xterm.js ITheme format
 */
export function toXtermTheme(theme: TerminalTheme): Record<string, string> {
  return {
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
  }
}
