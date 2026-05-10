# Step 5a — Pane Model Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor session/pane data model so each `Session` owns `panes: Pane[]` + `layout`, with each `Pane` owning its own PTY-derived state (`ptyId`, `cwd`, `agentType`, `status`, `restoreData`, `pid`). Decompose `useSessionManager.ts` (~1247 LOC) into 5 sub-hooks with small interfaces hiding substantial implementation. No visual change; existing single-pane sessions migrate seamlessly.

**Architecture:** Per-session canvas (M3): workspace state holds only `sessions[]` + `activeSessionId`; each session holds its own layout + panes registry. Rust IPC unchanged — Rust treats `sessionId` AS the PTY handle, React-side `Pane.ptyId` carries that value. `Session.id` is an independent React UUID. Manager extracted into `useSessionRestore`, `usePtyBufferDrain`, `useActiveSessionController`, `useAutoCreateOnEmpty`, `usePtyExitListener`. `Session.workingDirectory` and `Session.agentType` stay as DERIVED materialized fields (not removed) so existing consumers (`Tab`, `Sidebar`, `WorkspaceView.activeCwd`, `agentForSession`) compile unchanged.

**Tech Stack:** TypeScript, React 19, Vitest + Testing Library (jsdom), Tauri 2 (no Rust changes). React-side only.

**Spec:** `docs/superpowers/specs/2026-05-10-step-5a-pane-model-refactor-design.md` (committed at `5a4a85b`).

---

## Codex-applied plan corrections (2026-05-10)

The plan-complete codex review surfaced 8 contract / ordering issues. Fixes are applied
inline at the affected tasks; this index is the audit trail:

1. **Task 8 — `Session.id` for restored sessions stays = ptyId** by design (backward
   compat with cached `active_session_id`). Fresh UUIDs are introduced in **Task 14**'s
   `createSession` ONLY. Restore never mutates ids.
2. **Task 8 — production constructors update atomically with the type change.** Steps
   `8.4` and `8.5` (added) update `createSession`, `restartSession`, and the `onPtyExit`
   handler in the SAME commit as the Session shape change so the build stays green.
   Behavior is preserved (no API renames yet — those are still Task 14).
3. **Task 11 — controller exposes `activeSessionIdRef`** in its return interface so
   Task 14's mutations can read the latest active id without reaching into manager
   internals. Step 3's `ActiveSessionController` interface updated.
4. **Task 12 — `notifyPaneReady` cleanup keeps the removed-pane guard.** The release
   callback consults a `isStillTracked(ptyId)` predicate before re-arming pending
   state, mirroring the existing `removeSession` race fix in current code.
5. **Task 13 — restore callbacks use refs, not closure values.** `useSessionRestore`'s
   wiring in the manager passes a callback that reads `active.activeSessionIdRef.current`
   inside the body, NOT the destructured `active.activeSessionId` (which captures stale
   `null`).
6. **Tasks 15 ↔ 16 swapped:** Task 16 (TerminalPane accepts `pane` prop) now precedes
   Task 15 (TerminalZone passes `pane`). Renumbered as **Task 15: TerminalPane**,
   **Task 16: TerminalZone** below.
7. **Task 14 placeholder tests filled in** with executable assertion bodies instead of
   `// ...` stubs.
8. **Verification commands use `set -o pipefail`** (or drop the `| tail` filter) so
   failing exit codes propagate. Updated in Task 0 + Task 20.

---

## Working Directory

**All work happens on branch `docs/step-5a-pane-model-spec`** (already created off main, contains the spec). After Task 0 confirms the baseline, all subsequent commits land on this branch.

```bash
cd /home/will/projects/vimeflow
git branch --show-current   # should print: docs/step-5a-pane-model-spec
```

---

## Regression Safety Net

The existing test suite must stay green at every task boundary. Most-touched files and their test counts (record baseline in Task 0):

- `src/features/sessions/hooks/useSessionManager.test.ts` — full session/PTY lifecycle coverage
- `src/features/workspace/components/TerminalZone.test.tsx`
- `src/features/terminal/components/TerminalPane/index.test.tsx`
- `src/features/terminal/components/TerminalPane/Body.test.tsx`
- `src/features/workspace/WorkspaceView*.test.tsx` (multiple files)

`pre-push` hook runs `vitest run` which gates every push. `npm run lint` enforces `test()` not `it()` and the `no-console` rule. `tsc -b` covers type safety; new types must compile end-to-end.

---

## Task 0: Baseline verification

Record current state so we detect drift later.

**Files:** none modified

- [ ] **Step 1: Confirm clean working tree on the spec branch**

```bash
git status
git branch --show-current
```

Expected: branch `docs/step-5a-pane-model-spec`. Working tree may have uncommitted changes under `docs/design/handoff/` — those are unrelated and stay untouched. No staged changes.

- [ ] **Step 2: Record baseline test count**

```bash
set -o pipefail; npm run test 2>&1 | tail -3
```

Record the `Tests` line (e.g. `Tests  1234 passed (1234)`). Each subsequent task's "verify tests pass" step must show ≥ this number.

> `set -o pipefail` is **required** so the pipeline's exit code reflects the
> upstream `npm run test` command. Without it, `tail` always exits 0 and a
> failing test run looks successful at the gate. Apply this pattern to every
> piped verification command in this plan.

- [ ] **Step 3: Record baseline lint + type-check**

```bash
npm run lint 2>&1 | tail -3
npm run type-check 2>&1 | tail -3
```

Both must exit clean. Expected: `0 errors, 0 warnings` for lint; `tsc -b` produces no output on success.

---

## Task 1: Extract `emptyActivity` constant

**Files:**

- Create: `src/features/sessions/constants.ts`
- Modify: `src/features/sessions/hooks/useSessionManager.ts`
- Test: `src/features/sessions/constants.test.ts`

- [ ] **Step 1: Write the test for the new constant**

```ts
// src/features/sessions/constants.test.ts
import { describe, expect, test } from 'vitest'
import { emptyActivity } from './constants'

describe('emptyActivity', () => {
  test('produces a fresh AgentActivity skeleton with zeroed counters', () => {
    expect(emptyActivity.fileChanges).toEqual([])
    expect(emptyActivity.toolCalls).toEqual([])
    expect(emptyActivity.testResults).toEqual([])
    expect(emptyActivity.contextWindow.percentage).toBe(0)
    expect(emptyActivity.usage.turnCount).toBe(0)
  })

  test('returns the same reference (not a factory)', () => {
    // Callers must spread it: `{ ...emptyActivity }` — this test pins the
    // contract so a future refactor doesn't silently mutate shared state.
    const a = emptyActivity
    const b = emptyActivity
    expect(a).toBe(b)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/features/sessions/constants.test.ts
```

Expected: FAIL with module-not-found error on `./constants`.

- [ ] **Step 3: Create the constants module**

```ts
// src/features/sessions/constants.ts
import type { AgentActivity } from './types'

/** Frozen template for a fresh AgentActivity. Callers MUST clone via
 *  `{ ...emptyActivity }` rather than mutate this reference. */
export const emptyActivity: AgentActivity = {
  fileChanges: [],
  toolCalls: [],
  testResults: [],
  contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
  usage: {
    sessionDuration: 0,
    turnCount: 0,
    messages: { sent: 0, limit: 200 },
    tokens: { input: 0, output: 0, total: 0 },
  },
}
```

- [ ] **Step 4: Update useSessionManager.ts to import the constant**

In `src/features/sessions/hooks/useSessionManager.ts`, find the local `emptyActivity` constant (currently lines ~11-22) and DELETE it. Add at the top of the file:

```ts
import { emptyActivity } from '../constants'
```

- [ ] **Step 5: Run all sessions tests to verify no regression**

```bash
npx vitest run src/features/sessions/
```

Expected: PASS (all existing useSessionManager tests + new constants test).

- [ ] **Step 6: Commit**

```bash
git add src/features/sessions/constants.ts src/features/sessions/constants.test.ts src/features/sessions/hooks/useSessionManager.ts
git commit -m "refactor(sessions): extract emptyActivity constant

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extract `tabName` utility

**Files:**

- Create: `src/features/sessions/utils/tabName.ts`
- Create: `src/features/sessions/utils/tabName.test.ts`
- Modify: `src/features/sessions/hooks/useSessionManager.ts`

- [ ] **Step 1: Write the test for tabName**

```ts
// src/features/sessions/utils/tabName.test.ts
import { describe, expect, test } from 'vitest'
import { tabName } from './tabName'

