import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useState, type ReactElement } from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import { listen } from '@/lib/backend'
import type { BackendApi } from '@/lib/backend'
import type { AgentReplyEvent } from '@/bindings'
import { useFeedbackBatchStore } from './hooks/useFeedbackBatch'
import { useAgentReply } from './hooks/useAgentReply'
import { ReviewCommentRow } from './components/ReviewCommentRow'
import { clearPendingReview, setPendingReview } from './services/pendingReviews'
import {
  buildThreadGroups,
  threadAnchorLabel,
  threadGroupKey,
} from './services/threadGroups'
import { ReviewThreadCard } from './components/ReviewThreadCard'

// End-to-end wiring for the inline agent Q&A thread (VIM-249): a real
// useFeedbackBatchStore + useAgentReply mounted together (the WorkspaceView
// layer — Panel alone never subscribes), driven by a real `agent-reply` event.

type Cb = (payload: unknown) => void
const listeners = new Map<string, Cb[]>()

const listenImpl = (name: string, cb: Cb): Promise<() => void> => {
  const existing = listeners.get(name) ?? []
  existing.push(cb)
  listeners.set(name, existing)

  return Promise.resolve(() => undefined)
}

vi.mock('@/lib/backend', () => ({ invoke: vi.fn(), listen: vi.fn() }))

const OWNER = 'sess:pane-1'
const CWD = '/repo'
const FILE = 'src/foo.ts'

// Captured so tests can seed the store from OUTSIDE the component (the store
// exists only inside the harness). Reset in beforeEach.
let capturedStore: ReturnType<typeof useFeedbackBatchStore> | null = null

// Renders the dispatching owner's committed comments for the file, so the agent
// reply is asserted through the real ReviewCommentRow (VIM-256 rendering).
const Harness = (): ReactElement => {
  const store = useFeedbackBatchStore(OWNER, CWD)
  capturedStore = store
  useAgentReply({
    enabled: !store.hydrating && !store.hydrationFailed,
    activePtyId: null,
    addAnnotationForOwner: store.feedbackBatch.addAnnotationForOwner,
    nextCommentId: () => 'agent-reply-1',
    notifyInfo: vi.fn(),
  })

  const comments = store.feedbackBatch.annotationsForFile(CWD, FILE, false)

  return (
    <div>
      {comments.map((annotation) => (
        <ReviewCommentRow
          key={annotation.metadata.id}
          comment={annotation.metadata}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      ))}
    </div>
  )
}

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
    enabled: !store.hydrating && !store.hydrationFailed,
    activePtyId: null,
    addAnnotationForOwner: store.feedbackBatch.addAnnotationForOwner,
    nextCommentId,
    notifyInfo: vi.fn(),
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

const emitReply = async (event: AgentReplyEvent): Promise<void> => {
  await act(async () => {
    await Promise.resolve() // let listen() register the callback
    for (const cb of listeners.get('agent-reply') ?? []) {
      cb(event)
    }
  })
}

beforeEach(() => {
  listeners.clear()
  capturedStore = null
  window.vimeflow = {
    invoke: vi.fn(),
    listen: vi.fn(),
  } as unknown as BackendApi
  vi.mocked(listen).mockImplementation(listenImpl as unknown as typeof listen)
})

afterEach(() => {
  clearPendingReview('pty-1', 'abc')
  clearPendingReview('pty-1', 'n1')
  clearPendingReview('pty-1', 'n2')
  clearPendingReview('pty-1', 'n3')
  delete window.vimeflow
})

