import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import {
  SessionSwitcher,
  SESSION_SWITCHER_DIALOG_TEST_ID,
} from './SessionSwitcher'

const entries = [
  { id: 'a', title: 'api server', agentGlyph: null, isActive: true },
  { id: 'b', title: 'docs', agentGlyph: null, isActive: false },
]

describe('SessionSwitcher', () => {
  test('renders MRU entries as options with the selection marked', () => {
    render(
      <SessionSwitcher
        open
        entries={entries}
        selectedIndex={1}
        onCommitIndex={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('listbox')).toHaveAccessibleName('Session switcher')
  })

  test('marks its dialog so the owning hook can ignore its own overlay', () => {
    render(
      <SessionSwitcher
        open
        entries={entries}
        selectedIndex={0}
        onCommitIndex={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('dialog')).toHaveAttribute(
      'data-testid',
      SESSION_SWITCHER_DIALOG_TEST_ID
    )
  })

  test('clicking an entry commits its index', async () => {
    const onCommitIndex = vi.fn()
    render(
      <SessionSwitcher
        open
        entries={entries}
        selectedIndex={1}
        onCommitIndex={onCommitIndex}
        onCancel={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole('option', { name: /docs/ }))
    expect(onCommitIndex).toHaveBeenCalledWith(1)
  })

  test('renders nothing when closed', () => {
    render(
      <SessionSwitcher
        // eslint-disable-next-line react/jsx-boolean-value
        open={false}
        entries={entries}
        selectedIndex={0}
        onCommitIndex={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  test('close does not steal focus back from the activated surface', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    const { rerender } = render(
      <SessionSwitcher
        open
        entries={entries}
        selectedIndex={1}
        onCommitIndex={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const claimed = document.createElement('button')
    document.body.appendChild(claimed)
    claimed.focus()

    rerender(
      <SessionSwitcher
        // eslint-disable-next-line react/jsx-boolean-value
        open={false}
        entries={entries}
        selectedIndex={1}
        onCommitIndex={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(claimed).toHaveFocus()
    outside.remove()
    claimed.remove()
  })

  test('bounds the list height so long MRU lists scroll', () => {
    render(
      <SessionSwitcher
        open
        entries={entries}
        selectedIndex={0}
        onCommitIndex={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('listbox')).toHaveClass('overflow-y-auto')
  })

  test('scrolls the selected option into view as the selection moves', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')

    const { rerender } = render(
      <SessionSwitcher
        open
        entries={entries}
        selectedIndex={0}
        onCommitIndex={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    rerender(
      <SessionSwitcher
        open
        entries={entries}
        selectedIndex={1}
        onCommitIndex={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    scrollIntoView.mockRestore()
  })
})
