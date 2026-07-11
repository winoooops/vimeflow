import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, act } from '@testing-library/react'
import { listen } from '@/lib/backend'
import type { BackendApi } from '@/lib/backend'
import type { AgentReplyEvent } from '@/bindings'
import { useFeedbackBatchStore } from './hooks/useFeedbackBatch'
import { useAgentReply } from './hooks/useAgentReply'
import { ReviewCommentRow } from './components/ReviewCommentRow'
import { clearPendingReview, setPendingReview } from './services/pendingReviews'

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

vi.mock('@/lib/backend', () => ({ listen: vi.fn() }))

const OWNER = 'sess:pane-1'
const CWD = '/repo'
const FILE = 'src/foo.ts'

// Renders the dispatching owner's committed comments for the file, so the agent
// reply is asserted through the real ReviewCommentRow (VIM-256 rendering).
const Harness = (): ReactElement => {
  const store = useFeedbackBatchStore(OWNER, CWD)
  useAgentReply({
    addAnnotationForOwner: store.feedbackBatch.addAnnotationForOwner,
    nextCommentId: () => 'agent-reply-1',
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
  window.vimeflow = {
    invoke: vi.fn(),
    listen: vi.fn(),
  } as unknown as BackendApi
  vi.mocked(listen).mockImplementation(listenImpl as unknown as typeof listen)
})

afterEach(() => {
  clearPendingReview('pty-1', 'abc')
  delete window.vimeflow
})

describe('inline agent Q&A thread (integration)', () => {
  test('an agent reply renders in the thread under the dispatched comment', async () => {
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

    render(<Harness />)

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
