import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { Popover } from './Popover'

const makeAnchor = (): HTMLElement => {
  const el = document.createElement('button')

  document.body.appendChild(el)

  return el
}

describe('Popover', () => {
  test('renders children with role=dialog and the supplied aria-label', () => {
    const anchor = makeAnchor()

    render(
      <Popover
        anchor={anchor}
        open
        onOpenChange={vi.fn()}
        aria-label="Confirm action"
      >
        <p>Popover body</p>
      </Popover>
    )

    const dialog = screen.getByRole('dialog', { name: 'Confirm action' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Popover body')).toBeInTheDocument()
  })

  test('renders nothing when open is false', () => {
    const anchor = makeAnchor()
    const closed = false

    render(
      <Popover
        anchor={anchor}
        open={closed}
        onOpenChange={vi.fn()}
        aria-label="Confirm action"
      >
        <p>Should not appear</p>
      </Popover>
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument()
  })

  test('calls onOpenChange(false) when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const anchor = makeAnchor()

    render(
      <Popover
        anchor={anchor}
        open
        onOpenChange={onOpenChange}
        aria-label="Confirm action"
      >
        <button type="button">Do it</button>
      </Popover>
    )

    expect(
      screen.getByRole('dialog', { name: 'Confirm action' })
    ).toBeInTheDocument()
    await user.keyboard('{Escape}')
    // floating-ui passes (open, event, reason) — assert only the first argument.
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange.mock.calls[0][0]).toBe(false)
  })

  test('calls onOpenChange(false) on an outside-press', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const anchor = makeAnchor()

    // Render the outside target directly on body so FloatingFocusManager's
    // modal inert trap (aria-hidden on siblings) cannot hide it.
    const outsideBtn = document.createElement('button')
    outsideBtn.textContent = 'outside'

    document.body.appendChild(outsideBtn)

    render(
      <Popover
        anchor={anchor}
        open
        onOpenChange={onOpenChange}
        aria-label="Confirm action"
      >
        <button type="button">Do it</button>
      </Popover>
    )

    expect(
      screen.getByRole('dialog', { name: 'Confirm action' })
    ).toBeInTheDocument()
    await user.click(outsideBtn)
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange.mock.calls[0][0]).toBe(false)

    outsideBtn.remove()
  })

  test('renders children on the canonical glass chrome', () => {
    const anchor = makeAnchor()

    render(
      <Popover
        anchor={anchor}
        open
        onOpenChange={vi.fn()}
        aria-label="Settings"
      >
        <span>Content</span>
      </Popover>
    )

    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(dialog.className).toContain('rounded-lg')
    expect(dialog.className).toContain('backdrop-blur-md')
  })
})
