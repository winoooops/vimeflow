// scripts/generate-theme-css.ts — regenerate src/theme/theme.css from the
// Obsidian Lens definition. Run:
//   npx tsx scripts/generate-theme-css.ts && npx prettier --write src/theme/theme.css
// (prettier pass keeps the committed file byte-stable — it re-wraps long
// declarations the same way lint-staged would on commit.)
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
    ' * block in sync. Regenerate: npx tsx scripts/generate-theme-css.ts',
    ' * && npx prettier --write src/theme/theme.css',
    ' *',
    ' * NOTE: Tailwind bakes --shadow-* values into shadow-* utilities at',
    ' * build time — those do NOT re-theme at runtime. Consume themed',
    ' * shadows via var(--shadow-…) (arbitrary value or inline style). */',
    '@theme {',
    body,
    '}',
    '',
  ].join('\n')
)
