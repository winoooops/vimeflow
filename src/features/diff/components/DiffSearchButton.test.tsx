import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getCommand, type CommandId } from '@/features/keymap/catalog'
import { resolveDefault } from '@/features/keymap/resolve'
import type { Keybindings } from '@/features/keymap/useKeybindings'
import { DiffSearchButton } from './DiffSearchButton'

const fileHeaderHidden = false

const bindingFor: Keybindings['bindingFor'] = (id: CommandId) =>
  resolveDefault(getCommand(id), false)

describe('DiffSearchButton', () => {
  test('renders an accessible search button and fires onOpen', async () => {
    const onOpen = vi.fn()
    render(
      <DiffSearchButton
        bindingFor={bindingFor}
        fileHeaderVisible
        onOpen={onOpen}
      />
    )

    const button = screen.getByRole('button', { name: /search in diff/i })
    expect(button).toHaveAttribute('aria-keyshortcuts', '/')
    await userEvent.click(button)

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  test('moves down while the pierre file header is visible', () => {
    const { rerender } = render(
      <DiffSearchButton
        bindingFor={bindingFor}
        fileHeaderVisible
        onOpen={vi.fn()}
      />
    )

    const button = screen.getByRole('button', { name: /search in diff/i })
    expect(button).toHaveClass('right-[22px]')
    expect(button).toHaveClass('top-10')
    expect(button).not.toHaveClass('right-[72px]')
    expect(button).not.toHaveClass('top-1')

    rerender(
      <DiffSearchButton
        bindingFor={bindingFor}
        fileHeaderVisible={fileHeaderHidden}
        onOpen={vi.fn()}
      />
    )

    expect(button).toHaveClass('right-[22px]')
    expect(button).toHaveClass('top-1')
    expect(button).not.toHaveClass('right-[72px]')
    expect(button).not.toHaveClass('top-10')
  })
})
