import { deriveTheme } from '../derive'
import type { ThemeDefinition } from '../types'

const nordBase = deriveTheme({
  id: 'nord',
  label: 'Nord',
  kind: 'dark',
  palette: {
    background: '#242933',
    surface: '#2e3440',
    foreground: '#d8dee9',
    muted: '#7b88a1',
    primary: '#88c0d0',
    secondary: '#81a1c1',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#8fbcbb',
  },
})

export const nord: ThemeDefinition = {
  ...nordBase,
  ui: {
    ...nordBase.ui,
    'on-surface-variant': '#cdd3df',
  },
}
