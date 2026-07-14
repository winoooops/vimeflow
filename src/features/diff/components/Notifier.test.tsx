import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { DiffChipToolbarProps } from './toolbar'
import { Notifier } from './Notifier'
import type { RequestReviewScopeControl } from './RequestReviewPopover'

vi.mock('@/components/Popover', () => ({
  Popover: ({
    children,
    open,
  }: {
    children: ReactNode
    open: boolean
  }): ReactNode => (open ? <div data-testid="popover">{children}</div> : null),
}))

vi.mock('./toolbar', () => ({
  DiffChipToolbar: (): ReactNode => <div data-testid="diff-chip-toolbar" />,
}))

vi.mock('./FinishFeedbackPopover', () => ({
  FinishFeedbackPopover: ({
    commentCount,
  }: {
    commentCount: number
  }): ReactNode => (
    <div data-testid="finish-feedback-popover">{commentCount}</div>
  ),
}))

const toolbarProps: DiffChipToolbarProps = {
  diffMode: 'unstaged',
  diffStyle: 'split',
  onDiffStyleChange: vi.fn(),
  theme: 'pierre-dark',
  onThemeChange: vi.fn(),
  lineDiffType: 'word',
  onLineDiffTypeChange: vi.fn(),
  diffIndicators: 'classic',
  onDiffIndicatorsChange: vi.fn(),
  overflow: 'scroll',
  onOverflowChange: vi.fn(),
  disableLineNumbers: false,
  onDisableLineNumbersChange: vi.fn(),
  disableBackground: false,
  onDisableBackgroundChange: vi.fn(),
  disableFileHeader: false,
  onDisableFileHeaderChange: vi.fn(),
  stickyHeader: true,
  onStickyHeaderChange: vi.fn(),
  currentFileIndex: 0,
  totalFiles: 1,
}

const renderNotifier = (
  overrides: Partial<Parameters<typeof Notifier>[0]> = {}
): ReturnType<typeof render> =>
  render(
    <Notifier
      toolbarProps={toolbarProps}
      finishFeedback={{
        open: false,
        result: { kind: 'none' },
        commentCount: 0,
        fileCount: 0,
        onCancel: vi.fn(),
        onSend: vi.fn(),
        onCopy: vi.fn(),
      }}
      keyboardConfirm={null}
      onCancelKeyboardConfirm={vi.fn()}
      onConfirmKeyboardAction={vi.fn()}
      {...overrides}
    />
  )

describe('Notifier', () => {
  test('renders toolbar status messages and preserved draft copy', () => {
    renderNotifier({
      renderSyncError: 'pool failed',
      notifyMessage: 'Saved comment',
      recoverableDraft: {
        target: {
          filePath: 'src/foo.ts',
          staged: false,
          side: 'additions',
          lineNumber: 42,
        },
        text: 'Please explain this',
      },
    })

    expect(screen.getByTestId('diff-chip-toolbar')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Diff render sync failed: pool failed'
    )
    expect(screen.getByText('Saved comment')).toBeInTheDocument()
    expect(screen.getByTestId('diff-draft-recovery')).toHaveTextContent('R42')
  })

  test('renders anchored confirmation content after the shell ref is mounted', () => {
    const onConfirm = vi.fn()
    const { rerender } = renderNotifier()

    rerender(
      <Notifier
        toolbarProps={toolbarProps}
        finishFeedback={{
          open: false,
          result: { kind: 'none' },
          commentCount: 0,
          fileCount: 0,
          onCancel: vi.fn(),
          onSend: vi.fn(),
          onCopy: vi.fn(),
        }}
        keyboardConfirm={{
          title: 'Discard hunk?',
          body: 'This cannot be undone.',
          variant: 'danger',
        }}
        onCancelKeyboardConfirm={vi.fn()}
        onConfirmKeyboardAction={onConfirm}
      />
    )

    expect(screen.getByTestId('popover')).toHaveTextContent('Discard hunk?')
    expect(screen.getByRole('button', { name: 'Yes (y)' })).toBeInTheDocument()
  })

  test('scopeControl on requestReview reaches RequestReviewPopover', () => {
    const onScopeChange = vi.fn()

    const scopeControl: RequestReviewScopeControl = {
      scope: 'changelist',
      changeCount: 4,
      fileDisabled: false,
      changelistDisabled: false,
      onScopeChange,
    }

    const requestReviewProps = {
      open: true,
      result: { kind: 'none' as const },
      scopeLabel: '4 changes',
      scopeControl,
      onSubmit: vi.fn(),
      onCopy: vi.fn(),
      onCancel: vi.fn(),
    }

    const { rerender } = renderNotifier()

    // Rerender with the open request-review to give the ref time to mount
    rerender(
      <Notifier
        toolbarProps={toolbarProps}
        finishFeedback={{
          open: false,
          result: { kind: 'none' },
          commentCount: 0,
          fileCount: 0,
          onCancel: vi.fn(),
          onSend: vi.fn(),
          onCopy: vi.fn(),
        }}
        requestReview={requestReviewProps}
        keyboardConfirm={null}
        onCancelKeyboardConfirm={vi.fn()}
        onConfirmKeyboardAction={vi.fn()}
      />
    )

    // The SegmentedControl group from RequestReviewPopover must be in the DOM
    expect(
      screen.getByRole('group', { name: 'Review scope (f/a)' })
    ).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'All changes' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })
})
