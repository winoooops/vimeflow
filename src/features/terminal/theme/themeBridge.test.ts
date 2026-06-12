import { afterEach, expect, test } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { themeService } from '../../../theme'
import {
  clearTerminalCache,
  terminalCache,
} from '../components/TerminalPane/Body'
import { initTerminalThemeBridge } from './themeBridge'
import { toXtermTheme } from './toXtermTheme'

afterEach(() => {
  clearTerminalCache()
  themeService.apply('obsidian-lens')
})

test('live terminals get the new xterm theme on switch', () => {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const fake = { options: { theme: {} }, dispose: (): void => {} }
  terminalCache.set('s1', {
    terminal: fake as unknown as Terminal,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    fitAddon: { fit: (): void => {} } as never,
  })

  const stop = initTerminalThemeBridge()
  themeService.apply('flexoki')

  expect(fake.options.theme).toEqual(
    toXtermTheme(themeService.current().terminal)
  )
  stop()
})
