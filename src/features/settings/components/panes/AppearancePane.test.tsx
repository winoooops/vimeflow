import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BUILTIN_SCHEMES } from '../../sections'
import { AppearancePane } from './AppearancePane'

describe('AppearancePane', () => {
  test('renders the pane title', () => {
    render(<AppearancePane />)

    expect(screen.getByText('Appearance')).toBeInTheDocument()
    expect(
      screen.getByText('Theme · Color Scheme · Typography')
    ).toBeInTheDocument()
  })

  test('renders all builtin scheme cards', () => {
    render(<AppearancePane />)

    BUILTIN_SCHEMES.forEach((s) => {
      expect(screen.getByText(s.label)).toBeInTheDocument()
    })
  })

  test('selects a scheme card on click', async () => {
    const user = userEvent.setup()
    render(<AppearancePane />)

    const dense = screen.getByText('Dense')
    await user.click(dense)

    expect(screen.getByRole('button', { name: /Dense/i })).toHaveClass(
      'bg-primary-container/[0.08]'
    )
  })

  test('renders the accent hue slider', () => {
    render(<AppearancePane />)

    expect(screen.getByLabelText('Accent hue')).toBeInTheDocument()
  })

  test('changes density via the select', async () => {
    const user = userEvent.setup()
    render(<AppearancePane />)

    const density = screen.getByLabelText('Density')
    await user.selectOptions(density, 'compact')

    expect(density).toHaveValue('compact')
  })
})
