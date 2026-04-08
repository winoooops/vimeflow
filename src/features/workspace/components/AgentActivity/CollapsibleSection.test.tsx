import { render, screen } from '@testing-library/react'
import { test, expect, describe, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import CollapsibleSection from './CollapsibleSection'

describe('CollapsibleSection', () => {
  const mockOnToggle = vi.fn()

  beforeEach(() => {
    mockOnToggle.mockClear()
  })

  describe('rendering', () => {
    test('renders section title', () => {
      render(
        <CollapsibleSection
          title="Files Changed"
          count={3}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      expect(screen.getByText('Files Changed')).toBeInTheDocument()
    })

    test('renders count badge with correct number', () => {
      render(
        <CollapsibleSection
          title="Tool Calls"
          count={5}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      expect(screen.getByText('(5)')).toBeInTheDocument()
    })

    test('does not render count badge when count is 0', () => {
      render(
        <CollapsibleSection
          title="Tests"
          count={0}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      expect(screen.queryByText('(0)')).not.toBeInTheDocument()
    })

    test('renders children when expanded', () => {
      render(
        <CollapsibleSection
          title="Files Changed"
          count={3}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div>Section Content Here</div>
        </CollapsibleSection>
      )

      expect(screen.getByText('Section Content Here')).toBeInTheDocument()
    })

    test('does not render children when collapsed', () => {
      render(
        <CollapsibleSection
          title="Files Changed"
          count={3}
          onToggle={mockOnToggle}
        >
          <div>Section Content Here</div>
        </CollapsibleSection>
      )

      expect(screen.queryByText('Section Content Here')).not.toBeInTheDocument()
    })
  })

  describe('chevron indicator', () => {
    test('shows down chevron (▾) when expanded', () => {
      render(
        <CollapsibleSection
          title="Files"
          count={2}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      expect(screen.getByText('▾')).toBeInTheDocument()
    })

    test('shows right chevron (▸) when collapsed', () => {
      render(
        <CollapsibleSection title="Files" count={2} onToggle={mockOnToggle}>
          <div>Content</div>
        </CollapsibleSection>
      )

      expect(screen.getByText('▸')).toBeInTheDocument()
    })
  })

  describe('interaction', () => {
    test('calls onToggle when header is clicked', async () => {
      const user = userEvent.setup()

      render(
        <CollapsibleSection
          title="Tool Calls"
          count={4}
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      const header = screen.getByRole('button', { name: /tool calls/i })

      await user.click(header)
      expect(mockOnToggle).toHaveBeenCalledTimes(1)
    })

    test('header has pointer cursor for interactivity', () => {
      render(
        <CollapsibleSection
          title="Tests"
          count={10}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      const header = screen.getByRole('button')

      expect(header).toHaveClass('cursor-pointer')
    })
  })

  describe('styling and design tokens', () => {
    test('applies font-label class to header', () => {
      render(
        <CollapsibleSection
          title="Files"
          count={3}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      const header = screen.getByRole('button')

      expect(header).toHaveClass('font-label')
    })

    test('applies correct text color to title', () => {
      render(
        <CollapsibleSection
          title="Files"
          count={3}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      const title = screen.getByText('Files')

      expect(title).toHaveClass('text-on-surface')
    })

    test('applies muted color to count badge', () => {
      render(
        <CollapsibleSection
          title="Files"
          count={7}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      const countBadge = screen.getByText('(7)')

      expect(countBadge).toHaveClass('text-on-surface/60')
    })

    test('applies flex layout to header', () => {
      render(
        <CollapsibleSection
          title="Files"
          count={3}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      const header = screen.getByRole('button')

      expect(header).toHaveClass('flex')
      expect(header).toHaveClass('items-center')
    })

    test('applies correct spacing with gap-2', () => {
      render(
        <CollapsibleSection
          title="Files"
          count={3}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      const header = screen.getByRole('button')

      expect(header).toHaveClass('gap-2')
    })

    test('applies hover effect to header', () => {
      render(
        <CollapsibleSection
          title="Files"
          count={3}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      const header = screen.getByRole('button')

      expect(header).toHaveClass('hover:bg-surface-container/50')
    })

    test('applies rounded corners and padding to header', () => {
      render(
        <CollapsibleSection
          title="Files"
          count={3}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      const header = screen.getByRole('button')

      expect(header).toHaveClass('rounded-lg')
      expect(header).toHaveClass('px-2')
      expect(header).toHaveClass('py-1.5')
    })
  })

  describe('layout structure', () => {
    test('renders container with proper structure', () => {
      render(
        <CollapsibleSection
          title="Files"
          count={3}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div data-testid="section-content">Content</div>
        </CollapsibleSection>
      )

      const container = screen.getByTestId('collapsible-section')

      expect(container).toHaveClass('flex')
      expect(container).toHaveClass('flex-col')
      expect(container).toHaveClass('gap-2')
    })

    test('content area has proper margin when expanded', () => {
      render(
        <CollapsibleSection
          title="Files"
          count={3}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div data-testid="section-content">Content</div>
        </CollapsibleSection>
      )

      const content = screen.getByTestId('section-content-wrapper')

      expect(content).toHaveClass('ml-4')
    })
  })

  describe('accessibility', () => {
    test('header is a button for keyboard navigation', () => {
      render(
        <CollapsibleSection
          title="Files"
          count={3}
          isExpanded
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      const header = screen.getByRole('button')

      expect(header).toBeInTheDocument()
    })

    test('header has accessible name including title', () => {
      render(
        <CollapsibleSection
          title="Tool Calls"
          count={5}
          onToggle={mockOnToggle}
        >
          <div>Content</div>
        </CollapsibleSection>
      )

      expect(
        screen.getByRole('button', { name: /tool calls/i })
      ).toBeInTheDocument()
    })
  })
})
