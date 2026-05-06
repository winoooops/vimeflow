import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBar } from './StatusBar'

describe('StatusBar', () => {
  test('renders with 24px height (h-6)', () => {
    render(<StatusBar />)

    const bar = screen.getByTestId('status-bar')
    expect(bar).toHaveClass('h-6')
  })

  test('uses surface-container-lowest background per handoff §4.9', () => {
    render(<StatusBar />)

    const bar = screen.getByTestId('status-bar')
    expect(bar).toHaveClass('bg-surface-container-lowest')
  })

  test('has border-top for subtle separation', () => {
    render(<StatusBar />)

    const bar = screen.getByTestId('status-bar')
    expect(bar).toHaveClass('border-t')
  })

  test('renders placeholder brand mark in lavender', () => {
    render(<StatusBar />)

    const brand = screen.getByText('obsidian-cli')
    expect(brand).toHaveClass('text-primary-container')
  })

  test('renders placeholder version label', () => {
    render(<StatusBar />)

    expect(screen.getByText('v0.9.4')).toBeInTheDocument()
  })
})
