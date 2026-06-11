// scripts/generate-theme-css.ts — regenerate src/theme/theme.css from the
// Obsidian Lens definition. Run: npx tsx scripts/generate-theme-css.ts
import { writeFileSync } from 'node:fs'
import { toCssVars } from '../src/theme/cssVars'
import { obsidianLens } from '../src/theme/themes/obsidian-lens'

const body = Object.entries(toCssVars(obsidianLens))
  .map(([name, value]) => `  ${name}: ${value};`)
  .join('\n')

writeFileSync(
  'src/theme/theme.css',
  [
    '/* GENERATED defaults — single source of truth is',
    ' * src/theme/themes/obsidian-lens.ts; themeCss.test.ts keeps this',
    ' * block in sync. Regenerate: npx tsx scripts/generate-theme-css.ts */',
    '@theme {',
    body,
    '}',
    '',
  ].join('\n')
)
