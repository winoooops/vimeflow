import { createRef, type ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { FileDiffOptions } from '@pierre/diffs'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PanelBody } from './PanelBody'
import type { ReviewComment } from '../hooks/useFeedbackBatch'
import type { PierreFileInputs } from '../services/pierreAdapter'

interface MultiFileDiffMockProps {
  oldFile: { name: string }
  newFile: { name: string }
  lineAnnotations: unknown[]
  options: { diffStyle?: string }
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
      />
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

const createBodyProps = (
  overrides: Partial<Parameters<typeof PanelBody>[0]> = {}
): Parameters<typeof PanelBody>[0] => ({
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
  onPointerMove: vi.fn(),
  onAddComment: vi.fn(),
  onEditComment: vi.fn(),
  onDeleteComment: vi.fn(),
  onCommentTextChange: vi.fn(),
  onConfirmComment: vi.fn(),
  onCancelComment: vi.fn(),
  ...overrides,
})

const renderBody = (
  overrides: Partial<Parameters<typeof PanelBody>[0]> = {}
): ReturnType<typeof render> =>
  render(<PanelBody {...createBodyProps(overrides)} />)

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
})
