// src/theme/cssGuard.test.ts
import { expect, test } from 'vitest'

const cssFiles: Record<string, string> = import.meta.glob('../**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const COLOR_LITERAL =
  /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?|oklch)\(/

test('no CSS file outside src/theme contains color literals', () => {
  const offenders = Object.entries(cssFiles)
    .filter(([path]) => !path.includes('/theme/') && !path.startsWith('./'))
    .filter(([, text]) => COLOR_LITERAL.test(text))
    .map(([path]) => path)

  expect(offenders).toEqual([])
})
