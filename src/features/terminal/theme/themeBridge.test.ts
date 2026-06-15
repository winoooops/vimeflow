import { afterEach, expect, test, vi } from 'vitest'
import { themeService } from '../../../theme'
import {
  clearTerminalCache,
  terminalCache,
} from '../components/TerminalPane/Body'
import type { TerminalSurface } from '../types'
import { initTerminalThemeBridge } from './themeBridge'

afterEach(() => {
  clearTerminalCache()
  themeService.apply('obsidian-lens')
})

test('live terminals receive the new terminal theme on switch', () => {
  const fake = { applyTheme: vi.fn(), dispose: vi.fn() }
  terminalCache.set('s1', {
    terminal: fake as unknown as TerminalSurface,
    fitController: { fit: vi.fn() },
    viewportReader: { readVisibleText: vi.fn() },
  })

  const stop = initTerminalThemeBridge()
  themeService.apply('flexoki')

  expect(fake.applyTheme).toHaveBeenCalledWith(themeService.current().terminal)
  stop()
})
