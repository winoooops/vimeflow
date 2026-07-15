import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { FilePill, type FilePillProps } from './FilePill'

const renderPill = (
  overrides: Partial<FilePillProps> = {}
): ReturnType<typeof render> => {
  const baseProps: FilePillProps = {
    fileName: 'src/App.tsx',
    counterText: '2/9',
    navEnabled: true,
    onPrev: vi.fn<() => void>(),
    onNext: vi.fn<() => void>(),
    previousShortcut: 'p',
    previousAriaKeyshortcuts: 'p',
    nextShortcut: 'n',
    nextAriaKeyshortcuts: 'n',
  }

  return render(<FilePill {...baseProps} {...overrides} />)
}

describe('FilePill', () => {
  test('renders the basename of the path, not the full path', () => {
    renderPill({ fileName: 'src/features/diff/App.tsx' })

    expect(screen.getByText('App.tsx')).toBeInTheDocument()
    expect(screen.queryByText('src/features/diff/App.tsx')).toBeNull()
  })

  test('falls back to an em-dash when no file is selected', () => {
    renderPill({ fileName: undefined })

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  test('renders the description icon and the count badge', () => {
    renderPill({ counterText: '2/9' })

    // The accessible group name carries the position so screen readers get it.
    const group = screen.getByRole('group', { name: /file 2\/9/i })
    // Material symbol ligature renders as text content.
    expect(group).toHaveTextContent('description')
    expect(group).toHaveTextContent('2/9')
  })

  test('accessible name includes the file path so screen readers get the filename', () => {
    // The visible text shows only the basename; the aria-label must still
    // carry the path so assistive tech announces WHICH file is shown — the
    // pill is now the toolbar's current-file display.
    renderPill({ fileName: 'src/features/diff/App.tsx', counterText: '3/9' })

    expect(
      screen.getByRole('group', { name: 'file 3/9: src/features/diff/App.tsx' })
    ).toBeInTheDocument()
  })

  test('clicking the arrows fires onPrev / onNext when navEnabled', async () => {
    const user = userEvent.setup()
    const onPrev = vi.fn<() => void>()
    const onNext = vi.fn<() => void>()

    renderPill({ navEnabled: true, onPrev, onNext })

    await user.click(screen.getByRole('button', { name: /next file/i }))
    expect(onNext).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /previous file/i }))
    expect(onPrev).toHaveBeenCalledTimes(1)
  })

  test('file navigation tooltips show keyboard shortcuts', async () => {
    const user = userEvent.setup()
    renderPill()

    await user.hover(screen.getByRole('button', { name: /next file/i }))

    expect(await screen.findByText('Next file')).toBeInTheDocument()
    expect(screen.getByTestId('tooltip-shortcut')).toHaveTextContent('n')
    expect(screen.getByRole('button', { name: /next file/i })).toHaveAttribute(
      'aria-keyshortcuts',
      'n'
    )
  })

  test('arrows are disabled and inert when navEnabled is false', () => {
    const onPrev = vi.fn<() => void>()
    const onNext = vi.fn<() => void>()

    renderPill({ navEnabled: false, onPrev, onNext })

    const prev = screen.getByRole('button', { name: /previous file/i })
    const next = screen.getByRole('button', { name: /next file/i })
    expect(prev).toBeDisabled()
    expect(next).toBeDisabled()

    // fireEvent (not userEvent) — the disabled arrows are `pointer-events:none`,
    // which userEvent.click refuses to interact with; the disabled attribute
    // still blocks the handler.
    fireEvent.click(prev)
    fireEvent.click(next)
    expect(onPrev).not.toHaveBeenCalled()
    expect(onNext).not.toHaveBeenCalled()
  })
})