describe('tabName', () => {
  test('returns last cwd segment for absolute path', () => {
    expect(tabName('/home/will/projects/vimeflow', 0)).toBe('vimeflow')
  })

  test('returns "session N+1" for ~ alias', () => {
    expect(tabName('~', 2)).toBe('session 3')
  })

  test('returns "session N+1" for empty cwd', () => {
    expect(tabName('', 0)).toBe('session 1')
  })

  test('handles trailing slashes', () => {
    expect(tabName('/home/will/repo/', 0)).toBe('repo')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/features/sessions/utils/tabName.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Create the utility**

```ts
// src/features/sessions/utils/tabName.ts

/** Derive a human-readable tab name from a cwd. Falls back to a stable
 *  index-based name when the cwd is empty or the home alias `~`. */
export const tabName = (cwd: string, index: number): string => {
  if (cwd === '~') {
    return `session ${index + 1}`
  }
  const parts = cwd.split('/').filter(Boolean)
  return parts[parts.length - 1] || `session ${index + 1}`
}
```

- [ ] **Step 4: Update useSessionManager.ts to import**

In `src/features/sessions/hooks/useSessionManager.ts`, find the local `function tabName(cwd: string, index: number): string` (currently around lines 24-31) and DELETE it. Add to the existing import block:

```ts
import { tabName } from '../utils/tabName'
```

- [ ] **Step 5: Run sessions tests + new tabName test**

```bash
npx vitest run src/features/sessions/utils/tabName.test.ts src/features/sessions/hooks/useSessionManager.test.ts
```

Expected: PASS for both.

- [ ] **Step 6: Commit**

```bash
git add src/features/sessions/utils/tabName.ts src/features/sessions/utils/tabName.test.ts src/features/sessions/hooks/useSessionManager.ts
git commit -m "refactor(sessions): extract tabName utility

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add `LayoutId` + `Pane` types (no consumers yet)

The types land first as additive interfaces. Subsequent tasks update `Session` and consumers to use them.

**Files:**

- Modify: `src/features/sessions/types/index.ts`
- Test: `src/features/sessions/types/index.test.ts`

- [ ] **Step 1: Add type-shape tests**

In `src/features/sessions/types/index.test.ts`, add (do not replace existing tests):

```ts
import type { LayoutId, Pane, Session } from './index'

test('LayoutId enumerates the five canonical layouts', () => {
  const ids: LayoutId[] = ['single', 'vsplit', 'hsplit', 'threeRight', 'quad']
  expect(ids).toHaveLength(5)
})

test('Pane has the documented fields', () => {
  const pane: Pane = {
    id: 'p0',
    ptyId: 'pty-abc-123',
    cwd: '/home/will/repo',
    agentType: 'claude-code',
    status: 'running',
    active: true,
    pid: 12345,
    restoreData: undefined,
  }
  expect(pane.id).toBe('p0')
  expect(pane.active).toBe(true)
})

test('Session keeps workingDirectory and agentType (derived materialized fields)', () => {
  // Compile-time check: these fields must still exist on Session for
  // backward-compat with Tab, Sidebar, WorkspaceView consumers.
  const session: Pick<Session, 'workingDirectory' | 'agentType'> = {
    workingDirectory: '/home/will/repo',
    agentType: 'claude-code',
  }
  expect(session.workingDirectory).toBe('/home/will/repo')
})
```

- [ ] **Step 2: Run the test to verify the new ones fail**

```bash
npx vitest run src/features/sessions/types/index.test.ts
```

Expected: FAIL on the LayoutId / Pane imports (types don't exist yet).

- [ ] **Step 3: Add the types to `index.ts`**

In `src/features/sessions/types/index.ts`, after the existing `SessionStatus` declaration (line 3) add:

```ts
export type LayoutId = 'single' | 'vsplit' | 'hsplit' | 'threeRight' | 'quad'

export interface Pane {
  /** Session-scoped pane id, e.g. `'p0'`, `'p1'`. Stable across renders;
   *  used to address the pane within `Session.panes`. NOT a Rust handle. */
  id: string

  /** Rust PTY handle. Equals what the Rust IPC layer calls `sessionId` on
   *  the wire. Used for every PTY operation (kill, write, resize, restart,
   *  cwd_change, etc.). */
  ptyId: string

  /** Per-pane working directory. Drives chrome's `useGitBranch(pane.cwd)`
   *  and `useGitStatus(pane.cwd)`. Updated on OSC 7 events. */
  cwd: string

  /** Detected agent CLI for this pane, set by the agent-status detector
   *  (per-PTY). Reset to `'generic'` on PTY exit. */
  agentType: 'claude-code' | 'codex' | 'aider' | 'generic'

  /** Materialized pane status. Set at well-defined lifecycle transitions:
   *  'running' at create/restart/restore-Alive; 'completed' at PTY exit /
   *  restore-Exited. Does NOT continuously mirror useTerminal status. */
  status: SessionStatus

  /** Restoration buffer for buffered-event drain. Populated at restore
   *  time and on createSession; consumed by Body when it mounts. */
  restoreData?: import('../hooks/useSessionManager').RestoreData

  /** OS process id of the PTY (was Session.terminalPid?). Optional. */
  pid?: number

  /** Exactly one pane per session has `active === true`. */
  active: boolean
}
```

Do NOT modify `Session` yet — that comes in Task 8. The existing Session interface (with `workingDirectory`, `agentType`, `terminalPid?`) is unchanged in this task.

- [ ] **Step 4: Run the type tests**

```bash
npx vitest run src/features/sessions/types/index.test.ts
```

Expected: PASS for all (including the new ones).

- [ ] **Step 5: Confirm the rest of the project still type-checks**

```bash
npm run type-check 2>&1 | tail -3
```

Expected: clean (no new TS errors — the new types have no consumers yet).

- [ ] **Step 6: Commit**

```bash
git add src/features/sessions/types/index.ts src/features/sessions/types/index.test.ts
git commit -m "feat(sessions): add Pane and LayoutId types (no consumers yet)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Move PTY orchestration types to `terminal/types`

`RestoreData`, `PaneEventHandler`, and `NotifyPaneReadyResult` belong with the terminal feature, not the session manager.

**Files:**

- Modify: `src/features/terminal/types/index.ts` (extend)
- Modify: `src/features/sessions/hooks/useSessionManager.ts` (re-export for backward compat)
- Modify: `src/features/sessions/types/index.ts` (fix the temporary import in Pane)

- [ ] **Step 1: Move types into terminal/types/index.ts**

Append to `src/features/terminal/types/index.ts`:

```ts
/** Restoration data per PTY, populated at mount-time restore and on
 *  createSession. Consumed by `<TerminalPane>` Body when it mounts. */
export interface RestoreData {
  sessionId: string // ptyId on the wire
  cwd: string
  pid: number
  replayData: string
  replayEndOffset: number
  bufferedEvents: { data: string; offsetStart: number; byteLen: number }[]
}

/** Handler that receives a buffered PTY event during pane drain. */
export type PaneEventHandler = (
  data: string,
  offsetStart: number,
  byteLen: number
) => void

/** Cleanup callback returned by `notifyPaneReady` — call on pane unmount. */
export type NotifyPaneReadyResult = () => void
```

- [ ] **Step 2: Update Pane.restoreData to use the new path**

In `src/features/sessions/types/index.ts`, replace:

```ts
restoreData?: import('../hooks/useSessionManager').RestoreData
```

with:

```ts
restoreData?: import('../../terminal/types').RestoreData
```

- [ ] **Step 3: Update useSessionManager.ts**

In `src/features/sessions/hooks/useSessionManager.ts`, find the `RestoreData`, `PaneEventHandler`, `NotifyPaneReadyResult` declarations (currently lines ~47-75). REMOVE them. Add at the top of the file:

```ts
import type {
  RestoreData,
  PaneEventHandler,
  NotifyPaneReadyResult,
} from '../../terminal/types'

// Re-export for backward compat — external consumers may have imported these.
export type { RestoreData, PaneEventHandler, NotifyPaneReadyResult }
```

- [ ] **Step 4: Run the affected test files**

```bash
npx vitest run src/features/sessions src/features/terminal/types
```

Expected: PASS.

- [ ] **Step 5: Type-check the project**

```bash
npm run type-check 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/terminal/types/index.ts src/features/sessions/hooks/useSessionManager.ts src/features/sessions/types/index.ts
git commit -m "refactor(terminal): move RestoreData/PaneEventHandler types to terminal/types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Extract `sessionStatus` derive utility

Pure function: aggregate `Session.status` from `Pane[]`. Lands now (no consumers yet — used in Task 8 onward).

**Files:**

- Create: `src/features/sessions/utils/sessionStatus.ts`
- Create: `src/features/sessions/utils/sessionStatus.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// src/features/sessions/utils/sessionStatus.test.ts
import { describe, expect, test } from 'vitest'
import type { Pane } from '../types'
import { deriveSessionStatus } from './sessionStatus'

const pane = (status: Pane['status']): Pane => ({
  id: 'p0',
  ptyId: 'pty-x',
  cwd: '/x',
  agentType: 'generic',
  status,
  active: true,
})

describe('deriveSessionStatus', () => {
  test('any running pane → running', () => {
    expect(deriveSessionStatus([pane('running'), pane('completed')])).toBe(
      'running'
    )
  })

  test('no running but any errored → errored', () => {
    expect(deriveSessionStatus([pane('errored'), pane('completed')])).toBe(
      'errored'
    )
  })

  test('all completed → completed', () => {
    expect(deriveSessionStatus([pane('completed'), pane('completed')])).toBe(
      'completed'
    )
  })

  test('mix of paused and completed without errored → paused', () => {
    expect(deriveSessionStatus([pane('paused'), pane('completed')])).toBe(
      'paused'
    )
  })

  test('single pane proxies its status', () => {
    expect(deriveSessionStatus([pane('running')])).toBe('running')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/features/sessions/utils/sessionStatus.test.ts
```

Expected: FAIL on missing module.

- [ ] **Step 3: Implement**

```ts
// src/features/sessions/utils/sessionStatus.ts
import type { Pane, SessionStatus } from '../types'

/** Aggregate a session's status from its panes. See spec §1 "Session.status". */
export const deriveSessionStatus = (panes: Pane[]): SessionStatus => {
  if (panes.some((p) => p.status === 'running')) return 'running'
  if (panes.some((p) => p.status === 'errored')) return 'errored'
  if (panes.every((p) => p.status === 'completed')) return 'completed'

  return 'paused'
}
```

- [ ] **Step 4: Verify tests pass**

```bash
npx vitest run src/features/sessions/utils/sessionStatus.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/sessions/utils/sessionStatus.ts src/features/sessions/utils/sessionStatus.test.ts
git commit -m "feat(sessions): add deriveSessionStatus pure utility

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Extract `getActivePane` invariant utility

Asserts the exactly-one invariant from Decision #7 and returns the active pane. Throws on violations so write-site bugs surface immediately.

**Files:**

- Create: `src/features/sessions/utils/activeSessionPane.ts`
- Create: `src/features/sessions/utils/activeSessionPane.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// src/features/sessions/utils/activeSessionPane.test.ts
import { describe, expect, test } from 'vitest'
import type { Pane, Session } from '../types'
import { getActivePane } from './activeSessionPane'

const pane = (id: string, active: boolean): Pane => ({
  id,
  ptyId: `pty-${id}`,
  cwd: '/x',
  agentType: 'generic',
  status: 'running',
  active,
})

const session = (panes: Pane[]): Session => ({
  id: 'sess-1',
  projectId: 'proj-1',
  name: 'auth refactor',
  status: 'running',
  workingDirectory: '/x',
  agentType: 'generic',
  panes,
  layout: 'single',
  createdAt: '2026-05-10T00:00:00Z',
  lastActivityAt: '2026-05-10T00:00:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 200 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
})

describe('getActivePane', () => {
  test('returns the single active pane', () => {
    const s = session([pane('p0', true), pane('p1', false)])
    expect(getActivePane(s).id).toBe('p0')
  })

  test('throws when zero panes are active', () => {
    const s = session([pane('p0', false), pane('p1', false)])
    expect(() => getActivePane(s)).toThrow(/exactly one active pane/)
  })

  test('throws when more than one pane is active', () => {
    const s = session([pane('p0', true), pane('p1', true)])
    expect(() => getActivePane(s)).toThrow(/exactly one active pane/)
  })

  test('throws when panes is empty', () => {
    const s = session([])
    expect(() => getActivePane(s)).toThrow(/at least one pane/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/features/sessions/utils/activeSessionPane.test.ts
```

Expected: FAIL — module-not-found AND `Session` type doesn't yet have `panes`/`layout`. We'll fix the type in Task 8; for now the test stub uses the future shape, so this expected red is across both axes.

> **Note:** This test will continue failing until Task 8 lands the `Session.panes` field. Treat the FAIL as expected and verify the assertion-error messages are correct by reading the implementation in Step 3. Once Task 8 lands, re-run.

- [ ] **Step 3: Implement**

```ts
// src/features/sessions/utils/activeSessionPane.ts
import type { Pane, Session } from '../types'

/** Return the active pane in a session. Throws on invariant violations
 *  (zero panes, zero active, or more than one active) — these are write-site
 *  bugs to fix, not states to silently absorb. See spec §1 Decision #7. */
export const getActivePane = (session: Session): Pane => {
  if (session.panes.length === 0) {
    throw new Error(
      `getActivePane: session ${session.id} has at least one pane invariant violated (panes.length === 0)`
    )
  }
  const actives = session.panes.filter((p) => p.active)
  if (actives.length !== 1) {
    throw new Error(
      `getActivePane: session ${session.id} must have exactly one active pane (found ${actives.length})`
    )
  }

  return actives[0]
}
```

- [ ] **Step 4: Re-run test (still expected to FAIL until Task 8)**

```bash
npx vitest run src/features/sessions/utils/activeSessionPane.test.ts
```

Expected: FAIL because `Session.panes` / `Session.layout` don't exist yet. The test compiles only after Task 8.

- [ ] **Step 5: Commit (skipped tests note)**

The util lands now, tests will green after Task 8. Commit with a note in the message:

```bash
git add src/features/sessions/utils/activeSessionPane.ts src/features/sessions/utils/activeSessionPane.test.ts
git commit -m "feat(sessions): add getActivePane invariant utility

Tests will fail until Task 8 adds Session.panes/layout. Util lands now
so Task 8 has it available.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> **Pre-push hook will block this commit.** Either skip the failing test temporarily with `test.skip(...)` then unskip in Task 8, OR run Task 7 + Task 8 first and revisit Task 6 after. The recommended approach: rewrite the tests in Step 1 above using a minimal hand-rolled `Session`-like type for now, then update them in Task 8 to use the real `Session` import. See **Task 6 alternative** below.

### Task 6 alternative — defer real-Session import to Task 8

Replace Step 1's test fixtures to use a local minimal type so the test compiles before `Session.panes` lands:

```ts
// src/features/sessions/utils/activeSessionPane.test.ts (alternative)
import { describe, expect, test } from 'vitest'

interface MockSession {
  id: string
  panes: { id: string; active: boolean }[]
}

import { getActivePane } from './activeSessionPane'

// Use `as unknown as Session` casts — Task 8 replaces this with the real
// Session import.
test('returns the single active pane', () => {
  const s = {
    id: 's',
    panes: [
      { id: 'p0', active: true },
      { id: 'p1', active: false },
    ],
  }
  expect(getActivePane(s as unknown as import('../types').Session).id).toBe(
    'p0'
  )
})
// ... (same shape for the other three cases)
```

Use the alternative if pre-push blocks — it sidesteps the staged-types problem.

---

## Task 7: Extract `sessionFromInfo` (current Session shape)

Extract the helper as-is (no panes yet) — Task 9 updates it to produce `panes[]`.

**Files:**

- Create: `src/features/sessions/utils/sessionFromInfo.ts`
- Create: `src/features/sessions/utils/sessionFromInfo.test.ts`
- Modify: `src/features/sessions/hooks/useSessionManager.ts`

- [ ] **Step 1: Write the tests for the current behavior**

```ts
// src/features/sessions/utils/sessionFromInfo.test.ts
import { describe, expect, test } from 'vitest'
import type { SessionInfo } from '../../../bindings'
import { sessionFromInfo } from './sessionFromInfo'

const aliveInfo = (id: string, cwd: string): SessionInfo => ({
  id,
  cwd,
  status: { kind: 'Alive', pid: 1234, replay_data: '', replay_end_offset: 0 },
})

describe('sessionFromInfo (pre-pane shape)', () => {
  test('produces a Session with id from info.id, status running for Alive', () => {
    const session = sessionFromInfo(aliveInfo('pty-1', '/home/will/repo'), 0)
    expect(session.id).toBe('pty-1')
    expect(session.status).toBe('running')
    expect(session.workingDirectory).toBe('/home/will/repo')
    expect(session.name).toBe('repo')
    expect(session.agentType).toBe('generic')
  })

  test('produces a Session with status completed for non-Alive', () => {
    const info: SessionInfo = {
      id: 'pty-2',
      cwd: '/x',
      status: { kind: 'Exited' },
    }
    const session = sessionFromInfo(info, 0)
    expect(session.status).toBe('completed')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/features/sessions/utils/sessionFromInfo.test.ts
```

Expected: FAIL on missing module.

- [ ] **Step 3: Implement (current Session shape, Task 9 will add panes)**

```ts
// src/features/sessions/utils/sessionFromInfo.ts
import type { SessionInfo } from '../../../bindings'
import type { Session } from '../types'
import { emptyActivity } from '../constants'
import { tabName } from './tabName'

/** Build a `Session` from a Rust `SessionInfo`. Current shape (no panes yet);
 *  Task 9 in the 5a refactor plan extends this to populate `panes[0]`. */
export const sessionFromInfo = (info: SessionInfo, index: number): Session => ({
  id: info.id,
  projectId: 'proj-1',
  name: tabName(info.cwd, index),
  status: info.status.kind === 'Alive' ? 'running' : 'completed',
  workingDirectory: info.cwd,
  agentType: 'generic',
  createdAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  activity: { ...emptyActivity },
})
```

- [ ] **Step 4: Update useSessionManager.ts to import**

In `src/features/sessions/hooks/useSessionManager.ts`, find the local `function sessionFromInfo(...)` (lines ~33-45) and DELETE it. Add to imports:

```ts
import { sessionFromInfo } from '../utils/sessionFromInfo'
```

- [ ] **Step 5: Run all sessions tests**

```bash
npx vitest run src/features/sessions/
```

Expected: PASS for all (including the new sessionFromInfo test).

- [ ] **Step 6: Commit**

```bash
git add src/features/sessions/utils/sessionFromInfo.ts src/features/sessions/utils/sessionFromInfo.test.ts src/features/sessions/hooks/useSessionManager.ts
git commit -m "refactor(sessions): extract sessionFromInfo helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Add `panes[]` + `layout` to `Session`, update `sessionFromInfo`

This is the data-model breaking change. `Session` gains `panes` + `layout`; `terminalPid?` is removed; `workingDirectory`/`agentType` STAY (now derived materialized fields). `sessionFromInfo` is extended to produce a 1-pane Session.

**Files:**

- Modify: `src/features/sessions/types/index.ts`
- Modify: `src/features/sessions/utils/sessionFromInfo.ts`
- Modify: `src/features/sessions/utils/sessionFromInfo.test.ts`
- Modify: `src/features/sessions/utils/activeSessionPane.test.ts` (un-skip if alternative was used)
- Possibly modify: callers reading `session.terminalPid` (grep first)

- [ ] **Step 1: Audit consumers of Session.terminalPid**

```bash
grep -rn "\.terminalPid" src/ src-tauri/ 2>&1 | grep -v "\.test\."
```

If results: update each consumer to read from a non-removed source (e.g., agent-status panel may need `pane.pid` post-Task 9, or skip the field — note it stays undefined in current code so most consumers should already handle absence). If zero results: safe to remove.

- [ ] **Step 2: Modify Session interface**

In `src/features/sessions/types/index.ts`, replace the `Session` interface with:

```ts
export interface Session {
  id: string
  projectId: string
  name: string

  /** Aggregate status. Derived from `panes[]` per
   *  `src/features/sessions/utils/sessionStatus.ts`. Materialized for
   *  sidebar/tab-strip rendering speed. */
  status: SessionStatus

  /** Derived from `getActivePane(session).cwd` — kept on Session as a
   *  materialized field so existing consumers (Tab, Sidebar, WorkspaceView)
   *  continue to read `session.workingDirectory` unchanged. Updated by
   *  `useSessionManager` whenever the active pane's cwd changes or the
   *  active flag rotates between panes. */
  workingDirectory: string

  /** Derived from `getActivePane(session).agentType` — same materialization
   *  pattern. */
  agentType: 'claude-code' | 'codex' | 'aider' | 'generic'

  /** Per-session canvas layout. Default 'single' on createSession. */
  layout: LayoutId

  /** ≥1 pane per session (Decision #3). Created with one entry by
   *  `createSession`. */
  panes: Pane[]

  /** Existing field — retained at session level. Aggregated across panes
   *  (most-recent action wins). */
  currentAction?: string

  createdAt: string
  lastActivityAt: string
  activity: AgentActivity
}
```

Note: `terminalPid?` is REMOVED (moved to `Pane.pid?`).

- [ ] **Step 3: Update sessionFromInfo to produce panes**

```ts
// src/features/sessions/utils/sessionFromInfo.ts
import type { SessionInfo } from '../../../bindings'
import type { Pane, Session } from '../types'
import { emptyActivity } from '../constants'
import { tabName } from './tabName'

export const sessionFromInfo = (info: SessionInfo, index: number): Session => {
  const isAlive = info.status.kind === 'Alive'
  const status = isAlive ? 'running' : 'completed'

  const pane: Pane = {
    id: 'p0',
    ptyId: info.id,
    cwd: info.cwd,
    agentType: 'generic',
    status,
    active: true,
    pid: isAlive ? info.status.pid : undefined,
    restoreData: isAlive
      ? {
          sessionId: info.id,
          cwd: info.cwd,
          pid: info.status.pid,
          replayData: info.status.replay_data,
          replayEndOffset: Number(info.status.replay_end_offset),
          bufferedEvents: [],
        }
      : undefined,
  }

  return {
    id: info.id, // Note: matches existing 1:1 mapping. Task 11
    // generalizes to fresh UUIDs in createSession path
    // for new sessions; restore keeps id===ptyId for
    // backward compat with cached active_session_id.
    projectId: 'proj-1',
    name: tabName(info.cwd, index),
    status,
    layout: 'single',
    panes: [pane],
    workingDirectory: info.cwd,
    agentType: 'generic',
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    activity: { ...emptyActivity },
  }
}
```

- [ ] **Step 4: Update sessionFromInfo tests**

In `src/features/sessions/utils/sessionFromInfo.test.ts`, add tests for the new pane structure:

```ts
test('Alive info produces a session with one running pane', () => {
  const session = sessionFromInfo(aliveInfo('pty-1', '/home/will/repo'), 0)
  expect(session.panes).toHaveLength(1)
  expect(session.panes[0].id).toBe('p0')
  expect(session.panes[0].ptyId).toBe('pty-1')
  expect(session.panes[0].active).toBe(true)
  expect(session.panes[0].status).toBe('running')
  expect(session.panes[0].restoreData).toBeDefined()
  expect(session.panes[0].restoreData?.pid).toBe(1234)
  expect(session.layout).toBe('single')
})

test('Exited info produces a session with one completed pane and no restoreData', () => {
  const info: SessionInfo = {
    id: 'pty-2',
    cwd: '/x',
    status: { kind: 'Exited' },
  }
  const session = sessionFromInfo(info, 0)
  expect(session.panes).toHaveLength(1)
  expect(session.panes[0].status).toBe('completed')
  expect(session.panes[0].restoreData).toBeUndefined()
})
```

- [ ] **Step 5: Un-skip the activeSessionPane tests (if alternative was used)**

If Task 6 used the `MockSession` alternative, replace the test imports in `src/features/sessions/utils/activeSessionPane.test.ts` to use the real `Session` type (the imports from `../types` should now compile against the new shape).

- [ ] **Step 6: Run full type-check + sessions tests**

```bash
npm run type-check 2>&1 | tail -10
```

Expected: TypeScript will surface every consumer of `Session.panes` / `Session.layout` that needs updating. List them.

```bash
npx vitest run src/features/sessions/
```

Expected: PASS for sessions/ tests; FAIL for any tests that build a Session-shaped fixture without panes/layout — those must add the fields.

- [ ] **Step 7: Update test fixtures across the project**

For each test file that constructs a hand-rolled `Session` literal (find via type-check errors from Step 6), add `panes: [{ id: 'p0', ptyId: <id>, cwd: <cwd>, agentType: 'generic', status: 'running', active: true }]` and `layout: 'single'` so it conforms.

Common locations (from current grep):

- `src/features/sessions/utils/agentForSession.test.ts`
- `src/features/sessions/types/index.test.ts`
- `src/features/sessions/components/*.test.tsx`
- `src/features/workspace/WorkspaceView.test.tsx` and friends
- `src/features/workspace/components/TerminalZone.test.tsx`

Use a shared test helper if many files repeat the same fixture:

```ts
// src/features/sessions/test-helpers/buildSession.ts (new)
export const buildSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'sess-1',
  projectId: 'proj-1',
  name: 'test',
  status: 'running',
  workingDirectory: '/x',
  agentType: 'generic',
  layout: 'single',
  panes: [
    {
      id: 'p0',
      ptyId: 'pty-1',
      cwd: '/x',
      agentType: 'generic',
      status: 'running',
      active: true,
    },
  ],
  createdAt: '2026-05-10T00:00:00Z',
  lastActivityAt: '2026-05-10T00:00:00Z',
  activity: { ...emptyActivity },
  ...overrides,
})
```

- [ ] **Step 8: Run the full test suite**

```bash
npm run test 2>&1 | tail -3
```

Expected: every test passes (count ≥ baseline from Task 0).

- [ ] **Step 9: Update production constructors so the build stays green**

Per **Codex correction #2** at the top of this plan: changing `Session` shape
breaks `createSession` and `restartSession` immediately because they
literally construct Session objects without `panes`/`layout`. Update them
NOW (in this commit) — but PRESERVE existing behavior. NEW behaviors (fresh
UUIDs, kill-failure bailout, method renames) still wait until Task 14.

In `src/features/sessions/hooks/useSessionManager.ts`:

**`createSession`** — replace the inner `setSessions((prev) => { const newSession = {...} })`
literal with a panes-shaped one. Critical: keep `id: result.sessionId` (NOT a
fresh UUID — Task 14 introduces that). Keep all existing IPC + reorder logic
unchanged.

```ts
const newSession: Session = {
  id: result.sessionId, // unchanged behavior; Task 14 swaps to UUID
  projectId: 'proj-1',
  name: `session ${prev.length + 1}`,
  status: 'running',
  workingDirectory: result.cwd,
  agentType: 'generic',
  layout: 'single',
  panes: [
    {
      id: 'p0',
      ptyId: result.sessionId,
      cwd: result.cwd,
      agentType: 'generic',
      status: 'running',
      active: true,
      pid: result.pid,
      restoreData: {
        sessionId: result.sessionId,
        cwd: result.cwd,
        pid: result.pid,
        replayData: '',
        replayEndOffset: 0,
        bufferedEvents: [],
      },
    },
  ],
  createdAt: now,
  lastActivityAt: now,
  activity: { ...emptyActivity },
}
```

**`restartSession`** — find the `setSessions` updater that replaces the
restarted session entry. Update the literal to also rotate `panes[0].ptyId`

- reset `panes[0].agentType` + populate `panes[0].restoreData`:

```ts
next[idx] = {
  ...prev[idx],
  id: result.sessionId, // existing behavior preserved
  status: 'running',
  workingDirectory: result.cwd, // (was unchanged; cwd stays the active pane's cwd)
  agentType: 'generic',
  lastActivityAt: new Date().toISOString(),
  panes: [
    {
      ...prev[idx].panes[0],
      ptyId: result.sessionId,
      cwd: result.cwd,
      status: 'running',
      agentType: 'generic',
      pid: result.pid,
      restoreData: {
        sessionId: result.sessionId,
        cwd: result.cwd,
        pid: result.pid,
        replayData: '',
        replayEndOffset: 0,
        bufferedEvents: [],
      },
    },
  ],
}
```

**`onExit` (the existing useEffect at lines ~370-386 OR Task 9's ref body if
already extracted)** — flip both `Session.status` AND the active pane's
status:

```ts
setSessions((prev) =>
  prev.map((s) => {
    if (s.panes[0]?.ptyId !== sessionId) return s
    const newPane: Pane = {
      ...s.panes[0],
      status: 'completed',
      agentType: 'generic',
    }
    return {
      ...s,
      status: 'completed',
      agentType: 'generic',
      panes: [newPane],
      lastActivityAt: exitedAt,
    }
  })
)
```

> Single-pane is still the only shape in 5a (Decision #8), so the `panes[0]`
> shortcut is safe. Task 14 generalizes to `panes.findIndex` for multi-pane.

- [ ] **Step 10: Run the full test suite**

```bash
set -o pipefail; npm run test 2>&1 | tail -3
```

Expected: all tests pass (count ≥ baseline from Task 0).

- [ ] **Step 11: Commit**

```bash
git add src/features/sessions/
git commit -m "feat(sessions): add Session.panes + layout, derive workingDirectory and agentType

Session gains panes: Pane[] + layout: LayoutId. terminalPid? is removed
(moves to Pane.pid?). workingDirectory and agentType stay as derived
materialized fields (matched to active pane). sessionFromInfo extended
to produce a single 'p0' pane per restored session.

Production constructors (createSession, restartSession, onExit handler)
updated atomically: they now construct Session objects with panes[0]
populated from the spawn result. Behavior preserved — Session.id still
equals the spawn ptyId (Task 14 introduces the fresh-UUID rule).

All Session-shaped test fixtures across the project updated to include
the new fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Extract `usePtyExitListener` hook

Smallest of the 5 sub-hooks; good warm-up. Lifts the `service.onExit` subscription out of `useSessionManager` into its own hook.

**Files:**

- Create: `src/features/terminal/hooks/usePtyExitListener.ts`
- Create: `src/features/terminal/hooks/usePtyExitListener.test.ts`
- Modify: `src/features/sessions/hooks/useSessionManager.ts`

- [ ] **Step 1: Write the test**

```ts
// src/features/terminal/hooks/usePtyExitListener.test.ts
import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ITerminalService } from '../services/terminalService'
import { usePtyExitListener } from './usePtyExitListener'

const buildMockService = (): {
  service: ITerminalService
  fireExit: (sid: string) => void
  unsubscribed: () => boolean
} => {
  let cb: ((sid: string) => void) | null = null
  let unsubbed = false

  return {
    service: {
      onExit: (callback) => {
        cb = callback
        return () => {
          unsubbed = true
        }
      },
    } as unknown as ITerminalService,
    fireExit: (sid) => cb?.(sid),
    unsubscribed: () => unsubbed,
  }
}

describe('usePtyExitListener', () => {
  test('subscribes to service.onExit and forwards ptyId to onExit callback', () => {
    const { service, fireExit } = buildMockService()
    const onExit = vi.fn()
    renderHook(() => usePtyExitListener({ service, onExit }))

    fireExit('pty-1')
    expect(onExit).toHaveBeenCalledWith('pty-1')
  })

  test('unsubscribes on unmount', () => {
    const { service, unsubscribed } = buildMockService()
    const { unmount } = renderHook(() =>
      usePtyExitListener({ service, onExit: vi.fn() })
    )
    expect(unsubscribed()).toBe(false)
    unmount()
    expect(unsubscribed()).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/features/terminal/hooks/usePtyExitListener.test.ts
```

Expected: FAIL on missing module.

- [ ] **Step 3: Implement**

```ts
// src/features/terminal/hooks/usePtyExitListener.ts
import { useEffect } from 'react'
import type { ITerminalService } from '../services/terminalService'

export interface UsePtyExitListenerOptions {
  service: ITerminalService
  /** Called with the ptyId of the exited PTY. The caller is responsible for
   *  generating any side timestamp (the underlying service event has none). */
  onExit: (ptyId: string) => void
}

/** Subscribe to PTY-exit events for the lifetime of the consumer.
 *  Translates `service.onExit` → caller's `onExit(ptyId)`. */
export const usePtyExitListener = ({
  service,
  onExit,
}: UsePtyExitListenerOptions): void => {
  useEffect(() => {
    const unsubscribe = service.onExit((sessionId) => {
      onExit(sessionId)
    })
    return (): void => {
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service])
  // Note: onExit is intentionally outside the deps array — the manager
  // recreates onExit on every render (it closes over setSessions).
  // Subscribing on every render would tear down + re-attach the underlying
  // service listener constantly. Stable-ref pattern via useRef inside
  // useSessionManager keeps the closure fresh while the subscription stays put.
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/features/terminal/hooks/usePtyExitListener.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire into useSessionManager**

In `src/features/sessions/hooks/useSessionManager.ts`, find the existing `useEffect(() => { const unsubscribeExit = service.onExit(...) ... })` block (currently lines ~370-386). REPLACE that block with:

```ts
import { usePtyExitListener } from '../../terminal/hooks/usePtyExitListener'

// Inside the manager, replace the useEffect block:
const onPtyExitRef = useRef<(ptyId: string) => void>(() => {})
onPtyExitRef.current = (ptyId: string): void => {
  const exitedAt = new Date().toISOString()
  setSessions((prev) =>
    prev.map((s) =>
      s.id === ptyId
        ? { ...s, status: 'completed', lastActivityAt: exitedAt }
        : s
    )
  )
  // NOTE: Task 11 generalizes this to find by pane.ptyId across all
  // panes, since 5a doesn't yet have multi-pane sessions but the model
  // supports them.
}

usePtyExitListener({
  service,
  onExit: (ptyId) => onPtyExitRef.current(ptyId),
})
```

- [ ] **Step 6: Run the full sessions suite to verify no regression**

```bash
npx vitest run src/features/sessions/
```

Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/features/terminal/hooks/usePtyExitListener.ts src/features/terminal/hooks/usePtyExitListener.test.ts src/features/sessions/hooks/useSessionManager.ts
git commit -m "refactor(terminal): extract usePtyExitListener hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Extract `useAutoCreateOnEmpty` hook

**Files:**

- Create: `src/features/sessions/hooks/useAutoCreateOnEmpty.ts`
- Create: `src/features/sessions/hooks/useAutoCreateOnEmpty.test.ts`
- Modify: `src/features/sessions/hooks/useSessionManager.ts`

- [ ] **Step 1: Write the tests**

```ts
// src/features/sessions/hooks/useAutoCreateOnEmpty.test.ts
import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useAutoCreateOnEmpty } from './useAutoCreateOnEmpty'

describe('useAutoCreateOnEmpty', () => {
  test('fires createSession once after restore completes with no live session', () => {
    const createSession = vi.fn()
    const { rerender } = renderHook(
      ({ loading, hasLive }) =>
        useAutoCreateOnEmpty({
          enabled: true,
          loading,
          hasLiveSession: hasLive,
          pendingSpawns: 0,
          createSession,
        }),
      { initialProps: { loading: true, hasLive: false } }
    )

    expect(createSession).not.toHaveBeenCalled()

    rerender({ loading: false, hasLive: false })
    expect(createSession).toHaveBeenCalledTimes(1)

    // Subsequent re-render with no live session: NOT called again (once-only).
    rerender({ loading: false, hasLive: false })
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  test('does NOT fire when a live session exists post-restore', () => {
    const createSession = vi.fn()
    renderHook(() =>
      useAutoCreateOnEmpty({
        enabled: true,
        loading: false,
        hasLiveSession: true,
        pendingSpawns: 0,
        createSession,
      })
    )
    expect(createSession).not.toHaveBeenCalled()
  })

  test('defers when pendingSpawns > 0 and re-fires on post-failure tick', () => {
    const createSession = vi.fn()
    const { rerender } = renderHook(
      ({ pending, hasLive }) =>
        useAutoCreateOnEmpty({
          enabled: true,
          loading: false,
          hasLiveSession: hasLive,
          pendingSpawns: pending,
          createSession,
        }),
      { initialProps: { pending: 1, hasLive: false } }
    )

    expect(createSession).not.toHaveBeenCalled()

    // Pending spawn FAILED — pendingSpawns drops to 0, hasLive still false.
    rerender({ pending: 0, hasLive: false })
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  test('does nothing when enabled is false', () => {
    const createSession = vi.fn()
    renderHook(() =>
      useAutoCreateOnEmpty({
        enabled: false,
        loading: false,
        hasLiveSession: false,
        pendingSpawns: 0,
        createSession,
      })
    )
    expect(createSession).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/features/sessions/hooks/useAutoCreateOnEmpty.test.ts
```

Expected: FAIL on missing module.

- [ ] **Step 3: Implement**

```ts
// src/features/sessions/hooks/useAutoCreateOnEmpty.ts
import { useEffect, useRef } from 'react'

export interface UseAutoCreateOnEmptyOptions {
  enabled: boolean
  loading: boolean
  hasLiveSession: boolean
  pendingSpawns: number
  createSession: () => void
}

/** Seed exactly one session on clean launch. Fires createSession() ONCE
 *  after the initial restore completes, when no live session exists.
 *
 *  Does NOT re-fire when the user later closes all tabs (intentional).
 *  Defers when a manual createSession is in flight (pendingSpawns > 0);
 *  re-fires on the post-failure tick if the manual spawn failed
 *  (pendingSpawns drops to 0 with hasLiveSession still false). */
export const useAutoCreateOnEmpty = ({
  enabled,
  loading,
  hasLiveSession,
  pendingSpawns,
  createSession,
}: UseAutoCreateOnEmptyOptions): void => {
  const didInitialAutoCreateRef = useRef(false)

  useEffect(() => {
    if (!enabled || loading || didInitialAutoCreateRef.current) {
      return
    }
    if (pendingSpawns > 0) {
      return
    }
    didInitialAutoCreateRef.current = true
    if (!hasLiveSession) {
      createSession()
    }
  }, [enabled, loading, hasLiveSession, pendingSpawns, createSession])
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/sessions/hooks/useAutoCreateOnEmpty.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire into useSessionManager**

In `src/features/sessions/hooks/useSessionManager.ts`, find the existing auto-create-on-empty `useEffect` block (currently lines ~734-757) and REPLACE with:

```ts
import { useAutoCreateOnEmpty } from './useAutoCreateOnEmpty'

// Inside the manager body:
const hasLiveSession = sessions.some((s) => s.status === 'running')
useAutoCreateOnEmpty({
  enabled: autoCreateOnEmpty,
  loading,
  hasLiveSession,
  pendingSpawns,
  createSession,
})
```

- [ ] **Step 6: Run the full sessions suite**

```bash
npx vitest run src/features/sessions/
```

Expected: all tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/features/sessions/hooks/useAutoCreateOnEmpty.ts src/features/sessions/hooks/useAutoCreateOnEmpty.test.ts src/features/sessions/hooks/useSessionManager.ts
git commit -m "refactor(sessions): extract useAutoCreateOnEmpty hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Extract `useActiveSessionController` hook

**Files:**

- Create: `src/features/sessions/hooks/useActiveSessionController.ts`
- Create: `src/features/sessions/hooks/useActiveSessionController.test.ts`
- Modify: `src/features/sessions/hooks/useSessionManager.ts`

- [ ] **Step 1: Write the tests**

```ts
// src/features/sessions/hooks/useActiveSessionController.test.ts
import { act, renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Session } from '../types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import { useActiveSessionController } from './useActiveSessionController'

const buildService = (
  setActive: (id: string) => Promise<void> = () => Promise.resolve()
): ITerminalService =>
  ({
    setActiveSession: vi.fn().mockImplementation(setActive),
  }) as unknown as ITerminalService

const session = (id: string, ptyId: string): Session =>
  ({
    id,
    panes: [{ id: 'p0', ptyId, active: true }],
  }) as unknown as Session

describe('useActiveSessionController', () => {
  test('setActiveSessionId optimistically updates and calls IPC with active pane ptyId', async () => {
    const setActive = vi.fn().mockResolvedValue(undefined)
    const service = buildService(setActive)
    const sessionsRef = {
      current: [session('sess-A', 'pty-A'), session('sess-B', 'pty-B')],
    }

    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    await act(async () => {
      result.current.setActiveSessionId('sess-B')
    })
    expect(result.current.activeSessionId).toBe('sess-B')
    expect(setActive).toHaveBeenCalledWith('pty-B')
  })

  test('rolls back on IPC failure when no newer request superseded', async () => {
    let reject: (err: Error) => void = () => {}
    const setActive = vi.fn().mockReturnValueOnce(
      new Promise<void>((_, r) => {
        reject = r
      })
    )
    const service = buildService(setActive)
    const sessionsRef = { current: [session('sess-A', 'pty-A')] }

    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )
    expect(result.current.activeSessionId).toBeNull()

    act(() => {
      result.current.setActiveSessionId('sess-A')
    })
    expect(result.current.activeSessionId).toBe('sess-A')

    await act(async () => {
      reject(new Error('IPC failed'))
      await Promise.resolve()
    })
    expect(result.current.activeSessionId).toBeNull() // rolled back
  })

  test('does NOT roll back when superseded by newer request', async () => {
    // Two in-flight requests; first rejects after second succeeds.
    let reject1: (err: Error) => void = () => {}
    let resolve2: () => void = () => {}
    const setActive = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<void>((_, r) => {
          reject1 = r
        })
      )
      .mockReturnValueOnce(
        new Promise<void>((res) => {
          resolve2 = res
        })
      )
    const service = buildService(setActive)
    const sessionsRef = {
      current: [
        session('sess-A', 'pty-A'),
        session('sess-B', 'pty-B'),
        session('sess-C', 'pty-C'),
      ],
    }

    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    act(() => {
      result.current.setActiveSessionId('sess-B')
    })
    act(() => {
      result.current.setActiveSessionId('sess-C')
    })

    await act(async () => {
      reject1(new Error('first IPC failed'))
      resolve2()
      await Promise.resolve()
    })
    expect(result.current.activeSessionId).toBe('sess-C') // not rolled back to A
  })

  test('setActiveSessionIdRaw bypasses IPC', () => {
    const setActive = vi.fn()
    const service = buildService(setActive)
    const sessionsRef = { current: [session('sess-A', 'pty-A')] }

    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    act(() => {
      result.current.setActiveSessionIdRaw('sess-A')
    })
    expect(result.current.activeSessionId).toBe('sess-A')
    expect(setActive).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/features/sessions/hooks/useActiveSessionController.test.ts
```

Expected: FAIL on missing module.

- [ ] **Step 3: Implement**

```ts
// src/features/sessions/hooks/useActiveSessionController.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '../types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import { getActivePane } from '../utils/activeSessionPane'

export interface UseActiveSessionControllerOptions {
  service: ITerminalService
  sessionsRef: { current: Session[] }
}

export interface ActiveSessionController {
  activeSessionId: string | null
  setActiveSessionId: (id: string) => void
  /** Restore-time write that bypasses the IPC roundtrip. Use when Rust
   *  already persists the chosen value (cached active matched a session).
   *  Accepts `null` for the last-tab-removed path. */
  setActiveSessionIdRaw: (id: string | null) => void
  /** Read-only ref tracking the latest committed `activeSessionId`. Manager
   *  mutations (createSession / removeSession / restartSession) read this
   *  AFTER awaits to get the freshest value (closure-captured `activeSessionId`
   *  goes stale during in-flight IPC). Lifted onto the controller so manager
   *  code doesn't reach into private internals. */
  activeSessionIdRef: { readonly current: string | null }
}

export const useActiveSessionController = ({
  service,
  sessionsRef,
}: UseActiveSessionControllerOptions): ActiveSessionController => {
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    null
  )
  const activeSessionIdRef = useRef(activeSessionId)
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  const activeRequestIdRef = useRef(0)

  const setActiveSessionId = useCallback(
    (id: string): void => {
      const myReq = ++activeRequestIdRef.current
      const prev = activeSessionIdRef.current
      setActiveSessionIdState(id)

      const session = sessionsRef.current.find((s) => s.id === id)
      if (!session) {
        // Optimistic write but no Rust-side translation possible. Skip IPC.
        return
      }
      const ptyId = getActivePane(session).ptyId

      // eslint-disable-next-line promise/prefer-await-to-then
      service.setActiveSession(ptyId).catch((err) => {
        if (myReq === activeRequestIdRef.current) {
          // eslint-disable-next-line no-console
          console.warn('setActiveSession IPC failed; reverting', err)
          setActiveSessionIdState(prev)
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            'setActiveSession IPC failed but newer request superseded; not reverting',
            err
          )
        }
      })
    },
    [service, sessionsRef]
  )

  const setActiveSessionIdRaw = useCallback((id: string | null): void => {
    activeRequestIdRef.current += 1 // supersede any in-flight pick
    setActiveSessionIdState(id)
  }, [])

  return {
    activeSessionId,
    setActiveSessionId,
    setActiveSessionIdRaw,
    activeSessionIdRef, // exposed for manager mutations to read post-await
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/sessions/hooks/useActiveSessionController.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire into useSessionManager**

In `src/features/sessions/hooks/useSessionManager.ts`, replace the inline `setActiveSessionId` callback (currently lines ~507-534) and the `activeSessionIdRef` + `activeRequestIdRef` blocks with:

```ts
import { useActiveSessionController } from './useActiveSessionController'

// Inside the manager body, near the top after sessions/setSessions:
const sessionsRef = useRef(sessions)
sessionsRef.current = sessions

const active = useActiveSessionController({ service, sessionsRef })
// `active.activeSessionId`, `active.setActiveSessionId`, `active.setActiveSessionIdRaw`
// replace the previous local state + callback.
```

Then update every internal call from `setActiveSessionId` → `active.setActiveSessionId` and every `activeSessionIdRef.current` reference to use the controller's exposed ref (add a getter to the returned interface if needed).

- [ ] **Step 6: Run the full sessions test suite**

```bash
npx vitest run src/features/sessions/
```

Expected: all tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/features/sessions/hooks/useActiveSessionController.ts src/features/sessions/hooks/useActiveSessionController.test.ts src/features/sessions/hooks/useSessionManager.ts
git commit -m "refactor(sessions): extract useActiveSessionController hook

Active-session selector with monotonic request-id token now lives in
its own hook. Translates setActiveSessionId(reactSessionId) to
service.setActiveSession(getActivePane(session).ptyId) at the IPC site.
setActiveSessionIdRaw added for restore-time writes that bypass IPC.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Extract `usePtyBufferDrain` hook

**Files:**

- Create: `src/features/terminal/orchestration/usePtyBufferDrain.ts`
- Create: `src/features/terminal/orchestration/usePtyBufferDrain.test.ts`
- Modify: `src/features/sessions/hooks/useSessionManager.ts`

- [ ] **Step 1: Write the tests**

```ts
// src/features/terminal/orchestration/usePtyBufferDrain.test.ts
import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { usePtyBufferDrain } from './usePtyBufferDrain'

describe('usePtyBufferDrain', () => {
  test('bufferEvent collects events for pending sessions', () => {
    const { result } = renderHook(() =>
      usePtyBufferDrain({ service: {} as never })
    )
    result.current.registerPending('pty-1')
    result.current.bufferEvent('pty-1', 'hello', 0, 5)
    result.current.bufferEvent('pty-1', 'world', 5, 5)

    expect(result.current.getBufferedSnapshot('pty-1')).toEqual([
      { data: 'hello', offsetStart: 0, byteLen: 5 },
      { data: 'world', offsetStart: 5, byteLen: 5 },
    ])
  })

  test('bufferEvent drops events for ready sessions', () => {
    const { result } = renderHook(() =>
      usePtyBufferDrain({ service: {} as never })
    )
    const handler = vi.fn()
    result.current.registerPending('pty-1')
    result.current.notifyPaneReady('pty-1', handler) // marks ready

    result.current.bufferEvent('pty-1', 'after-ready', 0, 11)
    expect(result.current.getBufferedSnapshot('pty-1')).toEqual([])
  })

  test('notifyPaneReady drains buffered events to handler', () => {
    const { result } = renderHook(() =>
      usePtyBufferDrain({ service: {} as never })
    )
    const handler = vi.fn()
    result.current.registerPending('pty-1')
    result.current.bufferEvent('pty-1', 'first', 0, 5)
    result.current.bufferEvent('pty-1', 'second', 5, 6)

    result.current.notifyPaneReady('pty-1', handler)

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenNthCalledWith(1, 'first', 0, 5)
    expect(handler).toHaveBeenNthCalledWith(2, 'second', 5, 6)
  })

  test('notifyPaneReady cleanup re-arms pending state on remount', () => {
    const { result } = renderHook(() =>
      usePtyBufferDrain({ service: {} as never })
    )
    const handler = vi.fn()
    result.current.registerPending('pty-1')
    const release = result.current.notifyPaneReady('pty-1', handler)

    release()
    result.current.bufferEvent('pty-1', 'post-cleanup', 0, 12)
    expect(result.current.getBufferedSnapshot('pty-1')).toEqual([
      { data: 'post-cleanup', offsetStart: 0, byteLen: 12 },
    ])
  })

  test('dropAllForPty clears bookkeeping for one pty', () => {
    const { result } = renderHook(() =>
      usePtyBufferDrain({ service: {} as never })
    )
    result.current.registerPending('pty-1')
    result.current.bufferEvent('pty-1', 'leak', 0, 4)

    result.current.dropAllForPty('pty-1')
    expect(result.current.getBufferedSnapshot('pty-1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/features/terminal/orchestration/usePtyBufferDrain.test.ts
```

Expected: FAIL on missing module.

- [ ] **Step 3: Implement**

```ts
// src/features/terminal/orchestration/usePtyBufferDrain.ts
import { useCallback, useRef } from 'react'
import type { ITerminalService } from '../services/terminalService'
import type { NotifyPaneReadyResult, PaneEventHandler } from '../types'

export interface UsePtyBufferDrainOptions {
  service: ITerminalService // reserved for future cleanup hooks
}

interface BufferedEvent {
  data: string
  offsetStart: number
  byteLen: number
}

export interface PtyBufferDrain {
  /** Buffer a pty-data event for `ptyId` if the pane hasn't subscribed yet.
   *  Drops the event when the pane is already ready. */
  bufferEvent: (
    ptyId: string,
    data: string,
    offsetStart: number,
    byteLen: number
  ) => void

  /** Mark a pane as ready: drain any buffered events to the handler, flip
   *  the gate so future events bypass the buffer. Returns a release callback
   *  that re-arms the pending state on pane unmount. */
  notifyPaneReady: (
    ptyId: string,
    handler: PaneEventHandler
  ) => NotifyPaneReadyResult

  /** Mark a ptyId as expecting events but pane not yet attached. */
  registerPending: (ptyId: string) => void

  /** Snapshot of currently-buffered events for a ptyId (read-only). */
  getBufferedSnapshot: (ptyId: string) => BufferedEvent[]

  /** Drop all bookkeeping for a ptyId (used by removeSession + restartSession). */
  dropAllForPty: (ptyId: string) => void
}

export const usePtyBufferDrain = (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options: UsePtyBufferDrainOptions
): PtyBufferDrain => {
  const bufferedRef = useRef(new Map<string, BufferedEvent[]>())
  const pendingPanesRef = useRef(new Set<string>())
  const readyPanesRef = useRef(new Set<string>())

  const bufferEvent = useCallback<PtyBufferDrain['bufferEvent']>(
    (ptyId, data, offsetStart, byteLen) => {
      if (readyPanesRef.current.has(ptyId)) return
      let q = bufferedRef.current.get(ptyId)
      if (!q) {
        q = []
        bufferedRef.current.set(ptyId, q)
      }
      q.push({ data, offsetStart, byteLen })
    },
    []
  )

  const registerPending = useCallback<PtyBufferDrain['registerPending']>(
    (ptyId) => {
      pendingPanesRef.current.add(ptyId)
    },
    []
  )

  const getBufferedSnapshot = useCallback<
    PtyBufferDrain['getBufferedSnapshot']
  >((ptyId) => [...(bufferedRef.current.get(ptyId) ?? [])], [])

  const dropAllForPty = useCallback<PtyBufferDrain['dropAllForPty']>(
    (ptyId) => {
      readyPanesRef.current.delete(ptyId)
      pendingPanesRef.current.delete(ptyId)
      bufferedRef.current.delete(ptyId)
    },
    []
  )

  const notifyPaneReady = useCallback<PtyBufferDrain['notifyPaneReady']>(
    (ptyId, handler) => {
      readyPanesRef.current.add(ptyId)
      pendingPanesRef.current.delete(ptyId)

      const events = bufferedRef.current.get(ptyId)
      if (events && events.length > 0) {
        for (const e of events) handler(e.data, e.offsetStart, e.byteLen)
        bufferedRef.current.delete(ptyId)
      }

      return (): void => {
        // Removed-pane guard (round-8 F2 in current code): if dropAllForPty
        // already ran (e.g. removeSession / restartSession), do NOT re-arm
        // pending state. Without this, racing pty-data events would buffer
        // forever under a removed ptyId, leaking memory across the lifetime
        // of the hook.
        const isStillTracked =
          readyPanesRef.current.has(ptyId) ||
          pendingPanesRef.current.has(ptyId) ||
          bufferedRef.current.has(ptyId)
        if (!isStillTracked) {
          return // permanent teardown — nothing to re-arm
        }
        readyPanesRef.current.delete(ptyId)
        pendingPanesRef.current.add(ptyId)
        if (!bufferedRef.current.has(ptyId)) {
          bufferedRef.current.set(ptyId, [])
        }
      }
    },
    []
  )

  return {
    bufferEvent,
    notifyPaneReady,
    registerPending,
    getBufferedSnapshot,
    dropAllForPty,
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/terminal/orchestration/usePtyBufferDrain.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire into useSessionManager**

This is a partial wire-in — useSessionManager still owns the listener in this task. Task 13 (`useSessionRestore`) moves the listener to the restore hook.

For now, replace the inline `bufferedRef`, `pendingPanesRef`, `readyPanesRef`, `notifyPaneReady` declarations + the existing buffering callback inside the restore effect with calls into `buffer.bufferEvent`, `buffer.registerPending`, `buffer.notifyPaneReady`, `buffer.dropAllForPty`. The listener attachment stays in the same useEffect for this task.

- [ ] **Step 6: Run the full sessions suite**

```bash
npx vitest run src/features/sessions/
```

Expected: all tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/features/terminal/orchestration/usePtyBufferDrain.ts src/features/terminal/orchestration/usePtyBufferDrain.test.ts src/features/sessions/hooks/useSessionManager.ts
git commit -m "refactor(terminal): extract usePtyBufferDrain hook

Per-PTY buffer accounting (bufferEvent, notifyPaneReady, registerPending,
getBufferedSnapshot, dropAllForPty) moves into its own hook. The listener
lifecycle stays in useSessionManager for this commit; Task 13's
useSessionRestore lifts it out next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Extract `useSessionRestore` hook

**Files:**

- Create: `src/features/sessions/hooks/useSessionRestore.ts`
- Create: `src/features/sessions/hooks/useSessionRestore.test.ts`
- Modify: `src/features/sessions/hooks/useSessionManager.ts`

- [ ] **Step 1: Write the tests**

```ts
// src/features/sessions/hooks/useSessionRestore.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ITerminalService } from '../../terminal/services/terminalService'
import { useSessionRestore } from './useSessionRestore'

const buildBuffer = (): {
  bufferEvent: ReturnType<typeof vi.fn>
  registerPending: ReturnType<typeof vi.fn>
  getBufferedSnapshot: ReturnType<typeof vi.fn>
} =>
  ({
    bufferEvent: vi.fn(),
    registerPending: vi.fn(),
    getBufferedSnapshot: vi.fn(() => []),
    notifyPaneReady: vi.fn(),
    dropAllForPty: vi.fn(),
  }) as never

describe('useSessionRestore', () => {
  test('attaches onData listener BEFORE listSessions', async () => {
    const order: string[] = []
    const service = {
      onData: vi.fn().mockImplementation(async () => {
        order.push('onData-attached')
        return () => {}
      }),
      listSessions: vi.fn().mockImplementation(async () => {
        order.push('listSessions-called')
        return { sessions: [], activeSessionId: null }
      }),
    } as unknown as ITerminalService
    const onRestore = vi.fn()
    const onActiveResolved = vi.fn()

    renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer() as never,
        onRestore,
        onActiveResolved,
      })
    )

    await waitFor(() => {
      expect(service.listSessions).toHaveBeenCalled()
    })
    expect(order).toEqual(['onData-attached', 'listSessions-called'])
  })

  test('builds 1-pane Sessions with fresh UUIDs from Alive infos', async () => {
    const service = {
      onData: vi.fn().mockResolvedValue(() => {}),
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: 'pty-1',
            cwd: '/home/will/repo',
            status: {
              kind: 'Alive',
              pid: 1234,
              replay_data: '',
              replay_end_offset: 0,
            },
          },
        ],
        activeSessionId: 'pty-1',
      }),
    } as unknown as ITerminalService
    const onRestore = vi.fn()
    const onActiveResolved = vi.fn()

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer() as never,
        onRestore,
        onActiveResolved,
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(onRestore).toHaveBeenCalled()
    const restoredSessions = onRestore.mock.calls[0][0]
    expect(restoredSessions).toHaveLength(1)
    expect(restoredSessions[0].panes[0].ptyId).toBe('pty-1')
    expect(restoredSessions[0].panes[0].active).toBe(true)
    expect(restoredSessions[0].panes[0].status).toBe('running')
  })

  test('null active id with no sessions leaves activeSessionId null', async () => {
    const service = {
      onData: vi.fn().mockResolvedValue(() => {}),
      listSessions: vi
        .fn()
        .mockResolvedValue({ sessions: [], activeSessionId: null }),
    } as unknown as ITerminalService
    const onRestore = vi.fn()
    const onActiveResolved = vi.fn()

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer() as never,
        onRestore,
        onActiveResolved,
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(onActiveResolved).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/features/sessions/hooks/useSessionRestore.test.ts
```

Expected: FAIL on missing module.

- [ ] **Step 3: Implement**

```ts
// src/features/sessions/hooks/useSessionRestore.ts
import { useEffect, useState } from 'react'
import type { Session, Pane } from '../types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type { PtyBufferDrain } from '../../terminal/orchestration/usePtyBufferDrain'
import { sessionFromInfo } from '../utils/sessionFromInfo'
import { registerPtySession } from '../../terminal/ptySessionMap'

export interface UseSessionRestoreOptions {
  service: ITerminalService
  buffer: PtyBufferDrain
  onRestore: (sessions: Session[]) => void
  /** Called with the resolved React Session.id when restore picks an active
   *  session (matched ptyId or fallback). Not called when no sessions exist. */
  onActiveResolved: (sessionId: string) => void
  /** Called with the chosen fallback when cached active doesn't match
   *  any restored session. Caller should fire IPC (setActiveSessionId), not
   *  Raw, since Rust diverges from React intent. */
  onActiveFallback?: (sessionId: string) => void
}

export interface SessionRestoreState {
  loading: boolean
}

export const useSessionRestore = ({
  service,
  buffer,
  onRestore,
  onActiveResolved,
  onActiveFallback,
}: UseSessionRestoreOptions): SessionRestoreState => {
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let stopBuffering: (() => void) | null = null

    void (async (): Promise<void> => {
      try {
        // 1. Listener BEFORE list_sessions.
        stopBuffering = await service.onData(
          (sessionId, data, offsetStart, byteLen) => {
            buffer.bufferEvent(sessionId, data, offsetStart, byteLen)
          }
        )
        if (cancelled) {
          stopBuffering()
          stopBuffering = null
          return
        }

        // 2. Snapshot.
        const list = await service.listSessions()
        if (cancelled) return

        // 3. Build sessions (Alive + Exited cases).
        const restored: Session[] = list.sessions.map((info, idx) =>
          sessionFromInfo(info, idx)
        )
        for (const info of list.sessions) {
          if (info.status.kind === 'Alive') {
            buffer.registerPending(info.id)
            registerPtySession(info.id, info.id, info.cwd)
          }
          // Exited: no buffer registration; pane shows RestartAffordance.
        }

        // Hand sessions to caller.
        onRestore(restored)

        // 4. Resolve active session.
        if (list.activeSessionId !== null) {
          const matched = restored.find(
            (s) => s.panes[0]?.ptyId === list.activeSessionId
          )
          if (matched) {
            onActiveResolved(matched.id)
          } else if (restored.length > 0) {
            onActiveFallback?.(restored[0].id)
          }
        } else if (restored.length > 0) {
          onActiveFallback?.(restored[0].id)
        }

        setLoading(false)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('listSessions failed; starting empty', err)
        setLoading(false)
      }
    })()

    return (): void => {
      cancelled = true
      stopBuffering?.()
    }
  }, [service]) // buffer + callbacks intentionally omitted — see manager-level stable refs

  return { loading }
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/sessions/hooks/useSessionRestore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire into useSessionManager**

In `src/features/sessions/hooks/useSessionManager.ts`, REMOVE the entire mount-time restore effect (lines ~222-356) and add:

```ts
import { useSessionRestore } from './useSessionRestore'

// Inside the manager body, after sessionsRef + active are set up:
const { loading } = useSessionRestore({
  service,
  buffer,
  onRestore: (restored) => {
    setSessions((prev) => {
      // F2-round-2 alignment: merge optimistic + restored, dedup by ptyId.
      const inMemoryPtyIds = new Set(
        prev.flatMap((s) => s.panes.map((p) => p.ptyId))
      )
      const newOnes = restored.filter(
        (s) => !s.panes.some((p) => inMemoryPtyIds.has(p.ptyId))
      )
      const addedDuringLoad = prev
      return [...addedDuringLoad, ...newOnes]
    })
  },
  onActiveResolved: (id) => {
    // Optimistic preference: read FRESH active id via ref, not the closure-
    // captured value (which was `null` at hook-create time and would falsely
    // overwrite a user-created active session that landed during restore).
    if (active.activeSessionIdRef.current === null) {
      active.setActiveSessionIdRaw(id)
    }
  },
  onActiveFallback: (id) => {
    // Rust didn't have this id (or had null). Fire IPC to sync cache.
    if (active.activeSessionIdRef.current === null) {
      active.setActiveSessionId(id)
    }
  },
})
```

- [ ] **Step 6: Run the full sessions suite**

```bash
npx vitest run src/features/sessions/
```

Expected: all tests still pass (this is a load-bearing refactor; pay attention to any restore-related test failures).

- [ ] **Step 7: Commit**

```bash
git add src/features/sessions/hooks/useSessionRestore.ts src/features/sessions/hooks/useSessionRestore.test.ts src/features/sessions/hooks/useSessionManager.ts
git commit -m "refactor(sessions): extract useSessionRestore hook

Mount-time restore orchestration now lives in its own hook with a small
interface (loading boolean + onRestore/onActiveResolved/onActiveFallback
callbacks). Listener-before-list_sessions invariant preserved. Restore
delegates buffer accounting to usePtyBufferDrain via the buffer prop.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Update manager mutations for pane-keyed API

`createSession`, `removeSession`, `restartSession`, `updateSessionCwd`/`AgentType` adopt the new pane-keyed shapes. `restartSession` preserves `Session.id`; only `pane.ptyId` rotates.

**Files:**

- Modify: `src/features/sessions/hooks/useSessionManager.ts`
- Modify: `src/features/sessions/hooks/useSessionManager.test.ts`

- [ ] **Step 1: Write tests for the new behavior**

Add to `useSessionManager.test.ts`:

```ts
// Test infrastructure used across the new tests:
//
// const buildService = (overrides = {}) => ({
//   spawn: vi.fn().mockResolvedValue({ sessionId: 'pty-new', pid: 99, cwd: '/x' }),
//   kill: vi.fn().mockResolvedValue(undefined),
//   listSessions: vi.fn().mockResolvedValue({ sessions: [], activeSessionId: null }),
//   reorderSessions: vi.fn().mockResolvedValue(undefined),
//   setActiveSession: vi.fn().mockResolvedValue(undefined),
//   updateSessionCwd: vi.fn().mockResolvedValue(undefined),
//   onData: vi.fn().mockResolvedValue(() => {}),
//   onExit: vi.fn().mockReturnValue(() => {}),
//   ...overrides,
// } as unknown as ITerminalService)

describe('createSession (pane-keyed)', () => {
  test('produces a 1-pane session with fresh UUID id (not the spawn ptyId)', async () => {
    const service = buildService({
      spawn: vi
        .fn()
        .mockResolvedValue({ sessionId: 'pty-new', pid: 99, cwd: '/x' }),
    })
    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      result.current.createSession()
      // Allow the spawn promise to resolve and flushSync to commit.
      await Promise.resolve()
      await Promise.resolve()
    })

    const created = result.current.sessions[0]
    expect(created.id).not.toBe('pty-new') // fresh UUID, not the ptyId
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i) // UUID v4 shape
    expect(created.panes).toHaveLength(1)
    expect(created.panes[0].ptyId).toBe('pty-new')
    expect(created.panes[0].id).toBe('p0')
    expect(created.panes[0].active).toBe(true)
    expect(created.layout).toBe('single')
    // Materialized fields match the active pane.
    expect(created.workingDirectory).toBe('/x')
    expect(created.agentType).toBe('generic')
  })
})

describe('restartSession preserves Session.id', () => {
  test('only pane.ptyId rotates; session.id stays', async () => {
    // Seed a manager with one session whose panes[0].ptyId = 'pty-old' via
    // the listSessions restore path, then spawn returns 'pty-new' on restart.
    const service = buildService({
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: 'pty-old',
            cwd: '/x',
            status: {
              kind: 'Alive',
              pid: 1,
              replay_data: '',
              replay_end_offset: 0,
            },
          },
        ],
        activeSessionId: 'pty-old',
      }),
      spawn: vi
        .fn()
        .mockResolvedValue({ sessionId: 'pty-new', pid: 2, cwd: '/x' }),
    })
    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const sessionIdBefore = result.current.sessions[0].id

    await act(async () => {
      result.current.restartSession(sessionIdBefore)
      await Promise.resolve()
      await Promise.resolve()
    })

    const restarted = result.current.sessions[0]
    expect(restarted.id).toBe(sessionIdBefore) // preserved
    expect(restarted.panes[0].ptyId).toBe('pty-new') // rotated
    expect(restarted.panes[0].id).toBe('p0') // layout slot preserved
    expect(restarted.panes[0].status).toBe('running')
    expect(restarted.panes[0].agentType).toBe('generic') // reset
  })
})

describe('removeSession bails on real kill failure', () => {
  test('rejected kill leaves session visible', async () => {
    const service = buildService({
      kill: vi.fn().mockRejectedValue(new Error('KillFailed')),
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: 'pty-1',
            cwd: '/x',
            status: {
              kind: 'Alive',
              pid: 1,
              replay_data: '',
              replay_end_offset: 0,
            },
          },
        ],
        activeSessionId: 'pty-1',
      }),
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sessions).toHaveLength(1)
    const sessionId = result.current.sessions[0].id

    await act(async () => {
      result.current.removeSession(sessionId)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.sessions).toHaveLength(1) // still visible
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('removeSession: kill failed for a pane'),
      expect.any(Error)
    )
    warnSpy.mockRestore()
  })
})

describe('updatePaneCwd (renamed from updateSessionCwd)', () => {
  test('updates pane.cwd via paneId, mirrors to Rust via pane.ptyId', async () => {
    const service = buildService({
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: 'pty-1',
            cwd: '/old',
            status: {
              kind: 'Alive',
              pid: 1,
              replay_data: '',
              replay_end_offset: 0,
            },
          },
        ],
        activeSessionId: 'pty-1',
      }),
    })
    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const sessionId = result.current.sessions[0].id

    act(() => {
      result.current.updatePaneCwd(sessionId, 'p0', '/new/cwd')
    })

    const updated = result.current.sessions[0]
    expect(updated.panes[0].cwd).toBe('/new/cwd')
    expect(updated.workingDirectory).toBe('/new/cwd') // materialized
    expect(service.updateSessionCwd).toHaveBeenCalledWith('pty-1', '/new/cwd')
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
npx vitest run src/features/sessions/hooks/useSessionManager.test.ts
```

Expected: FAIL on the new tests.

- [ ] **Step 3: Update `createSession` in useSessionManager.ts**

Replace the existing `createSession` (lines ~572-702) with the pane-keyed flow:

```ts
const createSession = useCallback((): void => {
  setPendingSpawns((c) => c + 1)
  void (async (): Promise<void> => {
    try {
      const result = await service.spawn({
        cwd: '~',
        env: {},
        enableAgentBridge: true,
      })
      const now = new Date().toISOString()

      const newSessionId = crypto.randomUUID()
      buffer.registerPending(result.sessionId)

      let computedNewOrder = null as string[] | null
      flushSync(() => {
        setSessions((prev) => {
          const newSession: Session = {
            id: newSessionId,
            projectId: 'proj-1',
            name: `session ${prev.length + 1}`,
            status: 'running',
            workingDirectory: result.cwd,
            agentType: 'generic',
            layout: 'single',
            panes: [
              {
                id: 'p0',
                ptyId: result.sessionId,
                cwd: result.cwd,
                agentType: 'generic',
                status: 'running',
                active: true,
                pid: result.pid,
                restoreData: {
                  sessionId: result.sessionId,
                  cwd: result.cwd,
                  pid: result.pid,
                  replayData: '',
                  replayEndOffset: 0,
                  bufferedEvents: [],
                },
              },
            ],
            createdAt: now,
            lastActivityAt: now,
            activity: { ...emptyActivity },
          }
          const next = [newSession, ...prev]
          // Order persisted to Rust uses ptyIds (single-pane in 5a).
          computedNewOrder = next.map((s) => s.panes[0].ptyId)
          return next
        })
      })

      if (computedNewOrder !== null) {
        // eslint-disable-next-line promise/prefer-await-to-then
        service.reorderSessions(computedNewOrder).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('createSession: reorderSessions failed', err)
        })
      }

      active.setActiveSessionId(newSessionId)
      registerPtySession(result.sessionId, result.sessionId, result.cwd)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('spawn failed', err)
    } finally {
      setPendingSpawns((c) => c - 1)
    }
  })()
}, [service, active.setActiveSessionId, buffer])
```

- [ ] **Step 4: Update `removeSession`**

Replace the existing `removeSession` with allSettled + bail-on-failure semantics:

```ts
const removeSession = useCallback(
  (id: string): void => {
    void (async (): Promise<void> => {
      const target = sessionsRef.current.find((s) => s.id === id)
      if (!target) {
        // eslint-disable-next-line no-console
        console.warn(`removeSession: no session with id ${id}`)
        return
      }

      const results = await Promise.allSettled(
        target.panes.map((p) => service.kill({ sessionId: p.ptyId }))
      )
      const rejected = results.filter((r) => r.status === 'rejected')
      if (rejected.length > 0) {
        for (const r of rejected) {
          // eslint-disable-next-line no-console
          console.warn('removeSession: kill failed for a pane', r.reason)
        }
        // Bail — Rust may still hold the session, do NOT drop React state.
        return
      }

      // All kills succeeded. Drop bookkeeping per pane.
      for (const p of target.panes) {
        buffer.dropAllForPty(p.ptyId)
        unregisterPtySession(p.ptyId)
      }

      // Drop session from React state with active follow-up.
      const currentActiveId = activeSessionIdRef.current
      let computedFallback = null as string | null
      let shouldUpdateActive = false as boolean
      flushSync(() => {
        setSessions((prev) => {
          const next = prev.filter((s) => s.id !== id)
          if (currentActiveId === id) {
            const removedIndex = prev.findIndex((s) => s.id === id)
            shouldUpdateActive = true
            computedFallback =
              next.length === 0
                ? null
                : next[Math.min(removedIndex, next.length - 1)].id
          }
          return next
        })
      })

      if (shouldUpdateActive) {
        if (computedFallback !== null) {
          active.setActiveSessionId(computedFallback)
        } else {
          // Last tab removed.
          active.setActiveSessionIdRaw(null as never) // null-cast because of TS
        }
      }
    })()
  },
  [service, active, buffer]
)
```

> Note: `active.setActiveSessionIdRaw(null)` requires the controller's signature to accept `string | null`. Update `useActiveSessionController` accordingly: `setActiveSessionIdRaw: (id: string | null) => void`.

- [ ] **Step 5: Update `restartSession`**

Replace the existing `restartSession` to preserve `Session.id`:

```ts
const restartSession = useCallback(
  (sessionId: string): void => {
    void (async (): Promise<void> => {
      const oldSession = sessionsRef.current.find((s) => s.id === sessionId)
      if (!oldSession) {
        // eslint-disable-next-line no-console
        console.warn(`restartSession: no session with id ${sessionId}`)
        return
      }
      const oldPane = getActivePane(oldSession)
      const cachedCwd = oldPane.cwd

      let result: { sessionId: string; pid: number; cwd: string }
      try {
        result = await service.spawn({
          cwd: cachedCwd,
          env: {},
          enableAgentBridge: true,
        })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('restartSession: spawn failed; old session preserved', err)
        return
      }

      try {
        await service.kill({ sessionId: oldPane.ptyId })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          'restartSession: kill of old ptyId failed; killing new orphan',
          err
        )
        // eslint-disable-next-line promise/prefer-await-to-then,@typescript-eslint/no-empty-function
        service.kill({ sessionId: result.sessionId }).catch((): void => {})
        return
      }

      buffer.dropAllForPty(oldPane.ptyId)
      unregisterPtySession(oldPane.ptyId)
      buffer.registerPending(result.sessionId)
      registerPtySession(result.sessionId, result.sessionId, result.cwd)

      let computedNewOrder = null as string[] | null
      flushSync(() => {
        setSessions((prev) => {
          const idx = prev.findIndex((s) => s.id === sessionId)
          if (idx === -1) {
            // Session was removed during the spawn/kill window — kill orphan.
            // eslint-disable-next-line promise/prefer-await-to-then,@typescript-eslint/no-empty-function
            service.kill({ sessionId: result.sessionId }).catch((): void => {})
            return prev
          }
          const next = [...prev]
          const oldS = prev[idx]
          const replacementPane: Pane = {
            ...oldPane,
            ptyId: result.sessionId,
            cwd: result.cwd,
            status: 'running',
            agentType: 'generic',
            pid: result.pid,
            restoreData: {
              sessionId: result.sessionId,
              cwd: result.cwd,
              pid: result.pid,
              replayData: '',
              replayEndOffset: 0,
              bufferedEvents: [],
            },
          }
          next[idx] = {
            ...oldS,
            panes: oldS.panes.map((p) =>
              p.id === oldPane.id ? replacementPane : p
            ),
            status: 'running',
            workingDirectory: result.cwd,
            agentType: 'generic',
            lastActivityAt: new Date().toISOString(),
          }
          computedNewOrder = next.map((s) => s.panes[0].ptyId)
          return next
        })
      })

      if (computedNewOrder !== null) {
        // eslint-disable-next-line promise/prefer-await-to-then
        service.reorderSessions(computedNewOrder).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('restartSession: reorderSessions failed', err)
        })
      }

      if (activeSessionIdRef.current === sessionId) {
        active.setActiveSessionId(sessionId)
      }
    })()
  },
  [service, active, buffer]
)
```

- [ ] **Step 6: Add `updatePaneCwd` and `updatePaneAgentType`**

Replace `updateSessionCwd` and `updateSessionAgentType` with:

```ts
const updatePaneCwd = useCallback(
  (sessionId: string, paneId: string, cwd: string): void => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s
        const newPanes = s.panes.map((p) =>
          p.id === paneId ? { ...p, cwd } : p
        )
        const wd = newPanes.find((p) => p.active)?.cwd ?? s.workingDirectory
        return { ...s, panes: newPanes, workingDirectory: wd }
      })
    )

    const target = sessionsRef.current.find((s) => s.id === sessionId)
    const targetPane = target?.panes.find((p) => p.id === paneId)
    if (targetPane) {
      // eslint-disable-next-line promise/prefer-await-to-then
      service.updateSessionCwd(targetPane.ptyId, cwd).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('updatePaneCwd IPC failed', err)
      })
    }
  },
  [service]
)

