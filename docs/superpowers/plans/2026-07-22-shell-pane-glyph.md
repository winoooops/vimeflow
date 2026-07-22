# Shell Pane Glyph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shell pane's text `$` fallback with a universally recognized terminal brand mark (filled rounded tile with a knocked-out `>_` prompt), rendered like the other four agent brand icons.

**Architecture:** Add a `Shell` icon component to `src/agents/brandIcons.tsx` (same `BrandSvg` wrapper, `fill="currentColor"`, 24×24 viewBox, single compound path with evenodd knock-out), then wire it into `AGENTS.shell.Icon` in `src/agents/registry.ts`. `AgentGlyph` renders the icon automatically in all chip surfaces; no consumer changes. `glyph: '$'` stays as the text fallback and New Session dialog glyph.

**Tech Stack:** React 19, TypeScript (strict), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-22-shell-pane-glyph-design.md` (same repository, same branch).

**Workspace:** worktree `/Users/winoooops/projects/vimeflow/worktrees/shell-pane-glyph`, branch `feat/shell-pane-glyph`. All commands run from the worktree root.

**Commit attribution:** Codex reviewed this plan before implementation. If any Codex finding is incorporated, append the trailer `Co-Authored-By: codex <codex@openai.com>` exactly once to the affected `feat:` commits, per `rules/common/git-workflow.md`. Otherwise use the plain messages shown.

---

### Task 1: Add the Shell brand icon

**Files:**

- Test: `src/agents/brandIcons.test.tsx`
- Modify: `src/agents/brandIcons.tsx`

- [ ] **Step 1: Write the failing test**

In `src/agents/brandIcons.test.tsx`, extend the import and both icon lists:

```tsx
import {
  ClaudeCode,
  Codex,
  Kimi,
  OpenCode,
  Shell,
  type AgentIcon,
} from './brandIcons'

const BRAND_ICONS: readonly (readonly [string, AgentIcon])[] = [
  ['ClaudeCode', ClaudeCode],
  ['Codex', Codex],
  ['Kimi', Kimi],
  ['OpenCode', OpenCode],
  ['Shell', Shell],
]

const SQUARE_BRAND_ICONS: readonly (readonly [string, AgentIcon])[] = [
  ['Codex', Codex],
  ['Kimi', Kimi],
  ['OpenCode', OpenCode],
  ['Shell', Shell],
]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/brandIcons.test.tsx`
Expected: FAIL — the two new `Shell` cases throw "Element type is invalid: expected a string … but got: undefined" because `Shell` is not exported yet.

- [ ] **Step 3: Write minimal implementation**

In `src/agents/brandIcons.tsx`, append after the `OpenCode` export:

```tsx
export const Shell = ({
  size = DEFAULT_SIZE,
  ...props
}: AgentIconProps): ReactElement => (
  <BrandSvg size={size} {...props}>
    <path d="M6 4.2h12a3.4 3.4 0 013.4 3.4v8.8a3.4 3.4 0 01-3.4 3.4H6a3.4 3.4 0 01-3.4-3.4V7.6A3.4 3.4 0 016 4.2zM6.9 8.7h1.9l4.1 3.3-4.1 3.3H6.9l4.1-3.3zM13.5 14.3h4.1v1.7h-4.1z" />
  </BrandSvg>
)
```

Notes for the implementer:

- Do not add `fillRule` to the path — `BrandSvg` already sets `fillRule="evenodd"` on the `<svg>`, which is what knocks the two inner sub-paths (chevron, underscore) out of the outer rounded-tile sub-path. `OpenCode` relies on the same mechanism.
- The path data is the approved mockup geometry from the spec (§2). Proportions are a visual dial; keep the three-sub-path structure.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agents/brandIcons.test.tsx`
Expected: PASS — 10 tests (8 existing + 2 new Shell cases).

- [ ] **Step 5: Commit**

```bash
git add src/agents/brandIcons.tsx src/agents/brandIcons.test.tsx
git commit -m "feat: add shell terminal brand icon"
```

### Task 2: Wire the Shell icon into the agent registry

**Files:**

- Test: `src/agents/registry.test.ts`
- Test: `src/components/AgentGlyph.test.tsx`
- Test: `src/features/sessions/components/Tabs.test.tsx`
- Modify: `src/components/AgentGlyph.tsx`
- Modify: `src/agents/registry.ts`

- [ ] **Step 1: Update the registry Icon test (failing)**

In `src/agents/registry.test.ts`, replace the final test (lines 116–122, currently named `'supported agents carry a brand Icon; others fall back to their glyph'`) with:

