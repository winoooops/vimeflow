import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { AGENTS } from '../../../../agents/registry'
import { Footer } from './Footer'

const baseProps = {
  agent: AGENTS.claude,
  pipStatus: 'running' as const,
  isFocused: false,
  isPaused: false,
  onClickFocus: vi.fn(),
}

describe('Footer', () => {
  test('renders agent-accent glyph', () => {
    render(<Footer {...baseProps} />)

    expect(screen.getByText('>')).toBeInTheDocument()
  })

  test('input is readOnly, tabIndex={-1}, and aria-hidden', () => {
    render(<Footer {...baseProps} />)

    const input = screen.getByDisplayValue('')

    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveAttribute('tabindex', '-1')
    expect(input).toHaveAttribute('aria-hidden', 'true')
  })

  test('placeholder when blurred shows click-to-focus cue', () => {
    render(<Footer {...baseProps} />)

    expect(
      screen.getByPlaceholderText(/click to focus claude/i)
    ).toBeInTheDocument()
  })

  test('placeholder when focused and paused shows paused', () => {
    render(<Footer {...baseProps} isFocused isPaused pipStatus="paused" />)

    expect(screen.getByPlaceholderText('paused')).toBeInTheDocument()
  })

  test('placeholder when focused and running shows message cue', () => {
    render(<Footer {...baseProps} isFocused />)

    expect(screen.getByPlaceholderText(/message claude/i)).toBeInTheDocument()
  })

  test('placeholder override replaces derivation', () => {
    render(
      <Footer
        {...baseProps}
        placeholder="session ended — restart to resume claude"
      />
    )

    expect(screen.getByPlaceholderText(/session ended/i)).toBeInTheDocument()
  })

  test('clicking footer container fires onClickFocus', () => {
    const onClickFocus = vi.fn()

    render(<Footer {...baseProps} onClickFocus={onClickFocus} />)
    fireEvent.click(screen.getByTestId('terminal-pane-footer'))

    expect(onClickFocus).toHaveBeenCalledTimes(1)
  })
})