const updatePaneAgentType = useCallback(
  (
    sessionId: string,
    paneId: string,
    agentType: Session['agentType']
  ): void => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s
        const current = s.panes.find((p) => p.id === paneId)
        if (!current || current.agentType === agentType) return s
        const newPanes = s.panes.map((p) =>
          p.id === paneId ? { ...p, agentType } : p
        )
        const at = newPanes.find((p) => p.active)?.agentType ?? s.agentType
        return { ...s, panes: newPanes, agentType: at }
      })
    )
  },
  []
)
```

Update the manager's return interface to expose `updatePaneCwd`, `updatePaneAgentType` instead of the renamed methods. Remove the `restoreData` field from the public return.

- [ ] **Step 7: Update onPtyExit handler to find by ptyId across panes**

Replace the `onPtyExitRef.current` body from Task 9 with:

```ts
onPtyExitRef.current = (ptyId: string): void => {
  const exitedAt = new Date().toISOString()
  setSessions((prev) =>
    prev.map((s) => {
      const idx = s.panes.findIndex((p) => p.ptyId === ptyId)
      if (idx === -1) return s
      const newPanes = s.panes.map((p, i) =>
        i === idx
          ? {
              ...p,
              status: 'completed' as const,
              agentType: 'generic' as const,
            }
          : p
      )
      return {
        ...s,
        panes: newPanes,
        status: deriveSessionStatus(newPanes),
        lastActivityAt: exitedAt,
      }
    })
  )
}
```

- [ ] **Step 8: Run the full sessions test suite**

```bash
npx vitest run src/features/sessions/
```

Expected: PASS for all (including new tests from Step 1).

- [ ] **Step 9: Commit**

```bash
git add src/features/sessions/hooks/useSessionManager.ts src/features/sessions/hooks/useSessionManager.test.ts src/features/sessions/hooks/useActiveSessionController.ts
git commit -m "feat(sessions): pane-keyed manager mutations

