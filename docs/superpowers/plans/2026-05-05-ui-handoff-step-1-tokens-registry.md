# UI Handoff Migration — Step 1: Tokens + Agents Registry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land step 1 of the UI handoff migration — pre-step setup (move the `docs/design/handoff/` bundle into the worktree, create paired roadmap artifacts) plus the §9 step 1 deliverables (extend `tailwind.config.js` with handoff §6 design tokens; add `src/agents/registry.ts` exposing the AGENTS constant).

**Architecture:** Additive token strategy — new keys added under names that don't collide with existing classes (`primary-deep`, `text-vf-*`, `font-display`, `syn.*`, named `borderRadius`/`boxShadow`/`transitionTimingFunction` keys). Existing tokens untouched until step 10 cleanup. Agents registry is a frozen `as const` data export with a derived `AgentId` keyof-type. Three commits in one PR: setup chore → tokens feat → registry feat.

**Tech Stack:** TypeScript (`moduleResolution: bundler`), Tailwind CSS 3.x, Vitest + jsdom, ESLint flat config, Prettier.

**Spec:** `docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md`

---

## Task 1: Move handoff bundle into worktree

**Files:**

- Move: `/home/will/projects/vimeflow/docs/design/handoff/` → `/home/will/projects/vimeflow/.claude/worktrees/ui-update/docs/design/handoff/`

The bundle is currently untracked in the `main` checkout. Moving it (not copying) is the user's instruction. After the move, `main` will no longer have the folder — that is intended.

- [ ] **Step 1: Confirm source state**

```bash
ls /home/will/projects/vimeflow/docs/design/handoff/
```

Expected: `README.md  prototype/  screenshots/`. If missing, stop — the bundle was already moved or never lived there.

- [ ] **Step 2: Confirm target absence**

```bash
ls docs/design/handoff/ 2>/dev/null && echo EXISTS || echo OK
```

Expected: `OK`. If `EXISTS`, stop and ask the user — the worktree already has a (possibly different) bundle.

- [ ] **Step 3: Move**

```bash
mv /home/will/projects/vimeflow/docs/design/handoff /home/will/projects/vimeflow/.claude/worktrees/ui-update/docs/design/handoff
```

- [ ] **Step 4: Verify target**

```bash
ls docs/design/handoff/
```

Expected: `README.md  prototype/  screenshots/`.

- [ ] **Step 5: Stage** (do not commit yet — combined with Tasks 2 + 3 in the setup commit)

```bash
git add docs/design/handoff
git status -s docs/design/handoff | head -5
```

Expected: lines starting with `A  docs/design/handoff/...`.

---

## Task 2: Create `docs/roadmap/ui-update-roadmap.md`

**Files:**

- Create: `docs/roadmap/ui-update-roadmap.md`

Human-readable narrative. One section per migration step (1–10), each with: goal, files touched, DoD bullets, risks. Mirrors the structure of `docs/roadmap/tauri-migration-roadmap.md` so future contributors recognise the format.

- [ ] **Step 1: Create the file with full content**

Write `docs/roadmap/ui-update-roadmap.md` containing exactly:

