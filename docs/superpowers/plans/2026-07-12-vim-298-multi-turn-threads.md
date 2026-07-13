# VIM-298 Multi-Turn Finding Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-shot inline Q&A into multi-turn conversations: turns at one anchor render as a single GitHub-style thread card with a Reply/Resolve footer, and a follow-up dispatches alone to the agent via the VIM-297 single-comment path.

**Architecture:** A `threadId` on `ReviewComment` links turns (stamped at dispatch, inherited by agent replies through `PendingReviewHandle`); a pure render-layer selector pre-groups annotations into one anchor per thread before Pierre (mechanism A); a new `ReviewThreadCard` renders the settled demo recipe; follow-ups are created atomically with a successful dispatch (post-write, pre-stamped insert). Resolve is local state (`resolvedAt` on the root).

**Tech Stack:** React 19 + TypeScript, `@pierre/diffs` (`MultiFileDiff` annotations), Vitest + Testing Library. Frontend only — no Rust/bindings changes.

**Spec:** `docs/superpowers/specs/2026-07-11-vim-298-multi-turn-threads-design.md` (codex-reviewed). Read it first; every design rule referenced below (groupKey, rollup totality, atomic follow-up, affinity v1) is normative there.

**Working rules for the executor:**

- Run everything from the worktree root (`.claude/worktrees/vim-298-thread-ui`), branch `feature/vim-298`.
- TDD per task: failing test → implement → pass → commit. `test()` not `it()`; Testing Library role queries first; inline single-use test data.
- No hardcoded colors outside `src/theme/**` (`vimeflow/no-hardcoded-colors`); no `title=` attributes; no `console.log`; explicit return types on exports.
- If the pre-commit hook is killed under memory pressure, run `npx lint-staged --concurrent false` manually — do not skip the gate silently.

## File Structure

| File                                                      | Change                                                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/diff/hooks/useFeedbackBatch.ts`             | `ReviewComment` gains `threadId`/`resolvedAt`/`dispatchedTo`; `markDispatched` stamps thread fields; cap check keys on pending-ness |
| `src/features/diff/services/pendingReviews.ts`            | `PendingReviewHandle` gains `threadId`                                                                                              |
| `src/features/diff/hooks/useAgentReply.ts`                | `attachAgentNote` copies `handle.threadId`                                                                                          |
| `src/features/diff/hooks/useAgentReview.ts`               | findings self-root (`threadId = id`); anchored handles carry it                                                                     |
| `src/features/diff/reviewCategoryMeta.ts`                 | `THREAD_ROLLUP_META`                                                                                                                |
| `src/features/diff/services/threadGroups.ts` (new)        | `threadGroupKey`, `threadRollup`, `buildThreadGroups`, `threadAnchorLabel`, `ThreadGroup`                                           |
| `src/features/diff/components/ReviewCommentEditor.tsx`    | `mode: 'comment' \| 'reply'`                                                                                                        |
| `src/features/diff/services/feedbackDispatch.ts`          | Follow-up label/instruction, `followUpContextLine`, payload context param                                                           |
| `src/features/diff/components/ReviewThreadCard.tsx` (new) | The thread card (settled demo recipe)                                                                                               |
| `src/features/diff/components/PanelBody.tsx`              | Thread-group branch in `renderAnnotation`                                                                                           |
| `src/features/diff/Panel.tsx`                             | Grouping memos, reply draft state, `handleSendThreadReply`, popover scoping, resolve/reopen, file strip                             |
| `src/features/diff/agentReplyThread.integration.test.tsx` | Full multi-turn loop                                                                                                                |

---

### Task 1: Thread fields on `ReviewComment` + stamping + cap fix

**Files:**

- Modify: `src/features/diff/hooks/useFeedbackBatch.ts`
- Test: `src/features/diff/hooks/useFeedbackBatch.test.ts`

- [ ] **Step 1: Write the failing tests** (append to the existing file's describe structure, reusing its store-harness patterns — the file already tests `markDispatched` and the cap):

```ts
test('markDispatched stamps threadId as its own id on a root comment', () => {
  // seed one pending self comment with id 'c1' via the file's existing add helper,
  // then:
  //   markDispatched(1000, new Set(['c1']))
  // assert the annotation's metadata now has dispatchedAt: 1000 and threadId: 'c1'
})

test('markDispatched preserves an existing threadId (follow-up must not fork)', () => {
  // seed a pending self comment with metadata { id: 'c2', threadId: 'root-1', ... }
  //   markDispatched(1000, new Set(['c2']))
  // assert metadata.threadId === 'root-1' (NOT 'c2')
})

test('markDispatched stamps dispatchedTo when provided', () => {
  //   markDispatched(1000, new Set(['c1']), { dispatchedTo: 'pty-9' })
  // assert metadata.dispatchedTo === 'pty-9'
})

test('an already-dispatched self insert succeeds at the 50-pending cap', () => {
  // seed exactly 50 pending self comments (loop addAnnotation)
  // then addAnnotation with metadata { id: 'f1', author: 'self',
  //   dispatchedAt: 1000, threadId: 'root-1', text: 'follow', createdAt: 1 }
  // assert the result is 'ok' and the annotation is in the batch
})

test('a pending self insert is still rejected at the cap', () => {
  // seed 50 pending; addAnnotation of a pending self comment → 'cap-reached'
})
```

Write them as real tests against `useFeedbackBatchStore` exactly the way neighboring tests in the file construct it (renderHook or the file's harness component — match what is already there).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/diff/hooks/useFeedbackBatch.test.ts`
Expected: the new tests FAIL (`threadId` undefined; cap insert returns 'cap-reached').

- [ ] **Step 3: Implement.** In `useFeedbackBatch.ts`:

(a) Extend `ReviewComment` (after the `target` field):

```ts
  /**
   * Root comment id of the thread this turn belongs to (VIM-298). Stamped on
   * dispatch (`threadId ?? id` — a follow-up keeps its root, a root self-roots);
   * agent replies inherit it from the dispatch handle. Pending comments never
   * carry one — they are not conversations yet.
   */
  threadId?: string
  /**
   * Local thread resolution (VIM-298), set on the thread ROOT only. Purely
   * client-side — nothing is dispatched on resolve; a late agent turn does not
   * clear it (resolution is authoritative).
   */
  resolvedAt?: number
  /** ptyId of the session this comment was dispatched to (VIM-298 affinity). */
  dispatchedTo?: string
```

(b) In `markDispatched`, extend the options type to
`options?: { clearDraftForWholeBatch?: boolean; dispatchedTo?: string }` and replace the stamping object:

```ts
                ? {
                    ...annotation,
                    metadata: {
                      ...annotation.metadata,
                      dispatchedAt,
                      threadId:
                        annotation.metadata.threadId ?? annotation.metadata.id,
                      ...(options?.dispatchedTo === undefined
                        ? {}
                        : { dispatchedTo: options.dispatchedTo }),
                    },
                  }
                : annotation
```

(c) Cap-exempt dispatched inserts — in `addAnnotationForOwner` there are TWO cap checks (optimistic ref + inside `setBatchesByOwner`). In both, replace the condition `annotation.metadata.author === 'self'` with `isPendingReviewAnnotation(annotation)`:

```ts
      if (
        isPendingReviewAnnotation(annotation) &&
        countPendingInBatch(optimisticBatch) >= SOFT_CAP
      ) {
```

(The cap guards the _pending_ review the user is assembling; a pre-stamped dispatched follow-up is thread history, like agent output. `isPendingReviewAnnotation` = `author === 'self' && dispatchedAt === undefined`, so pending behavior is unchanged.)

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/features/diff/hooks/useFeedbackBatch.test.ts`
Expected: PASS (all, including pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/hooks/useFeedbackBatch.ts src/features/diff/hooks/useFeedbackBatch.test.ts
git commit -m "feat(diff): thread fields on ReviewComment + dispatch stamping (VIM-298)"
```

---

### Task 2: `threadId` through handles, agent replies, and finding placement

**Files:**

- Modify: `src/features/diff/services/pendingReviews.ts`
- Modify: `src/features/diff/Panel.tsx` (`buildFeedbackEntries`, `handleSendFeedback`)
- Modify: `src/features/diff/hooks/useAgentReply.ts`
- Modify: `src/features/diff/hooks/useAgentReview.ts`
- Test: `src/features/diff/hooks/useAgentReply.test.ts`, `src/features/diff/hooks/useAgentReview.test.ts`, `src/features/diff/Panel.test.tsx`

- [ ] **Step 1: Write the failing tests.**