```tsx
test('every supported agent carries a brand Icon', () => {
  expect(AGENTS.claude.Icon).toBeDefined()
  expect(AGENTS.codex.Icon).toBeDefined()
  expect(AGENTS.kimi.Icon).toBeDefined()
  expect(AGENTS.opencode.Icon).toBeDefined()
  expect(AGENTS.shell.Icon).toBeDefined()
})
```

- [ ] **Step 2: Update the AgentGlyph tests (failing)**

In `src/components/AgentGlyph.test.tsx`:

a) Add `AgentDef` to the registry import:

```tsx
import { AGENTS, type AgentDef } from '@/agents/registry'
```

b) Add a new test after the existing `'mono brand mark inherits currentColor for theme adaptation'` test:

```tsx
test('renders the brand SVG for the shell agent', () => {
  const { container } = render(<AgentGlyph agent={AGENTS.shell} />)
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- verifying brand SVG render
  const svg = container.querySelector('svg')

  expect(svg).toBeInTheDocument()
  expect(svg?.getAttribute('fill')).toBe('currentColor')
})
```

c) Replace the body of `'falls back to the unicode glyph for an agent without an Icon'` so it uses a synthetic icon-less agent (the fallback contract stays supported even though all registry agents now carry icons):

```tsx
test('falls back to the unicode glyph for an agent without an Icon', () => {
  const agentWithoutIcon: AgentDef = { ...AGENTS.shell, Icon: undefined }
  const { container } = render(<AgentGlyph agent={agentWithoutIcon} />)
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting no SVG in fallback
  const svg = container.querySelector('svg')

  expect(svg).toBeNull()
  expect(container).toHaveTextContent('$')
})
```

(`tsconfig.json` sets `strict` but not `exactOptionalPropertyTypes`, so `Icon: undefined` satisfies the optional `Icon?: AgentIcon`.)

- [ ] **Step 3: Update the Tabs chrome test (failing)**

In `src/features/sessions/components/Tabs.test.tsx`, the test `'renders agent chrome from session.agentType (no override path)'` (lines 219–246) currently asserts the shell tab renders the text glyph via `getByText(AGENTS.shell.glyph)`. The shell tab now renders an SVG mark. Replace the assertion block:

```tsx
    const activeTab = screen.getByRole('tab', { name: 'codex tab' })
    const inactiveTab = screen.getByRole('tab', { name: 'shell tab' })

    const codexChip = within(activeTab).getByTestId('agent-glyph-chip')
    // eslint-disable-next-line testing-library/no-node-access -- codex renders an svg brand mark
    const codexMark = codexChip.querySelector('svg')
    const shellChip = within(inactiveTab).getByTestId('agent-glyph-chip')
    // eslint-disable-next-line testing-library/no-node-access -- shell renders an svg brand mark
    const shellMark = shellChip.querySelector('svg')

    expect(codexMark).toBeInTheDocument()
    expect(shellMark).toBeInTheDocument()
    // Different sessions render different agent chips from their own agentType.
    expect(shellChip.innerHTML).not.toBe(codexChip.innerHTML)
  })
```

Also delete the now-unused import on line 6:

```tsx
import { AGENTS } from '../../../agents/registry'
```

(`AGENTS` is used nowhere else in this file — verified by grep.)

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/agents/registry.test.ts src/components/AgentGlyph.test.tsx src/features/sessions/components/Tabs.test.tsx`
Expected: FAIL in all three files — `AGENTS.shell.Icon` is undefined, no SVG renders for shell, and the shell tab chip contains no `svg`.

- [ ] **Step 5: Write minimal implementation**

a) In `src/components/AgentGlyph.tsx`, widen the prop type so the synthetic icon-less test agent type-checks — the component only needs the definition shape, not the union identity. Replace the import and interface:

```tsx
import type { ReactElement } from 'react'
import type { AgentDef } from '@/agents/registry'

interface AgentGlyphProps {
  agent: AgentDef
  size?: number
}
```

(All three existing callers pass `AGENTS` members, which are assignable to `AgentDef` — the registry's `satisfies Record<string, AgentDef>` proves it. The rest of the file is unchanged; `agent.Icon` / `agent.glyph` exist on `AgentDef`.)

b) In `src/agents/registry.ts`, add `Shell` to the brand-icons import and set it on the shell entry:

```tsx
import {
  ClaudeCode,
  Codex,
  Kimi,
  OpenCode,
  Shell,
  type AgentIcon,
} from './brandIcons'
```

```tsx
  shell: {
    id: 'shell',
    name: 'Shell',
    short: 'SHELL',
    glyph: '$',
    Icon: Shell,
    model: null,
    resumeCommands: null,
    accent: 'var(--color-agent-shell-accent)',
    accentDim: 'var(--color-agent-shell-accent-dim)',
    accentSoft: 'var(--color-agent-shell-accent-soft)',
    onAccent: 'var(--color-agent-shell-on-accent)',
  },
