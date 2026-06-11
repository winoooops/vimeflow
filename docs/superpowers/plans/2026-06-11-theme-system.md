# Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Runtime theme switching for the whole workspace — Obsidian Lens (current look) organized into one typed theme definition, Flexoki (light) as the hot-swap proof, with lint guards so no new hardcoded color lands.

**Architecture:** TypeScript-first theme objects in `src/theme/themes/`; a `ThemeService` applies them as CSS custom properties on `<html>` (Tailwind v4 `@theme` utilities resolve `var(--color-*)`) and notifies JS consumers (xterm via subscription, CodeMirror via Compartment, Pierre diff via state bridge). Spec: `docs/superpowers/specs/2026-06-11-theme-system-design.md`.

**Tech Stack:** React 19, Tailwind v4.2.2 (`@theme` + legacy `@config` for non-color tokens), xterm.js, CodeMirror 6, `@pierre/diffs`, Vitest + jsdom, ESLint 9 flat config.

**Working directory:** `worktrees/theme-system/` (branch `feat/theme-system`). All commands run from the worktree root.

**Conventions that apply to every task** (from `rules/`): TDD (write failing test → run → implement → run → commit), no semicolons, single quotes, explicit return types on exports, arrow components, `test()` not `it()`, immutability, conventional commits. Run `npm run lint` before each commit; lint-staged also runs on commit.

---

## Phase A — Foundation (zero visual change)

### Task 0: Worktree bootstrap

**Files:** none (environment)

- [ ] **Step 1: Install dependencies in the worktree**

```bash
npm install
```

