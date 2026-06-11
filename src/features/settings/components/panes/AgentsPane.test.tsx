import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_ALIASES } from '../../sections'
import { AgentsPane } from './AgentsPane'

describe('AgentsPane', () => {
  test('renders the pane title', () => {
    render(<AgentsPane />)

    expect(screen.getByText('Coding Agents')).toBeInTheDocument()
    expect(
      screen.getByText('Shell aliases · agent registry')
    ).toBeInTheDocument()
  })

  test('renders the default aliases', () => {
    render(<AgentsPane />)

    DEFAULT_ALIASES.forEach((a) => {
      expect(screen.getByDisplayValue(a.alias)).toBeInTheDocument()
    })
  })

  test('adds a new alias row when Add alias is clicked', async () => {
    const user = userEvent.setup()
    render(<AgentsPane />)

    await user.click(screen.getByRole('button', { name: /Add alias/i }))

    expect(screen.getAllByTestId('alias-row').length).toBe(
      DEFAULT_ALIASES.length + 1
    )
  })

  test('removes an alias row when its delete button is clicked', async () => {
    const user = userEvent.setup()
    render(<AgentsPane />)

    const deleteButtons = screen.getAllByTestId('remove-alias')
    await user.click(deleteButtons[0])

    expect(screen.getAllByTestId('alias-row').length).toBe(
      DEFAULT_ALIASES.length - 1
    )
  })

  test('dims alias rows when the shim toggle is turned off', async () => {
    const user = userEvent.setup()
    render(<AgentsPane />)

    await user.click(
      screen.getByRole('button', { name: 'Manage agent shell aliases' })
    )

    const rows = screen.getAllByTestId('alias-row')
    rows.forEach((row) => {
      expect(row).toHaveClass('opacity-45')
    })
  })

  test('renders the info callout with the aliases.toml path', () => {
    render(<AgentsPane />)

    expect(screen.getByText(/aliases.toml/)).toBeInTheDocument()
    expect(screen.getByText(/How this works/)).toBeInTheDocument()
  })
})
