#!/usr/bin/env node
// Audit color usage. Modes:
//   node scripts/audit-colors.mjs census   — usage counts for legacy token names
//   node scripts/audit-colors.mjs leaks    — every hardcoded color literal in src/
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue
      walk(full, out)
    } else if (/\.(tsx?|css|html)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

const files = walk(SRC)

const LEAK_PATTERNS = [
  // 6/8-digit only: 3/4-digit hex would false-positive on PR/issue refs
  // like `#302` in code comments. Short hex inside string literals is
  // still caught by the ESLint rule (Task 21).
  ['hex', /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g],
  ['color-fn', /\b(?:rgba?|hsla?|oklch)\(/g],
  [
    'raw-palette',
    /(?:text|bg|border|ring|fill|stroke|from|via|to|divide|outline|decoration|shadow|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g,
  ],
  [
    'white-black',
    /(?:text|bg|border|ring|fill|stroke|divide|outline)-(?:white|black)(?:\/(?:\d{1,3}|\[[^\]]+\]))?\b/g,
  ],
]

// Tokens we expect to drop — census proves they have no utility consumers.
const DIET_CANDIDATES = [
  'background',
  'surface-dim',
  'surface-variant',
  'on-background',
  'on-primary-container',
  'primary-fixed',
  'primary-fixed-dim',
  'secondary-fixed',
  'secondary-fixed-dim',
  'tertiary-fixed',
  'tertiary-fixed-dim',
  'on-primary-fixed',
  'on-primary-fixed-variant',
  'on-secondary-fixed',
  'on-secondary-fixed-variant',
  'on-tertiary-fixed',
  'on-tertiary-fixed-variant',
  'inverse-surface',
  'inverse-on-surface',
  'inverse-primary',
]

const mode = process.argv[2]

if (mode === 'census') {
  for (const token of DIET_CANDIDATES) {
    const re = new RegExp(
      `(?:text|bg|border|ring|fill|stroke|from|via|to|divide|outline|decoration|shadow)-${token}(?![\\w-])`,
      'g'
    )
    const hits = []
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(re)) {
        const line = text.slice(0, m.index).split('\n').length
        hits.push(`${relative(ROOT, f)}:${line}`)
      }
    }
    process.stdout.write(
      `${token}: ${hits.length}${hits.length ? '  ' + hits.join(' ') : ''}\n`
    )
  }
} else if (mode === 'leaks') {
  let total = 0
  for (const f of files) {
    if (f.includes('/src/theme/')) continue // theme defs + generated theme.css
    const text = readFileSync(f, 'utf8')
    const fileHits = []
    for (const [kind, re] of LEAK_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const line = text.slice(0, m.index).split('\n').length
        fileHits.push(`  ${line}: [${kind}] ${m[0]}`)
      }
    }
    if (fileHits.length) {
      total += fileHits.length
      process.stdout.write(`${relative(ROOT, f)} (${fileHits.length})\n`)
      process.stdout.write(fileHits.join('\n') + '\n')
    }
  }
  process.stdout.write(`\nTOTAL: ${total}\n`)
} else {
  process.stderr.write('usage: audit-colors.mjs census|leaks\n')
  process.exit(1)
}
