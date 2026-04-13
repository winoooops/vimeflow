import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollapsibleSection } from './CollapsibleSection'

describe('CollapsibleSection', () => {
  test('renders title in uppercase', () => {
    render(
      <CollapsibleSection title="Recent">
        <p>content</p>
      </CollapsibleSection>
    )

    expect(screen.getByRole('button', { name: /recent/i })).toBeInTheDocument()
  })

  test('renders count when provided', () => {
    render(
      <CollapsibleSection title="Files" count={5}>
        <p>content</p>
      </CollapsibleSection>
    )

    expect(screen.getByText('5')).toBeInTheDocument()
  })

  test('starts collapsed by default and hides children', () => {
    render(
      <CollapsibleSection title="Section">
        <p>hidden content</p>
      </CollapsibleSection>
    )

    expect(screen.queryByText('hidden content')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  test('starts expanded when defaultExpanded is true', () => {
    render(
      <CollapsibleSection title="Section" defaultExpanded>
        <p>visible content</p>
      </CollapsibleSection>
    )

    expect(screen.getByText('visible content')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  })

  test('toggles content visibility on click', async () => {
    const user = userEvent.setup()

    render(
      <CollapsibleSection title="Toggle">
        <p>toggled content</p>
      </CollapsibleSection>
    )

    expect(screen.queryByText('toggled content')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button'))
    expect(screen.getByText('toggled content')).toBeInTheDocument()

    await user.click(screen.getByRole('button'))
    expect(screen.queryByText('toggled content')).not.toBeInTheDocument()
  })

  test('shows collapsed chevron when collapsed and expanded chevron when expanded', async () => {
    const user = userEvent.setup()

    render(
      <CollapsibleSection title="Chevron">
        <p>content</p>
      </CollapsibleSection>
    )

    expect(screen.getByText('▸')).toBeInTheDocument()

    await user.click(screen.getByRole('button'))
    expect(screen.getByText('▾')).toBeInTheDocument()
  })
})
