import { themeService } from '../../../theme'
import { terminalCache } from '../components/TerminalPane/Body'
import { toXtermTheme } from './toXtermTheme'

/** Re-theme every live xterm instance when the workspace theme changes.
 * xterm renders to canvas and cannot read CSS variables — assigning a
 * fresh `options.theme` object triggers a colors-only repaint
 * (scrollback recolors, PTY untouched). */
export const initTerminalThemeBridge = (): (() => void) =>
  themeService.subscribe((theme) => {
    const xtermTheme = toXtermTheme(theme.terminal)

    terminalCache.forEach(({ terminal }) => {
      terminal.options.theme = xtermTheme
    })
  })