In `useAgentReply.test.ts` (match the file's existing event-emission harness):

```ts
test('an agent reply inherits the handle threadId', async () => {
  // setPendingReview with byHandle: new Map([[1, { cwd, filePath, staged: false,
  //   lineNumber: 5, side: 'additions', target: undefined, threadId: 'root-1' }]])
  // emit an agent-reply for [#1]
  // assert addAnnotationForOwner was called with metadata containing threadId: 'root-1'
})
```

In `useAgentReview.test.ts`:

```ts
test('a placed finding self-roots its thread', async () => {
  // emit an agent-review event with one line-scoped finding on a diffed file
  // assert the placed annotation's metadata.threadId === metadata.id
})
```

In `Panel.test.tsx`, if the file already has a dispatch-path test asserting `setPendingReview` contents, extend it to assert each handle now carries `threadId` equal to the dispatched comment's id; otherwise add one following the file's existing dispatch test setup.

**Existing assertion to update:** `useAgentReview.test.ts` (~lines 325–332) exactly compares the anchored handle shape — it will fail once handles carry `threadId`. Extend that expected object with `threadId: <the placed finding's comment id>` as part of this task (it is the behavior change, not collateral).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/diff/hooks/useAgentReply.test.ts src/features/diff/hooks/useAgentReview.test.ts src/features/diff/Panel.test.tsx`
Expected: new tests FAIL (no `threadId` anywhere).

- [ ] **Step 3: Implement.**

(a) `pendingReviews.ts` — add to `PendingReviewHandle` after `target`:

```ts
  /**
   * The thread the addressed comment roots or belongs to (VIM-298):
   * `comment.threadId ?? comment.id`, captured at handle registration so the
   * agent's reply lands in the same thread group.
   */
  threadId?: string
```

(b) `Panel.tsx` `buildFeedbackEntries` — in the `handles.set(...)` object add:

```ts
            threadId: annotation.metadata.threadId ?? annotation.metadata.id,
```

(c) `Panel.tsx` `handleSendFeedback` — the `feedback.markDispatched(...)` call's options become:

```ts
            { clearDraftForWholeBatch: onlyCommentId === undefined, dispatchedTo: pane.ptyId }
```

(d) `useAgentReply.ts` `attachAgentNote` — in the metadata object, after the `target` spread:

```ts
            ...(handle.threadId === undefined
              ? {}
              : { threadId: handle.threadId }),
```

(e) `useAgentReview.ts` — in `reviewerAnnotation`, self-root the finding:

```ts
const id = nextCommentId()
const metadata: ReviewComment = {
  id,
  threadId: id,
  text: finding.text,
  author: 'reviewer',
  reviewer,
  category: finding.category as ReviewCommentCategory,
  createdAt: Date.now(),
}
```

(remove the old `id: nextCommentId(),` line). Then in the `byOrdinal.set(ordinal, { kind: 'anchored', ... })` handle object add `threadId: annotation.metadata.id,`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/features/diff/hooks/useAgentReply.test.ts src/features/diff/hooks/useAgentReview.test.ts src/features/diff/Panel.test.tsx src/features/diff/agentReplyThread.integration.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/services/pendingReviews.ts src/features/diff/Panel.tsx src/features/diff/hooks/useAgentReply.ts src/features/diff/hooks/useAgentReview.ts src/features/diff/hooks/useAgentReply.test.ts src/features/diff/hooks/useAgentReview.test.ts src/features/diff/Panel.test.tsx
git commit -m "feat(diff): thread identity through dispatch handles and replies (VIM-298)"
```

---

### Task 3: Grouping selector + rollup metas

**Files:**

- Modify: `src/features/diff/reviewCategoryMeta.ts`
- Create: `src/features/diff/services/threadGroups.ts`
- Test: `src/features/diff/services/threadGroups.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/features/diff/services/threadGroups.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from '../hooks/useFeedbackBatch'
import { DRAFT_ID } from '../hooks/useFeedbackBatch'
import {
  buildThreadGroups,
  threadAnchorLabel,
  threadGroupKey,
  threadRollup,
} from './threadGroups'

const LOCATION = { cwd: '/repo', filePath: 'src/foo.ts', staged: false }

const annotation = (
  metadata: Partial<ReviewComment> & { id: string },
  lineNumber = 5
): DiffLineAnnotation<ReviewComment> => ({
  side: 'additions',
  lineNumber,
  metadata: {
    text: 't',
    author: 'self',
    createdAt: 1,
    ...metadata,
  } as ReviewComment,
})

describe('threadGroupKey', () => {
  test('pending self comments and the draft sentinel have no key', () => {
    expect(threadGroupKey(annotation({ id: 'p1' }))).toBeUndefined()
    expect(threadGroupKey(annotation({ id: DRAFT_ID }))).toBeUndefined()
  })

  test('threadId wins; dispatched and non-self fall back to own id', () => {
    expect(threadGroupKey(annotation({ id: 'a1', threadId: 'root-1' }))).toBe(
      'root-1'
    )
    expect(threadGroupKey(annotation({ id: 'c1', dispatchedAt: 1000 }))).toBe(
      'c1'
    )
    expect(threadGroupKey(annotation({ id: 'g1', author: 'agent' }))).toBe('g1')
  })
})

describe('buildThreadGroups', () => {
  test('collapses a thread to one anchor and passes pending through', () => {
    const root = annotation({ id: 'c1', dispatchedAt: 1000, threadId: 'c1' })
    const reply = annotation({ id: 'g1', author: 'agent', threadId: 'c1' })
    const pending = annotation({ id: 'p1' })
    const { collapsed, groups } = buildThreadGroups(
      [root, reply, pending],
      LOCATION
    )

    expect(collapsed).toEqual([root, pending])
    expect(groups.get('c1')?.turns).toEqual([root, reply])
    expect(groups.get('c1')).toMatchObject(LOCATION)
  })

  test('two roots on one line stay two groups', () => {
    const { groups } = buildThreadGroups(
      [
        annotation({ id: 'c1', dispatchedAt: 1, threadId: 'c1' }),
        annotation({ id: 'c2', dispatchedAt: 2, threadId: 'c2' }),
      ],
      LOCATION
    )

    expect(groups.size).toBe(2)
  })

  test('resolved derives from the root comment', () => {
    const { groups } = buildThreadGroups(
      [
        annotation({
          id: 'c1',
          dispatchedAt: 1,
          threadId: 'c1',
          resolvedAt: 2000,
        }),
        annotation({ id: 'g1', author: 'agent', threadId: 'c1' }),
      ],
      LOCATION
    )

    expect(groups.get('c1')?.resolved).toBe(true)
    expect(groups.get('c1')?.rollup.label).toBe('Resolved')
  })
})

describe('threadRollup', () => {
  test('is total over the latest turn (full outcome matrix)', () => {
    const agent = (outcome?: ReviewComment['outcome']) =>
      annotation({ id: 'g', author: 'agent', ...(outcome ? { outcome } : {}) })

    expect(threadRollup([agent('reply')], false).label).toBe('Replied')
    expect(threadRollup([agent('clarify')], false).label).toBe('Awaiting you')
    expect(threadRollup([agent('resolved')], false).label).toBe('Resolved')
    expect(threadRollup([agent('deferred')], false).label).toBe('Deferred')
    expect(threadRollup([agent('rejected')], false).label).toBe('Rejected')
    expect(threadRollup([agent()], false).label).toBe('Replied')
    expect(
      threadRollup(
        [agent('clarify'), annotation({ id: 'f', dispatchedAt: 3 })],
        false
      ).label
    ).toBe('Sent')
    expect(
      threadRollup([annotation({ id: 'r', author: 'reviewer' })], false).label
    ).toBe('Open')
    // Local resolve overrides every derived state.
    expect(threadRollup([agent('rejected')], true).label).toBe('Resolved')
  })
})

describe('threadAnchorLabel', () => {
  test('labels line, range, and file anchors', () => {
    expect(threadAnchorLabel(annotation({ id: 'a' }, 40))).toBe('line R40')
    expect(
      threadAnchorLabel(
        annotation({
          id: 'b',
          target: {
            scope: 'range',
            side: 'additions',
            startLine: 88,
            endLine: 94,
          },
        })
      )
    ).toBe('lines R88-R94')
    expect(
      threadAnchorLabel(annotation({ id: 'c', target: { scope: 'file' } }, 0))
    ).toBe('file')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/diff/services/threadGroups.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement.**

(a) `reviewCategoryMeta.ts` — append:

```ts
/**
 * Chip metas for thread rollup states that no single agent turn carries
 * (VIM-298): Sent = latest turn is a dispatched user turn (awaiting the
 * agent); Open = a reviewer finding with no agent turn yet; Resolved =
 * the user resolved the thread locally (reuses the outcome meta).
 */
export const THREAD_ROLLUP_META = {
  sent: { label: 'Sent', chip: 'text-primary' },
  open: { label: 'Open', chip: 'text-on-surface-variant' },
  resolved: AGENT_OUTCOME_META.resolved,
} as const
```

(b) Create `src/features/diff/services/threadGroups.ts`:

```ts
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from '../hooks/useFeedbackBatch'
import { AGENT_OUTCOME_META, THREAD_ROLLUP_META } from '../reviewCategoryMeta'

/**
 * One rendered conversation (VIM-298): the store stays flat, this is the
 * derived view-model. `turns` is store order (arrival order — attachAgentNote
 * appends). The batch-location snapshot is captured at group construction so
 * the follow-up dispatch has both the repo-relative handle coordinates and an
 * input to the repo-root resolver without re-deriving from render-time props.
 */
export interface ThreadGroup {
  threadId: string
  turns: DiffLineAnnotation<ReviewComment>[]
  rollup: { label: string; chip: string }
  resolved: boolean
  cwd: string
  filePath: string
  staged: boolean
}

export interface ThreadGroupsResult {
  /** One anchor annotation per group + pass-through pending/draft rows. */
  collapsed: DiffLineAnnotation<ReviewComment>[]
  groups: Map<string, ThreadGroup>
}

/**
 * The grouping key: threadId when present; orphan agent/reviewer annotations
 * and legacy dispatched roots self-key; pending user comments (and the draft
 * sentinel) have none — they render as flat rows, never inside a card.
 */
export const threadGroupKey = (
  annotation: DiffLineAnnotation<ReviewComment>
): string | undefined =>
  annotation.metadata.threadId ??
  (annotation.metadata.author !== 'self' ||
  annotation.metadata.dispatchedAt !== undefined
    ? annotation.metadata.id
    : undefined)

/**
 * Total rollup over the LATEST turn (a dispatched follow-up after a `clarify`
 * flips the thread back to awaiting the agent), with local resolve on top.
 * Every self turn inside a thread is dispatched by construction (follow-ups
 * are created atomically with a successful dispatch), so the self arm is Sent.
 */
export const threadRollup = (
  turns: DiffLineAnnotation<ReviewComment>[],
  resolved: boolean
): { label: string; chip: string } => {
  if (resolved) {
    return THREAD_ROLLUP_META.resolved
  }

  const latest = turns[turns.length - 1]?.metadata
  if (latest === undefined || latest.author === 'reviewer') {
    return THREAD_ROLLUP_META.open
  }

  if (latest.author === 'agent') {
    return latest.outcome === undefined
      ? AGENT_OUTCOME_META.reply
      : AGENT_OUTCOME_META[latest.outcome]
  }

  return THREAD_ROLLUP_META.sent
}

export const buildThreadGroups = (
  annotations: DiffLineAnnotation<ReviewComment>[],
  location: { cwd: string; filePath: string; staged: boolean }
): ThreadGroupsResult => {
  const groups = new Map<string, ThreadGroup>()
  const collapsed: DiffLineAnnotation<ReviewComment>[] = []

  for (const annotation of annotations) {
    const key = threadGroupKey(annotation)
    if (key === undefined) {
      collapsed.push(annotation)
      continue
    }

    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, {
        threadId: key,
        turns: [annotation],
        rollup: THREAD_ROLLUP_META.open,
        resolved: false,
        ...location,
      })
      collapsed.push(annotation)
      continue
    }

    existing.turns.push(annotation)
  }

  for (const group of groups.values()) {
    const root =
      group.turns.find((turn) => turn.metadata.id === group.threadId) ??
      group.turns[0]
    group.resolved = root?.metadata.resolvedAt !== undefined
    group.rollup = threadRollup(group.turns, group.resolved)
  }

  return { collapsed, groups }
}