Expected: completes without error; `node_modules/` appears. (The parent repo's `vitest.config.ts` already excludes `worktrees/**`, so this nested `node_modules` cannot break parent test runs — see memory `vitest-worktrees-react-duplication`.)

- [ ] **Step 2: Verify the toolchain works here**

```bash
npm run type-check && npx vitest run src/agents/registry.test.ts
```

Expected: type-check passes; registry tests PASS.

### Task 1: Color audit script (census + leak inventory)

**Files:**

- Create: `scripts/audit-colors.mjs`

This script has two jobs: (a) `census` — count real usages of legacy Tailwind color tokens so the "token diet" is evidence-based, (b) `leaks` — enumerate every hardcoded color (the Phase B checklist, spec §6 step 0). `scripts/**` is excluded from coverage; no test file needed (it is a dev tool, like `scripts/package-electron.mjs`).

- [ ] **Step 1: Write the script**

```js
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
  ['hex', /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g],
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
    if (f.includes('/theme/themes/')) continue
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
```

- [ ] **Step 2: Run the census and record the verdict**

```bash
node scripts/audit-colors.mjs census
```

Expected: every `DIET_CANDIDATES` token prints `0` hits **except** `background` (one hit: `src/index.css:106` `bg-background`). Decision rule: any candidate with a non-config hit is **kept** in the token set (and removed from the drop list in Task 2); `background`'s single hit is migrated in Task 7 instead.

- [ ] **Step 3: Run the leak inventory as a baseline**

```bash
node scripts/audit-colors.mjs leaks > .lifeline-planner/leaks-baseline.txt; tail -3 .lifeline-planner/leaks-baseline.txt
```

Expected: `TOTAL:` around 290 (codex recount; exact number is the baseline Phase B drives to zero).

- [ ] **Step 4: Commit**

```bash
git add scripts/audit-colors.mjs
git commit -m "chore(theme): add color audit script (census + leak inventory)"
```

### Task 2: Theme types and token lists

**Files:**

- Create: `src/theme/types.ts`
- Test: `src/theme/types.test.ts`

Token name lists are `as const` arrays (runtime-iterable for CSS-var emission and the sync test); types derive from them. `TerminalTheme` is reused from the terminal feature.

- [ ] **Step 1: Write the failing test**

```ts
// src/theme/types.test.ts
import { expect, test } from 'vitest'
import {
  AGENT_ACCENT_FIELDS,
  AGENT_IDS,
  EFFECT_COLOR_TOKENS,
  SHADOW_TOKENS,
  SYN_TOKENS,
  UI_TOKENS,
} from './types'

test('ui token list has no duplicates', () => {
  expect(new Set(UI_TOKENS).size).toBe(UI_TOKENS.length)
})

test('vcs and editor tokens are part of the ui set', () => {
  expect(UI_TOKENS).toContain('vcs-modified')
  expect(UI_TOKENS).toContain('editor-fg')
})

test('effect colors include washes, scrollbar, and diff tokens', () => {
  expect(EFFECT_COLOR_TOKENS).toContain('wash-subtle')
  expect(EFFECT_COLOR_TOKENS).toContain('scrollbar-thumb')
  expect(EFFECT_COLOR_TOKENS).toContain('diff-highlight-removed')
})

test('shadow tokens cover the composite shadows', () => {
  expect(SHADOW_TOKENS).toEqual([
    'pane-focus',
    'modal',
    'pip-glow',
    'ambient',
    'glow-primary',
    'ring-primary',
  ])
})

test('agents cover the five identities with four fields', () => {
  expect(AGENT_IDS).toEqual(['claude', 'codex', 'gemini', 'shell', 'browser'])
  expect(AGENT_ACCENT_FIELDS).toEqual([
    'accent',
    'accentDim',
    'accentSoft',
    'onAccent',
  ])
})

test('syntax tokens cover the markdown and editor needs', () => {
  expect(SYN_TOKENS).toContain('keyword')
  expect(SYN_TOKENS).toContain('class')
  expect(SYN_TOKENS).toContain('operator')
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run src/theme/types.test.ts
```

Expected: FAIL — `Cannot find module './types'`.

- [ ] **Step 3: Implement `src/theme/types.ts`**

```ts
import type { TerminalTheme } from '../features/terminal/types'

/* Token name lists are runtime-iterable on purpose: the CSS-variable
 * emitter (cssVars.ts) and the theme.css sync test both walk them.
 * Token diet applied per scripts/audit-colors.mjs census — Material 3
 * leftovers with zero consumers (fixed/inverse variants, surface-dim,
 * surface-variant, on-background, on-primary-container, background)
 * did not migrate. */

export const UI_TOKENS = [
  'surface',
  'surface-container-lowest',
  'surface-container-low',
  'surface-container',
  'surface-container-high',
  'surface-container-highest',
  'surface-bright',
  'surface-tint',
  'browser-bar',
  'browser-tab-active',
  'primary',
  'primary-container',
  'primary-dim',
  'primary-deep',
  'on-primary',
  'secondary',
  'secondary-container',
  'secondary-dim',
  'on-secondary',
  'on-secondary-container',
  'tertiary',
  'tertiary-container',
  'on-tertiary',
  'on-tertiary-container',
  'error',
  'error-container',
  'error-dim',
  'on-error',
  'on-error-container',
  'success',
  'success-muted',
  'warning',
  'on-surface',
  'on-surface-variant',
  'on-surface-muted',
  'outline',
  'outline-variant',
  'editor-fg',
  'editor-fg-dim',
  'vcs-modified',
  'vcs-added',
  'vcs-deleted',
  'vcs-renamed',
  'vcs-untracked',
] as const

export const EFFECT_COLOR_TOKENS = [
  'glass-fill',
  'selection',
  'scrollbar-thumb',
  'scrollbar-thumb-hover',
  'diff-added',
  'diff-removed',
  'diff-highlight-added',
  'diff-highlight-removed',
  'wash-faint',
  'wash-subtle',
  'wash-soft',
] as const

export const SHADOW_TOKENS = [
  'pane-focus',
  'modal',
  'pip-glow',
  'ambient',
  'glow-primary',
  'ring-primary',
] as const

export const SYN_TOKENS = [
  'keyword',
  'string',
  'fn',
  'variable',
  'comment',
  'type',
  'tag',
  'class',
  'operator',
] as const

export const AGENT_IDS = [
  'claude',
  'codex',
  'gemini',
  'shell',
  'browser',
] as const

export const AGENT_ACCENT_FIELDS = [
  'accent',
  'accentDim',
  'accentSoft',
  'onAccent',
] as const

export type UiToken = (typeof UI_TOKENS)[number]
export type EffectColorToken = (typeof EFFECT_COLOR_TOKENS)[number]
export type ShadowToken = (typeof SHADOW_TOKENS)[number]
export type SynToken = (typeof SYN_TOKENS)[number]
export type ThemeAgentId = (typeof AGENT_IDS)[number]
export type AgentAccentField = (typeof AGENT_ACCENT_FIELDS)[number]

export type AgentAccent = Record<AgentAccentField, string>

export type ThemeId = 'obsidian-lens' | 'flexoki'

export type ThemeKind = 'dark' | 'light'

export interface ThemeDefinition {
  id: ThemeId
  label: string
  kind: ThemeKind
  ui: Record<UiToken, string>
  effects: Record<EffectColorToken, string>
  shadows: Record<ShadowToken, string>
  syntax: Record<SynToken, string>
  terminal: TerminalTheme
  agents: Record<ThemeAgentId, AgentAccent>
}
```

- [ ] **Step 4: Run tests, lint, commit**

```bash
npx vitest run src/theme/types.test.ts && npm run lint -- src/theme
git add src/theme/types.ts src/theme/types.test.ts
git commit -m "feat(theme): add theme token lists and ThemeDefinition types"
```

### Task 3: Obsidian Lens theme definition

**Files:**

- Create: `src/theme/themes/obsidian-lens.ts`
- Test: `src/theme/themes/obsidian-lens.test.ts`

Values collected per spec rule "rendered truth wins": ui from `tailwind.config.js`, effects from `src/index.css` + `docs/design/tokens.css`, terminal from `catppuccin-mocha.ts`, agents from `registry.ts`/`browserIdentity.ts`, syntax from tokens.css + the CodeMirror palette. `editor-fg`/`editor-fg-dim`, `syn-class`, `syn-operator` are new tokens that preserve the editor's current exact colors. vcs values capture the rendered `*-400` palette classes.

- [ ] **Step 1: Write the failing test**

```ts
// src/theme/themes/obsidian-lens.test.ts
import { expect, test } from 'vitest'
import { obsidianLens } from './obsidian-lens'

test('obsidian lens is the dark default with current rendered values', () => {
  expect(obsidianLens.id).toBe('obsidian-lens')
  expect(obsidianLens.kind).toBe('dark')
  expect(obsidianLens.ui.surface).toBe('#121221')
  expect(obsidianLens.ui.primary).toBe('#e2c7ff')
  expect(obsidianLens.ui['secondary-container']).toBe('#124988') // rendered truth, not tokens.css #57377f
  expect(obsidianLens.effects['scrollbar-thumb']).toBe('#333344')
  expect(obsidianLens.terminal.background).toBe('#1e1e2e')
  expect(obsidianLens.agents.claude.accent).toBe('#cba6f7')
  expect(obsidianLens.agents.browser.accent).toBe('#4fc8d6')
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run src/theme/themes/obsidian-lens.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/theme/themes/obsidian-lens.ts`**

```ts
import type { ThemeDefinition } from '../types'

/* The Obsidian Lens — the current rendered appearance, collected from
 * tailwind.config.js (ui), index.css + docs tokens.css (effects),
 * terminal/theme/catppuccin-mocha.ts (terminal), agents/registry.ts +
 * browser/browserIdentity.ts (agents). This file is the single source
 * of truth; the @theme block in src/theme/theme.css must stay in sync
 * (guarded by themeCss.test.ts). */
export const obsidianLens: ThemeDefinition = {
  id: 'obsidian-lens',
  label: 'Obsidian Lens',
  kind: 'dark',
  ui: {
    surface: '#121221',
    'surface-container-lowest': '#0d0d1c',
    'surface-container-low': '#1a1a2a',
    'surface-container': '#1e1e2e',
    'surface-container-high': '#292839',
    'surface-container-highest': '#333344',
    'surface-bright': '#383849',
    'surface-tint': '#d9b9ff',
    'browser-bar': '#121226',
    'browser-tab-active': '#23233b',
    primary: '#e2c7ff',
    'primary-container': '#cba6f7',
    'primary-dim': '#d3b9f0',
    'primary-deep': '#57377f',
    'on-primary': '#3f1e66',
    secondary: '#a8c8ff',
    'secondary-container': '#124988',
    'secondary-dim': '#c39eee',
    'on-secondary': '#003062',
    'on-secondary-container': '#8fbaff',
    tertiary: '#ff94a5',
    'tertiary-container': '#fd7e94',
    'on-tertiary': '#3a2e2b',
    'on-tertiary-container': '#524442',
    error: '#ffb4ab',
    'error-container': '#93000a',
    'error-dim': '#d73357',
    'on-error': '#690005',
    'on-error-container': '#ffdad6',
    success: '#50fa7b',
    'success-muted': '#7defa1',
    warning: '#fab387',
    'on-surface': '#e3e0f7',
    'on-surface-variant': '#cdc3d1',
    'on-surface-muted': '#8a8299',
    outline: '#968e9a',
    'outline-variant': '#4a444f',
    'editor-fg': '#cdd6f4',
    'editor-fg-dim': '#a6adc8',
    'vcs-modified': '#fbbf24',
    'vcs-added': '#34d399',
    'vcs-deleted': '#f87171',
    'vcs-renamed': '#22d3ee',
    'vcs-untracked': '#c084fc',
  },
  effects: {
    'glass-fill': 'rgba(30, 30, 46, 0.88)',
    selection: 'rgba(203, 166, 247, 0.3)',
    'scrollbar-thumb': '#333344',
    'scrollbar-thumb-hover': '#4a444f',
    'diff-added': 'rgba(166, 227, 161, 0.15)',
    'diff-removed': 'rgba(243, 139, 168, 0.15)',
    'diff-highlight-added': 'rgba(166, 227, 161, 0.35)',
    'diff-highlight-removed': 'rgba(243, 139, 168, 0.35)',
    'wash-faint': 'rgba(255, 255, 255, 0.04)',
    'wash-subtle': 'rgba(255, 255, 255, 0.05)',
    'wash-soft': 'rgba(255, 255, 255, 0.08)',
  },
  shadows: {
    'pane-focus':
      '0 0 0 6px rgb(203 166 247 / 0.16), 0 8px 32px rgb(0 0 0 / 0.35)',
    modal: '0 24px 80px rgb(0 0 0 / 0.5)',
    'pip-glow': '0 0 4px currentColor',
    ambient: '0 10px 40px rgba(0, 0, 0, 0.4)',
    'glow-primary': '0 0 24px rgba(203, 166, 247, 0.35)',
    'ring-primary': '0 0 0 3px rgba(203, 166, 247, 0.28)',
  },
  syntax: {
    keyword: '#cba6f7',
    string: '#a6e3a1',
    fn: '#89b4fa',
    variable: '#f5e0dc',
    comment: '#6c7086',
    type: '#fab387',
    tag: '#f38ba8',
    class: '#f9e2af',
    operator: '#89dceb',
  },
  terminal: {
    foreground: '#cdd6f4',
    background: '#1e1e2e',
    cursor: '#f5e0dc',
    cursorAccent: '#1e1e2e',
    selectionBackground: '#585b70',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8',
  },
  agents: {
    claude: {
      accent: '#cba6f7',
      accentDim: 'rgb(203 166 247 / 0.16)',
      accentSoft: 'rgb(203 166 247 / 0.32)',
      onAccent: '#2a1646',
    },
    codex: {
      accent: '#7defa1',
      accentDim: 'rgb(125 239 161 / 0.16)',
      accentSoft: 'rgb(125 239 161 / 0.32)',
      onAccent: '#0a2415',
    },
    gemini: {
      accent: '#a8c8ff',
      accentDim: 'rgb(168 200 255 / 0.16)',
      accentSoft: 'rgb(168 200 255 / 0.32)',
      onAccent: '#0e1c33',
    },
    shell: {
      accent: '#f0c674',
      accentDim: 'rgb(240 198 116 / 0.14)',
      accentSoft: 'rgb(240 198 116 / 0.30)',
      onAccent: '#2a1f08',
    },
    browser: {
      accent: '#4fc8d6',
      accentDim: 'rgb(79 200 214 / 0.16)',
      accentSoft: 'rgb(79 200 214 / 0.30)',
      onAccent: '#06232a',
    },
  },
}
```

- [ ] **Step 4: Run tests, commit**

```bash
npx vitest run src/theme/themes/obsidian-lens.test.ts && npm run type-check
git add src/theme/themes/
git commit -m "feat(theme): collect Obsidian Lens into a complete theme definition"
```

### Task 4: CSS variable emission (`cssVars.ts`)

**Files:**

- Create: `src/theme/cssVars.ts`
- Test: `src/theme/cssVars.test.ts`

Mapping rules (spec §4): every color token → `--color-<name>`; syntax → `--color-syn-<name>`; agents → `--color-agent-<id>-<kebab-field>`; shadows → `--shadow-<name>`. Terminal tokens are NOT emitted as CSS vars (xterm is canvas; they go through the subscription).

- [ ] **Step 1: Write the failing test**

```ts
// src/theme/cssVars.test.ts
import { expect, test } from 'vitest'
import { toCssVars } from './cssVars'
import { obsidianLens } from './themes/obsidian-lens'

test('emits ui tokens under --color-*', () => {
  const vars = toCssVars(obsidianLens)
  expect(vars['--color-surface']).toBe('#121221')
  expect(vars['--color-on-surface-muted']).toBe('#8a8299')
})

test('emits effect colors, syntax, and shadows under their namespaces', () => {
  const vars = toCssVars(obsidianLens)
  expect(vars['--color-wash-subtle']).toBe('rgba(255, 255, 255, 0.05)')
  expect(vars['--color-syn-keyword']).toBe('#cba6f7')
  expect(vars['--shadow-modal']).toBe('0 24px 80px rgb(0 0 0 / 0.5)')
})

test('flattens agent accents with kebab-cased fields', () => {
  const vars = toCssVars(obsidianLens)
  expect(vars['--color-agent-claude-accent']).toBe('#cba6f7')
  expect(vars['--color-agent-claude-accent-dim']).toBe(
    'rgb(203 166 247 / 0.16)'
  )
  expect(vars['--color-agent-browser-on-accent']).toBe('#06232a')
})

test('does not emit terminal colors as CSS vars', () => {
  const vars = toCssVars(obsidianLens)
  expect(Object.keys(vars).filter((k) => k.includes('terminal'))).toHaveLength(
    0
  )
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/theme/cssVars.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/theme/cssVars.ts`**

```ts
import {
  AGENT_ACCENT_FIELDS,
  AGENT_IDS,
  EFFECT_COLOR_TOKENS,
  SHADOW_TOKENS,
  SYN_TOKENS,
  UI_TOKENS,
  type ThemeDefinition,
} from './types'

const kebab = (field: string): string =>
  field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

export const toCssVars = (theme: ThemeDefinition): Record<string, string> => {
  const vars: Record<string, string> = {}

  for (const token of UI_TOKENS) {
    vars[`--color-${token}`] = theme.ui[token]
  }

  for (const token of EFFECT_COLOR_TOKENS) {
    vars[`--color-${token}`] = theme.effects[token]
  }

  for (const token of SYN_TOKENS) {
    vars[`--color-syn-${token}`] = theme.syntax[token]
  }

  for (const id of AGENT_IDS) {
    for (const field of AGENT_ACCENT_FIELDS) {
      vars[`--color-agent-${id}-${kebab(field)}`] = theme.agents[id][field]
    }
  }

  for (const token of SHADOW_TOKENS) {
    vars[`--shadow-${token}`] = theme.shadows[token]
  }

  return vars
}
```

- [ ] **Step 4: Run tests, commit**

```bash
npx vitest run src/theme/cssVars.test.ts
git add src/theme/cssVars.ts src/theme/cssVars.test.ts
git commit -m "feat(theme): map theme definitions to CSS custom properties"
```

### Task 5: ThemeService

**Files:**

- Create: `src/theme/service.ts`
- Test: `src/theme/service.test.ts`

Deep module, narrow interface: `apply` / `current` / `subscribe` / `list` / `init` (spec §5). jsdom supports everything tested here.

- [ ] **Step 1: Write the failing test**

```ts
// src/theme/service.test.ts
import { beforeEach, expect, test, vi } from 'vitest'
import { THEME_STORAGE_KEY, themeService } from './service'

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
  themeService.apply('obsidian-lens')
})

test('apply writes CSS vars, data-theme, and color-scheme', () => {
  themeService.apply('flexoki')
  const root = document.documentElement
  expect(root.dataset.theme).toBe('flexoki')
  expect(root.style.colorScheme).toBe('light')
  expect(root.style.getPropertyValue('--color-surface')).toBe('#fffcf0')
})

test('apply persists and current() reflects the active theme', () => {
  themeService.apply('flexoki')
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('flexoki')
  expect(themeService.current().id).toBe('flexoki')
})

test('subscribers are notified once per apply with the new theme', () => {
  const seen = vi.fn()
  const unsubscribe = themeService.subscribe(seen)
  themeService.apply('flexoki')
  expect(seen).toHaveBeenCalledTimes(1)
  expect(seen.mock.calls[0][0].id).toBe('flexoki')
  unsubscribe()
  themeService.apply('obsidian-lens')
  expect(seen).toHaveBeenCalledTimes(1)
})

test('init falls back to obsidian-lens for unknown stored ids', () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, 'no-such-theme')
  themeService.init()
  expect(themeService.current().id).toBe('obsidian-lens')
})

test('init applies a valid stored theme', () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, 'flexoki')
  themeService.init()
  expect(document.documentElement.dataset.theme).toBe('flexoki')
})

test('list exposes both themes for pickers', () => {
  expect(themeService.list().map((t) => t.id)).toEqual([
    'obsidian-lens',
    'flexoki',
  ])
})
```

Note: this test imports `flexoki`, which does not exist until Phase C. To keep Phase A self-contained, Task 5 Step 3 creates a **placeholder-free but minimal** `flexoki.ts` with the full Phase C values (Task 19 then only tunes values flagged `derived`). See Task 19 for the authoritative value table — Step 3 below links the two.

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/theme/service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/theme/themes/flexoki.ts`**

Use the complete file content from **Task 19 Step 1** (the full Flexoki definition lives there to avoid duplicating 140 lines in this plan; it is complete, not a placeholder). Also create its sibling test from Task 19 Step 2. Then implement the service:

```ts
// src/theme/service.ts
import { toCssVars } from './cssVars'
import { flexoki } from './themes/flexoki'
import { obsidianLens } from './themes/obsidian-lens'
import type { ThemeDefinition, ThemeId } from './types'

export const THEME_STORAGE_KEY = 'vimeflow:theme'

let themes: readonly ThemeDefinition[] = [obsidianLens, flexoki]

const DEFAULT_THEME = obsidianLens

type Listener = (theme: ThemeDefinition) => void

let active: ThemeDefinition = DEFAULT_THEME

const listeners = new Set<Listener>()

const writeDom = (theme: ThemeDefinition): void => {
  const root = document.documentElement

  for (const [name, value] of Object.entries(toCssVars(theme))) {
    root.style.setProperty(name, value)
  }

  root.dataset.theme = theme.id
  root.style.colorScheme = theme.kind
}

const apply = (id: ThemeId): void => {
  const next = themes.find((t) => t.id === id) ?? DEFAULT_THEME

  active = next
  writeDom(next)
  window.localStorage.setItem(THEME_STORAGE_KEY, next.id)
  listeners.forEach((listener) => listener(next))
}

export const themeService = {
  apply,
  current: (): ThemeDefinition => active,
  list: (): readonly ThemeDefinition[] => themes,
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener)

    return (): void => {
      listeners.delete(listener)
    }
  },
  /** Read persisted choice and apply it. Called once, pre-render. */
  init: (): void => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    const found = themes.find((t) => t.id === stored)

    apply(found ? found.id : DEFAULT_THEME.id)
  },
}