```

Only the `Icon:` line changes in the entry; `glyph: '$'` stays (text fallback + New Session dialog).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/agents/registry.test.ts src/components/AgentGlyph.test.tsx src/features/sessions/components/Tabs.test.tsx`
Expected: PASS — all tests in all three files.

Then type-check the frontend graph (the widened `AgentDef` prop is the only type-surface change):

Run: `npx tsc -b`
Expected: exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/agents/registry.ts src/agents/registry.test.ts src/components/AgentGlyph.tsx src/components/AgentGlyph.test.tsx src/features/sessions/components/Tabs.test.tsx
git commit -m "feat: render shell pane glyph as a terminal brand mark"
```

### Task 3: Attribution note and full verification

**Files:**

- Modify: `src/agents/icons-NOTICE.md`

- [ ] **Step 1: Note the in-house mark**

In `src/agents/icons-NOTICE.md`, insert a new section between the intro paragraph (ending with `SPDX-License-Identifier: MIT`) and `## License (Lobe Icons)`:

```markdown
## In-house marks

The Shell terminal mark in `brandIcons.tsx` is drawn in-house for vimeflow and
is not vendored from Lobe Icons.
```

- [ ] **Step 2: Run the full affected test surface**

This touches every suite that renders or pins the shell glyph:

```bash
npx vitest run src/agents src/components src/features/sessions src/features/agent-status src/features/terminal/components/TerminalPane
```

Expected: PASS — all test files, 0 failures.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: exit 0, no errors (no new disables beyond the ones written above; `iconless`-style made-up words are avoided in identifiers so cspell stays clean).

- [ ] **Step 4: Type-check (canonical)**

Run: `npm run type-check`
Expected: exit 0. Note this regenerates Rust bindings via cargo first; that is normal.

- [ ] **Step 5: Format check on changed files**

Run: `npx prettier --check src/agents/brandIcons.tsx src/agents/brandIcons.test.tsx src/agents/registry.ts src/agents/registry.test.ts src/agents/icons-NOTICE.md src/components/AgentGlyph.tsx src/components/AgentGlyph.test.tsx src/features/sessions/components/Tabs.test.tsx`
Expected: "All matched files use Prettier code style". If it complains, run `npx prettier --write` on the same list and re-run the affected tests.

- [ ] **Step 6: Commit**

```bash
git add src/agents/icons-NOTICE.md
git commit -m "docs: note in-house shell mark in icon attribution"
```

### Task 4: Manual visual check (optional, no commit)

- [ ] **Step 1: Run the app and eyeball the three chip surfaces**

Run: `npm run electron:dev` (or `npm run electron:dev:ghostty` for the native build), then open or focus a plain shell session.

Confirm, in the dark default theme (Catppuccin):

- Session tab: amber rounded tile with a visible `>_` knock-out in the 16px chip.
- Terminal pane header: same mark in the 22px bordered chip.
- Agent status panel header: same mark in the 24px chip.
- New Session dialog: still shows the text `$` for Shell (intended — that dialog uses unicode glyphs for every agent).

If the chevron or underscore looks cramped at 12px, tune only the two inner sub-paths' coordinates in the `Shell` path (they are a visual dial per the spec), re-run `npx vitest run src/agents/brandIcons.test.tsx`, and amend the Task 1 commit only if the tests still pass.

---

## Self-review notes (completed by the plan author)

- **Spec coverage:** §2 mark → Task 1; §3 registry wiring + `glyph: '$'` retained → Task 2 Step 5b; §4 no consumer changes → nothing to do (verified `Tab.tsx`, `TerminalPane/Header.tsx`, `AgentStatusPanel/Header.tsx` all render via `AgentGlyph`); §5 tests → Tasks 1–2; §6 attribution → Task 3.
- **Breakages found during planning (beyond the spec):** `registry.test.ts:121` pinned `AGENTS.shell.Icon` undefined (Task 2 Step 1); `Tabs.test.tsx:244` queried the `$` text (Task 2 Step 3); `AgentGlyphProps.agent: Agent` rejected a synthetic icon-less agent (Task 2 Step 5a widens it to `AgentDef`).
- **Verified unaffected:** `ActivityEvent.test.tsx` `getByText('$')` is a bash prompt in a command line, not the glyph; `AgentStatusPanel/index.test.tsx` passes `AGENTS.shell` as a prop with no glyph assertion; `Card.tsx`/`SessionSwitcher.tsx` "glyph" hits are the pane-layout glyph and switcher numbering; `NewSessionDialog` keeps text glyphs for all agents by design.
