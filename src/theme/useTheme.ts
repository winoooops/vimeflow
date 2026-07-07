import { useSyncExternalStore } from 'react'
import { themeService } from './service'
import type { ThemeDefinition } from './types'

export const useTheme = (): ThemeDefinition =>
  useSyncExternalStore(themeService.subscribe, themeService.displayed)