```markdown
# UI Handoff Migration Roadmap

> Paired with `docs/roadmap/progress.yaml` phase `ui-handoff-migration`. Spec: `docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md`. Visual + behavioural source of truth: `docs/design/handoff/`.

10 sequential steps land the existing `WorkspaceView` onto the handoff visual + behavioural spec while keeping all Tauri integrations intact. Steps 1–9 mirror handoff §9 verbatim; step 10 is a token-cleanup pass that closes the additive-token strategy.

## Step 1 — Tokens + agents registry

**Goal.** Extend `tailwind.config.js` with the handoff §6 design tokens (additive only) and add `src/agents/registry.ts` per handoff §6's TypeScript snippet.

**Files.** `tailwind.config.js`, `src/agents/registry.ts`, `src/lib/tailwindConfig.test.ts` (new).

**DoD.** New tokens present and asserted by test; existing classes unchanged in value; agents registry exported with `AgentId` keyof-type; `npm run lint`, `npm run test`, `npm run type-check` all green.

**Risks.** None to runtime — no consumer in this step. Test lives under `src/lib/` so ESLint's `parserOptions.projectService` (scoped to `tsconfig.json`'s `src` include) parses it; importing `../../tailwind.config.js` works under Vite's bundler resolution.

## Step 2 — App shell layout

**Goal.** Adjust `WorkspaceView`'s grid to handoff §3 proportions (48 / 272 / flex / 284), mount a 38px session-tab strip placeholder above the existing TerminalZone, mount a 24px status bar below the BottomDrawer.

**Files.** `src/features/workspace/WorkspaceView.tsx`, `IconRail.tsx`, `Sidebar.tsx`, new status-bar component.

**DoD.** Region proportions match §3; status bar mounted (placeholder content); session-tab strip mounted (placeholder content); inner regions render unchanged from step 0.

**Risks.** Sidebar resizable behaviour: handoff says fixed 272px. We keep resizable, seed from 272px. If review pushes back, drop resizing in step 3.

## Step 3 — Sidebar sessions list + session tabs

**Goal.** Restyle sidebar sessions list per §4.2; replace placeholder session-tab strip with browser-style tabs per §4.3 wired to `useSessionManager`.

**Files.** `Sidebar.tsx`, new `SessionTabs.tsx`.

**DoD.** Sessions list rows match §4.2 (status dot, title, time, subtitle, state pill, +/- counts); session tabs open/close/`+` interactions work; active tab uses focused agent's accent stripe.

**Risks.** Negative-margin trick on active tab can clip — verify in browser before merge.

## Step 4 — Single TerminalPane

**Goal.** Replace existing TerminalPane with handoff §4.6 spec (collapsible header, scroll body, input footer, focus ring) wired to one PTY.

**Files.** `src/features/terminal/components/TerminalPane.tsx`, consumes `src/agents/registry.ts`.

**DoD.** Pane header collapsible; agent identity chip displays correct accent/glyph; focus ring matches §4.6 spec (outline + box-shadow + cursor swap); status pip tracks PTY health.

**Risks.** Focus-ring transition timing (180–220ms) — verify visually.

## Step 5 — SplitView grid

**Goal.** Add 5-canonical-layouts CSS Grid `SplitView` with `LayoutSwitcher`. Refactor `TerminalZone` to host SplitView. Wire ⌘1-4 (focus pane), ⌘\ (toggle vsplit/single).

**Files.** New `SplitView.tsx` + `LayoutSwitcher.tsx`; refactor `TerminalZone.tsx`.

**DoD.** All 5 layouts render correctly using `minmax(0, 1fr)`; pane spawn auto-fills via `VIMEFLOW_DEFAULT_PANES` template logic (real version reads from registry); pane close auto-shrinks layout per §5.3.

**Risks.** Bare `1fr` columns shrinking to content. Use `minmax(0, 1fr)` everywhere — covered in §3 of handoff.

## Step 6 — Activity panel

**Goal.** Restyle `AgentStatusPanel` per §4.7 — CONTEXT bar, 5-HOUR USAGE, TURNS, TOKEN CACHE block (big % + sparkline + 3-segment bar + past-sessions bars + NOW pulse). Always-expanded for now; collapse rail in step 9.

**Files.** `src/features/agent-status/components/AgentStatusPanel.tsx`.

**DoD.** Sections render per §4.7; panel header switches agent identity when focused pane changes (driven by step 5's focus state).

**Risks.** Sparkline/bar-chart rendering performance with frequent agent telemetry updates — verify with React profiler.

## Step 7 — Bottom panel

**Goal.** Restyle `BottomDrawer` per §4.8 (28px tab strip, agent-accent underline, 26px peek button when collapsed).

**Files.** `src/features/workspace/components/BottomDrawer.tsx`, `panels/EditorPanel.tsx`, `panels/DiffPanel.tsx`, `panels/FilesPanel.tsx`.

**DoD.** Tab strip matches §4.8; peek button restores panel; collapse persists between sessions (existing behaviour kept).

**Risks.** Existing diff/editor panels may have layout assumptions broken by tab-strip restyle — visually regress before merge.

## Step 8 — Command palette + keyboard shortcuts

**Goal.** Restyle `CommandPalette` per §4.10 (centred modal, blur backdrop, Instrument Sans search input). Verify ⌘K toggle + Esc dismiss; ⌘1-4 / ⌘\ already wired in step 5.

**Files.** `src/features/command-palette/CommandPalette.tsx`, key handler in `WorkspaceView.tsx`.

**DoD.** Palette modal matches §4.10; Esc dismiss; selected row uses left-accent bar.

**Risks.** Ctrl+K already used in workspace? Check existing bindings.

## Step 9 — Polish

**Goal.** Focus-ring transitions (180–220ms cubic-bezier `pane`), status pips, ContextSmiley, RelTime ticking, activity-panel 36px collapsed rail, status-bar §4.9 contents (`obsidian-cli · v0.9.4` left, ContextSmiley + cache% + turns + ⌘K right).

**Files.** Scattered.

**DoD.** Visual diff matches handoff screenshots `01–05` for the corresponding state.

**Risks.** Scope creep — keep this step strictly to polish. Anything structural rolls back into the appropriate earlier step.

## Step 10 — Token cleanup

**Goal.** Close the additive-token strategy. Delete deprecated tokens (`surface-tint` old value, `font-body`, `font-headline`, `font-label`, `tertiary*`, old `secondary-container: #124988`, `on-primary` flat). Codemod `text-vf-*` → `text-*` (overriding Tailwind defaults to handoff scale). Visual regression check on every screen.