/**
 * Anchor label for the card header, total over line / range / file scopes
 * (PanelBody's private annotationTargetLabel only labels ranges).
 */
export const threadAnchorLabel = (
  annotation: DiffLineAnnotation<ReviewComment>
): string => {
  const target = annotation.metadata.target
  if (target?.scope === 'file') {
    return 'file'
  }

  if (target?.scope === 'range') {
    const prefix = target.side === 'deletions' ? 'L' : 'R'

    return target.startLine === target.endLine
      ? `line ${prefix}${target.startLine}`
      : `lines ${prefix}${target.startLine}-${prefix}${target.endLine}`
  }

  const prefix = annotation.side === 'deletions' ? 'L' : 'R'

  return `line ${prefix}${annotation.lineNumber}`
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/diff/services/threadGroups.test.ts src/features/diff/reviewCategoryMeta.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/services/threadGroups.ts src/features/diff/services/threadGroups.test.ts src/features/diff/reviewCategoryMeta.ts
git commit -m "feat(diff): thread grouping selector + rollup metas (VIM-298)"
```

---

### Task 4: `reply` mode on `ReviewCommentEditor`

**Files:**

- Modify: `src/features/diff/components/ReviewCommentEditor.tsx`
- Test: `src/features/diff/components/ReviewCommentEditor.test.tsx`

- [ ] **Step 1: Write the failing tests** (append to the existing test file):

```ts
test('reply mode hides category tabs and relabels the chrome', () => {
  render(
    <ReviewCommentEditor
      mode="reply"
      chrome="plain"
      surfaceRole="none"
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />
  )

  expect(screen.getByText('Reply to thread')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Question' })).toBeNull()
  expect(screen.getByPlaceholderText('Reply to the agent…')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument()
})

test('reply mode ignores the ctrl+h/l category cycle', async () => {
  const onConfirm = vi.fn()
  render(
    <ReviewCommentEditor mode="reply" onConfirm={onConfirm} onCancel={vi.fn()} />
  )

  const textarea = screen.getByPlaceholderText('Reply to the agent…')
  fireEvent.keyDown(textarea, { key: 'l', ctrlKey: true })
  fireEvent.change(textarea, { target: { value: 'follow-up' } })
  fireEvent.keyDown(textarea, { key: 'Enter' })

  expect(onConfirm).toHaveBeenCalledWith('follow-up', 'change')
})
```

(The second test pins that confirm still passes the default category — the reply-mode caller ignores it, per spec.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/diff/components/ReviewCommentEditor.test.tsx`
Expected: FAIL — unknown prop / 'Local comment' rendered.

- [ ] **Step 3: Implement.** In `ReviewCommentEditor.tsx`:

(a) Add to `ReviewCommentEditorBaseProps`:

```ts
  /**
   * 'reply' = a typeless thread follow-up (VIM-298): category tabs hidden and
   * the cycle shortcuts inert, chrome copy reads Reply. Default 'comment'.
   */
  mode?: 'comment' | 'reply'
```

destructure `mode = 'comment'` in the component.

(b) Guard the cycle at the top of `cycleCategory`:

```ts
if (mode === 'reply') {
  return
}
```

(c) Header label: replace the literal `Local comment` text node with `{mode === 'reply' ? 'Reply to thread' : 'Local comment'}`.

(d) Wrap the category-tabs `<div className="flex flex-wrap items-center gap-1">…</div>` block in `{mode === 'reply' ? null : ( … )}`.

(e) Textarea placeholder: `placeholder={mode === 'reply' ? 'Reply to the agent…' : 'Request change'}`.

(f) Confirm button text: `{mode === 'reply' ? 'Reply' : 'Comment'}`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/features/diff/components/ReviewCommentEditor.test.tsx`
Expected: PASS (including all pre-existing tests — default mode unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/components/ReviewCommentEditor.tsx src/features/diff/components/ReviewCommentEditor.test.tsx
git commit -m "feat(diff): typeless reply mode on the comment editor (VIM-298)"
```

---

### Task 5: Follow-up payload formatting

**Files:**

- Modify: `src/features/diff/services/feedbackDispatch.ts`
- Test: `src/features/diff/services/feedbackDispatch.test.ts`

- [ ] **Step 1: Write the failing tests** (append; reuse the file's existing entry-construction helpers):

```ts
test('a typeless follow-up renders as [#n · Follow-up] with the context line', () => {
  const payload = formatFeedbackPayload(
    [
      {
        filePath: '/repo/src/auth.ts',
        staged: false,
        annotations: [
          {
            side: 'additions',
            lineNumber: 42,
            metadata: {
              id: 'f1',
              text: 'How does that interact with resize?',
              author: 'self',
              createdAt: 1,
              threadId: 'root-1',
            },
          },
        ],
      },
    ],
    'abc123',
    '> ↩ Continuing our thread — your last reply: "The pool applies backpressure"'
  )

  expect(payload).toContain('[#1 · Follow-up] /repo/src/auth.ts:42')
  expect(payload).toContain(
    '> ↩ Continuing our thread — your last reply: "The pool applies backpressure"'
  )
  expect(payload).toContain(
    '> → Answer inline in your reply. Do not edit files.'
  )
  expect(payload).not.toContain('Change request')
})

test('followUpContextLine phrases by author, truncates, and strips controls', () => {
  expect(
    followUpContextLine({
      id: 'g1',
      text: 'short answer',
      author: 'agent',
      createdAt: 1,
    })
  ).toBe('> ↩ Continuing our thread — your last reply: "short answer"')

  expect(
    followUpContextLine({
      id: 'r1',
      text: 'finding text',
      author: 'reviewer',
      createdAt: 1,
    })
  ).toContain('the finding: "finding text"')

  expect(
    followUpContextLine({
      id: 'c1',
      text: 'my question',
      author: 'self',
      createdAt: 1,
    })
  ).toContain('my earlier comment: "my question"')

  const long = followUpContextLine({
    id: 'g2',
    text: 'x'.repeat(300),
    author: 'agent',
    createdAt: 1,
  })
  expect(long).toContain('(truncated)')
  expect(long.length).toBeLessThan(300)

  // Paste-breakout regression: agent-controlled text cannot terminate the
  // bracketed paste or inject CR into the prompt.
  const hostile = followUpContextLine({
    id: 'g3',
    text: 'evil\x1b[201~\rinjected',
    author: 'agent',
    createdAt: 1,
  })
  expect(hostile).not.toContain('\x1b')
  expect(hostile).not.toContain('\r')
})

test('a category-less dispatched ROOT is not a follow-up', () => {
  // threadId === id (self-rooted) + no category → still the default Change
  // request in the payload, NOT [#n · Follow-up].
  expect(
    isFollowUpComment({
      id: 'c1',
      threadId: 'c1',
      text: 't',
      author: 'self',
      createdAt: 1,
      dispatchedAt: 1000,
    })
  ).toBe(false)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/diff/services/feedbackDispatch.test.ts`
Expected: FAIL — `followUpContextLine` not exported; label renders `Change request`.

- [ ] **Step 3: Implement.** In `feedbackDispatch.ts`:

(a) After `CATEGORY_INSTRUCTION`, add:

```ts
/**
 * A typeless thread follow-up (VIM-298): belongs to ANOTHER root's thread and
 * has no category. `threadId !== id` is load-bearing — a dispatched ROOT
 * self-stamps `threadId === id` and may legitimately omit category (defaults
 * to a change request); it must NOT be classified as a follow-up.
 */
export const isFollowUpComment = (comment: ReviewComment): boolean =>
  comment.author === 'self' &&
  comment.threadId !== undefined &&
  comment.threadId !== comment.id &&
  comment.category === undefined

const FOLLOW_UP_LABEL = 'Follow-up'
const FOLLOW_UP_INSTRUCTION = 'Answer inline in your reply. Do not edit files.'
const FOLLOW_UP_EXCERPT_MAX = 200

/**
 * The one-line continuation marker quoting the latest prior turn (VIM-298).
 * The excerpt is agent-controlled text, so it passes the same control-char
 * strip as everything else entering the bracketed paste.
 */
export const followUpContextLine = (previous: ReviewComment): string => {
  const phrasing =
    previous.author === 'agent'
      ? 'your last reply'
      : previous.author === 'reviewer'
        ? 'the finding'
        : 'my earlier comment'
  const clean = stripControls(previous.text)
  const truncated = clean.length > FOLLOW_UP_EXCERPT_MAX
  const excerpt = truncated ? clean.slice(0, FOLLOW_UP_EXCERPT_MAX) : clean

  return `> ↩ Continuing our thread — ${phrasing}: "${excerpt}"${truncated ? ' (truncated)' : ''}`
}
```

(b) `formatFeedbackPayload` gains a third parameter `followUpContext?: string`. In the per-annotation loop, compute follow-up-aware label/instruction and insert the context line:

```ts
const followUp = isFollowUpComment(annotation.metadata)
const label = followUp ? FOLLOW_UP_LABEL : CATEGORY_LABEL[category]
const instruction = followUp
  ? FOLLOW_UP_INSTRUCTION
  : CATEGORY_INSTRUCTION[category]

blocks.push(
  [
    `> [#${index} · ${label}] ${formatAnnotationTarget(entry, annotation)}`,
    ...(followUp && followUpContext !== undefined ? [followUpContext] : []),
    ...textLines,
    `> → ${instruction}`,
    '>',
  ].join('\n')
)
```

(c) `dispatchFeedbackBatch` gains a trailing optional `followUpContext?: string` parameter, passed through to `formatFeedbackPayload(entries, nonce, followUpContext)`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/features/diff/services/feedbackDispatch.test.ts`
Expected: PASS (existing dispatch-vocab pins untouched — non-follow-up output is byte-identical).

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/services/feedbackDispatch.ts src/features/diff/services/feedbackDispatch.test.ts
git commit -m "feat(diff): follow-up payload format + thread context line (VIM-298)"
```

---

### Task 6: `ReviewThreadCard`

**Files:**

- Create: `src/features/diff/components/ReviewThreadCard.tsx`
- Test: `src/features/diff/components/ReviewThreadCard.test.tsx`

- [ ] **Step 1: Write the failing test** — create the test file:

```tsx
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ThreadGroup } from '../services/threadGroups'
import { ReviewThreadCard } from './ReviewThreadCard'

const group = (overrides: Partial<ThreadGroup> = {}): ThreadGroup => ({
  threadId: 'c1',
  turns: [
    {
      side: 'additions',
      lineNumber: 40,
      metadata: {
        id: 'c1',
        text: 'Why does the cap live here?',
        author: 'self',
        category: 'question',
        createdAt: 1,
        dispatchedAt: 1000,
        threadId: 'c1',
      },
    },
    {
      side: 'additions',
      lineNumber: 40,
      metadata: {
        id: 'g1',
        text: 'The pool applies backpressure per write.',
        author: 'agent',
        outcome: 'reply',
        createdAt: 2,
        threadId: 'c1',
      },
    },
  ],
  rollup: { label: 'Replied', chip: 'text-success' },
  resolved: false,
  cwd: '/repo',
  filePath: 'src/foo.ts',
  staged: false,
  ...overrides,
})

const actions = (
  overrides: Partial<Parameters<typeof ReviewThreadCard>[0]['actions']> = {}
): NonNullable<Parameters<typeof ReviewThreadCard>[0]['actions']> => ({
  replying: false,
  replyDraft: '',
  onStartReply: vi.fn(),
  onReplyDraftChange: vi.fn(),
  onSubmitReply: vi.fn(),
  onCancelReply: vi.fn(),
  onResolve: vi.fn(),
  onReopen: vi.fn(),
  ...overrides,
})

describe('ReviewThreadCard', () => {
  test('renders header, ordered turns, chips, and the footer pair', () => {
    render(
      <ReviewThreadCard
        group={group()}
        anchorLabel="line R40"
        actions={actions()}
      />
    )

    expect(screen.getByText('line R40')).toBeInTheDocument()
    expect(screen.getByText('2 turns')).toBeInTheDocument()
    expect(screen.getByText('Replied')).toBeInTheDocument()
    expect(screen.getByText('Why does the cap live here?')).toBeInTheDocument()
    expect(
      screen.getByText('The pool applies backpressure per write.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reply/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument()
  })

  test('typeless follow-up turns render no category chip', () => {
    const g = group()
    g.turns.push({
      side: 'additions',
      lineNumber: 40,
      metadata: {
        id: 'f1',
        text: 'And during drags?',
        author: 'self',
        createdAt: 3,
        dispatchedAt: 2000,
        threadId: 'c1',
      },
    })
    render(
      <ReviewThreadCard group={g} anchorLabel="line R40" actions={actions()} />
    )

    // Exactly one category chip (the root's Question) despite two self turns.
    expect(screen.getAllByText('Question')).toHaveLength(1)
  })

  test('reply expands the editor; confirm submits the draft', () => {
    const a = actions({ replying: true, replyDraft: 'follow-up text' })
    render(
      <ReviewThreadCard group={group()} anchorLabel="line R40" actions={a} />
    )

    fireEvent.keyDown(screen.getByPlaceholderText('Reply to the agent…'), {
      key: 'Enter',
    })
    expect(a.onSubmitReply).toHaveBeenCalledWith('follow-up text')
  })

  test('no actions → no footer', () => {
    render(<ReviewThreadCard group={group()} anchorLabel="line R40" />)

    expect(screen.queryByRole('button', { name: /reply/i })).toBeNull()
  })

  test('resolved collapses to a disclosure header; expanding reveals Reopen', () => {
    render(
      <ReviewThreadCard
        group={group({
          resolved: true,
          rollup: { label: 'Resolved', chip: 'text-success' },
        })}
        anchorLabel="line R40"
        actions={actions()}
      />
    )

    expect(screen.queryByText('Why does the cap live here?')).toBeNull()
    const disclosure = screen.getByRole('button', { name: /thread/i })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Why does the cap live here?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reopen/i })).toBeInTheDocument()
  })

  test('re-resolving after an expanded reopen collapses again', () => {
    // expand-while-resolved is reset when the thread reopens: render resolved,
    // expand via the disclosure, rerender with resolved: false (reopened),
    // then rerender resolved: true again → the card must be COLLAPSED.
    const resolved = group({
      resolved: true,
      rollup: { label: 'Resolved', chip: 'text-success' },
    })
    const { rerender } = render(
      <ReviewThreadCard
        group={resolved}
        anchorLabel="line R40"
        actions={actions()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /thread/i }))
    rerender(
      <ReviewThreadCard
        group={group()}
        anchorLabel="line R40"
        actions={actions()}
      />
    )
    rerender(
      <ReviewThreadCard
        group={resolved}
        anchorLabel="line R40"
        actions={actions()}
      />
    )

    expect(screen.queryByText('Why does the cap live here?')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/diff/components/ReviewThreadCard.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement** — create `src/features/diff/components/ReviewThreadCard.tsx`:

```tsx
import { useEffect, useState, type ReactElement } from 'react'
import type { DiffLineAnnotation } from '@pierre/diffs'
import {
  reviewCommentCategory,
  type ReviewComment,
} from '../hooks/useFeedbackBatch'
import { AGENT_OUTCOME_META, REVIEW_CATEGORY_META } from '../reviewCategoryMeta'
import { isFollowUpComment } from '../services/feedbackDispatch'
import type { ThreadGroup } from '../services/threadGroups'
import { formatSentAgo } from './ReviewCommentRow'
import { ReviewCommentEditor } from './ReviewCommentEditor'

export interface ReviewThreadCardActions {
  /** True while this thread's reply editor is open (Panel-owned draft state). */
  replying: boolean
  replyDraft: string
  onStartReply: () => void
  onReplyDraftChange: (text: string) => void
  onSubmitReply: (text: string) => void
  onCancelReply: () => void
  onResolve: () => void
  onReopen: () => void
}

interface ReviewThreadCardProps {
  group: ThreadGroup
  anchorLabel: string
  /** Omitted → footer-less card (no dispatch capability in this context). */
  actions?: ReviewThreadCardActions
}

const HAIRLINE = {
  borderTop:
    '1px solid color-mix(in srgb, var(--color-on-surface) 12%, transparent)',
} as const

const Chip = ({
  label,
  className,
}: {
  label: string
  className: string
}): ReactElement => (
  <span
    className={`inline-flex items-center rounded bg-surface-container-highest/70 px-1.5 py-px text-[10px] font-medium ${className}`}
  >
    {label}
  </span>
)

const turnChip = (comment: ReviewComment): ReactElement | null => {
  if (comment.author === 'agent') {
    return comment.outcome === undefined ? (
      <Chip label="Agent reply" className="text-success" />
    ) : (
      <Chip
        label={AGENT_OUTCOME_META[comment.outcome].label}
        className={AGENT_OUTCOME_META[comment.outcome].chip}
      />
    )
  }

  // Typeless follow-ups carry no chip; categorized user/reviewer turns show
  // their raise intent (VIM-298 taxonomy).
  if (comment.author === 'self' && isFollowUpComment(comment)) {
    return null
  }

  const meta = REVIEW_CATEGORY_META[reviewCommentCategory(comment)]

  return <Chip label={meta.label} className={meta.chip} />
}

const turnIdentity = (
  comment: ReviewComment
): { avatarClass: string; initial: string; name: string } => {
  if (comment.author === 'agent') {
    return {
      avatarClass: 'bg-primary-container/60 text-primary',
      initial: 'A',
      name: 'Agent',
    }
  }

  if (comment.author === 'reviewer') {
    const name = comment.reviewer ?? 'Reviewer'

    return {
      avatarClass: 'bg-surface-container-highest text-on-surface-variant',
      initial: name.charAt(0).toUpperCase(),
      name,
    }
  }

  return {
    avatarClass: 'bg-surface-container-highest text-on-surface-variant',
    initial: 'Y',
    name: 'You',
  }
}

const TurnRow = ({
  turn,
  first,
}: {
  turn: DiffLineAnnotation<ReviewComment>
  first: boolean
}): ReactElement => {
  const comment = turn.metadata
  const identity = turnIdentity(comment)
  const timestamp =
    comment.author === 'self' && comment.dispatchedAt !== undefined
      ? `Sent ${formatSentAgo(comment.dispatchedAt, Date.now())}`
      : formatSentAgo(comment.createdAt, Date.now())

  return (
    <div className="px-4 py-2.5" style={first ? undefined : HAIRLINE}>
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${identity.avatarClass}`}
        >
          {identity.initial}
        </span>
        <span className="text-[11px] font-medium text-on-surface">
          {identity.name}
        </span>
        {turnChip(comment)}
        <span className="text-[10px] text-on-surface-variant">{timestamp}</span>
      </div>
      <p className="whitespace-pre-wrap break-words pl-[22px] text-xs leading-5 text-on-surface">
        {comment.text}
      </p>
    </div>
  )
}

/**
 * A multi-turn review conversation (VIM-298) — the GitHub-style card settled
 * in the demo-first pass: tonal container, header with anchor + rollup + turn
 * count, hairline-divided turns, paired Reply/Resolve footer. Resolved threads
 * collapse to the header behind an accessible disclosure.
 */
export const ReviewThreadCard = ({
  group,
  anchorLabel,
  actions = undefined,
}: ReviewThreadCardProps): ReactElement => {
  const [expandedWhileResolved, setExpandedWhileResolved] = useState(false)

  // Reset the read-only expansion whenever the thread reopens, so the NEXT
  // resolve collapses again (expand → Reopen → Resolve must not stay open).
  useEffect((): void => {
    if (!group.resolved) {
      setExpandedWhileResolved(false)
    }
  }, [group.resolved])

  const collapsed = group.resolved && !expandedWhileResolved
  const expanded = !collapsed

  const header = (
    <>
      <span className="font-mono">{anchorLabel}</span>
      <Chip label={group.rollup.label} className={group.rollup.chip} />
      <span>
        {group.turns.length} turn{group.turns.length === 1 ? '' : 's'}
      </span>
    </>
  )

  return (
    <div className="mx-3 my-2 overflow-hidden rounded-lg bg-surface-container-high/80">
      {group.resolved ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`Resolved thread on ${anchorLabel}, ${group.turns.length} turns`}
          onClick={(): void => setExpandedWhileResolved(!expandedWhileResolved)}
          className="flex w-full items-center gap-2 px-4 py-2 text-left text-[10px] text-on-surface-variant"
          style={{
            background:
              'color-mix(in srgb, var(--color-on-surface) 4%, transparent)',
          }}
        >
          {header}
          <span
            aria-hidden="true"
            className="material-symbols-outlined ml-auto text-sm leading-none"
          >
            {expanded ? 'expand_less' : 'expand_more'}
          </span>
        </button>
      ) : (
        <div
          className="flex items-center gap-2 px-4 py-2 text-[10px] text-on-surface-variant"
          style={{
            background:
              'color-mix(in srgb, var(--color-on-surface) 4%, transparent)',
          }}
        >
          {header}
        </div>
      )}

      {expanded
        ? group.turns.map((turn, index) => (
            <TurnRow key={turn.metadata.id} turn={turn} first={index === 0} />
          ))
        : null}

      {expanded && actions !== undefined ? (
        <div style={HAIRLINE}>
          {actions.replying ? (
            <div className="px-2 py-1.5">
              <ReviewCommentEditor
                mode="reply"
                chrome="plain"
                surfaceRole="none"
                targetLabel={anchorLabel}
                value={actions.replyDraft}
                onTextChange={actions.onReplyDraftChange}
                onConfirm={(text): void => actions.onSubmitReply(text)}
                onCancel={actions.onCancelReply}
              />
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2 px-4 py-2">
              <button
                type="button"
                onClick={actions.onStartReply}
                className="rounded-md px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-surface-container-highest/60"
                style={{
                  background:
                    'color-mix(in srgb, var(--color-primary) 12%, transparent)',
                }}
              >
                ↳ Reply
              </button>
              {group.resolved ? (
                <button
                  type="button"
                  onClick={actions.onReopen}
                  className="rounded-md px-3 py-1.5 text-[11px] font-medium text-on-surface-variant hover:bg-surface-container-highest/60 hover:text-on-surface"
                  style={{
                    background:
                      'color-mix(in srgb, var(--color-on-surface) 6%, transparent)',
                  }}
                >
                  ⟲ Reopen
                </button>
              ) : (
                <button
                  type="button"
                  onClick={actions.onResolve}
                  className="rounded-md px-3 py-1.5 text-[11px] font-medium text-on-surface-variant hover:bg-surface-container-highest/60 hover:text-on-surface"
                  style={{
                    background:
                      'color-mix(in srgb, var(--color-on-surface) 6%, transparent)',
                  }}
                >
                  ✓ Resolve
                </button>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
```

Note: the editor is mounted **controlled** (`value` + `onTextChange`) — the draft lives in Panel state so a `MultiFileDiff` remount cannot erase typed text (spec Section 4).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/diff/components/ReviewThreadCard.test.tsx`
Expected: PASS. If cspell flags `Reopen`/`expand_more` etc., fix spelling config only if it is a real dictionary gap (these are real words/identifiers; `⟲`/`↳` are symbols and fine).

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/components/ReviewThreadCard.tsx src/features/diff/components/ReviewThreadCard.test.tsx
git commit -m "feat(diff): GitHub-style thread card component (VIM-298)"
```

---

### Task 7: Panel + PanelBody wiring (grouping, reply dispatch, resolve)

**Files:**

- Modify: `src/features/diff/components/PanelBody.tsx`
- Modify: `src/features/diff/components/Notifier.tsx` (`FinishFeedbackState.onCopy` becomes optional — `onCopy?: () => void`; `FinishFeedbackPopover` already treats it as optional)
- Modify: `src/features/diff/Panel.tsx`
- Test: `src/features/diff/Panel.test.tsx`, `src/features/diff/components/PanelBody.test.tsx`

- [ ] **Step 1: Write the failing tests.**

In `PanelBody.test.tsx`: the file's existing Pierre mock **ignores `renderAnnotation`** — extend the mock first so annotations are observable, e.g. have the mocked `MultiFileDiff` render `props.lineAnnotations?.map((a) => <div key={…}>{props.renderAnnotation?.(a)}</div>)`. Then:

```ts
test('a grouped anchor renders the thread card instead of a row', () => {
  // Render PanelBody with lineAnnotations = [anchor] and
  // thread={{ groups: new Map([['c1', <group with 2 turns>]]),
  //   actions: { replyingThreadId: null, replyDraft: '', onStartReply: vi.fn(), ... } }}
  // Assert both turn texts render inside one container and no send/edit/delete
  // IconButtons are present for those turns.
})

test('thread without actions renders a footer-less card', () => {
  // Same render with thread={{ groups, actions: undefined }} —
  // assert no Reply/Resolve buttons (capability gating, spec Section 3).
})
```

In `Panel.test.tsx` add the reply-dispatch orchestration test (reuse the file's existing dispatch harness that drives `handleSendFeedback` through the Finish popover — same mocks: `writePty`, candidates):

```ts
test('thread reply dispatches alone, inserts post-write pre-stamped, and reopens', () => {
  // 1. Seed a dispatched root (threadId 'c1', resolvedAt set) + one agent turn + one
  //    UNRELATED pending comment 'p9'.
  // 2. Open the thread reply editor, type text, confirm → the Finish popover opens
  //    scoped (commentCount 1).
  // 3. Confirm the popover pane → assert:
  //    - writePty payload contains '[#1 · Follow-up]' and '↩ Continuing our thread'
  //    - the batch now contains the follow-up WITH dispatchedAt, dispatchedTo and
  //      threadId 'c1' (never observable as pending)
  //    - 'p9' is still pending (untouched)
  //    - the root's resolvedAt is cleared (reply implies reopen)
  // 4. Failure path: make writePty reject → assert no comment was inserted and the
  //    reply editor is still open with its text.
})

test('popover cancel preserves the draft and creates nothing', () => {
  // Reply → confirm (popover opens) → cancel the popover.
  // Assert: no writePty call, no new annotation, and reopening Reply shows the
  // same draft text (the per-thread draft map was not cleared).
})

test('the reply draft survives a MultiFileDiff remount', () => {
  // Open the reply editor, type text, then force PanelBody's render key to
  // change (the harness can bump the diff/highlight revision or rerender with a
  // new key). Assert the editor still shows the typed text — it is controlled
  // from Panel state, not textarea-local.
})

test('a repo-subdirectory cwd resolves both path forms', () => {
  // Batch under cwd '/repo/sub' with repoRootForCwd('/repo/sub') → '/repo'.
  // Dispatch a follow-up and assert: the payload path is '/repo/src/foo.ts'
  // (repo-root-resolved), while the registered handle carries the
  // repo-relative batch coordinates { cwd: '/repo/sub', filePath: 'src/foo.ts' }.
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/diff/Panel.test.tsx src/features/diff/components/PanelBody.test.tsx`
Expected: new tests FAIL.

- [ ] **Step 3: Implement PanelBody.** In `PanelBody.tsx`:

(a) Imports:

```ts
import {
  threadAnchorLabel,
  threadGroupKey,
  type ThreadGroup,
} from '../services/threadGroups'
import { ReviewThreadCard } from './ReviewThreadCard'
```

(b) New prop types + prop:

```ts
export interface PanelThreadActions {
  /** threadId whose reply editor is open; null = none. */
  replyingThreadId: string | null
  replyDraft: string
  onStartReply: (threadId: string) => void
  onReplyDraftChange: (text: string) => void
  onSubmitReply: (threadId: string, text: string) => void
  onCancelReply: () => void
  onResolve: (threadId: string) => void
  onReopen: (threadId: string) => void
}

export interface PanelThreadProps {
  groups: Map<string, ThreadGroup>
  /** Omitted → footer-less cards (no dispatch capability, spec Section 3). */
  actions?: PanelThreadActions
}
```

add `thread?: PanelThreadProps` to `PanelBodyProps` and destructure `thread = undefined`.

(c) In `renderAnnotation`, after the `isDraft || isEditing` branch and before the `ReviewCommentRow` return:

```ts
              const groupKey = threadGroupKey(annotation)
              const group =
                groupKey === undefined ? undefined : thread?.groups.get(groupKey)
              if (group !== undefined) {
                const actions = thread?.actions

                return (
                  <ReviewThreadCard
                    key={`thread:${group.threadId}`}
                    group={group}
                    anchorLabel={threadAnchorLabel(group.turns[0] ?? annotation)}
                    actions={
                      actions === undefined
                        ? undefined
                        : {
                            replying:
                              actions.replyingThreadId === group.threadId,
                            replyDraft: actions.replyDraft,
                            onStartReply: (): void =>
                              actions.onStartReply(group.threadId),
                            onReplyDraftChange: actions.onReplyDraftChange,
                            onSubmitReply: (text): void =>
                              actions.onSubmitReply(group.threadId, text),
                            onCancelReply: actions.onCancelReply,
                            onResolve: (): void =>
                              actions.onResolve(group.threadId),
                            onReopen: (): void =>
                              actions.onReopen(group.threadId),
                          }
                    }
                  />
                )
              }
```

- [ ] **Step 4: Implement Panel.** In `Panel.tsx`:

(a) Imports: `buildThreadGroups`, `threadAnchorLabel`, `threadGroupKey`, `type ThreadGroup` from `./services/threadGroups`; `followUpContextLine` from `./services/feedbackDispatch`; `ReviewThreadCard` from `./components/ReviewThreadCard`.

(b) State, next to `sendNowCommentId`:

```ts
// Thread reply drafts (VIM-298), keyed by threadId so starting a reply on
// one thread never discards another thread's typed text. Panel-owned so a
// MultiFileDiff remount cannot erase them; an entry is cleared ONLY by that
// thread's explicit cancel or its successful dispatch.
const [replyDrafts, setReplyDrafts] = useState<ReadonlyMap<string, string>>(
  new Map()
)
// Thread whose reply editor is currently open; null = none.
const [replyingThreadId, setReplyingThreadId] = useState<string | null>(null)
// Thread whose follow-up is awaiting the scoped confirm popover (VIM-298);
// mutually exclusive with finishOpen / sendNowCommentId.
const [replyDispatchThreadId, setReplyDispatchThreadId] = useState<
  string | null
>(null)
```

(c) Grouping memos, after `lineAnnotations` is available (below the `useReviewCommentDraft` destructure):

```ts
const lineThreads = useMemo(
  () =>
    buildThreadGroups(lineAnnotations, {
      cwd,
      filePath: selectedFilePath ?? '',
      staged: selectedFileStaged,
    }),
  [lineAnnotations, cwd, selectedFilePath, selectedFileStaged]
)

const fileThreads = useMemo(
  () =>
    buildThreadGroups(fileCommentsForSelectedFile, {
      cwd,
      filePath: selectedFileEntry?.path ?? '',
      staged: selectedFileEntry?.staged ?? false,
    }),
  [fileCommentsForSelectedFile, cwd, selectedFileEntry]
)

const threadGroupById = useMemo((): Map<string, ThreadGroup> => {
  const merged = new Map(lineThreads.groups)
  for (const [key, group] of fileThreads.groups) {
    merged.set(key, group)
  }

  return merged
}, [lineThreads, fileThreads])
```

(d) The reply-dispatch handler, after `handleSendFeedback` (mirrors its shape; the follow-up is created ONLY after the write succeeds — spec Section 4):

```ts
// VIM-298: dispatch a thread follow-up. The comment is never stored pending —
// it is built ephemerally for the payload and inserted post-write already
// stamped (dispatchedAt/dispatchedTo/threadId), so whole-batch Finish can
// never sweep it and a write failure leaves no local record.
const handleSendThreadReply = useCallback(
  (pane: PaneCandidate): void => {
    if (sendingFeedbackRef.current || replyDispatchThreadId === null) {
      return
    }
    const draftText = replyDrafts.get(replyDispatchThreadId) ?? ''
    const group = threadGroupById.get(replyDispatchThreadId)
    if (
      group === undefined ||
      feedbackDispatch === undefined ||
      draftText.trim().length === 0
    ) {
      setReplyDispatchThreadId(null)

      return
    }
    sendingFeedbackRef.current = true
    void (async (): Promise<void> => {
      try {
        const anchor = group.turns[0]
        const previous = group.turns[group.turns.length - 1]
        if (anchor === undefined || previous === undefined) {
          return
        }

        const comment: ReviewComment = {
          id: nextFeedbackCommentId(),
          text: draftText,
          author: 'self',
          createdAt: Date.now(),
          threadId: group.threadId,
          ...(anchor.metadata.target === undefined
            ? {}
            : { target: anchor.metadata.target }),
        }

        // Same repo-root resolution as buildFeedbackEntries: absolute prompt
        // path for the agent, repo-relative coordinates for the handle.
        const entryRepoRoot = repoRootRef.repoRootForCwd?.(group.cwd)
        const resolvedRepoRoot =
          entryRepoRoot && entryRepoRoot.length > 0
            ? entryRepoRoot
            : (response?.repoRoot ?? repoRootRef.current)
        const promptPath = resolvedRepoRoot
          ? `${resolvedRepoRoot}/${group.filePath}`
          : group.filePath

        const nonce = makeDispatchNonce()
        await dispatchFeedbackBatch(
          pane.paneId,
          pane.ptyId,
          [
            {
              filePath: promptPath,
              staged: group.staged,
              annotations: [
                {
                  side: anchor.side,
                  lineNumber: anchor.lineNumber,
                  metadata: comment,
                },
              ],
            },
          ],
          nonce,
          feedbackDispatch.writePty,
          followUpContextLine(previous.metadata)
        )

        if (feedbackOwnerKey !== undefined) {
          setPendingReview({
            ptyId: pane.ptyId,
            ownerKey: feedbackOwnerKey,
            nonce,
            dispatchedAt: Date.now(),
            byHandle: new Map([
              [
                1,
                {
                  cwd: group.cwd,
                  filePath: group.filePath,
                  staged: group.staged,
                  lineNumber: anchor.lineNumber,
                  side: anchor.side,
                  target: anchor.metadata.target,
                  threadId: group.threadId,
                },
              ],
            ]),
          })
        }

        // Post-write insert, pre-stamped: never observable as pending.
        feedback.addAnnotation(group.cwd, group.filePath, group.staged, {
          side: anchor.side,
          lineNumber: anchor.lineNumber,
          metadata: {
            ...comment,
            dispatchedAt: Date.now(),
            dispatchedTo: pane.ptyId,
          },
        })

        // Reply implies reopen — only after a successful dispatch.
        if (group.resolved) {
          feedback.updateAnnotation(
            group.cwd,
            group.filePath,
            group.staged,
            group.threadId,
            { resolvedAt: undefined }
          )
        }

        // Clear ONLY this thread's draft (successful dispatch).
        setReplyDrafts((prev) => {
          const next = new Map(prev)
          next.delete(group.threadId)

          return next
        })
        setReplyingThreadId((current) =>
          current === group.threadId ? null : current
        )
        setReplyDispatchThreadId(null)
        const focusTerminal = feedbackDispatch.focusTerminal
        if (focusTerminal !== undefined) {
          setTimeout(focusTerminal, 0)
        }
      } catch {
        // Write failed: keep the editor open with its text; nothing was inserted.
        setReplyDispatchThreadId(null)
        notifyInfo('Terminal session ended; reply not sent.')
      } finally {
        sendingFeedbackRef.current = false
      }
    })()
  },
  [
    replyDispatchThreadId,
    replyDrafts,
    threadGroupById,
    feedback,
    feedbackDispatch,
    feedbackOwnerKey,
    notifyInfo,
    repoRootRef,
    response,
  ]
)
```

(If `nextFeedbackCommentId` is declared below this point in the file, reference it the way sibling callbacks do — it is a stable module-level/hook helper already used by `confirmCommentEditor`.)

(e) The shared thread action handlers:

```ts
const resolveThread = useCallback(
  (threadId: string): void => {
    const group = threadGroupById.get(threadId)
    if (group !== undefined) {
      feedback.updateAnnotation(
        group.cwd,
        group.filePath,
        group.staged,
        threadId,
        {
          resolvedAt: Date.now(),
        }
      )
    }
  },
  [feedback, threadGroupById]
)

const reopenThread = useCallback(
  (threadId: string): void => {
    const group = threadGroupById.get(threadId)
    if (group !== undefined) {
      feedback.updateAnnotation(
        group.cwd,
        group.filePath,
        group.staged,
        threadId,
        {
          resolvedAt: undefined,
        }
      )
    }
  },
  [feedback, threadGroupById]
)

const threadProps = {
  replyingThreadId,
  replyDraft:
    replyingThreadId === null ? '' : (replyDrafts.get(replyingThreadId) ?? ''),
  // Switching to another thread's Reply closes the first editor but its
  // draft stays in the map — reopening restores it.
  onStartReply: (threadId: string): void => setReplyingThreadId(threadId),
  onReplyDraftChange: (text: string): void => {
    setReplyDrafts((prev) => {
      if (replyingThreadId === null) {
        return prev
      }
      const next = new Map(prev)
      next.set(replyingThreadId, text)

      return next
    })
  },
  onSubmitReply: (threadId: string, text: string): void => {
    setReplyDrafts((prev) => new Map(prev).set(threadId, text))
    setFinishOpen(false)
    setSendNowCommentId(null)
    setReplyDispatchThreadId(threadId)
  },
  // Explicit cancel clears ONLY the active thread's draft.
  onCancelReply: (): void => {
    if (replyingThreadId !== null) {
      setReplyDrafts((prev) => {
        const next = new Map(prev)
        next.delete(replyingThreadId)

        return next
      })
    }
    setReplyingThreadId(null)
  },
  onResolve: resolveThread,
  onReopen: reopenThread,
}
```

(`updateAnnotation` spreads `{ resolvedAt: undefined }` into the metadata — consumers only ever check `!== undefined`, so an explicit-undefined property is equivalent to absent.)

(f) Popover scoping — update the existing pieces:

```ts
const isFinishPopoverOpen =
  finishOpen || sendNowCommentId !== null || replyDispatchThreadId !== null
```

and in the `finishFeedback` object:

```ts
    commentCount:
      sendNowCommentId !== null || replyDispatchThreadId !== null
        ? 1
        : feedbackCount,
    fileCount:
      sendNowCommentId !== null || replyDispatchThreadId !== null
        ? 1
        : pendingFileCount,
    onCancel: (): void => {
      setFinishOpen(false)
      setSendNowCommentId(null)
      setReplyDispatchThreadId(null)
    },
    onSend: (pane: PaneCandidate): void => {
      if (replyDispatchThreadId !== null) {
        handleSendThreadReply(pane)

        return
      }
      handleSendFeedback(pane, sendNowCommentId ?? undefined)
    },
    // A follow-up has no persisted comment to copy — hide Copy for reply sends.
    ...(replyDispatchThreadId !== null
      ? {}
      : {
          onCopy: (): void => handleCopyFeedback(sendNowCommentId ?? undefined),
        }),
```

(adjust the `finishFeedback` consumer so `onCopy` is optional — `FinishFeedbackPopover` already treats it as optional).

Also update `onFinishFeedback` to clear the reply scope: add `setReplyDispatchThreadId(null)` beside `setSendNowCommentId(null)`.

(g) Wire PanelBody:

```tsx
            lineAnnotations={lineThreads.collapsed}
            ...
            thread={{
              groups: lineThreads.groups,
              // Capability gating: no dispatch surface → footer-less cards.
              actions: feedbackDispatch === undefined ? undefined : threadProps,
            }}
```

(h) File strip — replace the `fileCommentsForSelectedFile.map(...)` body: map over `fileThreads.collapsed` instead; for each annotation, look up `threadGroupKey(annotation)` in `fileThreads.groups`; when a group exists render:

```tsx
<ReviewThreadCard
  key={`thread:${group.threadId}`}
  group={group}
  anchorLabel={threadAnchorLabel(group.turns[0] ?? annotation)}
  actions={
    feedbackDispatch === undefined
      ? undefined
      : {
          replying: threadProps.replyingThreadId === group.threadId,
          replyDraft: threadProps.replyDraft,
          onStartReply: (): void => threadProps.onStartReply(group.threadId),
          onReplyDraftChange: threadProps.onReplyDraftChange,
          onSubmitReply: (text): void =>
            threadProps.onSubmitReply(group.threadId, text),
          onCancelReply: threadProps.onCancelReply,
          onResolve: (): void => threadProps.onResolve(group.threadId),
          onReopen: (): void => threadProps.onReopen(group.threadId),
        }
  }
/>
```

otherwise keep the existing `ReviewCommentRow` branch unchanged (pending file comments keep send-now/edit/delete).

(i) `Notifier.tsx` — change `FinishFeedbackState`'s `onCopy: () => void` to `onCopy?: () => void` (it is forwarded to `FinishFeedbackPopover`, whose prop is already optional; a reply-scoped popover passes no `onCopy`).

- [ ] **Step 5: Run the diff feature suite**

Run: `npx vitest run src/features/diff`
Expected: PASS — including all pre-existing Panel/PanelBody/integration tests (dispatched single comments now render as 1-turn cards; if an existing test asserted a dispatched comment's "Sent" chip via `ReviewCommentRow`, update it to assert the card's header/rollup instead — that rendering change is the feature).

- [ ] **Step 6: Commit**

```bash
git add src/features/diff/Panel.tsx src/features/diff/components/PanelBody.tsx src/features/diff/components/Notifier.tsx src/features/diff/Panel.test.tsx src/features/diff/components/PanelBody.test.tsx
git commit -m "feat(diff): thread cards + follow-up dispatch wiring (VIM-298)"
```

---

### Task 8: Integration test — the full multi-turn loop

**Files:**

- Modify: `src/features/diff/agentReplyThread.integration.test.tsx`

- [ ] **Step 1: Extend the harness.** The file already mounts a real `useFeedbackBatchStore` + `useAgentReply` with a mocked `agent-reply` listener. Add a second Harness that renders thread cards through the real selector:

```tsx
// Captured so tests can seed the store from OUTSIDE the component (the store
// exists only inside the harness). Reset in beforeEach.
let capturedStore: ReturnType<typeof useFeedbackBatchStore> | null = null

const ThreadHarness = (): ReactElement => {
  const store = useFeedbackBatchStore(OWNER, CWD)
  capturedStore = store

  // Stable across rerenders: a changing nextCommentId identity would
  // resubscribe useAgentReply on every render.
  const [nextCommentId] = useState(() => {
    let n = 0

    return (): string => `agent-${++n}`
  })
  useAgentReply({
    addAnnotationForOwner: store.feedbackBatch.addAnnotationForOwner,
    nextCommentId,
  })

  const annotations = store.feedbackBatch.annotationsForFile(CWD, FILE, false)
  const { collapsed, groups } = buildThreadGroups(annotations, {
    cwd: CWD,
    filePath: FILE,
    staged: false,
  })

  return (
    <div>
      {collapsed.map((annotation) => {
        const key = threadGroupKey(annotation)
        const group = key === undefined ? undefined : groups.get(key)

        return group === undefined ? null : (
          <ReviewThreadCard
            key={group.threadId}
            group={group}
            anchorLabel={threadAnchorLabel(annotation)}
          />
        )
      })}
    </div>
  )
}
```

Seed operations run through `capturedStore` inside `act(...)` after the initial `render(<ThreadHarness />)` — e.g. `act(() => { capturedStore?.feedbackBatch.addAnnotationForOwner(OWNER, CWD, FILE, false, …) })`.

- [ ] **Step 2: Write the loop test:**

```ts
test('comment → reply → follow-up → second reply renders one 4-turn card', async () => {
  // Seed the dispatched root directly (the Panel dispatch path is covered by
  // Panel.test.tsx; this exercises the reply→attach→group→render pipeline):
  //   addAnnotationForOwner(OWNER, CWD, FILE, false, { side: 'additions',
  //     lineNumber: 5, metadata: { id: 'c1', text: 'Why?', author: 'self',
  //     category: 'question', createdAt: 1, dispatchedAt: 1000, threadId: 'c1',
  //     dispatchedTo: 'pty-1' } })
  //   setPendingReview({ ptyId: 'pty-1', ownerKey: OWNER, nonce: 'n1',
  //     dispatchedAt: 1000, byHandle: new Map([[1, { cwd: CWD, filePath: FILE,
  //     staged: false, lineNumber: 5, side: 'additions', target: undefined,
  //     threadId: 'c1' }]]) })
  // emitReply for nonce 'n1', [#1] status 'clarify'
  // → assert ONE card, 2 turns, rollup chip 'Awaiting you'
  //
  // Seed the follow-up as the dispatch path would insert it (post-write,
  // pre-stamped): id 'f1', threadId 'c1', dispatchedAt 2000, no category.
  //   setPendingReview for nonce 'n2' with handle threadId 'c1'
  // → assert rollup chip flips to 'Sent'
  //
  // emitReply for nonce 'n2', [#1] status 'resolved'
  // → assert 4 turns in order (Why? / clarify text / follow-up text / resolved
  //   text), rollup 'Resolved' (from the outcome, thread NOT collapsed —
  //   resolvedAt is unset), and the follow-up turn shows no category chip.
})

test('a late agent reply after local resolve appends without unresolving', async () => {
  // Seed a dispatched root WITH resolvedAt set (locally resolved) + a live
  // pendingReview handle for nonce 'n3'. emitReply for 'n3'.
  // → assert the card stays collapsed (rollup 'Resolved', turn count ticked
  //   up to 2) and the root's resolvedAt is unchanged — local resolution is
  //   authoritative (spec Section 5).
})
```

Write the seeds/assertions as real code following the existing test's `emitReply`/`act` pattern.

- [ ] **Step 3: Run to verify**

Run: `npx vitest run src/features/diff/agentReplyThread.integration.test.tsx`
Expected: PASS (and the pre-existing single round-trip test still passes).

- [ ] **Step 4: Commit**

```bash
git add src/features/diff/agentReplyThread.integration.test.tsx
git commit -m "test(diff): multi-turn thread integration loop (VIM-298)"
```

---

### Task 9: Full gate, push, PR

- [ ] **Step 1: Repo-wide gate** (CI's Code Quality check is repo-wide, not diff-scoped):

Run:

```bash
npm run lint && npm run format:check && npm run type-check:generated && npx vitest run
```

Expected: all green. Known environment flakes (not caused by this PR, do not chase): `editorFileLifecycleStatus` home-path casing on macOS.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feature/vim-298
PATH="/opt/homebrew/bin:$PATH" gh pr create \
  --title "feat(diff): multi-turn finding threads (VIM-298)" \
  --label auto-review --label auto-approve \
  --body "$(cat <<'EOF'
## Summary
- Turns at one anchor render as a single GitHub-style thread card (header rollup, hairline turn rows, paired Reply/Resolve footer) — recipe settled in the VIM-298 demo-first pass.
- Reply on a thread dispatches ONLY that follow-up ([#1 · Follow-up] + quoted-context line) via the VIM-297 single-comment path; the agent's next reply lands on the same thread via threadId-carrying handles.
- Follow-ups are created atomically with a successful dispatch (post-write, pre-stamped insert — cap-exempt); Resolve is local state with collapse + reopen.

Spec: docs/superpowers/specs/2026-07-11-vim-298-multi-turn-threads-design.md (codex-reviewed)
Plan: docs/superpowers/plans/2026-07-12-vim-298-multi-turn-threads.md

Closes VIM-298
Part of VIM-284

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Post-merge cleanup (operator note, NOT part of this branch):** delete `preview.html`, `preview-thread-demo.tsx`, `vite.preview.config.ts` from the **main checkout** and stop the throwaway Vite preview server — the recipe now lives in the spec.

---

## Self-Review Notes (already applied)

- Spec coverage: Section 2 → Tasks 1–3, Section 3 → Task 6, Section 4 → Tasks 4, 5, 7, Section 5 → Tasks 6, 7, Section 6 → every task's tests + Task 8/9.
- Type consistency: `ThreadGroup`/`threadGroupKey`/`threadAnchorLabel`/`followUpContextLine`/`isFollowUpComment` names match across Tasks 3, 5, 6, 7, 8; `markDispatched` options shape matches Tasks 1 and 2; `PendingReviewHandle.threadId` matches Tasks 2, 7, 8.
- The two known judgment points for the executor: (1) existing Panel tests that asserted dispatched-comment rows will need updating to the card rendering — that is the feature, not a regression; (2) match each test file's existing harness idioms rather than inventing new ones.

<!-- codex-reviewed: 2026-07-13T07:17:31Z -->