createSession produces 1-pane sessions with fresh React UUIDs (not
ptyIds). removeSession bails on real kill failures. restartSession
preserves Session.id; only pane.ptyId rotates. updatePaneCwd /
updatePaneAgentType replace the per-session variants. onPtyExit finds
panes by ptyId across all sessions. Active-session controller accepts
null in setActiveSessionIdRaw for the last-tab-removed path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16 (was 15): Update `TerminalZone` to pass `pane` to `TerminalPane`

> **ORDER NOTE (Codex correction #6):** This task now follows Task 15
> (TerminalPane index.tsx) below. The TerminalPane prop interface MUST
> accept `pane` before TerminalZone passes it, otherwise the JSX boundary
> fails type-check.

**Files:**

- Modify: `src/features/workspace/components/TerminalZone.tsx`
- Modify: `src/features/workspace/components/TerminalZone.test.tsx`

- [ ] **Step 1: Update tests for the new prop pass**

In `TerminalZone.test.tsx`, add or update tests:

```ts
test('passes the active pane to each TerminalPane', () => {
  const sessions = [buildSession({ id: 'sess-A' }), buildSession({ id: 'sess-B' })]
  render(
    <TerminalZone
      sessions={sessions}
      activeSessionId="sess-A"
      service={mockService}
    />
  )
  const panes = screen.getAllByTestId('terminal-pane')
  expect(panes).toHaveLength(2)
  expect(panes[0].dataset.paneId).toBe('p0')
  expect(panes[0].dataset.cwd).toBe('/x')
})

test('uses awaiting-restart mode when active pane status is completed', () => {
  const session = buildSession({
    id: 'sess-A',
    status: 'completed',
    panes: [{ id: 'p0', ptyId: 'pty-A', cwd: '/x', status: 'completed', agentType: 'generic', active: true }],
  })
  render(
    <TerminalZone
      sessions={[session]}
      activeSessionId="sess-A"
      service={mockService}
    />
  )
  const pane = screen.getByTestId('terminal-pane')
  expect(pane.dataset.mode).toBe('awaiting-restart')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/features/workspace/components/TerminalZone.test.tsx
```

Expected: FAIL — TerminalZone doesn't yet pass `pane`.

- [ ] **Step 3: Update TerminalZone to use getActivePane**

In `src/features/workspace/components/TerminalZone.tsx`, update the `sessions.map` block:

```tsx
import { getActivePane } from '../../sessions/utils/activeSessionPane'

// Inside the JSX render:
sessions.map((session) => {
  const isActive = session.id === activeSessionId
  const activePane = getActivePane(session)
  const mode: TerminalPaneMode =
    activePane.status === 'completed' || activePane.status === 'errored'
      ? 'awaiting-restart'
      : activePane.restoreData
        ? 'attach'
        : 'spawn'
  const hasVisibleTab = isActive || isOpenSessionStatus(session.status)

  return (
    <div
      key={session.id}
      id={`session-panel-${session.id}`}
      role="tabpanel"
      aria-labelledby={hasVisibleTab ? `session-tab-${session.id}` : undefined}
      data-testid="terminal-pane"
      data-session-id={session.id}
      data-pane-id={activePane.id}
      data-cwd={activePane.cwd}
      data-mode={mode}
      className={`absolute inset-0 ${isActive ? '' : 'hidden'}`}
    >
      <TerminalPane
        session={session}
        pane={activePane}
        service={service}
        mode={mode}
        onCwdChange={(cwd) =>
          onSessionCwdChange?.(session.id, activePane.id, cwd)
        }
        onPaneReady={onPaneReady}
        onRestart={onSessionRestart}
        isActive={isActive}
      />
    </div>
  )
})
```

Update `TerminalZoneProps`:

- `onSessionCwdChange?: (sessionId: string, paneId: string, cwd: string) => void` (extra paneId param)
- Drop `restoreData` prop (no longer used)

- [ ] **Step 4: Run TerminalZone tests**

```bash
npx vitest run src/features/workspace/components/TerminalZone.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/workspace/components/TerminalZone.tsx src/features/workspace/components/TerminalZone.test.tsx
git commit -m "refactor(workspace): TerminalZone passes active pane to TerminalPane

TerminalZone now resolves getActivePane(session) and forwards it as the
pane prop; data-pane-id and data-cwd attributes use the active pane's
values. mode derivation reads pane.status/restoreData. onSessionCwdChange
gains a paneId parameter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15 (was 16): Update `TerminalPane/index.tsx` to consume `pane` prop

> **ORDER NOTE (Codex correction #6):** This task runs FIRST among the
> TerminalPane / TerminalZone pair so the prop is available when Task 16
> (TerminalZone) starts passing it.

**Files:**

- Modify: `src/features/terminal/components/TerminalPane/index.tsx`
- Modify: `src/features/terminal/components/TerminalPane/index.test.tsx`

- [ ] **Step 1: Update the prop interface**

In `src/features/terminal/components/TerminalPane/index.tsx`, replace `TerminalPaneProps` with:

```ts
export interface TerminalPaneProps {
  session: Session
  isActive: boolean
  service: ITerminalService
  mode?: TerminalPaneMode
  onPaneReady?: (
    sessionId: string,
    handler: PaneEventHandler
  ) => NotifyPaneReadyResult
  onClose?: (sessionId: string) => void
  onCwdChange?: (cwd: string) => void
  onRestart?: (sessionId: string) => void
  pane: Pane
}
```

The internal body now derives:

- `cwd` from `pane.cwd`
- `sessionId` (for IPC) from `pane.ptyId`
- `restoredFrom` from `pane.restoreData`

- [ ] **Step 2: Update the component body**

In the same file, replace any references to `cwd` (passed as prop) with `pane.cwd`; references to `sessionId` (for `useTerminal` etc.) with `pane.ptyId`; `restoredFrom` with `pane.restoreData`.

The `onRestart` closure passes `session.id`, NOT `pane.ptyId`:

```tsx
<RestartAffordance
  agent={agent}
  sessionId={session.id} // Session.id, not pane.ptyId
  exitedAt={session.lastActivityAt}
  onRestart={() => onRestart?.(session.id)}
/>
```

- [ ] **Step 3: Update the existing tests**

In `src/features/terminal/components/TerminalPane/index.test.tsx`, update fixtures to pass `pane` prop alongside `session`. Mock `Body` so the chrome tests don't pull xterm in:

```ts
import { vi } from 'vitest'
vi.mock('./Body', () => ({
  Body: vi.fn(() => <div data-testid="mock-body" />),
  terminalCache: new Map(),
  clearTerminalCache: vi.fn(),
  disposeTerminalSession: vi.fn(),
}))
```

Add a test asserting Body receives `pane.ptyId`:

```ts
test('forwards pane.ptyId to Body sessionId prop', () => {
  const session = buildSession({ id: 'sess-A' })
  const pane = session.panes[0]
  render(<TerminalPane session={session} pane={pane} service={mockService} ... />)
  expect(MockBody).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: pane.ptyId }),
    expect.anything()
  )
})
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/features/terminal/components/TerminalPane/index.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/components/TerminalPane/index.tsx src/features/terminal/components/TerminalPane/index.test.tsx
git commit -m "refactor(terminal): TerminalPane consumes pane prop

