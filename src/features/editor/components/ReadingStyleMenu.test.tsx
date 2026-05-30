import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ReadingStyleMenu } from './ReadingStyleMenu'
import {
  getReadingStyleId,
  setReadingStyleId,
} from '../utils/readingStyleStore'

describe('ReadingStyleMenu', () => {
  afterEach(() => {
    setReadingStyleId('comfortable')
  })

  test('opens the gear menu and lists the presets as names only', async () => {
    const user = userEvent.setup()
    render(<ReadingStyleMenu />)

    expect(screen.queryByRole('menu')).toBeNull()
    await user.click(screen.getByRole('button', { name: /reading style/i }))

    expect(
      screen.getByRole('menu', { name: /reading style/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('menuitemradio', { name: /^compact$/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('menuitemradio', { name: /^comfortable$/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('menuitemradio', { name: /^spacious$/i })
    ).toBeInTheDocument()
  })

  test('marks the active preset and switches the shared store on selection', async () => {
    const user = userEvent.setup()
    render(<ReadingStyleMenu />)

    await user.click(screen.getByRole('button', { name: /reading style/i }))
    expect(
      screen.getByRole('menuitemradio', { name: /^comfortable$/i })
    ).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('menuitemradio', { name: /^spacious$/i }))

    expect(getReadingStyleId()).toBe('spacious')
    // Menu closes after a selection.
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('closes on Escape without changing the selection', async () => {
    const user = userEvent.setup()
    render(<ReadingStyleMenu />)

    await user.click(screen.getByRole('button', { name: /reading style/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(getReadingStyleId()).toBe('comfortable')
  })

  test('stops click propagation so a parent overflow menu stays open', async () => {
    const user = userEvent.setup()
    const parentClick = vi.fn()
    render(
      <div onClick={parentClick}>
        <ReadingStyleMenu />
      </div>
    )

    await user.click(screen.getByRole('button', { name: /reading style/i }))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(parentClick).not.toHaveBeenCalled()
  })
})
