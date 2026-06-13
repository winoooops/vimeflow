import { test, expect } from 'vitest'
import { GLASS_SURFACE } from './glassSurface'

test('GLASS_SURFACE is the canonical glass-panel chrome', () => {
  expect(GLASS_SURFACE).toContain('rounded-lg')
  expect(GLASS_SURFACE).toContain('bg-surface-container-high/95')
  expect(GLASS_SURFACE).toContain('backdrop-blur-md')
  expect(GLASS_SURFACE).toContain('border-outline-variant/20')
  expect(GLASS_SURFACE).toContain('shadow-xl')
})
