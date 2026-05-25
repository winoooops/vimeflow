import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { DiffNarrowPlaceholder } from './DiffNarrowPlaceholder'

describe('DiffNarrowPlaceholder', (): void => {
  test('renders the primary copy', (): void => {
    render(<DiffNarrowPlaceholder min={360} />)
    expect(
      screen.getByText('Pane is too narrow to render the diff.')
    ).toBeInTheDocument()
  })

  test('renders the secondary copy with the passed min value', (): void => {
    render(<DiffNarrowPlaceholder min={420} />)
    expect(
      screen.getByText('Widen to ≥ 420px to view changes.')
    ).toBeInTheDocument()
  })

  test('uses role=status for accessibility', (): void => {
    render(<DiffNarrowPlaceholder min={360} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
