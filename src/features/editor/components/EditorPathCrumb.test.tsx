import { act, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { EditorPathCrumb, type EditorPathCrumbStatus } from './EditorPathCrumb'

const STATUS_RENDER_CASES: {
  status: EditorPathCrumbStatus
  savedAt?: number
  label: string
  className: string
  accessibleName: string
}[] = [
  {
    status: 'SAVED',
    savedAt: new Date('2026-06-17T03:09:00Z').getTime(),
    label: 'SAVED · 3m ago',
    className: 'text-success-muted',
    accessibleName: 'File path: src/middleware/auth.ts. saved · 3m ago',
  },
  {
    status: 'UNSAVED',
    label: 'UNSAVED',
    className: 'text-primary',
    accessibleName: 'File path: src/middleware/auth.ts. unsaved',
  },
  {
    status: 'NEW',
    label: 'NEW',
    className: 'text-success-muted',
    accessibleName: 'File path: src/middleware/auth.ts. new',
  },
  {
    status: 'DELETED',
    label: 'DELETED',
    className: 'text-tertiary',
    accessibleName: 'File path: src/middleware/auth.ts. deleted',
  },
]

describe('EditorPathCrumb', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('renders muted directories, separators, bright leaf, and unsaved tag', () => {
    render(
      <EditorPathCrumb filePath="src/middleware/auth.ts" status="UNSAVED" />
    )

    const crumb = screen.getByTestId('editor-path-crumb')
    expect(crumb).toHaveClass('cursor-default')
    expect(crumb).toHaveAccessibleName(
      'File path: src/middleware/auth.ts. unsaved'
    )

    expect(within(crumb).getByText('folder_open')).toHaveAttribute(
      'aria-hidden',
      'true'
    )
    expect(within(crumb).getByText('src')).toHaveClass('text-on-surface-muted')
    expect(within(crumb).getAllByText('/')[0]).toHaveClass(
      'text-outline-variant'
    )
    expect(within(crumb).getByText('auth.ts')).toHaveClass('text-on-surface')
    expect(within(crumb).getByText('UNSAVED')).toHaveClass('text-primary')
  })

  test.each(STATUS_RENDER_CASES)(
    'renders $status state with its expected label, tone, and accessible name',
    ({ status, savedAt = null, label, className, accessibleName }) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-17T03:12:00Z'))

      render(
        <EditorPathCrumb
          filePath="src/middleware/auth.ts"
          savedAt={savedAt}
          status={status}
        />
      )

      const crumb = screen.getByTestId('editor-path-crumb')
      expect(crumb).toHaveAccessibleName(accessibleName)
      expect(within(crumb).getByText(label)).toHaveClass(className)
    }
  )

  test('renders saved state with hour and day relative time buckets', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T12:00:00Z'))

    const { unmount } = render(
      <EditorPathCrumb
        filePath="src/middleware/auth.ts"
        savedAt={new Date('2026-06-17T09:00:00Z').getTime()}
        status="SAVED"
      />
    )

    expect(screen.getByText('SAVED · 3h ago')).toBeInTheDocument()

    unmount()
    render(
      <EditorPathCrumb
        filePath="src/middleware/auth.ts"
        savedAt={new Date('2026-06-15T12:00:00Z').getTime()}
        status="SAVED"
      />
    )

    expect(screen.getByText('SAVED · 2d ago')).toBeInTheDocument()
  })

  test('updates saved relative time while the saved state is visible', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T03:12:00Z'))

    render(
      <EditorPathCrumb
        filePath="src/middleware/auth.ts"
        savedAt={new Date('2026-06-17T03:12:00Z').getTime()}
        status="SAVED"
      />
    )

    expect(screen.getByText('SAVED · just now')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(screen.getByText('SAVED · 1m ago')).toBeInTheDocument()
  })

  test('omits saved state when no saved timestamp is available', () => {
    render(<EditorPathCrumb filePath="README.md" status="SAVED" />)

    expect(screen.getByText('README.md')).toHaveClass('text-on-surface')
    expect(screen.queryByText(/saved/i)).toBeNull()
  })

  test('truncates deep paths to the last two directories and filename', () => {
    render(
      <EditorPathCrumb
        filePath="src/server/api/routes/webhooks.ts"
        status="UNSAVED"
      />
    )

    expect(screen.getByTestId('editor-path-trimmed')).toHaveTextContent('…/')
    expect(screen.queryByText('src')).toBeNull()
    expect(screen.queryByText('server')).toBeNull()
    expect(screen.getByText('api')).toBeInTheDocument()
    expect(screen.getByText('routes')).toBeInTheDocument()
    expect(screen.getByText('webhooks.ts')).toBeInTheDocument()
  })

  test('omits the state tag when status is null', () => {
    render(<EditorPathCrumb filePath="README.md" />)

    expect(screen.getByText('README.md')).toHaveClass('text-on-surface')
    expect(screen.queryByText('UNSAVED')).toBeNull()
    expect(screen.queryByText('SAVED')).toBeNull()
    expect(screen.queryByText('NEW')).toBeNull()
    expect(screen.queryByText('DELETED')).toBeNull()
  })
})
