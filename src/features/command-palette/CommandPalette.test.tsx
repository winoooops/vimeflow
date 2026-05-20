import { describe, expect, test } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPalette } from './CommandPalette.testUtils'
import type { Command } from './registry/types'

const sampleCommand: Command = {
  id: 'help',
  label: ':help',
  description: 'Show command reference',
  icon: 'help',
}

describe('CommandPalette', () => {
  test('does not render the dialog when state.isOpen is false', () => {
    renderPalette({ state: { isOpen: false } })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('renders the dialog when state.isOpen is true', () => {
    renderPalette({ state: { isOpen: true } })

    expect(
      screen.getByRole('dialog', { name: 'Command palette' })
    ).toBeInTheDocument()
  })

  test('calls close when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const { close } = renderPalette({ state: { isOpen: true } })

    await user.click(screen.getByTestId('command-palette-backdrop'))

    expect(close).toHaveBeenCalledTimes(1)
  })

  test('renders the controlled query value and forwards input changes', async () => {
    const user = userEvent.setup()

    const { setQuery } = renderPalette({
      state: { isOpen: true, query: ':open' },
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })

    expect(input).toHaveValue(':open')

    await user.type(input, 'x')

    expect(setQuery).toHaveBeenLastCalledWith(':open' + 'x')
  })

  test('renders controlled results and selected index', () => {
    renderPalette({
      filteredResults: [sampleCommand],
      clampedSelectedIndex: 0,
    })

    const option = screen.getByRole('option', { name: /:help/i })

    expect(option).toHaveAttribute('aria-selected', 'true')
  })

  test('calls selectIndex when a result is clicked', async () => {
    const user = userEvent.setup()

    const { selectIndex } = renderPalette({
      filteredResults: [sampleCommand],
      clampedSelectedIndex: 0,
    })

    await user.click(screen.getByRole('option', { name: /:help/i }))

    expect(selectIndex).toHaveBeenCalledWith(0)
  })

  test('renders the footer and overlay z-index', () => {
    renderPalette()

    expect(screen.getByText('Navigate')).toBeInTheDocument()
    expect(screen.getByText('Select')).toBeInTheDocument()
    expect(screen.getByText("Type '?' for help")).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveClass('z-[100]')
  })
})
