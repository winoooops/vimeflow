import { expect, test } from 'vitest'
import { toCssVars } from './cssVars'
import { obsidianLens } from './themes/obsidian-lens'
import themeCss from './theme.css?raw'

const parseThemeBlock = (css: string): Record<string, string> => {
  const block = /@theme(?:\s+static)?\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  const vars: Record<string, string> = {}

  for (const match of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    vars[match[1]] = match[2].trim()
  }

  return vars
}

test('@theme block matches the Obsidian Lens definition exactly', () => {
  expect(parseThemeBlock(themeCss)).toEqual(toCssVars(obsidianLens))
})
