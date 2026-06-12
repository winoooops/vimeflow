import { act, renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import { themeService } from './service'
import { useTheme } from './useTheme'

test('returns the active theme and re-renders on switch', () => {
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