**Files.** `tailwind.config.js`, codemod across `src/**/*.{ts,tsx}`.

**DoD.** No reference to deprecated tokens anywhere (`rg` clean); all `text-vf-*` → `text-*`; visual diff vs step 9 is zero.

**Risks.** A consumer of `tertiary` semantic colour that we forget to migrate. Run `rg 'tertiary|font-body|font-headline|font-label|surface-tint|on-primary'` before commit and audit each match.
```

- [ ] **Step 2: Verify**

```bash
test -f docs/roadmap/ui-update-roadmap.md && wc -l docs/roadmap/ui-update-roadmap.md
```

Expected: line count > 80 (the file is ~120+ lines after Prettier reflow).

- [ ] **Step 3: Stage**

```bash
git add docs/roadmap/ui-update-roadmap.md
```

---

## Task 3: Append `ui-handoff-migration` phase to `progress.yaml`

**Files:**

- Modify: `docs/roadmap/progress.yaml`

Append a new phase block under the existing `phases:` list. 10 step entries, all `pending`. `blocked_by: []` because this phase doesn't gate on prior phases (it's parallel to the Tauri migration).

- [ ] **Step 1: Read the tail of `progress.yaml` to find the append point**

```bash
tail -20 docs/roadmap/progress.yaml
```

Expected: see the last existing phase's last step. The new phase appends as a sibling under `phases:`.

- [ ] **Step 2: Append the new phase**

The block must land at 2-space indent (sibling of existing `- id: phase-1`, etc., under the top-level `phases:` mapping). Run this command verbatim — the bash heredoc preserves the leading 2-space indentation, and a `bash` code fence (unlike `yaml`) is not reformatted by Prettier:

```bash
cat >> docs/roadmap/progress.yaml <<'EOF'
  - id: ui-handoff-migration
    name: 'UI Handoff Migration (handoff §9 + token cleanup)'
    status: pending
    blocked_by: []
    specs:
      - docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md
    steps:
      - id: ui-s1
        name: 'Tokens + agents registry'
        status: pending
      - id: ui-s2
        name: 'App shell layout (proportions + status bar + session-tab strip)'
        status: pending
      - id: ui-s3
        name: 'Sidebar sessions list + browser-style session tabs'
        status: pending
      - id: ui-s4
        name: 'Single TerminalPane (handoff §4.6)'
        status: pending
      - id: ui-s5
        name: 'SplitView grid (5 layouts) + LayoutSwitcher + ⌘1-4 / ⌘\ shortcuts'
        status: pending
      - id: ui-s6
        name: 'Activity panel (handoff §4.7)'
        status: pending
      - id: ui-s7
        name: 'Bottom panel restyle (handoff §4.8)'
        status: pending
      - id: ui-s8
        name: 'Command palette restyle + keyboard shortcuts (handoff §4.10)'
        status: pending
      - id: ui-s9
        name: 'Polish (transitions, ContextSmiley, RelTime, activity collapse rail, status bar)'
        status: pending
      - id: ui-s10
        name: 'Token cleanup (delete deprecated, codemod text-vf-* → text-*)'
        status: pending