Chrome derives cwd/ptyId/restoreData from pane.* instead of taking them
as separate props. onRestart bubbles up session.id (not pane.ptyId) per
Decision #11 layer-(b). Body is mocked in chrome tests to skip xterm.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Update `TerminalPane/Header.tsx` to use `pane.cwd`

**Files:**

- Modify: `src/features/terminal/components/TerminalPane/Header.tsx`
- Modify: `src/features/terminal/components/TerminalPane/Header.test.tsx`

- [ ] **Step 1: Update Header to take `pane` prop (or pass `cwd` from index)**

The cleanest approach is for `index.tsx` to pass `pane.cwd` and `pane.ptyId` as the `cwd` and `sessionId` props Header already takes. If Header has its own `useGitBranch(session.workingDirectory)` call, change it to receive cwd as a prop and call `useGitBranch(props.cwd)`.

Walk the existing Header API: in step-4 chrome it takes `session: Session, branch: string | null, added: number, removed: number, ...`. Branch + ±changes are derived in `index.tsx`. Update `index.tsx` to pass `pane.cwd` to those derivations.

In `index.tsx`:

```tsx
const { branch } = useGitBranch(pane.cwd, { enabled: isActive })
const { files, filesCwd } = useGitStatus(pane.cwd, { enabled: isActive })
const { added, removed } =
  filesCwd === pane.cwd ? aggregateLineDelta(files) : { added: 0, removed: 0 }
```