/* Dev-only: editing a theme file re-applies the active theme live, so
 * Flexoki value tuning shows on screen without a reload (spec §5). */
if (import.meta.hot) {
  import.meta.hot.accept(
    ['./themes/obsidian-lens', './themes/flexoki'],
    ([obsMod, flexMod]) => {
      const nextObsidian =
        (obsMod as { obsidianLens?: ThemeDefinition } | undefined)
          ?.obsidianLens ?? obsidianLens
      const nextFlexoki =
        (flexMod as { flexoki?: ThemeDefinition } | undefined)?.flexoki ??
        flexoki

      themes = [nextObsidian, nextFlexoki]
      apply(active.id)
    }
  )
}
```

- [ ] **Step 4: Run tests (service + flexoki), commit**

```bash
npx vitest run src/theme/ && npm run type-check
git add src/theme/
git commit -m "feat(theme): ThemeService with apply/subscribe/persist + Flexoki definition"
```

### Task 6: `useTheme` hook and public exports

**Files:**

- Create: `src/theme/useTheme.ts`, `src/theme/index.ts`
- Test: `src/theme/useTheme.test.ts`, `src/theme/index.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/theme/useTheme.test.ts
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
```

```ts
// src/theme/index.test.ts
import { expect, test } from 'vitest'
import * as theme from './index'