EOF
```

- [ ] **Step 3: Verify YAML parses**

```bash
node -e "const yaml = require('js-yaml'); const fs = require('fs'); const doc = yaml.load(fs.readFileSync('docs/roadmap/progress.yaml', 'utf8')); const phase = doc.phases.find(p => p.id === 'ui-handoff-migration'); if (!phase) throw new Error('phase not found'); if (phase.steps.length !== 10) throw new Error('expected 10 steps, got ' + phase.steps.length); console.log('OK: phase has', phase.steps.length, 'steps');"
```

Expected: `OK: phase has 10 steps`. If `js-yaml` not installed, fall back to manual visual check via `tail -50 docs/roadmap/progress.yaml`.

- [ ] **Step 4: Stage**

```bash
git add docs/roadmap/progress.yaml
```

---

## Task 4: Commit setup chore

- [ ] **Step 1: Verify staged set is exactly the three setup artifacts**

```bash
git diff --cached --stat
```

Expected: shows `docs/design/handoff/...` (multiple files), `docs/roadmap/ui-update-roadmap.md`, `docs/roadmap/progress.yaml`. No other paths.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: scaffold ui-update tracking + import handoff bundle

Move docs/design/handoff/ from main checkout into this worktree (was
untracked in main); create docs/roadmap/ui-update-roadmap.md with the
§9 + step 10 narrative; append the ui-handoff-migration phase to
docs/roadmap/progress.yaml. Sets up tracking before step 1's feat
commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Verify**

```bash
git log -1 --oneline
git status -s
```

Expected: `chore: scaffold ui-update tracking + import handoff bundle` is the latest commit; working tree clean.

---

## Task 5: Tailwind config tokens (TDD)

**Files:**

- Create: `src/lib/tailwindConfig.test.ts`
- Modify: `tailwind.config.js` (project root)

Additive entries only. Existing tokens stay untouched.

- [ ] **Step 1: Write the failing test**

Create `src/lib/tailwindConfig.test.ts` with exactly this content. The file lives under `src/` so ESLint's `parserOptions.projectService` (scoped to `tsconfig.json`'s `src` include) parses it correctly:

```ts
import config from '../../tailwind.config.js'

const colors = config.theme.extend.colors as Record<string, unknown>
const fontFamily = config.theme.extend.fontFamily as Record<string, unknown>
const fontSize = config.theme.extend.fontSize as Record<string, unknown>
const borderRadius = config.theme.extend.borderRadius as Record<string, unknown>
const boxShadow = config.theme.extend.boxShadow as Record<string, unknown>
const transitionTimingFunction = config.theme.extend
  .transitionTimingFunction as Record<string, unknown>

test('colors expose handoff additive tokens', () => {
  expect(colors).toMatchObject({
    'primary-deep': '#57377f',
    'on-surface-muted': '#8a8299',
    warning: '#ff94a5',
  })
  expect(colors.syn).toMatchObject({
    keyword: '#cba6f7',
    string: '#a6e3a1',
    fn: '#89b4fa',
    var: '#f5e0dc',
    comment: '#6c7086',
    type: '#fab387',
    tag: '#f38ba8',
  })
})

test('fontFamily exposes handoff sans/display/mono', () => {
  expect(fontFamily.sans).toEqual(['Inter', 'ui-sans-serif', 'system-ui'])
  expect(fontFamily.display).toEqual([
    'Instrument Sans',
    'Manrope',
    'system-ui',
  ])
  expect(fontFamily.mono).toEqual([
    'JetBrains Mono',
    'ui-monospace',
    'monospace',
  ])
})

test('fontSize.vf-* matches handoff scale', () => {
  expect(fontSize['vf-2xs']).toEqual(['10px', { lineHeight: '14px' }])
  expect(fontSize['vf-xs']).toEqual(['10.5px', { lineHeight: '15px' }])
  expect(fontSize['vf-sm']).toEqual(['11.5px', { lineHeight: '16px' }])
  expect(fontSize['vf-base']).toEqual(['13px', { lineHeight: '19px' }])
  expect(fontSize['vf-lg']).toEqual(['16px', { lineHeight: '22px' }])
  expect(fontSize['vf-xl']).toEqual(['20px', { lineHeight: '26px' }])
  expect(fontSize['vf-2xl']).toEqual(['28px', { lineHeight: '32px' }])
})

