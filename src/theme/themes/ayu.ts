import { deriveTheme } from '../derive'
import type { ThemeDefinition } from '../types'

export const ayu: ThemeDefinition = deriveTheme({
  id: 'ayu',
  label: 'Ayu',
  kind: 'dark',
  palette: {
    background: '#181c26',
    surface: '#1f2430',
    foreground: '#cccac2',
    muted: '#969daa',
    primary: '#ffcd66',
    secondary: '#73d0ff',
    red: '#f28779',
    green: '#d5ff80',
    yellow: '#ffcd66',
    blue: '#73d0ff',
    magenta: '#dfbfff',
    cyan: '#95e6cb',
  },
})
