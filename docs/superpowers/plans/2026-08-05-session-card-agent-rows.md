# Session Card Agent Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Active session card in the sidebar Sessions list always shows one row per coding-agent pane — a 22px state chip (spinner / ! / ✕ / ✓ / ◦), the agent name, and its latest task message inside a tonal recess panel — and clicking a row focuses that pane.

**Architecture:** Pure-frontend aggregation. A new `deriveSessionAgents` util filters `session.panes` to coding-agent panes; a new `AgentRows` component renders them inside `Card` as a sibling of the full-row activation button (the kebab-menu pattern). Messages come from the latest `NotificationRecord` per `ptyId`; the running ring is the union of watcher lifecycle status and live OSC 9;4 progress via `usePtyProgress` (spec Decision 9). One new theme token (`wash-recess`); chip colors use semantic tokens directly. No Rust changes, no new `Pane` fields, no time display, no `ProgressBar`.

**Tech Stack:** React 19 + TypeScript (ESM), Tailwind v4 semantic tokens (utilities auto-derived from `@theme` in generated `src/theme/theme.css`), framer-motion (already wrapping the list — untouched), Vitest + Testing Library.

**Linear:** [VIM-423](https://linear.app/vimeflow/issue/VIM-423)
**Spec:** `docs/superpowers/specs/2026-08-05-session-card-agent-rows-design.md`
**Visual reference:** `docs/superpowers/specs/2026-08-05-agent-rows-handoff/` (handoff MD + interactive mockup)

## Global Constraints

- Style: no semicolons, single quotes, trailing commas es5; arrow-function components only; explicit return types on all exported functions; `no-console`; default props via default arguments; blank line before `return` (`@stylistic/padding-line-between-statements`).
- Data-driven precedence maps (`Record<SessionStatus, …>`) — no if/else cascades; immutability everywhere (no `.push`/mutation).
- Tests: Vitest, explicit `import { describe, expect, test, vi } from 'vitest'`; `test()` not `it()`; Testing Library query priority (`getByRole` first, `getByTestId` last resort); inline single-use test data.
- Icons/controls: no raw icon-only `<button>` (`vimeflow/no-raw-icon-button`); decorative spans need `aria-hidden="true"`; every a11y attribute gets a test query.
- Commits: conventional, lowercase after the colon.
- Gate before push (in order): `npm run lint` → `npm run format:check` → `npm run type-check` → `npx vitest run`.
- Node 24 (`.nvmrc`).

## Kickoff (before Task 1)

This plan assumes the vim-411 notification epic is merged to `main` (it supplies `NotificationRecord.body` and the contextual-message pipeline). From the primary checkout:

```bash
git fetch origin
git worktree add worktrees/vim-423 -b feat/vim-423-session-card-agent-rows origin/main
cp worktrees/vim-281/docs/superpowers/specs/2026-08-05-session-card-agent-rows-design.md \
   worktrees/vim-423/docs/superpowers/specs/
cp worktrees/vim-281/docs/superpowers/plans/2026-08-05-session-card-agent-rows.md \
   worktrees/vim-423/docs/superpowers/plans/
mkdir -p worktrees/vim-423/docs/superpowers/specs/2026-08-05-agent-rows-handoff
cp "/home/will/Downloads/agent-rows-handoff/AGENT-ROWS-HANDOFF.md" \
   "/home/will/Downloads/agent-rows-handoff/Session Card Agent Rows.html" \
   worktrees/vim-423/docs/superpowers/specs/2026-08-05-agent-rows-handoff/
cd worktrees/vim-423 && npm install
git add docs/superpowers && git commit -m "docs: add session card agent rows spec, plan, and design handoff"
```

Sanity-check that these exist on the new branch before starting (all landed with vim-411): `body`/`occurredAt` on `NotificationRecord` in `src/features/sessions/hooks/useNotificationCenter.ts`, `setSessionActivePane` in `src/features/sessions/hooks/useSessionManager.ts`, `usePtyProgress` in `src/features/terminal/hooks/`. If any is missing, stop — the base is wrong.

---

### Task 1: `deriveSessionAgents` util

**Files:**

- Create: `src/features/sessions/utils/deriveSessionAgents.ts`
- Test: `src/features/sessions/utils/deriveSessionAgents.test.ts`

**Interfaces:**

- Consumes: `agentForPane` (`./agentForSession`), `isShellPane` (`./paneKind`), `Pane`/`Session`/`SessionStatus` (`../types`), `Agent` (`../../../agents/registry`).
- Produces: `interface SessionAgentEntry { paneId: string; ptyId: string; agent: Agent; status: SessionStatus; label: string }` and `deriveSessionAgents(session: Pick<Session, 'panes'>): SessionAgentEntry[]`. Tasks 4–5 import both.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from 'vitest'
import type { Pane } from '../types'
import { deriveSessionAgents } from './deriveSessionAgents'

const pane = (overrides: Partial<Pane> = {}): Pane => ({
  id: 'p0',
  ptyId: 'pty-0',
  cwd: '/tmp/project',
  agentType: 'kimi',
  status: 'running',
  active: true,
  ...overrides,
})

describe('deriveSessionAgents', () => {
  test('maps coding-agent shell panes in pane order', () => {
    const entries = deriveSessionAgents({
      panes: [
        pane({ id: 'p0', ptyId: 'pty-0', agentType: 'claude-code' }),
        pane({
          id: 'p1',
          ptyId: 'pty-1',
          agentType: 'codex',
          status: 'awaiting',
        }),
      ],
    })

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      paneId: 'p0',
      ptyId: 'pty-0',
      status: 'running',
    })
    expect(entries[0]?.agent.id).toBe('claude')
    expect(entries[1]).toMatchObject({ paneId: 'p1', status: 'awaiting' })
    expect(entries[1]?.agent.id).toBe('codex')
  })

  test('excludes generic and aider panes (shell-mapped agents)', () => {
    const entries = deriveSessionAgents({
      panes: [
        pane({ id: 'p0', agentType: 'generic' }),
        pane({ id: 'p1', agentType: 'aider' }),
        pane({ id: 'p2', agentType: 'opencode' }),
      ],
    })

    expect(entries.map((e) => e.paneId)).toEqual(['p2'])
  })

  test('excludes browser panes even with an agent type set', () => {
    const entries = deriveSessionAgents({
      panes: [pane({ kind: 'browser', agentType: 'kimi' })],
    })

    expect(entries).toEqual([])
  })

  test('keeps duplicate agents as separate rows', () => {
    const entries = deriveSessionAgents({
      panes: [
        pane({ id: 'p0', ptyId: 'pty-0' }),
        pane({ id: 'p1', ptyId: 'pty-1' }),
      ],
    })

    expect(entries.map((e) => e.agent.id)).toEqual(['kimi', 'kimi'])
  })

  test('label precedence: userLabel, then agentTitle, then working-on cwd dir', () => {
    const entries = deriveSessionAgents({
      panes: [
        pane({ id: 'p0', userLabel: 'my label', agentTitle: 'agent title' }),
        pane({ id: 'p1', ptyId: 'pty-1', agentTitle: 'agent title' }),
        pane({ id: 'p2', ptyId: 'pty-2', cwd: '/home/user/vimeflow/' }),
      ],
    })

    expect(entries.map((e) => e.label)).toEqual([
      'my label',
      'agent title',
      'working on vimeflow',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/sessions/utils/deriveSessionAgents.test.ts`
Expected: FAIL — cannot resolve `./deriveSessionAgents`.

- [ ] **Step 3: Write the implementation**

```typescript
import type { Agent } from '../../../agents/registry'
import type { Pane, Session, SessionStatus } from '../types'
import { agentForPane } from './agentForSession'
import { isShellPane } from './paneKind'

export interface SessionAgentEntry {
  paneId: string
  ptyId: string
  agent: Agent
  status: SessionStatus
  label: string
}

const cwdBasename = (cwd: string): string =>
  cwd.split('/').filter(Boolean).at(-1) ?? cwd

// Pane-header precedence (userLabel ?? agentTitle), then a friendly cwd
// descriptor instead of a bare pane id.
const paneLabel = (pane: Pane): string =>
  pane.userLabel ?? pane.agentTitle ?? `working on ${cwdBasename(pane.cwd)}`

/**
 * Coding-agent panes of a session, in pane order. Plain shells (generic,
 * aider — both registry-mapped to 'shell') and browser panes are excluded:
 * the sidebar rows are an agent status surface, not a pane manifest.
 */
export const deriveSessionAgents = (
  session: Pick<Session, 'panes'>
): SessionAgentEntry[] =>
  session.panes
    .filter(isShellPane)
    .map((pane) => ({ pane, agent: agentForPane(pane) }))
    .filter(({ agent }) => agent.id !== 'shell')
    .map(({ pane, agent }) => ({
      paneId: pane.id,
      ptyId: pane.ptyId,
      agent,
      status: pane.status,
      label: paneLabel(pane),
    }))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/sessions/utils/deriveSessionAgents.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/sessions/utils/deriveSessionAgents.ts src/features/sessions/utils/deriveSessionAgents.test.ts
git commit -m "feat(sessions): derive coding-agent entries per session"
```

---

### Task 2: `latestPaneRecord` selector

**Files:**

- Modify: `src/features/sessions/hooks/useNotificationCenter.ts` (append after `sessionUnreadCategory`, which starts near line 149)
- Test: `src/features/sessions/hooks/useNotificationCenter.test.ts` (append a describe block)

**Interfaces:**

- Consumes: `NotificationRecord` (same file).
- Produces: `latestPaneRecord(records: readonly NotificationRecord[], ptyId: string): NotificationRecord | undefined` — newest by `occurredAt` (a number, epoch ms) among records matching `ptyId`. Tasks 4–5 import it.

- [ ] **Step 1: Write the failing test** (append to the existing test file — keep its existing imports; add `latestPaneRecord` and the `NotificationRecord` type to the import from `./useNotificationCenter` if not present)

```typescript
describe('latestPaneRecord', () => {
  const record = (
    id: string,
    ptyId: string,
    occurredAt: number
  ): NotificationRecord => ({
    id,
    sessionId: 'sess-1',
    ptyId,
    reason: 'turn-complete',
    title: 'Kimi finished',
    occurredAt,
    read: false,
  })

  test('returns undefined when no record matches the pane', () => {
    expect(latestPaneRecord([record('a', 'pty-other', 1000)], 'pty-1')).toBe(
      undefined
    )
  })

  test('returns the newest matching record by occurredAt regardless of order', () => {
    const records = [
      record('a', 'pty-1', 1000),
      record('b', 'pty-2', 5000),
      record('c', 'pty-1', 3000),
      record('d', 'pty-1', 2000),
    ]

    expect(latestPaneRecord(records, 'pty-1')?.id).toBe('c')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/sessions/hooks/useNotificationCenter.test.ts`
Expected: FAIL — `latestPaneRecord` is not exported.

- [ ] **Step 3: Write the implementation** (append to `useNotificationCenter.ts`)

```typescript
/**
 * Newest record for a pane by occurredAt. Order-independent on purpose —
 * the reducer prepends new records but pruning can reorder survivors.
 */
export const latestPaneRecord = (
  records: readonly NotificationRecord[],
  ptyId: string
): NotificationRecord | undefined =>
  records.reduce<NotificationRecord | undefined>(
    (latest, candidate) =>
      candidate.ptyId === ptyId &&
      (latest === undefined || candidate.occurredAt > latest.occurredAt)
        ? candidate
        : latest,
    undefined
  )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/sessions/hooks/useNotificationCenter.test.ts`
Expected: PASS (existing tests plus the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/features/sessions/hooks/useNotificationCenter.ts src/features/sessions/hooks/useNotificationCenter.test.ts
git commit -m "feat(sessions): add latest-record-per-pane selector"
```

---

### Task 3: `wash-recess` theme token

**Files:**

- Modify: `src/theme/types.ts` (token union list — add `'wash-recess'` right after `'wash-soft'`, near line 72)
- Modify: `src/theme/themes/obsidian-lens.ts`, `src/theme/themes/flexoki.ts`, `src/theme/themes/tokyo-night.ts`, `src/theme/themes/dracula.ts`, `src/theme/themes/gruvbox/gruvbox-dark.ts`, `src/theme/themes/gruvbox/gruvbox-light.ts` (add the entry next to each file's existing `'wash-soft'` line)
- Modify: `src/theme/derive.ts` (add next to `'wash-soft'`, near line 164)
- Regenerate: `src/theme/theme.css` (generated file — never hand-edit)

**Interfaces:**

- Produces: the `bg-wash-recess` Tailwind utility (Tailwind v4 auto-derives it from `--color-wash-recess` in the regenerated `@theme` block). Task 4 uses it.

- [ ] **Step 1: Register the token and watch the guards fail**

In `src/theme/types.ts`, add to the token list after `'wash-soft'`:

```typescript
  'wash-recess',
```

Run: `npx vitest run src/theme`
Expected: FAIL — completeness guards (`cssVars` / `themeCss` / theme-file tests) report the missing token per theme and in the generated CSS. This is the red step; the failures enumerate exactly the files Step 2 fixes.

- [ ] **Step 2: Add the per-theme values and the derive rule**

Add next to each file's `'wash-soft'` entry (a darkening inset wash — `wash-*` lightens in dark themes, so a new token is required; values from the design handoff, tokyo-night/dracula/gruvbox-light extrapolated — confirm at live check):

| File                              | Entry                                       |
| --------------------------------- | ------------------------------------------- |
| `themes/obsidian-lens.ts`         | `'wash-recess': 'rgba(0, 0, 0, 0.22)',`     |
| `themes/gruvbox/gruvbox-dark.ts`  | `'wash-recess': 'rgba(0, 0, 0, 0.24)',`     |
| `themes/tokyo-night.ts`           | `'wash-recess': 'rgba(0, 0, 0, 0.2)',`      |
| `themes/dracula.ts`               | `'wash-recess': 'rgba(0, 0, 0, 0.2)',`      |
| `themes/flexoki.ts`               | `'wash-recess': 'rgba(16, 15, 15, 0.045)',` |
| `themes/gruvbox/gruvbox-light.ts` | `'wash-recess': 'rgba(16, 15, 15, 0.05)',`  |

In `src/theme/derive.ts`, after the `'wash-soft'` line (the `light` boolean is already in scope there):

```typescript
      'wash-recess': alpha('#000000', light ? 0.05 : 0.22),
```

- [ ] **Step 3: Regenerate the CSS**

```bash
npx tsx scripts/generate-theme-css.ts && npx prettier --write src/theme/theme.css
```

- [ ] **Step 4: Run the theme suite to verify it passes**

Run: `npx vitest run src/theme`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/theme
git commit -m "feat(theme): add wash-recess inset token"
```

---

### Task 4: `AgentRows` component (+ export `ProgressSource`)

**Files:**

- Modify: `src/features/terminal/hooks/usePtyProgress.ts:5` — change `type ProgressSource =` to `export type ProgressSource =`
- Create: `src/features/sessions/components/AgentRows.tsx`
- Test: `src/features/sessions/components/AgentRows.test.tsx`

**Interfaces:**

- Consumes: `deriveSessionAgents` + `SessionAgentEntry` (Task 1), `latestPaneRecord` + `NotificationRecord` (Task 2), `bg-wash-recess` (Task 3), `usePtyProgress` + `ProgressSource` (`../../terminal/hooks/usePtyProgress`).
- Produces: `AgentRows` with exported `AgentRowsProps` `{ session: Session; records?: readonly NotificationRecord[]; service?: ProgressSource; onFocusPane: (sessionId: string, paneId: string) => void }`; renders `null` when the session has no coding-agent panes. Task 5 imports it.

- [ ] **Step 1: Export `ProgressSource`**

In `src/features/terminal/hooks/usePtyProgress.ts` change line 5:

```typescript
export type ProgressSource = Pick<
  ITerminalService,
  'getProgress' | 'onProgress'
>
```

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NotificationRecord } from '../hooks/useNotificationCenter'
import type { Pane, Session } from '../types'
import { AgentRows } from './AgentRows'

const pane = (overrides: Partial<Pane> = {}): Pane => ({
  id: 'p0',
  ptyId: 'pty-0',
  cwd: '/tmp/project',
  agentType: 'kimi',
  status: 'running',
  active: true,
  ...overrides,
})

const session = (panes: Pane[]): Session =>
  ({
    id: 'sess-1',
    name: 'vimeflow',
    panes,
  }) as Session

const record = (
  overrides: Partial<NotificationRecord> = {}
): NotificationRecord => ({
  id: 'n1',
  sessionId: 'sess-1',
  ptyId: 'pty-0',
  reason: 'turn-complete',
  title: 'Kimi finished',
  occurredAt: 1_000,
  read: false,
  ...overrides,
})

describe('AgentRows', () => {
  test('renders one row per coding-agent pane with the state in the accessible name', () => {
    render(
      <AgentRows
        session={session([
          pane({ id: 'p0', agentType: 'kimi' }),
          pane({ id: 'p1', ptyId: 'pty-1', agentType: 'generic' }),
          pane({
            id: 'p2',
            ptyId: 'pty-2',
            agentType: 'codex',
            status: 'awaiting',
          }),
        ])}
        onFocusPane={vi.fn()}
      />
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(
      screen.getByRole('button', { name: /kimi.*running/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /codex.*needs you/i })
    ).toBeInTheDocument()
  })

  test('renders nothing when the session has no coding-agent panes', () => {
    const { container } = render(
      <AgentRows
        session={session([pane({ agentType: 'generic' })])}
        onFocusPane={vi.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  test('row click reports the session and pane ids', async () => {
    const onFocusPane = vi.fn()

    render(
      <AgentRows
        session={session([pane({ id: 'p3', ptyId: 'pty-3' })])}
        onFocusPane={onFocusPane}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /kimi/i }))

    expect(onFocusPane).toHaveBeenCalledWith('sess-1', 'p3')
  })

  test('message precedence: record body, then title, then pane label', () => {
    render(
      <AgentRows
        session={session([
          pane({ id: 'p0', ptyId: 'pty-0' }),
          pane({ id: 'p1', ptyId: 'pty-1' }),
          pane({ id: 'p2', ptyId: 'pty-2', userLabel: 'watcher pane' }),
        ])}
        records={[
          record({ id: 'n1', ptyId: 'pty-0', body: 'wrote 3 files' }),
          record({ id: 'n2', ptyId: 'pty-1', body: undefined }),
        ]}
        onFocusPane={vi.fn()}
      />
    )

    expect(screen.getByText('wrote 3 files')).toBeInTheDocument()
    expect(screen.getByText('Kimi finished')).toBeInTheDocument()
    expect(screen.getByText('watcher pane')).toBeInTheDocument()
  })

  test('idle pane with active OSC progress renders as running (Decision 9 union)', async () => {
    render(
      <AgentRows
        session={session([pane({ status: 'idle' })])}
        service={{
          getProgress: () => ({ state: 'indeterminate', value: null }),
          onProgress: (): Promise<() => void> =>
            Promise.resolve(() => undefined),
        }}
        onFocusPane={vi.fn()}
      />
    )

    expect(
      await screen.findByRole('button', { name: /kimi.*running/i })
    ).toBeInTheDocument()
  })

  test('idle pane without a progress source stays idle', () => {
    render(
      <AgentRows
        session={session([pane({ status: 'idle' })])}
        onFocusPane={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: /kimi.*idle/i })
    ).toBeInTheDocument()
  })

  test('completed chip shows the done glyph, running chip spins with motion-reduce escape', () => {
    const { container } = render(
      <AgentRows
        session={session([
          pane({ id: 'p0', ptyId: 'pty-0', status: 'completed' }),
          pane({ id: 'p1', ptyId: 'pty-1', status: 'running' }),
        ])}
        onFocusPane={vi.fn()}
      />
    )

    expect(screen.getByText('✓')).toBeInTheDocument()
    // eslint-disable-next-line testing-library/no-node-access -- verifying spinner styling classes
    const ring = container.querySelector('.animate-spin')
    expect(ring).toBeInTheDocument()
    expect(ring?.className).toContain('motion-reduce:animate-none')
  })
})
```

Note: the `session(...)` helper casts through `as Session` because `AgentRows` only reads `id`, `name`, and `panes` — same convention `Card.test.tsx` uses.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/sessions/components/AgentRows.test.tsx`
Expected: FAIL — cannot resolve `./AgentRows`.

- [ ] **Step 4: Write the implementation**

```tsx
import type { ReactElement } from 'react'
import {
  usePtyProgress,
  type ProgressSource,
} from '../../terminal/hooks/usePtyProgress'
import type { Session, SessionStatus } from '../types'
import {
  latestPaneRecord,
  type NotificationRecord,
} from '../hooks/useNotificationCenter'
import {
  deriveSessionAgents,
  type SessionAgentEntry,
} from '../utils/deriveSessionAgents'

// Chip state → glyph + semantic tone + accessible label; exhaustive Record so
// a new SessionStatus must rank itself. Fills stay ≤16% so no row outshouts
// the card-level notification badge (design handoff §3). Themes recolor the
// vocabulary through the semantic tokens themselves.
const CHIP_STATE: Record<
  SessionStatus,
  { glyph: string | null; chipClass: string; label: string }
> = {
  running: {
    glyph: null, // rotating hairline ring instead of a glyph
    chipClass: 'bg-secondary/[0.14] text-secondary',
    label: 'running',
  },
  awaiting: {
    glyph: '!',
    chipClass: 'bg-tertiary/[0.16] text-tertiary',
    label: 'needs you',
  },
  errored: {
    glyph: '✕',
    chipClass: 'bg-error/[0.16] text-error',
    label: 'error',
  },
  completed: {
    glyph: '✓',
    chipClass: 'bg-success-muted/[0.14] text-success-muted',
    label: 'finished',
  },
  idle: {
    glyph: '◦',
    chipClass: 'bg-on-surface-muted/[0.10] text-on-surface-muted',
    label: 'idle',
  },
}

// Inert stand-in so the hook is unconditionally callable when no service is
// threaded (tests, stories); `enabled` stays false then, so it never
// subscribes.
const NOOP_PROGRESS_SOURCE: ProgressSource = {
  getProgress: () => undefined,
  onProgress: (): Promise<() => void> => Promise.resolve(() => undefined),
}

interface AgentRowProps {
  sessionId: string
  entry: SessionAgentEntry
  record?: NotificationRecord
  service?: ProgressSource
  onFocusPane: (sessionId: string, paneId: string) => void
}

const AgentRow = ({
  sessionId,
  entry,
  record = undefined,
  service = undefined,
  onFocusPane,
}: AgentRowProps): ReactElement => {
  const progress = usePtyProgress(
    service ?? NOOP_PROGRESS_SOURCE,
    entry.ptyId,
    service !== undefined &&
      (entry.status === 'running' || entry.status === 'idle')
  )
  // Running signal = watcher lifecycle ∪ live OSC 9;4 progress — the
  // row-level analogue of the pane header's lifecycle fallback. Only idle
  // upgrades; decisive states (awaiting/errored/completed) always win over
  // stray progress.
  const displayStatus: SessionStatus =
    entry.status === 'idle' && progress !== undefined ? 'running' : entry.status
  const state = CHIP_STATE[displayStatus]
  const message = record?.body ?? record?.title ?? entry.label

  return (
    <li>
      <button
        type="button"
        // The chip is the only visible state signal and it's aria-hidden, so
        // the button's accessible name carries agent + state.
        aria-label={`${entry.agent.name} — ${state.label}`}
        onClick={() => onFocusPane(sessionId, entry.paneId)}
        className="grid w-full grid-cols-[22px_minmax(0,1fr)] items-center gap-2 rounded-md px-1.5 py-[3px] text-left transition-colors hover:bg-wash-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/45"
      >
        <span
          aria-hidden="true"
          className={`grid h-[22px] w-[22px] place-items-center rounded-[6px] font-mono text-[11px] leading-none ${state.chipClass}`}
        >
          {state.glyph ?? (
            <span className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-secondary/25 border-t-secondary motion-reduce:animate-none" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-medium leading-none text-on-surface-variant">
            {entry.agent.name}
          </span>
          <span className="mt-[3px] block truncate text-[10.5px] leading-[1.25] text-on-surface-muted">
            {message}
          </span>
        </span>
      </button>
    </li>
  )
}

export interface AgentRowsProps {
  session: Session
  records?: readonly NotificationRecord[]
  service?: ProgressSource
  onFocusPane: (sessionId: string, paneId: string) => void
}

/**
 * Always-on live agent rows for a session card (spec 2026-08-05, VIM-423):
 * one shared recess panel wrapping a row per coding-agent pane. Renders
 * nothing when the session has none. Must be mounted as a SIBLING of Card's
 * absolute activation button, never inside its pointer-events-none content
 * wrapper.
 */
export const AgentRows = ({
  session,
  records = [],
  service = undefined,
  onFocusPane,
}: AgentRowsProps): ReactElement | null => {
  const entries = deriveSessionAgents(session)

  if (entries.length === 0) {
    return null
  }

  return (
    <ul
      aria-label={`Agents in ${session.name}`}
      className="pointer-events-auto relative mt-1.5 flex flex-col gap-px rounded-lg bg-wash-recess p-1"
    >
      {entries.map((entry) => (
        <AgentRow
          key={entry.paneId}
          sessionId={session.id}
          entry={entry}
          record={latestPaneRecord(records, entry.ptyId)}
          service={service}
          onFocusPane={onFocusPane}
        />
      ))}
    </ul>
  )
}
```

Notes for the implementer:

- The grid column `minmax(0,1fr)` plus `min-w-0` on the text wrapper is load-bearing for truncation (handoff §2) — do not swap to `flex-1 shrink-0`.
- The mockup used `<div>`s; semantic `<ul>`/`<li>` is deliberate here (rows are a list of buttons).
- OSC `remove` events delete the cache entry, so `progress` returns to `undefined` and the ring follows the watcher alone — the intended Decision-9 behavior.
- If cspell flags a word, fix the word rather than adding dictionary entries.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/sessions/components/AgentRows.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/terminal/hooks/usePtyProgress.ts src/features/sessions/components/AgentRows.tsx src/features/sessions/components/AgentRows.test.tsx
git commit -m "feat(sessions): add live agent rows component"
```

---

### Task 5: render `AgentRows` inside `Card`

**Files:**

- Modify: `src/features/sessions/components/Card.tsx`
- Test: `src/features/sessions/components/Card.test.tsx`

**Interfaces:**

- Consumes: `AgentRows` (Task 4), `NotificationRecord` type (Task 2), `ProgressSource` (Task 4).
- Produces: three new optional `CardProps` — `notificationRecords?: readonly NotificationRecord[]`, `progressSource?: ProgressSource`, `onFocusPane?: (sessionId: string, paneId: string) => void`. Task 6 passes them from `List`.

- [ ] **Step 1: Write the failing tests** (append to `Card.test.tsx`; extend the existing `session()` fixture with a `panes: []` default so sessions always carry the field)

In the fixture object inside `session()`, add one line after `layout: 'single',`:

```typescript
    panes: [],
```

Append tests (the `Pane` type joins the existing type import from `'../types'`):

```typescript
describe('agent rows', () => {
  const agentPane: Pane = {
    id: 'p1',
    ptyId: 'pty-1',
    cwd: '/tmp/project',
    agentType: 'kimi',
    status: 'running',
    active: true,
  }

  test('active card renders agent rows and row click focuses the pane without activating the card', async () => {
    const onClick = vi.fn()
    const onFocusPane = vi.fn()

    renderActiveCard(session({ panes: [agentPane] }), {
      onClick,
      onFocusPane,
    })
    await userEvent.click(
      screen.getByRole('button', { name: /kimi.*running/i })
    )

    expect(onFocusPane).toHaveBeenCalledWith('sess-1', 'p1')
    expect(onClick).not.toHaveBeenCalled()
  })

  test('active card without onFocusPane renders no agent rows', () => {
    renderActiveCard(session({ panes: [agentPane] }))

    expect(
      screen.queryByRole('list', { name: /agents in/i })
    ).not.toBeInTheDocument()
  })

  test('recent card renders no agent rows', () => {
    renderRecentCard(session({ panes: [agentPane] }), {
      onFocusPane: vi.fn(),
    })

    expect(
      screen.queryByRole('list', { name: /agents in/i })
    ).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/sessions/components/Card.test.tsx`
Expected: FAIL — `onFocusPane` is not a known prop / rows not rendered.

- [ ] **Step 3: Implement the Card changes**

In `Card.tsx`:

1. Add the component import and the `ProgressSource` type import; extend the existing hook type import:

```typescript
import { AgentRows } from './AgentRows'
import type { ProgressSource } from '../../terminal/hooks/usePtyProgress'
```

```typescript
import type {
  NotificationCategory,
  NotificationRecord,
} from '../hooks/useNotificationCenter'
```

2. Extend `CardProps`:

```typescript
  notificationRecords?: readonly NotificationRecord[]
  progressSource?: ProgressSource
  onFocusPane?: (sessionId: string, paneId: string) => void
```

3. Extend the destructure with defaults:

```typescript
  notificationRecords = [],
  progressSource = undefined,
  onFocusPane = undefined,
```

4. In `inner`, directly after the closing `</div>` of the `pointer-events-none` content wrapper (before the kebab block), insert:

```tsx
{
  /* Live agent rows — sibling of the activation button (like the kebab)
          so row buttons stay clickable above the absolute overlay. */
}
{
  variant === 'active' && onFocusPane !== undefined && (
    <AgentRows
      session={session}
      records={notificationRecords}
      service={progressSource}
      onFocusPane={onFocusPane}
    />
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/sessions/components/Card.test.tsx`
Expected: PASS (all existing tests plus the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/features/sessions/components/Card.tsx src/features/sessions/components/Card.test.tsx
git commit -m "feat(sessions): show live agent rows on active session cards"
```

---

### Task 6: thread props `WorkspaceView → SessionsView → List → Card`

**Files:**

- Modify: `src/features/sessions/components/List.tsx`
- Modify: `src/features/workspace/components/SessionsView.tsx`
- Modify: `src/features/workspace/WorkspaceView.tsx` (SessionsView usage near line 3372; `handleSetActiveSessionId` is defined near line 1768; `setSessionActivePane` is already destructured from `useSessionManager` near line 399; `terminalService` exists from line 369)
- Test: `src/features/sessions/components/List.test.tsx`, `src/features/workspace/components/SessionsView.test.tsx` (append)

**Interfaces:**

- Consumes: `CardProps` additions (Task 5), `setSessionActivePane(sessionId: string, paneId: string)` and `handleSetActiveSessionId(id: string)` (existing), `terminalService: ITerminalService` (satisfies `ProgressSource` structurally).
- Produces: `ListProps`/`SessionsViewProps` additions `progressSource?: ProgressSource` and `onFocusPane?: (sessionId: string, paneId: string) => void`.

- [ ] **Step 1: Write the failing test** (append to `List.test.tsx`, matching its existing render helpers/fixtures; the session must land in the Active group — give the pane `status: 'running'`, or `open: true` on the session if the file's builder defaults panes to non-live statuses)

```typescript
test('threads onFocusPane to active session cards', async () => {
  const onFocusPane = vi.fn()

  render(
    <List
      sessions={[
        session({
          id: 'sess-1',
          panes: [
            {
              id: 'p1',
              ptyId: 'pty-1',
              cwd: '/tmp/project',
              agentType: 'codex',
              status: 'running',
              active: true,
            },
          ],
        }),
      ]}
      activeSessionId="sess-1"
      onSessionClick={vi.fn()}
      onFocusPane={onFocusPane}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: /codex.*running/i }))

  expect(onFocusPane).toHaveBeenCalledWith('sess-1', 'p1')
})
```

Adapt the `session(...)` fixture call to whatever builder `List.test.tsx` already uses. Add the same style of forwarding test to `SessionsView.test.tsx` with `hidden={false}`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/sessions/components/List.test.tsx src/features/workspace/components/SessionsView.test.tsx`
Expected: FAIL — unknown `onFocusPane` prop.

- [ ] **Step 3: Implement the threading**

`List.tsx` — extend `ListProps` (with `import type { ProgressSource } from '../../terminal/hooks/usePtyProgress'`):

```typescript
  progressSource?: ProgressSource
  onFocusPane?: (sessionId: string, paneId: string) => void
```

defaults `progressSource = undefined`, `onFocusPane = undefined`, and pass to the **active** group's `<Card />` only:

```tsx
notificationRecords = { notificationRecords }
progressSource = { progressSource }
onFocusPane = { onFocusPane }
```

(keep the existing `notificationCategory` prop as is; recent cards get nothing new).

`SessionsView.tsx` — the same two optional props on `SessionsViewProps` (same import path), same defaults, forwarded to `<List />`.

`WorkspaceView.tsx` — after the `handleSetActiveSessionId` definition (near line 1768), add:

```typescript
// Sidebar agent-row click: activate the session, then focus that pane.
const handleFocusSessionPane = useCallback(
  (sessionId: string, paneId: string): void => {
    handleSetActiveSessionId(sessionId)
    setSessionActivePane(sessionId, paneId)
  },
  [handleSetActiveSessionId, setSessionActivePane]
)
```

and extend the `<SessionsView />` usage (near line 3372):

```tsx
progressSource = { terminalService }
onFocusPane = { handleFocusSessionPane }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/sessions src/features/workspace/components/SessionsView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/sessions/components/List.tsx src/features/sessions/components/List.test.tsx src/features/workspace/components/SessionsView.tsx src/features/workspace/components/SessionsView.test.tsx src/features/workspace/WorkspaceView.tsx
git commit -m "feat(workspace): wire agent rows into the sessions sidebar"
```

---

### Task 7: full gate, live check, changelog

**Files:**

- Modify: `CHANGELOG.md`, `CHANGELOG.zh-CN.md` (new entry at the top of the current unreleased/latest section, matching the files' existing entry format)

- [ ] **Step 1: Run the full gate**

```bash
npm run lint
npm run format:check
npm run type-check
npx vitest run
```

Expected: all pass. Fix violations (run `npm run lint:fix` / `npm run format` if needed) and re-run until clean. Known flake: `read_loop_eof_marks_cache_exited` is Rust-side and unrelated. If codex review is run later, `git checkout -- src/bindings/` before trusting `format:check`.

- [ ] **Step 2: Live sanity check**

Run: `npm run dev` (or the Electron dev command if verifying against the sidecar), open the sidebar Sessions tab, start a session with an agent (e.g. `kimi`) plus a plain shell pane, and confirm: a recess panel with one row appears for the agent only; the ring spins while it works (including when only OSC progress is flowing) and flips to `✓` when the turn completes; the latest task message appears after a turn and `working on <dir>` shows before any; clicking the row focuses that pane; the row and panel disappear when the agent pane closes. Flip through Catppuccin, Flexoki, and the two extrapolated-value themes (tokyo-night or dracula, plus gruvbox-light) to verify the recess reads correctly.

- [ ] **Step 3: Changelog entries**

`CHANGELOG.md` (match surrounding format):

```markdown
- **Sidebar agent rows** — Active session cards now list the coding agents running in their panes (state chip + latest task message); clicking a row focuses that pane. (`feat/vim-423-session-card-agent-rows`)
```

`CHANGELOG.zh-CN.md`:

```markdown
- **侧边栏 agent 行** — Active 会话卡片现在会列出其 pane 中运行的编码 agent（状态徽标 + 最新任务消息）；点击某行即可聚焦对应 pane。（`feat/vim-423-session-card-agent-rows`）
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CHANGELOG.zh-CN.md
git commit -m "docs: changelog for sidebar agent rows"
```

- [ ] **Step 5: Pre-push review loop and PR**

Per repo convention: run `codex exec` review on the committed range (`codex review --base main` from the worktree, stdin redirected from `/dev/null`, proxy cleared), fix findings, iterate to 0 before push. Then push and open the PR with `/lifeline:request-pr` targeting `main`, and include the unformatted magic word `Closes VIM-423` in the PR body (direct-to-main PR → closing ref is correct per the Linear workflow).

---

## Self-review notes (already applied)

- Spec coverage: anatomy/state vocabulary/motion/a11y → Task 4; Decision 9 running-union (watcher ∪ OSC, idle-only upgrade, enabled only for running/idle rows) → Task 4 implementation + the two idle tests; recess token table → Task 3; derive/latest-record data + `working on <dir>` fallback → Tasks 1–2; Card/threading interactions incl. `progressSource` → Tasks 5–6; edge cases covered by derive-from-props design + Task 1/4 tests; handoff deltas (no status word, no right slot, no agent accents, no `ProgressBar`) hold — `usePtyProgress` feeds only the chip's running signal; v2 items deliberately absent.
- Type consistency: `SessionAgentEntry` fields (`paneId`, `ptyId`, `agent`, `status`, `label`) identical in Tasks 1/4; `onFocusPane(sessionId, paneId)` signature identical in Tasks 4–6; `ProgressSource` exported in Task 4 and imported in Tasks 5–6; `occurredAt` treated as epoch-ms number everywhere; chip state labels (`running` / `needs you` / `error` / `finished` / `idle`) match the spec table and the Task 4/5/6 test regexes.
