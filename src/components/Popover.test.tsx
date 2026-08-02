import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Popover } from './Popover'

const trackedAnchors: HTMLElement[] = []

const makeAnchor = (): HTMLElement => {
  const el = document.createElement('button')

  document.body.appendChild(el)
  trackedAnchors.push(el)

  return el
}

afterEach(() => {
  trackedAnchors.forEach((el) => el.remove())
  trackedAnchors.length = 0
})

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

  test('moves focus into the dialog on open and traps Tab inside it', async () => {
    const user = userEvent.setup()
    const anchor = makeAnchor()

    // A focusable sibling outside the popover; the modal trap must not let Tab
    // reach it. Rendered on body so the inert sibling-hiding cannot remove it.
    const outsideBtn = document.createElement('button')
    outsideBtn.textContent = 'outside'

    document.body.appendChild(outsideBtn)

    render(
      <Popover anchor={anchor} open onOpenChange={vi.fn()} aria-label="Confirm">
        <button type="button">Cancel</button>
        <button type="button">Confirm</button>
      </Popover>
    )

    const dialog = screen.getByRole('dialog', { name: 'Confirm' })

    // FloatingFocusManager moves focus to the first tabbable child on a
    // post-render microtask; without the fix focus stays on the trigger.
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Cancel' })
      ).toHaveFocus()
    )

    // Tab advances to the next in-dialog control and never escapes to the
    // outside sibling — the modal trap is engaged.
    await user.tab()
    expect(
      within(dialog).getByRole('button', { name: 'Confirm' })
    ).toHaveFocus()
    expect(outsideBtn).not.toHaveFocus()

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

  test('can render a pointer-transparent non-modal card', () => {
    const anchor = makeAnchor()

    render(
      <Popover
        anchor={anchor}
        open
        onOpenChange={vi.fn()}
        aria-label="Hover details"
        pointerEvents="none"
        focus="none"
      >
        <span>Details</span>
      </Popover>
    )

    const dialog = screen.getByRole('dialog', { name: 'Hover details' })

    expect(dialog).toHaveStyle({ pointerEvents: 'none' })
    expect(screen.getByText('Details')).toBeInTheDocument()
  })
})
