import { act, renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import { themeService } from './service'
import { useTheme } from './useTheme'

test('returns the displayed theme and re-renders on switch', () => {
  themeService.apply('obsidian-lens')
  const { result } = renderHook(() => useTheme())
  expect(result.current.id).toBe('obsidian-lens')

  act(() => {
    themeService.apply('flexoki')
  })

  expect(result.current.id).toBe('flexoki')
  act(() => {
    themeService.apply('obsidian-lens')
  })
})

test('re-renders when the theme is previewed without committing it', () => {
  themeService.apply('obsidian-lens')
  const { result } = renderHook(() => useTheme())

  act(() => {
    themeService.preview('flexoki')
  })

  expect(result.current.id).toBe('flexoki')
  expect(themeService.current().id).toBe('obsidian-lens')
  act(() => {
    themeService.apply('obsidian-lens')
  })
})