describe('inline agent Q&A thread (integration)', () => {
  test('an agent reply renders in the thread under the dispatched comment', async () => {
    render(<Harness />)

    await waitFor(() => expect(capturedStore?.hydrating).toBe(false))

    setPendingReview({
      ptyId: 'pty-1',
      ownerKey: OWNER,
      nonce: 'abc',
      dispatchedAt: 1,
      byHandle: new Map([
        [
          1,
          {
            cwd: CWD,
            filePath: FILE,
            staged: false,
            lineNumber: 5,
            side: 'additions',
            target: undefined,
          },
        ],
      ]),
    })

    // No agent reply yet.
    expect(screen.queryByText('Replied')).not.toBeInTheDocument()

    await emitReply({
      sessionId: 'pty-1',
      nonce: 'abc',
      rawText: 'Because latency.',
      replies: [
        { id: 1, status: 'reply', target: 'comment', text: 'Because latency.' },
      ],
    })

    // The reply attached onto the dispatching owner and renders distinctly,
    // carrying its outcome chip (VIM-304 PR-3: "reply" reads as "Replied").
    expect(screen.getByText('Replied')).toBeInTheDocument()
    expect(screen.getByText('Because latency.')).toBeInTheDocument()
  })
})

describe('multi-turn thread loop (VIM-298 integration)', () => {
  test('comment → reply → follow-up → second reply renders one 4-turn card', async () => {
    render(<ThreadHarness />)

    await waitFor(() => expect(capturedStore?.hydrating).toBe(false))

    // Seed the dispatched root — mirroring what Panel.handleSendFeedback inserts
    // (post-dispatch, pre-stamped fields: dispatchedAt, dispatchedTo, threadId).
    act(() => {
      capturedStore?.feedbackBatch.addAnnotationForOwner(
        OWNER,
        CWD,
        FILE,
        false,
        {
          side: 'additions',
          lineNumber: 5,
          metadata: {
            id: 'c1',
            text: 'Why?',
            author: 'self',
            category: 'question',
            createdAt: 1,
            dispatchedAt: 1000,
            threadId: 'c1',
            dispatchedTo: 'pty-1',
          },
        }
      )
    })

    setPendingReview({
      ptyId: 'pty-1',
      ownerKey: OWNER,
      nonce: 'n1',
      dispatchedAt: 1000,
      byHandle: new Map([
        [
          1,
          {
            cwd: CWD,
            filePath: FILE,
            staged: false,
            lineNumber: 5,
            side: 'additions',
            target: undefined,
            threadId: 'c1',
          },
        ],
      ]),
    })

    // First agent reply: status 'clarify' — the agent needs more info.
    await emitReply({
      sessionId: 'pty-1',
      nonce: 'n1',
      rawText: 'Can you clarify which cap you mean?',
      replies: [
        {
          id: 1,
          status: 'clarify',
          target: 'comment',
          text: 'Can you clarify which cap you mean?',
        },
      ],
    })

    // ONE card should exist with 2 turns; rollup should show 'Awaiting you'.
    // 'Awaiting you' appears in both the header rollup chip and the agent
    // turn's outcome chip — use getAllByText deliberately.
    expect(screen.getByText('2 turns')).toBeInTheDocument()
    expect(screen.getAllByText('Awaiting you').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Why?')).toBeInTheDocument()
    expect(
      screen.getByText('Can you clarify which cap you mean?')
    ).toBeInTheDocument()

    // Seed the follow-up exactly as the dispatch path inserts it (post-write,
    // pre-stamped: has dispatchedAt, no category — category-less follow-up).
    act(() => {
      capturedStore?.feedbackBatch.addAnnotationForOwner(
        OWNER,
        CWD,
        FILE,
        false,
        {
          side: 'additions',
          lineNumber: 5,
          metadata: {
            id: 'f1',
            text: 'The soft write cap at 50 comments.',
            author: 'self',
            createdAt: 2000,
            dispatchedAt: 2000,
            threadId: 'c1',
          },
        }
      )
    })

    setPendingReview({
      ptyId: 'pty-1',
      ownerKey: OWNER,
      nonce: 'n2',
      dispatchedAt: 2000,
      byHandle: new Map([
        [
          1,
          {
            cwd: CWD,
            filePath: FILE,
            staged: false,
            lineNumber: 5,
            side: 'additions',
            target: undefined,
            threadId: 'c1',
          },
        ],
      ]),
    })

    // After the follow-up seed, rollup flips to 'Sent' (latest turn is self).
    expect(screen.getByText('Sent')).toBeInTheDocument()

    // Second agent reply: status 'resolved' — confirms the full loop.
    await emitReply({
      sessionId: 'pty-1',
      nonce: 'n2',
      rawText: 'Got it, the write-queue depth limit.',
      replies: [
        {
          id: 1,
          status: 'resolved',
          target: 'comment',
          text: 'Got it, the write-queue depth limit.',
        },
      ],
    })

    // 4 turns in document order; rollup 'Resolved' from the agent outcome
    // (thread NOT collapsed — resolvedAt is unset, resolution is by outcome only).
    // 'Resolved' appears in both the header chip and the agent turn chip;
    // use getAllByText deliberately.
    expect(screen.getByText('4 turns')).toBeInTheDocument()
    expect(screen.getAllByText('Resolved').length).toBeGreaterThanOrEqual(1)

    // All four turn texts visible (thread not collapsed).
    expect(screen.getByText('Why?')).toBeInTheDocument()
    expect(
      screen.getByText('Can you clarify which cap you mean?')
    ).toBeInTheDocument()

    expect(
      screen.getByText('The soft write cap at 50 comments.')
    ).toBeInTheDocument()

    expect(
      screen.getByText('Got it, the write-queue depth limit.')
    ).toBeInTheDocument()

    // The follow-up turn (id 'f1') has no category chip — it has no category.
    // Only the root's 'Question' chip should appear.
    expect(screen.getAllByText('Question')).toHaveLength(1)
  })

  test('a late agent reply after local resolve appends without clearing resolution', async () => {
    render(<ThreadHarness />)

    await waitFor(() => expect(capturedStore?.hydrating).toBe(false))

    // Seed a dispatched root WITH resolvedAt set (locally resolved).
    act(() => {
      capturedStore?.feedbackBatch.addAnnotationForOwner(
        OWNER,
        CWD,
        FILE,
        false,
        {
          side: 'additions',
          lineNumber: 5,
          metadata: {
            id: 'c1',
            text: 'Is this safe?',
            author: 'self',
            category: 'question',
            createdAt: 1,
            dispatchedAt: 1000,
            threadId: 'c1',
            dispatchedTo: 'pty-1',
            resolvedAt: 1500,
          },
        }
      )
    })

    setPendingReview({
      ptyId: 'pty-1',
      ownerKey: OWNER,
      nonce: 'n3',
      dispatchedAt: 1000,
      byHandle: new Map([
        [
          1,
          {
            cwd: CWD,
            filePath: FILE,
            staged: false,
            lineNumber: 5,
            side: 'additions',
            target: undefined,
            threadId: 'c1',
          },
        ],
      ]),
    })

    // The card should be collapsed (resolved) with turn count showing 1.
    expect(screen.getByText('1 turn')).toBeInTheDocument()
    expect(screen.getByText('Resolved')).toBeInTheDocument()
    // Collapsed: the root's text is NOT visible.
    expect(screen.queryByText('Is this safe?')).not.toBeInTheDocument()

    // Late agent reply arrives after local resolution.
    await emitReply({
      sessionId: 'pty-1',
      nonce: 'n3',
      rawText: 'Yes, the pool is safe.',
      replies: [
        {
          id: 1,
          status: 'reply',
          target: 'comment',
          text: 'Yes, the pool is safe.',
        },
      ],
    })

    // Turn count ticks up to 2, rollup stays 'Resolved' (local resolution is
    // authoritative — the agent reply does NOT unset resolvedAt).
    expect(screen.getByText('2 turns')).toBeInTheDocument()
    expect(screen.getByText('Resolved')).toBeInTheDocument()
    // Still collapsed — the late reply did not unresolved the thread.
    expect(screen.queryByText('Is this safe?')).not.toBeInTheDocument()
    expect(screen.queryByText('Yes, the pool is safe.')).not.toBeInTheDocument()
  })
})
