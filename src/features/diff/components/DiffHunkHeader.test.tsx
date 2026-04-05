/* eslint-disable testing-library/no-node-access */
import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { DiffHunkHeader } from './DiffHunkHeader'

describe('DiffHunkHeader', () => {
  test('renders hunk header text', () => {
    render(<DiffHunkHeader header="@@ -102,7 +102,6 @@" />)
    expect(screen.getByText('@@ -102,7 +102,6 @@')).toBeInTheDocument()
  })

  test('renders with sticky positioning', () => {
    const { container } = render(<DiffHunkHeader header="@@ -1,5 +1,3 @@" />)
    const header = container.firstChild as HTMLElement
    expect(header).toHaveClass('sticky')
  })

  test('has background styling', () => {
    const { container } = render(<DiffHunkHeader header="@@ -10,8 +10,12 @@" />)
    const header = container.firstChild as HTMLElement
    expect(header).toHaveClass('bg-surface-container-highest/50')
  })

  test('has appropriate z-index for layering', () => {
    const { container } = render(<DiffHunkHeader header="@@ -20,4 +20,4 @@" />)
    const header = container.firstChild as HTMLElement
    // z-10 is commonly used for sticky headers
    expect(header).toHaveClass('z-10')
  })

  test('renders different header formats correctly', () => {
    const { rerender } = render(<DiffHunkHeader header="@@ -1,1 +1,1 @@" />)
    expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeInTheDocument()

    rerender(
      <DiffHunkHeader header="@@ -150,25 +150,30 @@ function main() {" />
    )

    expect(
      screen.getByText('@@ -150,25 +150,30 @@ function main() {')
    ).toBeInTheDocument()
  })

  test('uses monospace font for header text', () => {
    const { container } = render(<DiffHunkHeader header="@@ -5,5 +5,5 @@" />)
    const header = container.firstChild as HTMLElement
    expect(header).toHaveClass('font-code')
  })

  test('has proper text styling', () => {
    const { container } = render(<DiffHunkHeader header="@@ -10,3 +10,3 @@" />)
    const header = container.firstChild as HTMLElement
    expect(header).toHaveClass('text-on-surface-variant')
  })

  test('has proper padding and spacing', () => {
    const { container } = render(<DiffHunkHeader header="@@ -1,1 +1,1 @@" />)
    const header = container.firstChild as HTMLElement
    // Should have reasonable padding for visual separation
    const classes = header.className
    expect(classes).toMatch(/p[xy]?-/)
  })
})
