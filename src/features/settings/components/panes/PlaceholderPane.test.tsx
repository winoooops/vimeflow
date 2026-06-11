import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SETTINGS_SECTIONS } from '../../sections'
import { PlaceholderPane } from './PlaceholderPane'

describe('PlaceholderPane', () => {
  test('renders the section label as title and coming soon eyebrow', () => {
    const section = SETTINGS_SECTIONS.find((s) => s.id === 'terminal')!
    render(<PlaceholderPane section={section} />)

    expect(screen.getByText('Terminal')).toBeInTheDocument()
    expect(screen.getByText('Coming soon')).toBeInTheDocument()
  })

  test('renders the placeholder message', () => {
    const section = SETTINGS_SECTIONS.find((s) => s.id === 'editor')!
    render(<PlaceholderPane section={section} />)

    expect(
      screen.getByText("Editor settings haven't been wired yet.")
    ).toBeInTheDocument()

    expect(
      screen.getByText(
        'This pane will host the editor configuration in a future build.'
      )
    ).toBeInTheDocument()
  })
})
