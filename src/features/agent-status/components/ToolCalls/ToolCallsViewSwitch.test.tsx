import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ToolCallsViewSwitch } from './ToolCallsViewSwitch'

describe('ToolCallsViewSwitch', () => {
  test('renders both view options as buttons', () => {
    render(<ToolCallsViewSwitch view="jar" onChange={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: 'Packed view' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tag view' })).toBeInTheDocument()
  })

  test('marks the active view as pressed', () => {
    render(<ToolCallsViewSwitch view="tags" onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Tag view' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    expect(screen.getByRole('button', { name: 'Packed view' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  test('calls onChange with the chosen view', () => {
    const onChange = vi.fn()
    render(<ToolCallsViewSwitch view="jar" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Tag view' }))

    expect(onChange).toHaveBeenCalledWith('tags')
  })
})
