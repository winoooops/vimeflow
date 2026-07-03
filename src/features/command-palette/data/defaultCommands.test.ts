import { expect, test } from 'vitest'
import { themeService } from '../../../theme'
import { findCommandById } from '../registry/commandTree'
import { defaultCommands } from './defaultCommands'

test(':set theme lists every registered theme and applies on execute', () => {
  const setTheme = findCommandById(defaultCommands, 'set-theme')
  expect(setTheme?.children?.map((c) => c.id)).toEqual([
    'set-theme-obsidian-lens',
    'set-theme-flexoki',
    'set-theme-gruvbox-dark',
    'set-theme-gruvbox-light',
    'set-theme-tokyo-night',
    'set-theme-dracula',
  ])

  findCommandById(defaultCommands, 'set-theme-flexoki')?.execute?.('')
  expect(themeService.current().id).toBe('flexoki')

  findCommandById(defaultCommands, 'set-theme-gruvbox-dark')?.execute?.('')
  expect(themeService.current().id).toBe('gruvbox-dark')

  findCommandById(defaultCommands, 'set-theme-gruvbox-light')?.execute?.('')
  expect(themeService.current().id).toBe('gruvbox-light')

  findCommandById(defaultCommands, 'set-theme-tokyo-night')?.preview?.()
  expect(themeService.current().id).toBe('gruvbox-light')
  expect(themeService.displayed().id).toBe('tokyo-night')

  findCommandById(defaultCommands, 'set-theme-tokyo-night')?.execute?.('')
  expect(themeService.current().id).toBe('tokyo-night')

  findCommandById(defaultCommands, 'set-theme-dracula')?.preview?.()
  expect(themeService.current().id).toBe('tokyo-night')
  expect(themeService.displayed().id).toBe('dracula')

  findCommandById(defaultCommands, 'set-theme-dracula')?.execute?.('')
  expect(themeService.current().id).toBe('dracula')

  findCommandById(defaultCommands, 'set-theme-obsidian-lens')?.execute?.('')
  expect(themeService.current().id).toBe('obsidian-lens')
})
