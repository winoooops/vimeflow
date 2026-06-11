import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KEYMAPS } from '../../sections'
import { KeymapPane } from './KeymapPane'

describe('KeymapPane', () => {
  test('renders the pane title', () => {
    render(<KeymapPane />)

    expect(screen.getByText('Keymap')).toBeInTheDocument()
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument()
  })

  test('renders the preset select', () => {
    render(<KeymapPane />)

    expect(screen.getByLabelText('Keymap preset')).toHaveValue('vimeflow')
  })

  test('renders every keymap binding', () => {
    render(<KeymapPane />)

    KEYMAPS.forEach((b) => {
      expect(screen.getByText(b.label)).toBeInTheDocument()
    })
  })

  test('switches preset via the select', async () => {
    const user = userEvent.setup()
    render(<KeymapPane />)

    const select = screen.getByLabelText('Keymap preset')
    await user.selectOptions(select, 'vim')

    expect(select).toHaveValue('vim')
  })

  test('renders the reset/import/export ghost buttons', () => {
    render(<KeymapPane />)

    expect(
      screen.getByRole('button', { name: 'Reset to preset' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Import bindings...' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Export bindings' })
    ).toBeInTheDocument()
  })
})
