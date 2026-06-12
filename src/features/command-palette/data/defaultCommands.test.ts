import { expect, test } from 'vitest'
import { themeService } from '../../../theme'
import { findCommandById } from '../registry/commandTree'
import { defaultCommands } from './defaultCommands'

test(':set theme lists every registered theme and applies on execute', () => {
  const setTheme = findCommandById(defaultCommands, 'set-theme')
  expect(setTheme?.children?.map((c) => c.id)).toEqual([
    'set-theme-obsidian-lens',
    'set-theme-flexoki',
  ])

  findCommandById(defaultCommands, 'set-theme-flexoki')?.execute?.('')
  expect(themeService.current().id).toBe('flexoki')

  findCommandById(defaultCommands, 'set-theme-obsidian-lens')?.execute?.('')
  expect(themeService.current().id).toBe('obsidian-lens')
})