test('public surface exposes service, hook, types helpers', () => {
  expect(theme.themeService).toBeDefined()
  expect(theme.useTheme).toBeTypeOf('function')
  expect(theme.toCssVars).toBeTypeOf('function')
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/theme/useTheme.test.ts src/theme/index.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// src/theme/useTheme.ts
import { useSyncExternalStore } from 'react'
import { themeService } from './service'
import type { ThemeDefinition } from './types'

export const useTheme = (): ThemeDefinition =>
  useSyncExternalStore(themeService.subscribe, themeService.current)
```

```ts
// src/theme/index.ts
export { themeService, THEME_STORAGE_KEY } from './service'
export { useTheme } from './useTheme'
export { toCssVars } from './cssVars'
export { obsidianLens } from './themes/obsidian-lens'
export { flexoki } from './themes/flexoki'
export type { AgentAccent, ThemeDefinition, ThemeId, ThemeKind } from './types'
```

- [ ] **Step 4: Run tests, commit**

```bash
npx vitest run src/theme/
git add src/theme/useTheme.ts src/theme/useTheme.test.ts src/theme/index.ts src/theme/index.test.ts
git commit -m "feat(theme): useTheme hook and public module surface"
```

### Task 7: Tailwind cutover — `theme.css`, `base.css`, `index.css`, `tailwind.config.js`

**Files:**

- Create: `src/theme/theme.css`, `src/theme/base.css`
- Test: `src/theme/themeCss.test.ts`
- Modify: `src/index.css` (lines 1–3, 100–137, 139–245, 303–320), `tailwind.config.js` (remove `colors` + `boxShadow`)

This is the structural cutover. After it, utilities resolve through `var(--color-*)` with Obsidian defaults — the app renders pixel-identical.

- [ ] **Step 1: Write the failing sync test**

```ts
// src/theme/themeCss.test.ts
import { expect, test } from 'vitest'
import { toCssVars } from './cssVars'
import { obsidianLens } from './themes/obsidian-lens'
import themeCss from './theme.css?raw'

const parseThemeBlock = (css: string): Record<string, string> => {
  const block = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  const vars: Record<string, string> = {}

  for (const match of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    vars[match[1]] = match[2].trim()
  }

  return vars
}

test('@theme block matches the Obsidian Lens definition exactly', () => {
  expect(parseThemeBlock(themeCss)).toEqual(toCssVars(obsidianLens))
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/theme/themeCss.test.ts
```

Expected: FAIL — cannot resolve `./theme.css?raw`.

- [ ] **Step 3: Generate `src/theme/theme.css`**

The `@theme` block must contain exactly `toCssVars(obsidianLens)` — generate it instead of hand-typing 96 lines:

```bash
node --experimental-strip-types -e "
import { toCssVars } from './src/theme/cssVars.ts'
import { obsidianLens } from './src/theme/themes/obsidian-lens.ts'
const body = Object.entries(toCssVars(obsidianLens))
  .map(([k, v]) => \`  \${k}: \${v};\`)
  .join('\n')
console.log('/* GENERATED defaults — single source of truth is')
console.log(' * src/theme/themes/obsidian-lens.ts; themeCss.test.ts keeps')
console.log(' * this block in sync. Regenerate via the Task 7 Step 3')
console.log(' * one-liner in the implementation plan. */')
console.log('@theme {')
console.log(body)
console.log('}')
" > src/theme/theme.css
```

(If `--experimental-strip-types` is unavailable on the installed Node, write the same content via a throwaway `npx tsx` invocation: `npx tsx -e "..."` with the identical script body.)

- [ ] **Step 4: Run the sync test**

```bash
npx vitest run src/theme/themeCss.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write `src/theme/base.css`** (static vars carried over from `docs/design/tokens.css` + global scrollbar + selection)

```css
/* Static, theme-independent variables (carried from docs/design/tokens.css,
 * which no longer loads at runtime) + global scrollbar/selection rules.
 * Color values are var() references — never literals (cssGuard.test.ts). */
:root {
  /* ── Type ── */
  --font-display: 'Instrument Sans', 'Manrope', system-ui, sans-serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* ── Radius ── */
  --radius-xl: 1.5rem;
  --radius-lg: 1rem;
  --radius-md: 0.75rem;
  --radius-sm: 0.5rem;
  --radius-full: 9999px;

  /* ── Layout ── */
  --rail-w: 48px;
  --sidebar-w: 272px;
  --sidebar-w-compact: 248px;
  --activity-w: 320px;
  --view-tabs-h: 40px;
  --status-bar-h: 24px;

  /* ── Motion ── */
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --dur-fast: 160ms;
  --dur-base: 300ms;
  --dur-entry: 220ms;
  --dur-slow: 400ms;

  /* ── Glass ── */
  --glass-blur: 20px;
  --glass-saturate: 150%;
}

::selection {
  background: var(--color-selection);
  color: var(--color-on-surface);
}

@layer base {
  /* Global default: every scroll container — current and future, including
   * xterm's viewport and CodeMirror's scroller — gets the thin themed
   * scrollbar. `no-scrollbar` remains the only opt-out.
   * `scrollbar-width`/`scrollbar-color` (CSS standard) and
   * `::-webkit-scrollbar` (WebKit pseudo) both apply on WebKitGTK on
   * Linux — the renderer paints two synced vertical tracks. Gate the
   * standard properties to engines that lack the pseudo (Firefox,
   * detected via `-moz-appearance: none`) so WebKit only sees the
   * pseudo-element rules. */
  @supports (-moz-appearance: none) {
    * {
      scrollbar-width: thin;
      scrollbar-color: var(--color-scrollbar-thumb) transparent;
    }
  }

  *::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  *::-webkit-scrollbar-track {
    background: transparent;
  }

  *::-webkit-scrollbar-thumb {
    background: var(--color-scrollbar-thumb);
    border-radius: 10px;
  }

  *::-webkit-scrollbar-thumb:hover {
    background: var(--color-scrollbar-thumb-hover);
  }
}
```

- [ ] **Step 6: Rewire `src/index.css`**

Replace lines 1–3:

```css
@import './theme/base.css';
@import 'tailwindcss';
@import './theme/theme.css';
@config '../tailwind.config.js';
```

(`theme.css` must come after `@import 'tailwindcss'` so `@theme` is processed by Tailwind; `base.css` is plain CSS and may load first.)

Replace the body rule inside `@layer base` (line 106):

```css
body {
  @apply bg-surface text-on-surface font-body overflow-hidden m-0;
}
```

Delete entirely:

- the `@utility thin-scrollbar { ... }` block (lines 165–190)
- the `.terminal-pane-body .xterm-viewport` scrollbar blocks (lines 192–213)
- the `.cm-editor .cm-scroller` scrollbar blocks + `@supports` block (lines 215–245)

Replace the diff classes (lines 303–320):

```css
/* Diff viewer styling */
.diff-added {
  background-color: var(--color-diff-added);
}

.diff-removed {
  background-color: var(--color-diff-removed);
}

.diff-highlight-added {
  background-color: var(--color-diff-highlight-added);
  border-radius: 2px;
}

.diff-highlight-removed {
  background-color: var(--color-diff-highlight-removed);
  border-radius: 2px;
}
```

- [ ] **Step 7: Strip `tailwind.config.js`**

Delete the entire `colors: { ... }` object and the `boxShadow: { ... }` object from `theme.extend` (shadows now come from `--shadow-*` in `@theme`; `shadow-pane-focus`, `shadow-modal`, `shadow-pip-glow` utilities keep working with identical names). Everything else (keyframes, animation, fontFamily, fontSize, borderRadius, transitionTimingFunction, darkMode) stays.

- [ ] **Step 8: Find any `thin-scrollbar` / `no-scrollbar` class usages and clean up**

```bash
grep -rn "thin-scrollbar" src/ | grep -v ".css"
```

For every hit, delete the `thin-scrollbar` class from the `className` (the global default now covers it). Expected: a handful of components; mechanical removal.

- [ ] **Step 9: Migrate the remaining `var(--…)` consumers**

Repo-wide inventory first:

```bash
grep -rn "var(--" src/ --include="*.tsx" --include="*.ts" --include="*.css" | grep -v "src/theme/" | grep -vE "var\(--(color|shadow|radius|font|rail|sidebar|activity|view-tabs|status-bar|ease|dur|glass)"
```

Known consumers and their replacements:

`src/components/StatusBar.tsx` — replace old token names with the `--color-*` names (same value, new name):

- `var(--outline-variant)` → `var(--color-outline-variant)` (2 inline styles, 1 arbitrary class)
- `text-[var(--success)]` → `text-success` (the utility exists again — simpler than var)
- `text-[var(--on-surface-variant)]` → `text-on-surface-variant`
- `text-[var(--tertiary)]` → `text-tertiary`
- `text-[var(--error)]` → `text-error`
- `text-[var(--primary)]` → `text-primary`
- `text-[var(--on-surface-muted)]` → `text-on-surface-muted` (3×)
- `text-[var(--primary-container)]` → `text-primary-container`
- `bg-[var(--surface-container-low)]` → `hover:bg-surface-container-low` context kept as-is, just rename token: `hover:bg-[var(--color-surface-container-low)]` → prefer `hover:bg-surface-container-low`
- `bg-[var(--surface-container-lowest)]` → `bg-surface-container-lowest`
- `bg-[color-mix(in_srgb,var(--surface-container-high)_60%,transparent)]` → `bg-surface-container-high/60`
- `border-[color:color-mix(in_srgb,var(--outline-variant)_60%,transparent)]` → `border-outline-variant/60`
- `focus-visible:shadow-[var(--ring-primary)]` → `focus-visible:shadow-[var(--shadow-ring-primary)]`
- `rounded-[var(--radius-sm)]`, `h-[var(--status-bar-h)]` — unchanged (static vars now in base.css)

`src/features/editor/components/MarkdownReadingView.css` — rename every `var(--syn-X)` → `var(--color-syn-X)` (7 occurrences), `var(--on-surface)` → `var(--color-on-surface)`, `var(--surface-container-lowest)` → `var(--color-surface-container-lowest)`. Update the header comment to point at `src/theme/` instead of `docs/design/tokens.css`.

Then re-run the inventory grep: expected zero hits outside `src/theme/`.

- [ ] **Step 10: Verify zero visual change**

```bash
npm run type-check && npx vitest run && npm run build
```

Expected: all pass. Then `npm run dev`, open the app, compare against `main` visually (surfaces, scrollbars, diff colors, status bar). Everything identical.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(theme): tailwind v4 @theme cutover — utilities resolve through CSS variables"
```

### Task 8: Pre-render init + `:set theme` command

**Files:**

- Modify: `src/main.tsx`, `src/features/command-palette/data/defaultCommands.ts` (the `set-theme` stub at lines 42–51)
- Test: modify `src/features/command-palette/data/defaultCommands.test.ts` (or create if missing)

- [ ] **Step 1: Wire init in `src/main.tsx`** (before `createRoot` — synchronous, pre-paint, no FOUC)

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/e2e-bridge'
import { themeService } from './theme'
import App from './App.tsx'

themeService.init()

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 2: Write the failing command test**

Add to the existing defaultCommands test file (create `src/features/command-palette/data/defaultCommands.test.ts` if absent):

```ts
import { expect, test } from 'vitest'
import { themeService } from '../../../theme'
import { defaultCommands } from './defaultCommands'
import { findCommandById } from '../registry/commandTree'

test(':set theme lists every registered theme and applies on execute', () => {
  const setTheme = findCommandById(defaultCommands, 'set-theme')
  expect(setTheme?.children?.map((c) => c.id)).toEqual([
    'set-theme-obsidian-lens',
    'set-theme-flexoki',
  ])

  findCommandById(defaultCommands, 'set-theme-flexoki')?.execute?.('')
  expect(themeService.current().id).toBe('flexoki')

  findCommandById(defaultCommands, 'set-theme-obsidian-lens')?.execute?.('')
  expect(themeService.current().id).toBe('obsidian-lens')
})
```

- [ ] **Step 3: Run to verify failure**

```bash
npx vitest run src/features/command-palette/data/defaultCommands.test.ts
```

Expected: FAIL — `set-theme` has no children.

- [ ] **Step 4: Replace the `set-theme` stub in `defaultCommands.ts`**

```ts
      {
        id: 'set-theme',
        label: 'theme',
        description: 'Switch color theme',
        icon: 'palette',
        children: themeService.list().map((theme) => ({
          id: `set-theme-${theme.id}`,
          label: theme.id,
          description: `Switch to ${theme.label}`,
          icon: 'palette',
          execute: (): void => {
            themeService.apply(theme.id)
          },
        })),
      },
```

Add the import at the top of `defaultCommands.ts`:

```ts
import { themeService } from '../../../theme'
```

(If the leaf `execute` signature requires an args parameter per `Command`, match the existing `(args: string): void` shape.)

- [ ] **Step 5: Run tests + lint, commit**

```bash
npx vitest run src/features/command-palette/ && npm run lint
git add src/main.tsx src/features/command-palette/data/
git commit -m "feat(theme): pre-render theme init + :set theme palette command"
```

### Task 9: Terminal bridge (xterm re-theming)

**Files:**

- Create: `src/features/terminal/theme/toXtermTheme.ts`, `src/features/terminal/theme/themeBridge.ts`
- Test: `src/features/terminal/theme/toXtermTheme.test.ts`, `src/features/terminal/theme/themeBridge.test.ts`
- Modify: `src/features/terminal/components/TerminalPane/Body.tsx` (imports at line 19, terminal creation at ~line 610), `src/main.tsx`
- Delete: `src/features/terminal/theme/catppuccin-mocha.ts` (its data now lives in `obsidian-lens.ts`)
- Modify: `src/features/terminal/types/index.test.ts` (palette expectations move to importing `obsidianLens`)

- [ ] **Step 1: Move `toXtermTheme` to its own file**

```ts
// src/features/terminal/theme/toXtermTheme.ts
import type { TerminalTheme } from '../types'

/** Convert TerminalTheme to xterm.js ITheme format. */
export const toXtermTheme = (theme: TerminalTheme): Record<string, string> => ({
  foreground: theme.foreground,
  background: theme.background,
  cursor: theme.cursor,
  cursorAccent: theme.cursorAccent,
  selectionBackground: theme.selectionBackground,
  ...(theme.selectionForeground && {
    selectionForeground: theme.selectionForeground,
  }),
  black: theme.black,
  red: theme.red,
  green: theme.green,
  yellow: theme.yellow,
  blue: theme.blue,
  magenta: theme.magenta,
  cyan: theme.cyan,
  white: theme.white,
  brightBlack: theme.brightBlack,
  brightRed: theme.brightRed,
  brightGreen: theme.brightGreen,
  brightYellow: theme.brightYellow,
  brightBlue: theme.brightBlue,
  brightMagenta: theme.brightMagenta,
  brightCyan: theme.brightCyan,
  brightWhite: theme.brightWhite,
})
```

```ts
// src/features/terminal/theme/toXtermTheme.test.ts
import { expect, test } from 'vitest'
import { obsidianLens } from '../../../theme'
import { toXtermTheme } from './toXtermTheme'

test('maps every TerminalTheme field into the xterm shape', () => {
  const xterm = toXtermTheme(obsidianLens.terminal)
  expect(xterm.background).toBe('#1e1e2e')
  expect(xterm.brightWhite).toBe('#a6adc8')
  expect(Object.keys(xterm)).toHaveLength(21)
})
```

- [ ] **Step 2: Write the failing bridge test**

```ts
// src/features/terminal/theme/themeBridge.test.ts
import { afterEach, expect, test } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { themeService } from '../../../theme'
import {
  clearTerminalCache,
  terminalCache,
} from '../components/TerminalPane/Body'
import { initTerminalThemeBridge } from './themeBridge'
import { toXtermTheme } from './toXtermTheme'

afterEach(() => {
  clearTerminalCache()
  themeService.apply('obsidian-lens')
})

test('live terminals get the new xterm theme on switch', () => {
  const fake = { options: { theme: {} }, dispose: (): void => {} }
  terminalCache.set('s1', {
    terminal: fake as unknown as Terminal,
    fitAddon: { fit: (): void => {} } as never,
  })

  const stop = initTerminalThemeBridge()
  themeService.apply('flexoki')

  expect(fake.options.theme).toEqual(
    toXtermTheme(themeService.current().terminal)
  )
  stop()
})
```

- [ ] **Step 3: Run to verify failure**

```bash
npx vitest run src/features/terminal/theme/themeBridge.test.ts
```

Expected: FAIL — `themeBridge` not found.

- [ ] **Step 4: Implement the bridge**

```ts
// src/features/terminal/theme/themeBridge.ts
import { themeService } from '../../../theme'
import { terminalCache } from '../components/TerminalPane/Body'
import { toXtermTheme } from './toXtermTheme'

/** Re-theme every live xterm instance when the workspace theme changes.
 * xterm renders to canvas and cannot read CSS variables — assigning a
 * fresh `options.theme` object triggers a colors-only repaint
 * (scrollback recolors, PTY untouched). */
export const initTerminalThemeBridge = (): (() => void) =>
  themeService.subscribe((theme) => {
    const xtermTheme = toXtermTheme(theme.terminal)

    terminalCache.forEach(({ terminal }) => {
      terminal.options.theme = xtermTheme
    })
  })
```

- [ ] **Step 5: Switch the creation site and delete the old palette file**

In `src/features/terminal/components/TerminalPane/Body.tsx`:

- line 19: replace `import { catppuccinMocha, toXtermTheme } from '../../theme/catppuccin-mocha'` with:

```ts
import { themeService } from '../../../../theme'
import { toXtermTheme } from '../../theme/toXtermTheme'
```

- creation (~line 610): replace `theme: toXtermTheme(catppuccinMocha),` with:

```ts
        theme: toXtermTheme(themeService.current().terminal),
```

Delete `src/features/terminal/theme/catppuccin-mocha.ts`. Update `src/features/terminal/types/index.test.ts`: replace any import of `catppuccinMocha` with `import { obsidianLens } from '../../../theme'` and assert against `obsidianLens.terminal` (same values, e.g. `expect(obsidianLens.terminal.background).toBe('#1e1e2e')`).

In `src/main.tsx`, start the bridge right after init:

```ts
import { initTerminalThemeBridge } from './features/terminal/theme/themeBridge'

themeService.init()
initTerminalThemeBridge()
```

- [ ] **Step 6: Full test run + commit**

```bash
npx vitest run src/features/terminal/ src/theme/ && npm run type-check
git add -A
git commit -m "feat(theme): xterm theme bridge — terminals re-theme on switch"
```

### Task 10: CodeMirror theme rewrite (vars + dark-facet Compartment)

**Files:**

- Rewrite: `src/features/editor/theme/catppuccin.ts` → keep path (exports change to a builder), or cleaner: create `src/features/editor/theme/editorTheme.ts`, delete `catppuccin.ts`
- Test: `src/features/editor/theme/editorTheme.test.ts`
- Modify: `src/features/editor/hooks/useCodeMirror.ts` (imports; extensions array ~line 397; add subscription effect)

- [ ] **Step 1: Write the failing test**

```ts
// src/features/editor/theme/editorTheme.test.ts
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { expect, test } from 'vitest'
import { createEditorTheme } from './editorTheme'

test('dark kind sets the darkTheme facet, light does not', () => {
  const dark = EditorState.create({ extensions: createEditorTheme('dark') })
  const light = EditorState.create({ extensions: createEditorTheme('light') })
  expect(dark.facet(EditorView.darkTheme)).toBe(true)
  expect(light.facet(EditorView.darkTheme)).toBe(false)
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/features/editor/theme/editorTheme.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/features/editor/theme/editorTheme.ts`**

Every color is a `var(--color-*)` reference (CodeMirror renders DOM — variables work and re-theme with zero reconfigure); only the `dark` boolean needs the Compartment. Color mapping preserves today's exact rendered colors (`editor-fg` = old `colors.text`, `syn-class` = old yellow, `syn-type` = old peach for constants/numbers, `syn-operator` = old sky):

```ts
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { ThemeKind } from '../../../theme'

// Editing-surface mono stack; mirrors Tailwind's `mono` token.
export const EDITOR_MONO_FONT_FAMILY =
  '"Ioskeley Mono", "JetBrains Mono", ui-monospace, monospace'

const c = (token: string): string => `var(--color-${token})`

const mix = (token: string, pct: number): string =>
  `color-mix(in srgb, var(--color-${token}) ${pct}%, transparent)`

const buildTheme = (kind: ThemeKind): Extension =>
  EditorView.theme(
    {
      // `&` targets `.cm-editor`. `height: 100%` is load-bearing — see the
      // canonical CM6 "fill container" recipe note in the git history of
      // theme/catppuccin.ts (PR #228 era): without it .cm-scroller never
      // overflows and vim scroll-follow has no scrollable ancestor.
      '&': {
        backgroundColor: c('surface'),
        color: c('editor-fg'),
        height: '100%',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: EDITOR_MONO_FONT_FAMILY,
      },
      '.cm-content': {
        caretColor: c('primary'),
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: c('primary'),
      },
      '&.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: mix('primary', 25),
      },
      '.cm-selectionBackground': {
        backgroundColor: mix('primary', 19),
      },
      '.cm-activeLine': {
        backgroundColor: c('surface-container'),
      },
      '.cm-gutters': {
        backgroundColor: c('surface-container-low'),
        color: c('syn-comment'),
        border: 'none',
      },
      '.cm-activeLineGutter': {
        backgroundColor: c('surface-container'),
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 8px 0 8px',
        minWidth: '40px',
      },
      '.cm-matchingBracket': {
        backgroundColor: mix('syn-keyword', 30),
        outline: 'none',
      },
      '.cm-nonmatchingBracket': {
        backgroundColor: mix('syn-type', 20),
      },
    },
    { dark: kind === 'dark' }
  )

const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: c('syn-keyword') },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: c('editor-fg') },
  { tag: [t.propertyName], color: c('syn-fn') },
  { tag: [t.variableName], color: c('syn-variable') },
  { tag: [t.function(t.variableName)], color: c('syn-fn') },
  { tag: [t.labelName], color: c('syn-keyword') },
  {
    tag: [t.color, t.constant(t.name), t.standard(t.name)],
    color: c('syn-type'),
  },
  { tag: [t.definition(t.name), t.separator], color: c('editor-fg') },
  { tag: [t.className], color: c('syn-class') },
  {
    tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
    color: c('syn-type'),
  },
  { tag: [t.typeName], color: c('syn-class') },
  { tag: [t.operator, t.operatorKeyword], color: c('syn-operator') },
  { tag: [t.url, t.escape, t.regexp, t.link], color: c('syn-string') },
  { tag: [t.meta, t.comment], color: c('syn-comment') },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: c('syn-keyword') },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: c('syn-type') },
  { tag: t.invalid, color: c('syn-type') },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.string, color: c('syn-string') },
])

/** Theme extension for the given kind. Colors are CSS variables — only the
 * dark/light base facet differs, so a theme switch only needs a Compartment
 * reconfigure when `kind` changes. */
export const createEditorTheme = (kind: ThemeKind): Extension => [
  buildTheme(kind),
  syntaxHighlighting(highlightStyle),
]
```

- [ ] **Step 4: Wire the Compartment in `useCodeMirror.ts`**

Imports — remove `import { catppuccinMocha } from '../theme/catppuccin'` (also move the `EDITOR_MONO_FONT_FAMILY` import to `../theme/editorTheme` if referenced); add:

```ts
import { Compartment } from '@codemirror/state'
import { themeService } from '../../../theme'
import { createEditorTheme } from '../theme/editorTheme'
```

Inside the hook, next to the existing `languageCompartment` ref, add:

```ts
const themeCompartment = useRef(new Compartment())
```

In the extensions array (~line 397), replace `catppuccinMocha,` with:

```ts
      themeCompartment.current.of(
        createEditorTheme(themeService.current().kind)
      ),
```

After the view-creation effect, add a subscription effect (same effect that creates the view can register it; place it right after `const view = new EditorView({...})` so it captures `view`):

```ts
const unsubscribeTheme = themeService.subscribe((theme) => {
  view.dispatch({
    effects: themeCompartment.current.reconfigure(
      createEditorTheme(theme.kind)
    ),
  })
})
```

…and call `unsubscribeTheme()` in that effect's existing cleanup (before `view.destroy()`).

Delete `src/features/editor/theme/catppuccin.ts` and migrate any remaining importers of `EDITOR_MONO_FONT_FAMILY`:

```bash
grep -rn "theme/catppuccin'" src/ --include="*.ts*"
```

Expected after edits: zero hits.

- [ ] **Step 5: Run editor tests + visual check, commit**

```bash
npx vitest run src/features/editor/ && npm run type-check
```

Then `npm run dev`: open a file — syntax colors identical to before.

```bash
git add -A
git commit -m "feat(theme): CodeMirror theme via CSS variables + dark-facet compartment"
```

### Task 11: Diff Pierre-theme bridge

**Files:**

- Create: `src/features/diff/pierreTheme.ts`
- Test: `src/features/diff/pierreTheme.test.ts`
- Modify: `src/features/diff/components/DiffPanelContent.tsx` (theme state init at line 876 + new effect)

- [ ] **Step 1: Write the failing test**

```ts
// src/features/diff/pierreTheme.test.ts
import { expect, test } from 'vitest'
import { pierreThemeForKind } from './pierreTheme'

test('maps workspace theme kind to the nearest Pierre theme', () => {
  expect(pierreThemeForKind('dark')).toBe('pierre-dark')
  expect(pierreThemeForKind('light')).toBe('pierre-light')
})
```

- [ ] **Step 2: Run to verify failure, then implement**

```bash
npx vitest run src/features/diff/pierreTheme.test.ts
```

```ts
// src/features/diff/pierreTheme.ts
import type { DiffsThemeNames } from '@pierre/diffs'
import type { ThemeKind } from '../../theme'

/** Pierre ships fixed built-in themes; map the workspace kind to the
 * nearest one. The toolbar dropdown stays as a session-level override —
 * a workspace theme switch resets it to this mapping. */
export const pierreThemeForKind = (kind: ThemeKind): DiffsThemeNames =>
  kind === 'dark' ? 'pierre-dark' : 'pierre-light'
```

- [ ] **Step 3: Bridge in `DiffPanelContent.tsx`**

Imports:

```ts
import { useTheme } from '../../../theme'
import { pierreThemeForKind } from '../pierreTheme'
```

At line 876, replace:

```ts
const [theme, setTheme] = useState<DiffsThemeNames>('pierre-dark')
```

with:

```ts
const workspaceTheme = useTheme()
const [theme, setTheme] = useState<DiffsThemeNames>(() =>
  pierreThemeForKind(workspaceTheme.kind)
)

// Workspace theme switch resets the diff theme to the mapped default,
// overriding any session-level dropdown choice (spec §5).
useEffect(() => {
  setTheme(pierreThemeForKind(workspaceTheme.kind))
}, [workspaceTheme.kind])
```

(The existing worker-pool sync effect downstream of `theme` handles propagation — no further change.)

- [ ] **Step 4: Run diff tests, commit**

```bash
npx vitest run src/features/diff/ && npm run type-check
git add src/features/diff/
git commit -m "feat(theme): diff viewer follows workspace theme via Pierre bridge"
```

### Task 12: Phase A acceptance

- [ ] **Step 1: Full gate**

```bash
npm run type-check && npm run lint && npx vitest run && npm run build
```

Expected: all green.

- [ ] **Step 2: Manual smoke (zero visual change + working switch)**

`npm run dev` (or `npm run electron:dev`): app renders identical to `main`. Open command palette → `:set theme flexoki` → entire UI, terminal, editor, diff flip live (Flexoki is still untuned — color correctness is Phase C; the mechanism is what's accepted here). `:set theme obsidian-lens` returns. Reload app — choice persisted.

- [ ] **Step 3: Commit any straggler fixes; tag the phase in the log**

```bash
git add -A && git commit -m "feat(theme): phase A — runtime switching foundation complete" --allow-empty
```

---

## Phase B — Leak migration (inventory-driven)

Sequencing note vs. the spec's §6 batch table: batches 1–3 (index.css scrollbars/diff, the xterm theme file, the CodeMirror theme) already landed inside Phase A Tasks 7/9/10 — they are structural prerequisites of the cutover, not independent leak cleanups. Phase B covers the remaining batches 4–9.

### Task 13: Inventory refresh + mapping table

- [ ] **Step 1: Regenerate the checklist**

```bash
node scripts/audit-colors.mjs leaks > docs/superpowers/plans/2026-06-11-theme-leak-inventory.md
git add docs/superpowers/plans/2026-06-11-theme-leak-inventory.md
git commit -m "docs(theme): phase B leak inventory baseline"
```

**The replacement mapping (applies to every batch below; spec Appendix B):**

| Found                         | Replace with (className)       | Replace with (inline style / CSS)                                                |
| ----------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `#e2c7ff`                     | `text-primary` etc.            | `var(--color-primary)`                                                           |
| `#cba6f7`                     | `*-primary-container`          | `var(--color-primary-container)`                                                 |
| `#8a8299`                     | `*-on-surface-muted`           | `var(--color-on-surface-muted)`                                                  |
| `#6c7086`                     | `*-syn-comment`                | `var(--color-syn-comment)`                                                       |
| `#0d0d1c`                     | `*-surface-container-lowest`   | `var(--color-surface-container-lowest)`                                          |
| `#121221`                     | `*-surface`                    | `var(--color-surface)`                                                           |
| `#1e1e2e`                     | `*-surface-container`          | `var(--color-surface-container)`                                                 |
| `#333344` (scrollbar)         | —                              | `var(--color-scrollbar-thumb)`                                                   |
| `#333344` (surface)           | `*-surface-container-highest`  | `var(--color-surface-container-highest)`                                         |
| `#4a444f`                     | `*-outline-variant`            | `var(--color-outline-variant)`                                                   |
| `rgba(203,166,247,α)`         | `*-primary-container/α`        | `color-mix(in srgb, var(--color-primary-container) α%, transparent)`             |
| `rgba(226,199,255,α)`         | `*-primary/α`                  | `color-mix(in srgb, var(--color-primary) α%, transparent)`                       |
| `rgba(74,68,79,α)`            | `*-outline-variant/α`          | `color-mix(in srgb, var(--color-outline-variant) α%, transparent)`               |
| `rgba(13,13,28,α)`            | `*-surface-container-lowest/α` | `color-mix(in srgb, var(--color-surface-container-lowest) α%, transparent)`      |
| `rgba(0,0,0,α)` in shadows    | `shadow-*` token utilities     | keep inside `--shadow-*` definitions only                                        |
| `#4fc8d6` family              | —                              | `var(--color-agent-browser-accent)` (+`-accent-dim`/`-accent-soft`/`-on-accent`) |
| `#f0c674` family              | —                              | `var(--color-agent-shell-accent)` family                                         |
| `text-amber-400` …            | `text-vcs-modified` …          | —                                                                                |
| `white/[0.03]`/`white/[0.04]` | `*-wash-faint`                 | `var(--color-wash-faint)`                                                        |
| `white/5`, `white/[0.05]`     | `*-wash-subtle`                | `var(--color-wash-subtle)`                                                       |
| `white/[0.08]`                | `*-wash-soft`                  | `var(--color-wash-soft)`                                                         |
| agent accents in TS configs   | —                              | `'var(--color-agent-<id>-…)'` strings                                            |

Values with no row get a real token added to `types.ts` + both theme files + `theme.css` (regenerate via Task 7 Step 3) — never a lookalike substitution. Alpha percentages round to the nearest Tailwind step (`/15`, `/25`, `/30`…); exact fractional alphas keep `color-mix()`.

### Task 14: Agent registries → CSS variable references

**Files:**

- Modify: `src/agents/registry.ts` (color fields), `src/features/browser/browserIdentity.ts`
- Modify tests: `src/agents/registry.test.ts`, `src/features/browser/browserIdentity.test.ts`

- [ ] **Step 1: Update tests first** (assert var-references — the theme owns concrete values now)

In `registry.test.ts` replace the four color assertions:

```ts
test('claude is lavender', () => {
  expect(AGENTS.claude.accent).toBe('var(--color-agent-claude-accent)')
  expect(AGENTS.claude.short).toBe('CLAUDE')
  expect(AGENTS.claude.glyph).toBe('∴')
  expect(AGENTS.claude.model).toBe('sonnet-4')
})
```

…and equivalently `codex` → `var(--color-agent-codex-accent)`, `gemini` → `var(--color-agent-gemini-accent)`, `shell` → `var(--color-agent-shell-accent)`. In `browserIdentity.test.ts`: `expect(BROWSER_IDENTITY.accent).toBe('var(--color-agent-browser-accent)')`.

- [ ] **Step 2: Run to verify failures**

```bash
npx vitest run src/agents/registry.test.ts src/features/browser/browserIdentity.test.ts
```

Expected: FAIL on the color assertions.

- [ ] **Step 3: Update the sources**

In `registry.ts`, each agent's four color fields become var references (consumers — inline styles, SVG — resolve them through the CSS engine and re-theme automatically):

```ts
  claude: {
    id: 'claude',
    name: 'Claude Code',
    short: 'CLAUDE',
    glyph: '∴',
    model: 'sonnet-4',
    accent: 'var(--color-agent-claude-accent)',
    accentDim: 'var(--color-agent-claude-accent-dim)',
    accentSoft: 'var(--color-agent-claude-accent-soft)',
    onAccent: 'var(--color-agent-claude-on-accent)',
  },
```

…same pattern for `codex`, `gemini`, `shell`. In `browserIdentity.ts`:

```ts
export const BROWSER_IDENTITY: PaneIdentity = {
  name: 'Web',
  short: 'WEB',
  glyph: '⊕',
  accent: 'var(--color-agent-browser-accent)',
  accentDim: 'var(--color-agent-browser-accent-dim)',
  accentSoft: 'var(--color-agent-browser-accent-soft)',
  onAccent: 'var(--color-agent-browser-on-accent)',
}
```

- [ ] **Step 4: Run the full suite** (catches any consumer that did string manipulation on these values — fix those by switching them to the `-dim`/`-soft` var instead of computing alpha)

```bash
npx vitest run && npm run dev
```

Visual: agent accent chips/headers identical.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(theme): agent identities reference theme variables"
```

### Task 15: VCS status colors

**Files:**

- Modify: `src/features/files/components/FileTreeNode.tsx` (lines 58–74), `src/features/workspace/components/panels/FileExplorer.tsx` (line 110)
- Modify: their co-located tests if they assert the raw classes

- [ ] **Step 1: Replace the status map**

```tsx
const getGitStatusColor = (status: GitStatus): string => {
  switch (status) {
    case 'modified':
      return 'text-vcs-modified'
    case 'added':
      return 'text-vcs-added'
    case 'deleted':
      return 'text-vcs-deleted'
    case 'renamed':
      return 'text-vcs-renamed'
    case 'untracked':
      return 'text-vcs-untracked'
  }
}
```

In `FileExplorer.tsx` line 110: `text-red-400` → `text-error`.

- [ ] **Step 2: Update any test assertions** (`grep -rn "amber-400\|emerald-400" src/features/files src/features/workspace`), run, commit

```bash
npx vitest run src/features/files/ src/features/workspace/
git add -A && git commit -m "refactor(theme): git status colors via vcs tokens"
```

### Task 16: Workspace dock components (worked example: DockTab)

**Files:**

- Modify: `src/features/workspace/components/DockTab.tsx`, `DockPanel.tsx`, `DockPeekButton.tsx`, `DockSwitcher.tsx`, `ViewModeToggle.tsx` (+ co-located tests if they assert classes)

- [ ] **Step 1: DockTab.tsx — apply the mapping table.** The two class builders become:

```tsx
const tabButtonClass = (active: boolean, compact: boolean): string =>
  `flex items-center justify-center font-mono text-[10.5px] h-[26px] rounded-md border transition-colors ${
    compact ? 'w-[30px] px-0' : 'gap-1.5 px-[11px]'
  } ${
    active
      ? 'bg-primary/[0.08] border-primary-container/30 text-primary'
      : 'bg-transparent border-transparent text-on-surface-muted hover:text-primary'
  }`

const tabIconClass = (active: boolean): string =>
  `material-symbols-outlined text-[12px] ${
    active ? 'text-primary-container' : 'text-syn-comment'
  }`
```

Container/menu/buttons in the same file:

- `border-[rgba(74,68,79,0.25)] bg-[#0d0d1c]` → `border-outline-variant/25 bg-surface-container-lowest`
- `border-[rgba(74,68,79,0.35)] bg-[#0d0d1c]` (menu) → `border-outline-variant/35 bg-surface-container-lowest`
- `text-[#8a8299]` → `text-on-surface-muted`; `hover:text-[#e2c7ff]` → `hover:text-primary` (4 occurrences)
- `hover:bg-white/5` / `focus:bg-white/5` → `hover:bg-wash-subtle` / `focus:bg-wash-subtle`

- [ ] **Step 2: Same mapping over the four sibling components.** Every replacement comes from the Task 13 table:
  - `DockPanel.tsx`: `border-[#cba6f7]` → `border-primary-container` (2×); `border-[rgba(74,68,79,0.3)]` → `border-outline-variant/30`; `bg-[#121221]` → `bg-surface`; focus ring `0 0 0 1px #cba6f7 inset, 0 0 0 6px rgba(203,166,247,0.12)` → `boxShadow: 'inset 0 0 0 1px var(--color-primary-container), 0 0 0 6px color-mix(in srgb, var(--color-primary-container) 12%, transparent)'`
  - `DockPeekButton.tsx`: `bg-[#0d0d1c]` → `bg-surface-container-lowest`; `text-[#8a8299]` → `text-on-surface-muted`; `hover:bg-[rgba(203,166,247,0.10)]` → `hover:bg-primary-container/10`; `hover:text-[#e2c7ff]` → `hover:text-primary`; edge borders `border-[rgba(74,68,79,0.25)]` → `border-outline-variant/25`
  - `DockSwitcher.tsx`: `border-[rgba(74,68,79,0.3)]` → `border-outline-variant/30`; `bg-[rgba(13,13,28,0.6)]` → `bg-surface-container-lowest/60`; active `bg-[rgba(203,166,247,0.15)] border-[rgba(203,166,247,0.45)] text-[#cba6f7]` → `bg-primary-container/15 border-primary-container/45 text-primary-container`; `text-[#8a8299]` → `text-on-surface-muted`; `hover:text-[#e2c7ff]` → `hover:text-primary`
  - `ViewModeToggle.tsx`: active `bg-[rgba(226,199,255,0.08)] border-[rgba(203,166,247,0.3)] text-[#e2c7ff]` → `bg-primary/[0.08] border-primary-container/30 text-primary`; inactive `text-[#8a8299] hover:text-[#e2c7ff]` → `text-on-surface-muted hover:text-primary`

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run src/features/workspace/ && npm run dev
node scripts/audit-colors.mjs leaks | grep -c "workspace/components" || true
```

Expected: dock components render identically; leak count for these five files = 0.

```bash
git add -A && git commit -m "refactor(theme): dock components on semantic tokens"
```

### Task 17: Inline-style heavy components

**Files:**

- Modify: `src/features/terminal/components/TerminalPane/index.tsx` (line 84–86), `TerminalPane/Header.tsx` (line 91), `BurnerTerminalPopup/index.tsx`, `src/features/agent-status/components/TokenCache.tsx`, `ActivityEvent.tsx`, `LiquidFill.tsx`, `src/features/browser/components/BrowserTabBar.tsx` (line 65), `BrowserTabFavicon.tsx`

- [ ] **Step 1: Apply the mapping per file.** Representative complete transforms:

`TerminalPane/index.tsx`:

```ts
// before
background: '#121221'
boxShadow: `0 0 0 6px ${agent.accentDim}, 0 8px 32px rgba(0,0,0,0.35)`
// after
background: 'var(--color-surface)'
boxShadow: `0 0 0 6px ${agent.accentDim}, var(--shadow-ambient)`
```

(`agent.accentDim` is already a var reference after Task 14 — keep the template structure. If the trailing ambient component must stay exactly `0 8px 32px rgba(0,0,0,0.35)`, it equals the second component of `--shadow-pane-focus`; reuse that or add a dedicated `shadow` entry — never an inline literal.)

`BrowserTabBar.tsx` line 65:

```ts
// before
'linear-gradient(180deg, rgba(79,200,214,0.05), transparent 70%), #121226'
// after
'linear-gradient(180deg, color-mix(in srgb, var(--color-agent-browser-accent) 5%, transparent), transparent 70%), var(--color-browser-bar)'
```

`TokenCache.tsx` tone tints:

```ts
const TONE_TINT: Record<Tone, string> = {
  healthy:
    'color-mix(in srgb, var(--color-agent-codex-accent) 6%, transparent)',
  warming: 'color-mix(in srgb, var(--color-primary-container) 6%, transparent)',
  cold: 'color-mix(in srgb, var(--color-tertiary) 6%, transparent)',
}
```

`LiquidFill.tsx` SVG gradient stops: `rgba(255,255,255,α)` glints → `color-mix(in srgb, var(--color-on-surface) α%, transparent)` (light-on-dark in Obsidian, dark-on-light in Flexoki — the glint stays theme-correct); `rgba(0,0,0,α)` shading → `color-mix(in srgb, var(--color-surface-container-lowest) α%, transparent)`. Where α matches a wash token (4/5/8%), prefer `var(--color-wash-*)`.

- [ ] **Step 2: Per-file verify loop** — after each file: `npx vitest run <its test>` + visual spot-check, then move on.

- [ ] **Step 3: Commit**

```bash
node scripts/audit-colors.mjs leaks | tail -3
git add -A && git commit -m "refactor(theme): inline styles and gradients on theme variables"
```

### Task 18: Wash sweep + tail + tests batch

- [ ] **Step 1: Washes everywhere**

```bash
grep -rln "white/\[0\.0\|white/5\|black/" src --include="*.tsx"
```

Apply: `white/[0.03]`,`white/[0.04]` → `wash-faint`; `white/[0.05]`,`white/5` → `wash-subtle`; `white/[0.08]` → `wash-soft`; `black/40`,`black/[0.40]` → `surface-container-lowest/40` (scrim) — keep the same utility prefix (`bg-`, `border-`, …).

- [ ] **Step 2: Tail sweep until zero**

```bash
node scripts/audit-colors.mjs leaks
```

Work the remaining files with the Task 13 table until `TOTAL: 0`. Any value without a mapping row → add a token (types + both themes + regenerate theme.css + sync test).

- [ ] **Step 3: Migrate remaining color-asserting tests**

`src/features/workspace/WorkspaceView.visual.test.tsx` (lines 153–211): the `tailwindConfig.theme.extend.colors` object no longer exists. Rewrite the four token tests against the theme definition:

```tsx
import { obsidianLens } from '../../theme'

describe('Color Tokens: Obsidian Lens theme', () => {
  test('surface hierarchy tokens', () => {
    expect(obsidianLens.ui.surface).toBe('#121221')
    expect(obsidianLens.ui['surface-container-lowest']).toBe('#0d0d1c')
    expect(obsidianLens.ui['surface-container-low']).toBe('#1a1a2a')
    expect(obsidianLens.ui['surface-container']).toBe('#1e1e2e')
    expect(obsidianLens.ui['surface-container-high']).toBe('#292839')
    expect(obsidianLens.ui['surface-container-highest']).toBe('#333344')
    expect(obsidianLens.ui['surface-bright']).toBe('#383849')
  })

  test('primary tokens', () => {
    expect(obsidianLens.ui.primary).toBe('#e2c7ff')
    expect(obsidianLens.ui['primary-container']).toBe('#cba6f7')
    expect(obsidianLens.ui['primary-dim']).toBe('#d3b9f0')
  })

  test('semantic feedback tokens', () => {
    expect(obsidianLens.ui.success).toBe('#50fa7b')
    expect(obsidianLens.ui['success-muted']).toBe('#7defa1')
    expect(obsidianLens.ui.tertiary).toBe('#ff94a5')
    expect(obsidianLens.ui['tertiary-container']).toBe('#fd7e94')
    expect(obsidianLens.ui.error).toBe('#ffb4ab')
    expect(obsidianLens.ui['error-dim']).toBe('#d73357')
  })

  test('text tokens', () => {
    expect(obsidianLens.ui['on-surface']).toBe('#e3e0f7')
    expect(obsidianLens.ui['on-surface-variant']).toBe('#cdc3d1')
    expect(obsidianLens.ui['outline-variant']).toBe('#4a444f')
  })
})
```

(Remove the now-unused `tailwindConfig` import if nothing else uses it. `sections.test.ts` from the spec's batch 9 does not exist on this branch — the settings feature lives on `feat/settings-dialog-migration`; its integration note is in Task 22.)

- [ ] **Step 4: Phase B gate**

```bash
node scripts/audit-colors.mjs leaks | tail -1   # TOTAL: 0
npm run type-check && npm run lint && npx vitest run && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(theme): zero hardcoded colors outside theme definitions"
```

---

## Phase C — Flexoki + guards + docs

### Task 19: Flexoki definition (authoritative values)

**Files:**

- Create (or finalize, if Task 5 already created them): `src/theme/themes/flexoki.ts`, `src/theme/themes/flexoki.test.ts`

- [ ] **Step 1: `src/theme/themes/flexoki.ts`** — complete content. Values from the official Flexoki palette (paper/base ramp + 8 hues × {400,600}); entries marked `derived` are interpolations to be tuned in Task 20's contrast pass:

```ts
import type { ThemeDefinition } from '../types'

/* Flexoki (Steph Ango) — light proof theme. Official palette values;
 * lines marked `derived` are interpolations pending the Task 20
 * on-screen contrast pass. */
export const flexoki: ThemeDefinition = {
  id: 'flexoki',
  label: 'Flexoki',
  kind: 'light',
  ui: {
    surface: '#fffcf0',
    'surface-container-lowest': '#f2f0e5',
    'surface-container-low': '#e6e4d9',
    'surface-container': '#dad8ce',
    'surface-container-high': '#cecdc3',
    'surface-container-highest': '#b7b5ac',
    'surface-bright': '#b7b5ac',
    'surface-tint': '#8b7ec8',
    'browser-bar': '#f2f0e5',
    'browser-tab-active': '#fffcf0',
    primary: '#5e409d',
    'primary-container': '#8b7ec8',
    'primary-dim': '#735eb5', // derived
    'primary-deep': '#3d2a66', // derived
    'on-primary': '#fffcf0',
    secondary: '#205ea6',
    'secondary-container': '#4385be',
    'secondary-dim': '#3171b2', // derived
    'on-secondary': '#fffcf0',
    'on-secondary-container': '#fffcf0',
    tertiary: '#a02f6f',
    'tertiary-container': '#ce5d97',
    'on-tertiary': '#fffcf0',
    'on-tertiary-container': '#fffcf0',
    error: '#af3029',
    'error-container': '#d14d41',
    'error-dim': '#c03e35', // derived
    'on-error': '#fffcf0',
    'on-error-container': '#fffcf0',
    success: '#66800b',
    'success-muted': '#879a39',
    warning: '#bc5215',
    'on-surface': '#100f0f',
    'on-surface-variant': '#343331',
    'on-surface-muted': '#6f6e69',
    outline: '#878580',
    'outline-variant': '#b7b5ac',
    'editor-fg': '#100f0f',
    'editor-fg-dim': '#6f6e69',
    'vcs-modified': '#ad8301',
    'vcs-added': '#66800b',
    'vcs-deleted': '#af3029',
    'vcs-renamed': '#24837b',
    'vcs-untracked': '#5e409d',
  },
  effects: {
    'glass-fill': 'rgba(255, 252, 240, 0.88)',
    selection: 'rgba(94, 64, 157, 0.25)',
    'scrollbar-thumb': '#dad8ce',
    'scrollbar-thumb-hover': '#b7b5ac',
    'diff-added': 'rgba(102, 128, 11, 0.14)',
    'diff-removed': 'rgba(175, 48, 41, 0.12)',
    'diff-highlight-added': 'rgba(102, 128, 11, 0.30)',
    'diff-highlight-removed': 'rgba(175, 48, 41, 0.28)',
    'wash-faint': 'rgba(16, 15, 15, 0.04)',
    'wash-subtle': 'rgba(16, 15, 15, 0.05)',
    'wash-soft': 'rgba(16, 15, 15, 0.08)',
  },
  shadows: {
    'pane-focus':
      '0 0 0 6px rgb(94 64 157 / 0.14), 0 8px 24px rgb(16 15 15 / 0.12)',
    modal: '0 24px 60px rgb(16 15 15 / 0.18)',
    'pip-glow': '0 0 4px currentColor',
    ambient: '0 10px 30px rgba(16, 15, 15, 0.12)',
    'glow-primary': '0 0 24px rgba(94, 64, 157, 0.2)',
    'ring-primary': '0 0 0 3px rgba(94, 64, 157, 0.25)',
  },
  syntax: {
    keyword: '#5e409d',
    string: '#66800b',
    fn: '#205ea6',
    variable: '#a02f6f',
    comment: '#6f6e69',
    type: '#bc5215',
    tag: '#af3029',
    class: '#ad8301',
    operator: '#24837b',
  },
  terminal: {
    foreground: '#100f0f',
    background: '#fffcf0',
    cursor: '#5e409d',
    cursorAccent: '#fffcf0',
    selectionBackground: '#dad8ce',
    black: '#100f0f',
    red: '#af3029',
    green: '#66800b',
    yellow: '#ad8301',
    blue: '#205ea6',
    magenta: '#a02f6f',
    cyan: '#24837b',
    white: '#f2f0e5',
    brightBlack: '#575653',
    brightRed: '#d14d41',
    brightGreen: '#879a39',
    brightYellow: '#d0a215',
    brightBlue: '#4385be',
    brightMagenta: '#ce5d97',
    brightCyan: '#3aa99f',
    brightWhite: '#fffcf0',
  },
  agents: {
    claude: {
      accent: '#8b7ec8',
      accentDim: 'rgb(139 126 200 / 0.16)',
      accentSoft: 'rgb(139 126 200 / 0.32)',
      onAccent: '#fffcf0',
    },
    codex: {
      accent: '#66800b',
      accentDim: 'rgb(102 128 11 / 0.14)',
      accentSoft: 'rgb(102 128 11 / 0.28)',
      onAccent: '#fffcf0',
    },
    gemini: {
      accent: '#205ea6',
      accentDim: 'rgb(32 94 166 / 0.14)',
      accentSoft: 'rgb(32 94 166 / 0.28)',
      onAccent: '#fffcf0',
    },
    shell: {
      accent: '#ad8301',
      accentDim: 'rgb(173 131 1 / 0.14)',
      accentSoft: 'rgb(173 131 1 / 0.28)',
      onAccent: '#100f0f',
    },
    browser: {
      accent: '#24837b',
      accentDim: 'rgb(36 131 123 / 0.14)',
      accentSoft: 'rgb(36 131 123 / 0.28)',
      onAccent: '#fffcf0',
    },
  },
}
```

- [ ] **Step 2: `src/theme/themes/flexoki.test.ts`**

```ts
import { expect, test } from 'vitest'
import { flexoki } from './flexoki'

test('flexoki is the light proof theme on official palette values', () => {
  expect(flexoki.id).toBe('flexoki')
  expect(flexoki.kind).toBe('light')
  expect(flexoki.ui.surface).toBe('#fffcf0')
  expect(flexoki.ui['on-surface']).toBe('#100f0f')
  expect(flexoki.terminal.background).toBe('#fffcf0')
  expect(flexoki.effects['wash-subtle']).toBe('rgba(16, 15, 15, 0.05)')
})
```

- [ ] **Step 3: Run, commit** (skip if Task 5 already landed both files — then this task is only the final value review)

```bash
npx vitest run src/theme/themes/
git add src/theme/themes/flexoki.* && git commit -m "feat(theme): flexoki light theme on official palette"
```

### Task 20: Acceptance + contrast pass

- [ ] **Step 1: Full gate**

```bash
npm run type-check && npm run lint && npx vitest run && npm run build
```

- [ ] **Step 2: Hot-swap walkthrough** (the original acceptance criterion)

Run `npm run electron:dev`. With a live agent session producing terminal output:

1. `:set theme flexoki` — every zone flips with no reload: terminal background/ANSI (scrollback recolors), editor chrome + syntax, agent accent chips, diff viewer (Pierre flips to `pierre-light`), scrollbars, status bar, washes (must read as dark-on-light, not white film).
2. Walk the checklist: each dock position, command palette overlay, browser pane chrome, settings-free surfaces, BurnerTerminal popup, TokenCache/Activity panels.
3. Note every contrast/legibility issue; fix by tuning `flexoki.ts` values (Vite HMR re-applies live). `derived`-marked entries are the expected suspects.
4. `:set theme obsidian-lens` — pixel-identical to `main`. Restart the app — persisted choice restores.

- [ ] **Step 3: Commit tuning**

```bash
git add src/theme/themes/flexoki.ts && git commit -m "feat(theme): flexoki contrast pass"
```

### Task 21: Hardcoded-color guards

**Files:**

- Create: `eslint-rules/no-hardcoded-colors.js`, `eslint-rules/no-hardcoded-colors.test.js`
- Create: `src/theme/cssGuard.test.ts`
- Modify: `eslint.config.js`

- [ ] **Step 1: Write the rule**

```js
// eslint-rules/no-hardcoded-colors.js
// Bans color literals outside src/theme/themes/. The themes dir is the one
// legitimate home; everywhere else uses semantic tokens (utilities or
// var(--color-*)). Escape hatch: eslint-disable-next-line with a reason.
const COLOR_PATTERNS = [
  /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/,
  /\b(?:rgba?|hsla?|oklch)\(/,
  /(?:text|bg|border|ring|fill|stroke|from|via|to|divide|outline|decoration|shadow|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/,
  /(?:text|bg|border|ring|fill|stroke|divide|outline)-(?:white|black)(?:\/(?:\d{1,3}|\[[^\]]+\]))?\b/,
]

const findViolation = (text) => {
  for (const pattern of COLOR_PATTERNS) {
    const match = pattern.exec(text)
    if (match) {
      return match[0]
    }
  }
  return null
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow hardcoded colors; use theme tokens (utilities or var(--color-*))',
    },
    messages: {
      hardcoded:
        'Hardcoded color "{{value}}" — use a semantic token (Tailwind utility or var(--color-*)); themes live in src/theme/themes/.',
    },
    schema: [],
  },
  create(context) {
    const check = (node, text) => {
      if (typeof text !== 'string') {
        return
      }
      const hit = findViolation(text)
      if (hit) {
        context.report({ node, messageId: 'hardcoded', data: { value: hit } })
      }
    }

    return {
      Literal(node) {
        check(node, node.value)
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          check(quasi, quasi.value.raw)
        }
      },
    }
  },
}
```

- [ ] **Step 2: RuleTester coverage**

```js
// eslint-rules/no-hardcoded-colors.test.js
import { RuleTester } from 'eslint'
import rule from './no-hardcoded-colors.js'

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

tester.run('no-hardcoded-colors', rule, {
  valid: [
    { code: "const c = 'var(--color-primary)'" },
    {
      code: "const c = 'color-mix(in srgb, var(--color-primary) 25%, transparent)'",
    },
    { code: "const cls = 'bg-surface text-on-surface hover:bg-wash-subtle'" },
    { code: "const cls = 'text-vcs-modified shadow-pane-focus'" },
  ],
  invalid: [
    { code: "const c = '#cba6f7'", errors: [{ messageId: 'hardcoded' }] },
    {
      code: "const c = 'rgba(0,0,0,0.4)'",
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: 'const c = `0 0 0 6px rgb(203 166 247 / 0.16)`',
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: "const cls = 'text-amber-400'",
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: "const cls = 'hover:bg-white/5'",
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: "const cls = 'border-white/[0.08]'",
      errors: [{ messageId: 'hardcoded' }],
    },
  ],
})
```

(RuleTester runs under vitest because `globals: true` provides `describe`/`it`.)

- [ ] **Step 3: Register in `eslint.config.js`** (alongside the cspell-style entries)

```js
import noHardcodedColors from './eslint-rules/no-hardcoded-colors.js'
```

```js
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/theme/themes/**'],
    plugins: {
      vimeflow: { rules: { 'no-hardcoded-colors': noHardcodedColors } },
    },
    rules: {
      'vimeflow/no-hardcoded-colors': 'error',
    },
  },
```

- [ ] **Step 4: CSS guard test**

```ts
// src/theme/cssGuard.test.ts
import { expect, test } from 'vitest'

const cssFiles = import.meta.glob('../**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const COLOR_LITERAL =
  /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?|oklch)\(/

test('no CSS file outside src/theme contains color literals', () => {
  const offenders = Object.entries(cssFiles)
    .filter(([path]) => !path.includes('/theme/'))
    .filter(([, text]) => COLOR_LITERAL.test(text))
    .map(([path]) => path)

  expect(offenders).toEqual([])
})
```

- [ ] **Step 5: Run everything — the migration must already be clean**

```bash
npx vitest run eslint-rules/ src/theme/cssGuard.test.ts && npm run lint
```

Expected: PASS / zero lint errors. Any failure = a missed leak; fix it via the Task 13 table, never with a disable comment.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(theme): lint + test guards against hardcoded colors"
```

### Task 22: Docs and handoff notes

**Files:**

- Modify: `docs/design/tokens.css`, `docs/design/tokens.ts` (superseded banners), `CLAUDE.md` (Design System paragraph + read-order), `docs/design/CLAUDE.md` (tokens entry), `CHANGELOG.md`, `CHANGELOG.zh-CN.md`

- [ ] **Step 1: Banners.** Top of `docs/design/tokens.css`:

```css
/*
 * SUPERSEDED (2026-06-11): runtime color tokens now live in
 * src/theme/themes/*.ts (single source of truth; applied as CSS
 * variables by src/theme/service.ts). This file is design reference
 * only — it is no longer imported at runtime. Non-color vars moved to
 * src/theme/base.css.
 */
```

Equivalent comment at the top of `docs/design/tokens.ts`.

- [ ] **Step 2: `CLAUDE.md`** — in "Design System: The Obsidian Lens", replace `Colors defined as semantic tokens in `tailwind.config.js``with`Colors defined as semantic theme tokens in `src/theme/` (TS theme definitions applied as CSS variables; see docs/superpowers/specs/2026-06-11-theme-system-design.md)`, and append `src/theme/themes/obsidian-lens.ts`to the read-order line. Same pointer fix in`docs/design/CLAUDE.md`'s tokens section.

- [ ] **Step 3: Changelog entries (both files, mirrored)** — one entry: theme system with runtime switching (Obsidian Lens + Flexoki), `:set theme` command, hardcoded-color guards.

- [ ] **Step 4: Settings-branch integration note.** The settings feature lives on `feat/settings-dialog-migration`, not this branch; when that branch lands, wire its AppearancePane with:

```tsx
// AppearancePane integration (apply on feat/settings-dialog-migration):
const activeTheme = useTheme()
// picker list: themeService.list(); card click: themeService.apply(t.id)
// preview swatch: t.ui.primary / t.ui.surface / t.ui['on-surface-variant']
```

- [ ] **Step 5: Final gate + commit**

```bash
npm run type-check && npm run lint && npx vitest run && npm run build
git add -A && git commit -m "docs(theme): supersede legacy token docs; changelog"
```

---

## Final verification

1. `node scripts/audit-colors.mjs leaks` → `TOTAL: 0`
2. `npm run type-check && npm run lint && npx vitest run && npm run build` → green
3. Electron run: hot-swap both directions with a live agent + open editor + diff; restart restores choice
4. `git log --oneline main..` reads as the phase sequence; each commit independently green
