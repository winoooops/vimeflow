import { useState, type ReactElement } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SETTINGS_SECTIONS } from '../sections'
import { SettingsSidebar } from './SettingsSidebar'

const StatefulSidebar = (): ReactElement => {
  const [query, setQuery] = useState('')

  return (
    <SettingsSidebar
      sections={SETTINGS_SECTIONS}
      active="appearance"
      onPick={() => undefined}
      query={query}
      onQuery={setQuery}
    />
  )
}

describe('SettingsSidebar', () => {
  const baseProps = {
    sections: SETTINGS_SECTIONS,
    active: 'appearance' as const,
    onPick: vi.fn(),
    query: '',
    onQuery: vi.fn(),
  }

  test('renders the search input with placeholder', () => {
    render(<SettingsSidebar {...baseProps} />)

    expect(
      screen.getByPlaceholderText('Search settings...')
    ).toBeInTheDocument()
  })

  test('renders all section buttons', () => {
    render(<SettingsSidebar {...baseProps} />)

    SETTINGS_SECTIONS.forEach((s) => {
      expect(screen.getByRole('button', { name: s.label })).toBeInTheDocument()
    })
  })

  test('forwards query changes', async () => {
    const user = userEvent.setup()
    render(<StatefulSidebar />)

    await user.type(screen.getByPlaceholderText('Search settings...'), 'term')

    expect(screen.getByPlaceholderText('Search settings...')).toHaveValue(
      'term'
    )
  })

  test('calls onPick with the section id when a button is clicked', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<SettingsSidebar {...baseProps} onPick={onPick} />)

    await user.click(screen.getByRole('button', { name: 'Keymap' }))

    expect(onPick).toHaveBeenCalledWith('keymap')
  })

  test('marks the active section with primary text', () => {
    render(<SettingsSidebar {...baseProps} />)

    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveClass(
      'text-primary'
    )
  })
})
