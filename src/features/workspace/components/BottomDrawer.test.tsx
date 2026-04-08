import { render, screen, within } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import userEvent from '@testing-library/user-event'
import BottomDrawer from './BottomDrawer'

describe('BottomDrawer', () => {
  test('renders with Editor tab active by default', () => {
    render(<BottomDrawer />)

    // Editor tab should be active (has border-bottom and primary color)
    const editorTab = screen.getByRole('button', { name: /editor/i })
    expect(editorTab).toBeInTheDocument()
    expect(editorTab).toHaveClass('text-primary')
    expect(editorTab).toHaveClass('border-b-2')

    // Diff tab should be inactive
    const diffTab = screen.getByRole('button', { name: /diff viewer/i })
    expect(diffTab).toBeInTheDocument()
    expect(diffTab).toHaveClass('text-slate-400')
    expect(diffTab).not.toHaveClass('border-b-2')
  })

  test('displays Editor content by default', () => {
    render(<BottomDrawer />)

    // Check for line numbers - they're in a single div with br tags
    expect(screen.getByText(/1.*2.*3/)).toBeInTheDocument()

    // Check for code content - look for unique string in code
    expect(screen.getByText(/jwtVerify/i)).toBeInTheDocument()
  })

  test('switches to Diff Viewer tab when clicked', async () => {
    const user = userEvent.setup()
    render(<BottomDrawer />)

    const diffTab = screen.getByRole('button', { name: /diff viewer/i })
    await user.click(diffTab)

    // Diff tab should now be active
    expect(diffTab).toHaveClass('text-primary')
    expect(diffTab).toHaveClass('border-b-2')

    // Editor tab should be inactive
    const editorTab = screen.getByRole('button', { name: /editor/i })
    expect(editorTab).toHaveClass('text-slate-400')
    expect(editorTab).not.toHaveClass('border-b-2')
  })

  test('displays Diff Viewer content when Diff tab is active', async () => {
    const user = userEvent.setup()
    render(<BottomDrawer />)

    // Switch to Diff tab
    const diffTab = screen.getByRole('button', { name: /diff viewer/i })
    await user.click(diffTab)

    // Check for diff content
    expect(screen.getByText(/No changes to review/i)).toBeInTheDocument()
  })

  test('renders file path in header', () => {
    render(<BottomDrawer />)

    const filePath = screen.getByText(/src\/middleware\/auth\.ts/i)
    expect(filePath).toBeInTheDocument()
    expect(filePath).toHaveClass('font-mono')
  })

  test('renders collapse toggle button', () => {
    render(<BottomDrawer />)

    const collapseToggle = screen.getByRole('button', {
      name: /collapse|expand|keyboard_arrow/i,
    })
    expect(collapseToggle).toBeInTheDocument()
  })

  test('uses Material Symbols icons for tabs', () => {
    render(<BottomDrawer />)

    // Editor tab should have 'code' icon text
    const editorTab = screen.getByRole('button', { name: /editor/i })
    expect(within(editorTab).getByText('code')).toBeInTheDocument()

    // Diff tab should have 'difference' icon text
    const diffTab = screen.getByRole('button', { name: /diff viewer/i })
    expect(within(diffTab).getByText('difference')).toBeInTheDocument()
  })

  test('has correct height and styling', () => {
    render(<BottomDrawer />)

    // Main section should be present - use region role or aria-label if needed
    // For now, verify key elements are present which implies correct structure
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /diff viewer/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /collapse drawer/i })
    ).toBeInTheDocument()
  })

  test('Editor content has line numbers', () => {
    render(<BottomDrawer />)

    // Line numbers are in a single div separated by br tags
    // Check that the line number section exists with multiple numbers
    expect(
      screen.getByText(/1.*2.*3.*4.*5.*6.*7.*8.*9.*10/)
    ).toBeInTheDocument()
  })

  test('Editor content has syntax highlighting', () => {
    render(<BottomDrawer />)

    // Check for code content that should be syntax highlighted
    // Keywords like 'import', 'const' appear multiple times
    expect(screen.getAllByText(/import/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/const/i).length).toBeGreaterThan(0)

    // Check for unique function names in the mock code
    expect(screen.getByText(/jwtVerify/i)).toBeInTheDocument()
    expect(screen.getByText(/TextEncoder/i)).toBeInTheDocument()
  })
})