Header itself doesn't need changes if it already receives `branch`, `added`, `removed` as props.

- [ ] **Step 2: Update Header tests**

If Header tests built `session` fixtures with `workingDirectory`, no changes (workingDirectory still exists as a derived field). If they passed `cwd` directly, point them at `pane.cwd`.

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/features/terminal/components/TerminalPane/
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/terminal/components/TerminalPane/index.tsx
git commit -m "refactor(terminal): TerminalPane derives git from pane.cwd

useGitBranch and useGitStatus now read pane.cwd instead of
session.workingDirectory. Multi-cwd panes (5b future) will see
per-pane branch + ±changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Update `TerminalPane/Body.tsx` to key by `pane.ptyId`

**Files:**

- Modify: `src/features/terminal/components/TerminalPane/Body.tsx`
- Modify: `src/features/terminal/components/TerminalPane/Body.test.tsx`

- [ ] **Step 1: Confirm Body's existing prop is `sessionId`**

Body takes `sessionId: string` from index. With Task 16's change, index now passes `pane.ptyId` as `sessionId`. Body's body code (`useTerminal(sessionId)`, `terminalCache.get(sessionId)`) continues to work — the value flowing through is now the ptyId.

Update the JSDoc on `Body.BodyProps.sessionId` to clarify it receives a ptyId:

