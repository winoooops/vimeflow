import { createRef, type ReactElement, type ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { DiffLineAnnotation, FileDiffOptions } from '@pierre/diffs'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getCommand, type CommandId } from '@/features/keymap/catalog'
import { resolveDefault } from '@/features/keymap/resolve'
import type { Keybindings } from '@/features/keymap/useKeybindings'
import { SettingsContext } from '@/features/settings/SettingsProvider'
import { DEFAULT_SETTINGS } from '@/features/settings/store/settingsDefaults'
import { PanelBody } from './PanelBody'
import type { ReviewComment } from '../hooks/useFeedbackBatch'
import type { PierreFileInputs } from '../services/pierreAdapter'
import type { ThreadGroup } from '../services/threadGroups'

interface MultiFileDiffMockProps {
  oldFile: { name: string }
  newFile: { name: string }
  lineAnnotations: DiffLineAnnotation<ReviewComment>[]
  options: { diffStyle?: string }
  renderAnnotation?: (a: DiffLineAnnotation<ReviewComment>) => ReactElement
}

interface WorkerPoolMock {
  inspectCaches: () => { diffCache: Set<string> }
  subscribeToStatChanges: (callback: () => void) => () => void
}

const pierreReactMock = vi.hoisted(() => ({
  renderCount: 0,
  workerPool: undefined as WorkerPoolMock | undefined,
}))

vi.mock('@pierre/diffs/react', () => ({
  useWorkerPool: (): WorkerPoolMock | undefined => pierreReactMock.workerPool,
  MultiFileDiff: ({
    oldFile,
    newFile,
    lineAnnotations,
    options,
    renderAnnotation = undefined,
  }: MultiFileDiffMockProps): ReactNode => {
    pierreReactMock.renderCount += 1

    return (
      <div
        data-testid="multi-file-diff"
        data-old-file={oldFile.name}
        data-new-file={newFile.name}
        data-annotations={lineAnnotations.length}
        data-diff-style={options.diffStyle}
        data-render-count={pierreReactMock.renderCount}
      >
        {renderAnnotation !== undefined
          ? lineAnnotations.map((a) => (
              <div key={a.metadata.id}>{renderAnnotation(a)}</div>
            ))
          : null}
      </div>
    )
  },
}))

vi.mock('./DiffNarrowPlaceholder', () => ({
  DiffNarrowPlaceholder: ({ min }: { min: number }): ReactNode => (
    <div data-testid="diff-narrow-placeholder">{min}</div>
  ),
}))

const pierreInputs: PierreFileInputs = {
  oldFile: { name: 'src/foo.ts', contents: 'old' },
  newFile: { name: 'src/foo.ts', contents: 'new' },
  identity: 'diff-identity',
  diffCacheKey: 'diff-cache-key',
}

const options: FileDiffOptions<ReviewComment> = {
  diffStyle: 'split',
  theme: 'pierre-dark',
}

const bindingFor: Keybindings['bindingFor'] = (id: CommandId) =>
  resolveDefault(getCommand(id), false)

const SettingsFixture = ({
  children,
}: {
  children: ReactNode
}): ReactElement => (
  <SettingsContext.Provider
    value={{ settings: DEFAULT_SETTINGS, saveError: null, update: vi.fn() }}
  >
    {children}
  </SettingsContext.Provider>
)

const createBodyProps = (
  overrides: Partial<Parameters<typeof PanelBody>[0]> = {}
): Parameters<typeof PanelBody>[0] => ({
  bindingFor,
  scrollBodyRef: createRef<HTMLDivElement>(),
  diffError: null,
  diffLoading: false,
  pierreInputs,
  tooNarrow: false,
  renderKey: 'pierre-dark:word',
  options,
  selectedLines: null,
  lineAnnotations: [],
  annotationTarget: null,
  commentDraftText: '',
  commentCategory: 'change',
  onPointerMove: vi.fn(),
  onAddComment: vi.fn(),
  onEditComment: vi.fn(),
  onDeleteComment: vi.fn(),
  onCommentTextChange: vi.fn(),
  onCommentCategoryChange: vi.fn(),
  onConfirmComment: vi.fn(),
  onCancelComment: vi.fn(),
  ...overrides,
})

