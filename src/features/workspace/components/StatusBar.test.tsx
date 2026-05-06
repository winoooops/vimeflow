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

  test('renders product brand mark in lavender', () => {
    render(<StatusBar />)

    const brand = screen.getByText('vimeflow')
    expect(brand).toHaveClass('text-primary-container')
  })

  test('renders version sourced from package.json', () => {
    render(<StatusBar />)

    // Anchored regex survives package.json version bumps without test churn.
    expect(screen.getByText(/^v\d+\.\d+\.\d+$/)).toBeInTheDocument()
  })

  test('exposes contentinfo landmark for assistive navigation', () => {
    render(<StatusBar />)

    // <footer> outside sectioning element → implicit role="contentinfo".
    expect(screen.getByRole('contentinfo')).toHaveAccessibleName('App status')
  })
})