```ts
export interface BodyProps {
  /** Rust PTY handle. Equals what Rust IPC calls `sessionId`; in 5a-and-later
   *  React code, this is `pane.ptyId`. Used to key xterm cache entries and
   *  the `useTerminal` hook. */
  sessionId: string
  // ...
}
```

- [ ] **Step 2: Run Body tests**

```bash
npx vitest run src/features/terminal/components/TerminalPane/Body.test.tsx
```

Expected: PASS (no behavioural change).

- [ ] **Step 3: Commit**

```bash
git add src/features/terminal/components/TerminalPane/Body.tsx
git commit -m "docs(terminal): clarify Body sessionId prop is pane.ptyId

Body's sessionId prop now carries pane.ptyId in 5a-and-later code paths.
JSDoc updated to make the contract explicit. No code change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: Update `WorkspaceView` consumers

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/WorkspaceView*.test.tsx` (multiple files)

- [ ] **Step 1: Update WorkspaceView API call sites**

In `src/features/workspace/WorkspaceView.tsx`:

```tsx
import { getActivePane } from '../sessions/utils/activeSessionPane'

// Find each updateSessionCwd / updateSessionAgentType call site.
// Replace with the pane-keyed variant. Active pane lookup:
const activePane = activeSession ? getActivePane(activeSession) : undefined

// agent-type bridge (around lines 135-156):
useEffect(() => {
  if (!activeSessionId) return
  if (agentStatus.sessionId !== activePane?.ptyId) return  // was: activeSessionId
  if (!agentStatus.isActive || !agentStatus.agentType) return
  if (activeSessionStatus !== 'running' && activeSessionStatus !== 'paused') return
  if (!activePane) return
  updatePaneAgentType(activeSessionId, activePane.id, agentStatus.agentType)
}, [...])

// onPty exit reset effect (around lines 164-174):
useEffect(() => {
  for (const session of sessions) {
    if (session.status !== 'completed' && session.status !== 'errored') continue
    const ap = getActivePane(session)
    if (ap.agentType === 'generic') continue
    updatePaneAgentType(session.id, ap.id, 'generic')
  }
}, [sessions, updatePaneAgentType])

// onSessionCwdChange now takes paneId:
<TerminalZone
  // ...
  onSessionCwdChange={updatePaneCwd}     // direct pass-through (3-arg)
  // ...
/>

// useAgentStatus now keys on activePane.ptyId:
const agentStatus = useAgentStatus(activePane?.ptyId ?? null)
```