const renderBody = (
  overrides: Partial<Parameters<typeof PanelBody>[0]> = {}
): ReturnType<typeof render> =>
  render(<PanelBody {...createBodyProps(overrides)} />, {
    wrapper: SettingsFixture,
  })

describe('PanelBody', () => {
  beforeEach(() => {
    pierreReactMock.renderCount = 0
    pierreReactMock.workerPool = undefined
  })

  test('renders loading and error states before the Pierre renderer', () => {
    const { rerender } = renderBody({
      pierreInputs: null,
      diffLoading: true,
    })

    expect(screen.getByRole('status')).toHaveTextContent('Loading diff')

    rerender(
      <PanelBody
        {...createBodyProps({
          diffError: new Error('git failed'),
          pierreInputs: null,
        })}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('git failed')
  })

  test('renders narrow placeholder instead of Pierre when the pane is too small', () => {
    renderBody({ tooNarrow: true })

    expect(screen.getByTestId('diff-narrow-placeholder')).toHaveTextContent(
      '360'
    )
    expect(screen.queryByTestId('multi-file-diff')).not.toBeInTheDocument()
  })

  test('passes render inputs and options to the Pierre diff renderer', () => {
    renderBody()

    const renderer = screen.getByTestId('multi-file-diff')
    expect(renderer).toHaveAttribute('data-old-file', 'src/foo.ts')
    expect(renderer).toHaveAttribute('data-new-file', 'src/foo.ts')
    expect(renderer).toHaveAttribute('data-diff-style', 'split')
  })

  test('shows resolved comment action shortcuts', () => {
    const remappedBindingFor: Keybindings['bindingFor'] = (id) => {
      if (id === 'diff-comment-update') {
        return { code: 'ArrowDown', mods: new Set(['Shift']) }
      }
      if (id === 'diff-comment-delete') {
        return { code: 'ArrowUp', mods: new Set(['Alt']) }
      }

      return bindingFor(id)
    }

    const annotation: DiffLineAnnotation<ReviewComment> = {
      side: 'additions',
      lineNumber: 2,
      metadata: {
        id: 'pending',
        text: 'Pending comment',
        author: 'self',
        createdAt: 1,
      },
    }

    renderBody({
      bindingFor: remappedBindingFor,
      lineAnnotations: [annotation],
    })

    expect(
      screen.getByRole('button', { name: 'Edit comment' })
    ).toHaveAttribute('aria-keyshortcuts', 'Shift+ArrowDown')

    expect(
      screen.getByRole('button', { name: 'Delete comment' })
    ).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowUp')
  })

  test('rerenders Pierre when the active diff highlight cache becomes available', async () => {
    const diffCache = new Set<string>()
    const subscribers = new Set<() => void>()

    pierreReactMock.workerPool = {
      inspectCaches: (): { diffCache: Set<string> } => ({ diffCache }),
      subscribeToStatChanges: (callback): (() => void) => {
        subscribers.add(callback)

        return (): void => {
          subscribers.delete(callback)
        }
      },
    }

    renderBody()

    expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
      'data-render-count',
      '1'
    )

    act(() => {
      diffCache.add(pierreInputs.diffCacheKey)
      subscribers.forEach((callback) => callback())
    })

    await waitFor(() =>
      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-render-count',
        '2'
      )
    )
  })

  test('a grouped anchor renders the thread card instead of a row', () => {
    const anchorAnnotation: DiffLineAnnotation<ReviewComment> = {
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
    }

    const group: ThreadGroup = {
      threadId: 'c1',
      turns: [
        anchorAnnotation,
        {
          side: 'additions',
          lineNumber: 40,
          metadata: {
            id: 'g1',
            text: 'The pool applies backpressure.',
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
    }

    renderBody({
      lineAnnotations: [anchorAnnotation],
      thread: {
        groups: new Map([['c1', group]]),
        actions: {
          replyingThreadId: null,
          replyDraft: '',
          onStartReply: vi.fn(),
          onReplyDraftChange: vi.fn(),
          onSubmitReply: vi.fn(),
          onCancelReply: vi.fn(),
          onResolve: vi.fn(),
          onReopen: vi.fn(),
        },
      },
    })

    // Both turn texts render inside one card container.
    expect(screen.getByText('Why does the cap live here?')).toBeInTheDocument()
    expect(
      screen.getByText('The pool applies backpressure.')
    ).toBeInTheDocument()

    // No send/edit/delete buttons from ReviewCommentRow for the dispatched anchor.
    expect(
      screen.queryByRole('button', { name: 'Send comment now' })
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: 'Edit comment' })
    ).not.toBeInTheDocument()
  })

  test('reply draft survives a MultiFileDiff remount triggered by renderKey change (VIM-298)', () => {
    const anchorAnnotation: DiffLineAnnotation<ReviewComment> = {
      side: 'additions',
      lineNumber: 40,
      metadata: {
        id: 'c-draft',
        text: 'Original question.',
        author: 'self',
        category: 'question',
        createdAt: 1,
        dispatchedAt: 1000,
        threadId: 'c-draft',
      },
    }

    const group: ThreadGroup = {
      threadId: 'c-draft',
      turns: [
        anchorAnnotation,
        {
          side: 'additions',
          lineNumber: 40,
          metadata: {
            id: 'g-draft',
            text: 'Agent answer.',
            author: 'agent',
            outcome: 'reply',
            createdAt: 2,
            threadId: 'c-draft',
          },
        },
      ],
      rollup: { label: 'Replied', chip: 'text-success' },
      resolved: false,
      cwd: '/repo',
      filePath: 'src/foo.ts',
      staged: false,
    }

    const sharedActions = {
      replyingThreadId: 'c-draft',
      replyDraft: 'typed text',
      onStartReply: vi.fn(),
      onReplyDraftChange: vi.fn(),
      onSubmitReply: vi.fn(),
      onCancelReply: vi.fn(),
      onResolve: vi.fn(),
      onReopen: vi.fn(),
    }

    const threadProp = {
      groups: new Map([['c-draft', group]]),
      actions: sharedActions,
    }

    const { rerender } = renderBody({
      lineAnnotations: [anchorAnnotation],
      thread: threadProp,
    })

    // The reply editor is open; confirm the textarea shows the draft text.
    const textareaBefore = screen.getByPlaceholderText('Reply to the agent…')
    expect(textareaBefore).toHaveValue('typed text')

    // Change renderKey — this causes effectiveRenderKey to change, which
    // remounts MultiFileDiff (it is keyed by effectiveRenderKey in PanelBody).
    rerender(
      <PanelBody
        {...createBodyProps({
          renderKey: 'pierre-dark:word:remounted',
          lineAnnotations: [anchorAnnotation],
          thread: threadProp,
        })}
      />
    )

    // The MultiFileDiff was remounted — DOM node identity must have changed.
    const textareaAfter = screen.getByPlaceholderText('Reply to the agent…')
    expect(textareaAfter).not.toBe(textareaBefore)

    // Draft value is still present because it flows from props above the
    // remount boundary, not from internal textarea state.
    expect(textareaAfter).toHaveValue('typed text')
  })

  test('thread without actions renders a footer-less card', () => {
    const anchorAnnotation: DiffLineAnnotation<ReviewComment> = {
      side: 'additions',
      lineNumber: 40,
      metadata: {
        id: 'c2',
        text: 'Finding text here.',
        author: 'reviewer',
        createdAt: 1,
        threadId: 'c2',
      },
    }

    const group: ThreadGroup = {
      threadId: 'c2',
      turns: [anchorAnnotation],
      rollup: { label: 'Open', chip: 'text-on-surface-variant' },
      resolved: false,
      cwd: '/repo',
      filePath: 'src/foo.ts',
      staged: false,
    }

    renderBody({
      lineAnnotations: [anchorAnnotation],
      thread: {
        groups: new Map([['c2', group]]),
        actions: undefined,
      },
    })

    expect(screen.getByText('Finding text here.')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /reply/i })
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: /resolve/i })
    ).not.toBeInTheDocument()
  })
})
