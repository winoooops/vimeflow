import { deriveTheme } from '../derive'
import type { ThemeDefinition } from '../types'

export const rosePine: ThemeDefinition = deriveTheme({
  id: 'rose-pine',
  label: 'Rosé Pine',
  kind: 'dark',
  palette: {
    background: '#191724',
    surface: '#1f1d2e',
    foreground: '#e0def4',
    muted: '#6e6a86',
    primary: '#c4a7e7',
    secondary: '#9ccfd8',
    red: '#eb6f92',
    green: '#9ccfd8',
    yellow: '#f6c177',
    blue: '#31748f',
    magenta: '#c4a7e7',
    cyan: '#ebbcba',
  },
})
