import { describe, expect, test } from 'vitest'
import {
  resolveDiffIndicators,
  resolveDiffLineDiffType,
  resolveDiffOverflow,
  resolveDiffStyle,
  resolveDiffTheme,
  resolveDiffThemeSetting,
} from './diffViewSettings'

describe('diff view settings', () => {
  test('normalizes persisted values and falls back safely', () => {
    expect(resolveDiffStyle('unified')).toBe('unified')
    expect(resolveDiffStyle('invalid')).toBe('split')
    expect(resolveDiffTheme('auto', 'light')).toBe('pierre-light')
    expect(resolveDiffTheme('dracula', 'dark')).toBe('dracula')
    expect(resolveDiffTheme('invalid', 'dark')).toBe('pierre-dark')
    expect(resolveDiffThemeSetting('dracula')).toBe('dracula')
    expect(resolveDiffThemeSetting('invalid')).toBe('auto')
    expect(resolveDiffLineDiffType('char')).toBe('char')
    expect(resolveDiffLineDiffType('invalid')).toBe('word')
    expect(resolveDiffIndicators('bars')).toBe('bars')
    expect(resolveDiffIndicators('invalid')).toBe('classic')
    expect(resolveDiffOverflow('wrap')).toBe('wrap')
    expect(resolveDiffOverflow('invalid')).toBe('scroll')
  })
})
