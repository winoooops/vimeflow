import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ReorderMotionDemo } from './ReorderMotionDemo'

describe('ReorderMotionDemo', () => {
  test('renders native and current-list reorder surfaces side by side', () => {
    render(<ReorderMotionDemo />)

    expect(
      screen.getByRole('heading', { name: 'Session Reorder' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('heading', { name: 'Native Framer' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('heading', { name: 'Current List' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('heading', { name: 'Native Guarded' })
    ).toBeInTheDocument()

    expect(screen.getAllByRole('button', { name: 'Sessions' })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Other' })).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
  })
})
