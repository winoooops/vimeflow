import { themeService } from '../../../theme'
import { terminalCache } from '../components/TerminalPane/Body'

/** Re-theme every live terminal renderer when the workspace theme changes.
 * Canvas-backed renderers cannot read CSS variables — applying a fresh theme
 * triggers a colors-only repaint (scrollback recolors, PTY untouched). */
export const initTerminalThemeBridge = (): (() => void) =>
  themeService.subscribe((theme) => {
    terminalCache.forEach(({ terminal }) => {
      terminal.applyTheme(theme.terminal)
    })
  })
