import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { DiffSearchPopup } from './DiffSearchPopup'

const fileHeaderHidden = false

const baseProps = {
  open: true,
  fileHeaderVisible: true,
  query: '',
  matchCount: 0,
  activeOrdinal: 0,
  confirming: false,
  inputRef: createRef<HTMLInputElement>(),
  onQueryChange: vi.fn(),
  onCommit: vi.fn(),
  onStep: vi.fn(),
  onClose: vi.fn(),
}

describe('DiffSearchPopup', () => {
  test('exposes a search landmark with labeled controls', () => {
    render(<DiffSearchPopup {...baseProps} />)

    expect(screen.getByRole('search')).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: /search in diff/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /previous match/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /next match/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /close search/i })
    ).toBeInTheDocument()
  })

  test('counter states: empty query → blank; matches → k/N; none → 0/0', () => {
    const { rerender } = render(<DiffSearchPopup {...baseProps} />)
    expect(screen.getByRole('status').textContent).toBe('')

    rerender(
      <DiffSearchPopup
        {...baseProps}
        query="se"
        matchCount={12}
        activeOrdinal={3}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('3/12')

    rerender(
      <DiffSearchPopup
        {...baseProps}
        query="zz"
        matchCount={0}
        activeOrdinal={0}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('0/0')
  })

  test('Enter commits forward, Shift+Enter backward, Esc closes', async () => {
    const onCommit = vi.fn()
    const onClose = vi.fn()
    render(
      <DiffSearchPopup
        {...baseProps}
        query="se"
        onCommit={onCommit}
        onClose={onClose}
      />
    )
    const input = screen.getByRole('textbox', { name: /search in diff/i })

    await userEvent.type(input, '{Enter}')
    expect(onCommit).toHaveBeenLastCalledWith(1)

    await userEvent.type(input, '{Shift>}{Enter}{/Shift}')
    expect(onCommit).toHaveBeenLastCalledWith(-1)

    await userEvent.type(input, '{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  test('Esc is inert while confirming (spec §3)', async () => {
    const onClose = vi.fn()
    render(<DiffSearchPopup {...baseProps} confirming onClose={onClose} />)

    await userEvent.type(
      screen.getByRole('textbox', { name: /search in diff/i }),
      '{Escape}'
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  test('typing forwards to onQueryChange', async () => {
    const onQueryChange = vi.fn()
    render(<DiffSearchPopup {...baseProps} onQueryChange={onQueryChange} />)

    await userEvent.type(
      screen.getByRole('textbox', { name: /search in diff/i }),
      'a'
    )
    expect(onQueryChange).toHaveBeenCalledWith('a')
  })

  test('uses the glassy 70% popup fill', () => {
    render(<DiffSearchPopup {...baseProps} />)

    const popup = screen.getByRole('search')
    expect(popup).toHaveClass('bg-surface-container-high/70')
    expect(popup).toHaveClass('backdrop-blur-[34px]')
    expect(popup).toHaveClass('backdrop-brightness-110')
    expect(popup).toHaveClass('backdrop-saturate-[180%]')
    expect(popup).not.toHaveClass('bg-surface-container-high/85')
  })

  test('moves down while the pierre file header is visible', () => {
    const { rerender } = render(<DiffSearchPopup {...baseProps} />)

    const popup = screen.getByRole('search')
    expect(popup).toHaveClass('right-[22px]')
    expect(popup).toHaveClass('top-10')
    expect(popup).not.toHaveClass('right-[72px]')
    expect(popup).not.toHaveClass('top-1')

    rerender(
      <DiffSearchPopup {...baseProps} fileHeaderVisible={fileHeaderHidden} />
    )

    expect(popup).toHaveClass('right-[22px]')
    expect(popup).toHaveClass('top-1')
    expect(popup).not.toHaveClass('right-[72px]')
    expect(popup).not.toHaveClass('top-10')
  })
})