test('borderRadius exposes handoff named keys', () => {
  expect(borderRadius).toMatchObject({
    pane: '10px',
    tab: '8px 8px 0 0',
    chip: '6px',
    pill: '999px',
    modal: '12px',
  })
})

test('boxShadow exposes handoff named keys', () => {
  expect(boxShadow).toMatchObject({
    'pane-focus':
      '0 0 0 6px rgb(203 166 247 / 0.16), 0 8px 32px rgb(0 0 0 / 0.35)',
    modal: '0 24px 80px rgb(0 0 0 / 0.5)',
    'pip-glow': '0 0 4px currentColor',
  })
})

test('transitionTimingFunction.pane exposes handoff cubic-bezier', () => {
  expect(transitionTimingFunction.pane).toBe('cubic-bezier(0.32, 0.72, 0, 1)')
})

test('existing tokens remain untouched', () => {
  expect(colors.primary).toBe('#e2c7ff')
  expect(colors['surface-container']).toBe('#1e1e2e')
  expect(colors.tertiary).toBe('#ff94a5')
  expect(colors['surface-tint']).toBe('#d9b9ff')
  expect(colors['secondary-container']).toBe('#124988')
})
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run src/lib/tailwindConfig.test.ts
```

Expected: every test except `existing tokens remain untouched` fails with `expected ... to match object { ... }` — the new keys don't exist yet.

If `existing tokens remain untouched` also fails, stop — `tailwind.config.js` was modified outside this plan and the additive premise is broken.

- [ ] **Step 3: Add new tokens to `tailwind.config.js`**

Modify `tailwind.config.js`. Within the existing `theme.extend` block, **add** the following entries (do not delete or rename anything):

Inside `colors: { ... }`, add:

```js
        'primary-deep': '#57377f',
        'on-surface-muted': '#8a8299',
        warning: '#ff94a5',
        syn: {
          keyword: '#cba6f7',
          string: '#a6e3a1',
          fn: '#89b4fa',
          var: '#f5e0dc',
          comment: '#6c7086',
          type: '#fab387',
          tag: '#f38ba8',
        },
