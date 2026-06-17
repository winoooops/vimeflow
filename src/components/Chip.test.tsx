import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Chip } from './Chip'

test('renders a text label', () => {
  render(<Chip label="Read" />)

  expect(screen.getByText('Read')).toBeInTheDocument()
})

test('renders a material leading icon as aria-hidden', () => {
  render(<Chip leadingIcon="description" label="File" />)

  const icon = screen.getByText('description')
  expect(icon).toHaveClass('material-symbols-outlined')
  expect(icon).toHaveAttribute('aria-hidden', 'true')
})

test('renders a trailing count with mono emphasis', () => {
  render(<Chip label="Edit" trailingCount={7} />)

  expect(screen.getByText('7')).toHaveClass('font-mono', 'font-semibold')
})

test('applies variant, tone, radius, and size classes', () => {
  render(
    <Chip
      data-testid="chip"
      variant="tinted"
      tone="primary"
      radius="pill"
      size="xs"
      label="Live"
    />
  )

  const chip = screen.getByTestId('chip')
  expect(chip).toHaveClass('rounded-full')
  expect(chip).toHaveClass('bg-primary/10')
  expect(chip).toHaveClass('text-primary')
  expect(chip).toHaveClass('text-[9px]')
})

test('renders custom children instead of the label shortcut', () => {
  render(
    <Chip label="Hidden">
      <span>Custom chip</span>
    </Chip>
  )

  expect(screen.getByText('Custom chip')).toBeInTheDocument()
  expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
})
