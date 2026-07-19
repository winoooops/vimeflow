import { deriveTheme } from '../derive'
import type { ThemeDefinition } from '../types'

export const kanagawa: ThemeDefinition = deriveTheme({
  id: 'kanagawa',
  label: 'Kanagawa',
  kind: 'dark',
  palette: {
    background: '#16161d',
    surface: '#1f1f28',
    foreground: '#dcd7ba',
    muted: '#7a7970',
    primary: '#957fb8',
    secondary: '#7e9cd8',
    red: '#e46876',
    green: '#98bb6c',
    yellow: '#e6c384',
    blue: '#7e9cd8',
    magenta: '#d27e99',
    cyan: '#7aa89f',
  },
})
