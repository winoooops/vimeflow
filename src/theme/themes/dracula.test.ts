import { expect, test } from 'vitest'
import { dracula } from './dracula'

test('dracula uses the Terminal Colors default palette', () => {
  expect(dracula.id).toBe('dracula')
  expect(dracula.label).toBe('Dracula')
  expect(dracula.kind).toBe('dark')
  expect(dracula.ui.surface).toBe('#21222c')
  expect(dracula.ui.primary).toBe('#ff79c6')
  expect(dracula.ui['on-surface']).toBe('#f8f8f2')
  expect(dracula.ui['on-surface-variant']).toBe('#e8e8df')
  expect(dracula.ui['on-surface-muted']).toBe('#8a94c8')
  expect(dracula.terminal.background).toBe('#282a36')
  expect(dracula.terminal.foreground).toBe('#f8f8f2')
  expect(dracula.terminal.selectionBackground).toBe('#44475a')
  expect(dracula.terminal.black).toBe('#21222c')
  expect(dracula.terminal.brightBlack).toBe('#6272a4')
  expect(dracula.terminal.brightWhite).toBe('#ffffff')
})