- [ ] **Step 2: Update WorkspaceView tests**

Update `WorkspaceView.test.tsx` and friends to use `buildSession()` with `panes` populated, and verify the new bridge keys (agentStatus.sessionId === activePane.ptyId).

- [ ] **Step 3: Run all workspace tests**

```bash
npx vitest run src/features/workspace/
```

Expected: PASS for all.

- [ ] **Step 4: Commit**

```bash
git add src/features/workspace/
git commit -m "refactor(workspace): WorkspaceView uses pane-keyed manager API

agent-type bridge re-keyed to compare agentStatus.sessionId against
activePane.ptyId (both are now ptyIds). updatePaneCwd /
updatePaneAgentType call sites updated. useAgentStatus(activePane.ptyId)
matches the Rust handle. agentForSession resolution unchanged because
session.agentType is still on Session as a derived materialized field.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: Final integration sweep

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

```bash
set -o pipefail; npm run test 2>&1 | tail -3
```

Expected: ≥ baseline test count from Task 0. Failed exit code propagates
through `tail` thanks to `pipefail` — without it, a failing test run
silently appears successful.

- [ ] **Step 2: Type check**

```bash
set -o pipefail; npm run type-check 2>&1 | tail -3
```

Expected: 0 errors.

- [ ] **Step 3: Lint**

```bash
set -o pipefail; npm run lint 2>&1 | tail -3
```

Expected: 0 errors, 0 warnings (no `console.log`, `test()` not `it()`).

- [ ] **Step 4: Format check**

```bash
set -o pipefail; npm run format:check 2>&1 | tail -3
```

Expected: clean. If not, run `npm run format` and amend the most recent commit.

- [ ] **Step 5: Smoke-test the dev server**

```bash
npm run dev &
DEV_PID=$!
sleep 5
# Verify the workspace renders without console errors. Browse to http://localhost:5173.
# Manually click a session in the sidebar, type into the terminal, switch tabs, restart.
kill $DEV_PID
```

Expected: workspace loads, terminal interactive, tab switching works, restart preserves Session.id (UI doesn't flicker).

- [ ] **Step 6: Optional — record line-count summary**

```bash
wc -l src/features/sessions/hooks/*.ts src/features/sessions/utils/*.ts src/features/terminal/orchestration/*.ts src/features/terminal/hooks/*.ts
```

Expected: `useSessionManager.ts` ~450 LOC; sub-hooks each under 200 LOC.

- [ ] **Step 7: Final commit (if any cleanup)**

If this step revealed any forgotten file or test fixup, commit it:

```bash
git add -p
git commit -m "chore(sessions): final cleanup post-refactor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

If nothing to commit: skip.

---

## Self-Review (after writing the plan)

- ✅ **Spec coverage:** Each section of the spec maps to tasks above. §1 architecture (types + module decomposition) → Tasks 1-13. §2 lifecycle → Task 14. §3 component APIs → Tasks 15-18. §4 migration mechanics → Tasks 13 (restore-merge) + Task 14 (manager mutations) + Task 19 (consumers). Testing approach → covered per-task.

- ✅ **Placeholder scan:** No "TBD", "TODO", "implement later". Every task has concrete code blocks.

- ✅ **Type consistency:** `Session`, `Pane`, `LayoutId`, `RestoreData`, `PaneEventHandler` reference the same paths and field names across tasks. `getActivePane`, `deriveSessionStatus`, `tabName`, `sessionFromInfo` invocations match their declared signatures.

- ⚠️ **Known intra-task gaps:**
  - Task 6 has a "Task 6 alternative" because `getActivePane` tests need `Session.panes` which only lands in Task 8. The alternative uses a `MockSession` cast. This is acceptable but flagged.
  - `useActiveSessionController.setActiveSessionIdRaw` is typed as `(id: string) => void` in Task 11; Task 14 widens it to `(id: string | null) => void`. The widening edit is in Task 14 Step 4.
  - Task 17 mentions `index.tsx` modifications but the file change is folded into Task 16's commit. Treated as a continuation of the prior commit; no separate commit needed.

- 📋 **PR shape:** 19 commits on `docs/step-5a-pane-model-spec`. Each commit ships green (vitest + lint + tsc clean). Total ~+880 / -865 LOC matches spec's prediction.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-step-5a-pane-model-refactor.md`.**

> Per the calling planner: control returns to `/lifeline:planner` for codex review of this plan before any implementation begins. Do NOT chain to executing-plans or subagent-driven-development from here.

After codex review of this plan completes, the user will pick the execution mode (subagent-driven or inline) at that time.

<!-- codex-reviewed: 2026-05-10T14:14:57Z -->
