import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { EditorPathCrumb } from './EditorPathCrumb'

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

  test('renders saved state with relative time in success tone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T03:12:00Z'))

    render(
      <EditorPathCrumb
        filePath="src/middleware/auth.ts"
        savedAt={new Date('2026-06-17T03:09:00Z').getTime()}
        status="SAVED"
      />
    )

    expect(screen.getByText('SAVED · 3m ago')).toHaveClass('text-success-muted')
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
  })
})
