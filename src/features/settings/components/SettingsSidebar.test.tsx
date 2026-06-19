import { useState, type ReactElement } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  SETTINGS_SECTIONS,
  SETTINGS_TARGET_IDS,
  SETTINGS_TARGETS,
} from '../sections'
import { SettingsSidebar } from './SettingsSidebar'

const redactTarget = SETTINGS_TARGETS.find(
  (target) => target.id === SETTINGS_TARGET_IDS.generalRedactPrivateValues
)!

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

  test('renders the search input as a combobox with accessible name', () => {
    render(<SettingsSidebar {...baseProps} />)

    expect(
      screen.getByRole('combobox', { name: 'Search settings' })
    ).toBeInTheDocument()
  })

  test('exposes combobox list semantics on the search input', () => {
    render(<SettingsSidebar {...baseProps} />)

    const input = screen.getByRole('combobox', { name: 'Search settings' })

    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    expect(input).toHaveAttribute('aria-controls', 'settings-search-results')
    expect(input).toHaveAttribute('aria-expanded', 'true')
  })

  test('points aria-activedescendant at the active section result', () => {
    render(<SettingsSidebar {...baseProps} active="keymap" />)

    expect(
      screen.getByRole('combobox', { name: 'Search settings' })
    ).toHaveAttribute(
      'aria-activedescendant',
      'settings-search-result-section-keymap'
    )
  })

  test('points aria-activedescendant at the active target result', () => {
    render(
      <SettingsSidebar
        {...baseProps}
        sections={SETTINGS_SECTIONS.filter(
          (section) => section.id === 'general'
        )}
        targets={[redactTarget]}
        active="general"
        activeTargetId={redactTarget.id}
      />
    )

    expect(
      screen.getByRole('combobox', { name: 'Search settings' })
    ).toHaveAttribute(
      'aria-activedescendant',
      `settings-search-result-target-${redactTarget.id}`
    )
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

  test('renders a clear search button when the query has text', async () => {
    const user = userEvent.setup()
    const onClearQuery = vi.fn()
    render(
      <SettingsSidebar
        {...baseProps}
        query="term"
        onClearQuery={onClearQuery}
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Clear settings search' })
    )

    expect(onClearQuery).toHaveBeenCalledTimes(1)
  })

  test('does not render the clear search button when the query is empty', () => {
    render(<SettingsSidebar {...baseProps} />)

    expect(
      screen.queryByRole('button', { name: 'Clear settings search' })
    ).not.toBeInTheDocument()
  })

  test('forwards search result keyboard navigation', async () => {
    const user = userEvent.setup()
    const onNavigateSearchResult = vi.fn()
    const onConfirmSearchResult = vi.fn()
    render(
      <SettingsSidebar
        {...baseProps}
        query="redact"
        onNavigateSearchResult={onNavigateSearchResult}
        onConfirmSearchResult={onConfirmSearchResult}
      />
    )

    await user.click(screen.getByRole('combobox', { name: 'Search settings' }))
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}')

    expect(onNavigateSearchResult).toHaveBeenNthCalledWith(1, 'next')
    expect(onNavigateSearchResult).toHaveBeenNthCalledWith(2, 'previous')
    expect(onConfirmSearchResult).toHaveBeenCalledTimes(1)
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

  test('marks the active section with aria-current', () => {
    render(<SettingsSidebar {...baseProps} />)

    expect(
      screen.getByRole('button', { name: 'Appearance', current: 'page' })
    ).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Keymap' })).not.toHaveAttribute(
      'aria-current'
    )
  })

  test('renders matching option targets under their owning section', () => {
    render(
      <SettingsSidebar
        {...baseProps}
        sections={SETTINGS_SECTIONS.filter(
          (section) => section.id === 'general'
        )}
        targets={[redactTarget]}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Redact Private Values' })
    ).toBeInTheDocument()
  })

  test('calls onPickTarget when an option target is clicked', async () => {
    const user = userEvent.setup()
    const onPickTarget = vi.fn()
    render(
      <SettingsSidebar
        {...baseProps}
        sections={SETTINGS_SECTIONS.filter(
          (section) => section.id === 'general'
        )}
        targets={[redactTarget]}
        onPickTarget={onPickTarget}
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Redact Private Values' })
    )

    expect(onPickTarget).toHaveBeenCalledWith(redactTarget)
  })

  test('marks the active option target with aria-current', () => {
    render(
      <SettingsSidebar
        {...baseProps}
        sections={SETTINGS_SECTIONS.filter(
          (section) => section.id === 'general'
        )}
        targets={[redactTarget]}
        activeTargetId={redactTarget.id}
      />
    )

    expect(
      screen.getByRole('button', {
        name: 'Redact Private Values',
        current: 'location',
      })
    ).toBeInTheDocument()
  })
})
