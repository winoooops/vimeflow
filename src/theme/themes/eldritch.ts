import { deriveTheme } from '../derive'
import type { ThemeDefinition } from '../types'

export const eldritch: ThemeDefinition = deriveTheme({
  id: 'eldritch',
  label: 'Eldritch',
  kind: 'dark',
  palette: {
    background: '#171928',
    surface: '#212337',
    foreground: '#ebfafa',
    muted: '#7081d0',
    primary: '#37f499',
    secondary: '#04d1f9',
    red: '#f16c75',
    green: '#37f499',
    yellow: '#f1fc79',
    blue: '#04d1f9',
    magenta: '#a48cf2',
    cyan: '#04d1f9',
  },
})