```

Replace the existing `fontFamily: { ... }` block with this expanded version (preserves existing `headline`/`body`/`label` aliases for backward compat):

```js
      fontFamily: {
        headline: ['Manrope', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        label: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        display: ['Instrument Sans', 'Manrope', 'system-ui'],
      },
```

Add a new `fontSize` block (sibling of `fontFamily`):

```js
      fontSize: {
        'vf-2xs': ['10px', { lineHeight: '14px' }],
        'vf-xs': ['10.5px', { lineHeight: '15px' }],
        'vf-sm': ['11.5px', { lineHeight: '16px' }],
        'vf-base': ['13px', { lineHeight: '19px' }],
        'vf-lg': ['16px', { lineHeight: '22px' }],
        'vf-xl': ['20px', { lineHeight: '26px' }],
        'vf-2xl': ['28px', { lineHeight: '32px' }],
      },
```

Replace the existing `borderRadius: { ... }` block with this expanded version (preserves existing `DEFAULT`, `md`, `lg`, `xl`, `full`):

```js
      borderRadius: {
        DEFAULT: '0.25rem',
        md: '0.75rem',
        lg: '1rem',
        xl: '1.5rem',
        full: '9999px',
        pane: '10px',
        tab: '8px 8px 0 0',
        chip: '6px',
        pill: '999px',
        modal: '12px',
      },
```

Add new `boxShadow` and `transitionTimingFunction` blocks (siblings of `borderRadius`):

```js
      boxShadow: {
        'pane-focus':
          '0 0 0 6px rgb(203 166 247 / 0.16), 0 8px 32px rgb(0 0 0 / 0.35)',
        modal: '0 24px 80px rgb(0 0 0 / 0.5)',
        'pip-glow': '0 0 4px currentColor',
      },
      transitionTimingFunction: {
        pane: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
```

- [ ] **Step 4: Run test, verify it passes**

```bash
npx vitest run src/lib/tailwindConfig.test.ts
```

Expected: all 7 `test(...)` blocks pass.

- [ ] **Step 5: Run full lint to catch syntax errors in the config**

```bash
npm run lint
```

Expected: clean exit. If `tailwind.config.js` has a syntax error, ESLint will report it.

- [ ] **Step 6: Stage and commit**

```bash
git add tailwind.config.js src/lib/tailwindConfig.test.ts
git commit -m "$(cat <<'EOF'
feat(tokens): add handoff design tokens to tailwind config

Additive entries per docs/design/handoff/ §6: primary-deep, on-surface-muted,
warning, syn.{keyword,string,fn,var,comment,type,tag}, fontFamily.{sans,display},
fontSize.vf-{2xs,xs,sm,base,lg,xl,2xl}, borderRadius.{pane,tab,chip,pill,modal},
boxShadow.{pane-focus,modal,pip-glow}, transitionTimingFunction.pane.

Existing tokens untouched (parallel-name strategy). Cleanup of deprecated
tokens deferred to step 10 of the migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Agents registry (TDD)

**Files:**

- Create: `src/agents/registry.ts`
- Create: `src/agents/registry.test.ts`

Per handoff §6 TypeScript snippet. Frozen `as const` data export with `AgentId` keyof-type.

- [ ] **Step 1: Write the failing test**

Create `src/agents/registry.test.ts` with exactly this content:

```ts
import { AGENTS, type AgentId } from './registry'

const ALL_AGENTS: ReadonlyArray<AgentId> = [
  'claude',
  'codex',
  'gemini',
  'shell',
]

test('AGENTS keys are claude, codex, gemini, shell', () => {
  expect(Object.keys(AGENTS).sort()).toEqual([...ALL_AGENTS].sort())
})

test('every agent has the required fields with correct shapes', () => {
  for (const id of ALL_AGENTS) {
    const a = AGENTS[id]
    expect(a.id).toBe(id)
    expect(typeof a.name).toBe('string')
    expect(a.short).toMatch(/^[A-Z]+$/)
    expect(a.glyph).toHaveLength(1)
    expect(a.accent).toMatch(/^#[0-9a-f]{6}$/i)
    expect(a.accentDim).toMatch(/^rgb\(/)
    expect(a.accentSoft).toMatch(/^rgb\(/)
    expect(a.onAccent).toMatch(/^#[0-9a-f]{6}$/i)
  }
})

test('claude is lavender', () => {
  expect(AGENTS.claude.accent).toBe('#cba6f7')
  expect(AGENTS.claude.short).toBe('CLAUDE')
  expect(AGENTS.claude.glyph).toBe('∴')
  expect(AGENTS.claude.model).toBe('sonnet-4')
})

test('codex is mint', () => {
  expect(AGENTS.codex.accent).toBe('#7defa1')
  expect(AGENTS.codex.short).toBe('CODEX')
  expect(AGENTS.codex.glyph).toBe('◇')
  expect(AGENTS.codex.model).toBe('gpt-5-codex')
})

test('gemini is azure', () => {
  expect(AGENTS.gemini.accent).toBe('#a8c8ff')
  expect(AGENTS.gemini.short).toBe('GEMINI')
  expect(AGENTS.gemini.glyph).toBe('✦')
  expect(AGENTS.gemini.model).toBe('gemini-2.5')
})

test('shell is yellow with null model', () => {
  expect(AGENTS.shell.accent).toBe('#f0c674')
  expect(AGENTS.shell.short).toBe('SHELL')
  expect(AGENTS.shell.glyph).toBe('$')
  expect(AGENTS.shell.model).toBeNull()
})
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run src/agents/registry.test.ts
```

Expected: fail with `Cannot find module './registry'` or similar.

- [ ] **Step 3: Implement the registry**

Create `src/agents/registry.ts` with exactly this content:

```ts
export const AGENTS = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    short: 'CLAUDE',
    glyph: '∴',
    model: 'sonnet-4',
    accent: '#cba6f7',
    accentDim: 'rgb(203 166 247 / 0.16)',
    accentSoft: 'rgb(203 166 247 / 0.32)',
    onAccent: '#2a1646',
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    short: 'CODEX',
    glyph: '◇',
    model: 'gpt-5-codex',
    accent: '#7defa1',
    accentDim: 'rgb(125 239 161 / 0.16)',
    accentSoft: 'rgb(125 239 161 / 0.32)',
    onAccent: '#0a2415',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    short: 'GEMINI',
    glyph: '✦',
    model: 'gemini-2.5',
    accent: '#a8c8ff',
    accentDim: 'rgb(168 200 255 / 0.16)',
    accentSoft: 'rgb(168 200 255 / 0.32)',
    onAccent: '#0e1c33',
  },
  shell: {
    id: 'shell',
    name: 'shell',
    short: 'SHELL',
    glyph: '$',
    model: null,
    accent: '#f0c674',
    accentDim: 'rgb(240 198 116 / 0.14)',
    accentSoft: 'rgb(240 198 116 / 0.30)',
    onAccent: '#2a1f08',
  },
} as const

export type AgentId = keyof typeof AGENTS
export type Agent = (typeof AGENTS)[AgentId]
```

- [ ] **Step 4: Run test, verify it passes**

```bash
npx vitest run src/agents/registry.test.ts
```

Expected: all 6 `test(...)` blocks pass.

- [ ] **Step 5: Run lint and type-check**

```bash
npm run lint
npm run type-check
```

Expected: both clean. If lint flags any spelling (e.g. `lavender` is fine but cspell may flag a typo elsewhere), fix the typo, not the spell-check config.

If lint flags `gemini`, `codex`, `claude`, `vimeflow`, or `obsidian` as misspellings, those tokens are very likely already in `cspell.config.yaml` (the project uses them throughout). If not, add them to the project's spell-check dictionary file (NOT to per-file ignore directives) — those names are project vocabulary.

- [ ] **Step 6: Stage and commit**

```bash
git add src/agents/registry.ts src/agents/registry.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): add agents registry per handoff §6

AGENTS const exposes claude/codex/gemini/shell with id, name, short,
glyph, model, accent, accentDim, accentSoft, onAccent. Frozen via
`as const` so `AgentId = keyof typeof AGENTS` narrows to the literal
union. Consumed in step 4 (TerminalPane) and step 5 (SplitView) to
drive per-agent accent colours and identity chips.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full test suite**

```bash
npm run test 2>&1 | tail -10
```

Expected: file count is the prior baseline + 2 (one for `src/lib/tailwindConfig.test.ts`, one for `src/agents/registry.test.ts`). The absolute number doesn't matter — what matters is that every file passes.

- [ ] **Step 2: Lint + type-check**

```bash
npm run lint && npm run type-check
```

Expected: both clean.

- [ ] **Step 3: Inspect the three commits**

```bash
git log --oneline -3
```

Expected (top to bottom):

```
<hash> feat(agents): add agents registry per handoff §6
<hash> feat(tokens): add handoff design tokens to tailwind config
<hash> chore: scaffold ui-update tracking + import handoff bundle
```

- [ ] **Step 4: Push (optional — defer to user)**

```bash
git push -u origin worktree-ui-update
```

Don't push without explicit user instruction. The pre-push hook (`vitest run`) will run the full suite again.

---

## Done criteria for this plan

- ✅ `docs/design/handoff/` lives in this worktree, tracked.
- ✅ `docs/roadmap/ui-update-roadmap.md` exists with §9 + step 10 narrative.
- ✅ `docs/roadmap/progress.yaml` has `ui-handoff-migration` phase with 10 pending steps.
- ✅ `tailwind.config.js` has all handoff §6 additive token entries.
- ✅ `src/lib/tailwindConfig.test.ts` asserts the new keys and protects existing values.
- ✅ `src/agents/registry.ts` exports `AGENTS` + `AgentId` + `Agent` types.
- ✅ `src/agents/registry.test.ts` covers all four agents.
- ✅ `npm run lint`, `npm run test`, `npm run type-check` all green.
- ✅ Three commits on the branch in the documented order.

After this plan lands, mark `ui-s1` in `progress.yaml` as `done` (with the merging PR number) as part of the merge process — that update lives outside this plan.

The next plan covers **step 2 — App shell layout**.
