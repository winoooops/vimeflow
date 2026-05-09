import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  test('placeholder when blurred shows click-to-focus cue', () => {
    render(<Footer {...baseProps} />)

    expect(screen.getByText('click to focus claude')).toBeInTheDocument()
  })

  test('placeholder when focused and paused shows paused', () => {
    render(<Footer {...baseProps} isFocused isPaused pipStatus="paused" />)

    expect(screen.getByText('paused')).toBeInTheDocument()
  })

  test('placeholder when focused and running shows message cue', () => {
    render(<Footer {...baseProps} isFocused />)

    expect(screen.getByText('message claude...')).toBeInTheDocument()
  })

  test('placeholder override replaces derivation', () => {
    render(
      <Footer
        {...baseProps}
        placeholder="session ended — restart to resume claude"
      />
    )

    expect(
      screen.getByText('session ended — restart to resume claude')
    ).toBeInTheDocument()
  })

  test('clicking focus button fires onClickFocus', () => {
    const onClickFocus = vi.fn()

    render(<Footer {...baseProps} onClickFocus={onClickFocus} />)
    fireEvent.click(screen.getByRole('button', { name: 'Focus terminal' }))

    expect(onClickFocus).toHaveBeenCalledTimes(1)
  })

  test('pressing Enter on focus button fires onClickFocus', async () => {
    const onClickFocus = vi.fn()
    const user = userEvent.setup()

    render(<Footer {...baseProps} onClickFocus={onClickFocus} />)
    screen.getByRole('button', { name: 'Focus terminal' }).focus()
    await user.keyboard('{Enter}')

    expect(onClickFocus).toHaveBeenCalledTimes(1)
  })
})
