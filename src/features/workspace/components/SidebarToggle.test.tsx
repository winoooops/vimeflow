import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { SidebarToggle, type SidebarToggleProps } from './SidebarToggle'

// `collapsed` is required, and `react/jsx-boolean-value: 'never'` forbids
// literal `collapsed={false}` in JSX — pass props as JS values via a helper.
const renderToggle = (
  props: Partial<SidebarToggleProps> & Pick<SidebarToggleProps, 'collapsed'>
): ReturnType<typeof render> =>
  render(<SidebarToggle onClick={vi.fn()} {...props} />)

describe('SidebarToggle', () => {
  test('renders a button', () => {
    renderToggle({ collapsed: false })

    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  test('uses the project tooltip, not a native title attribute', () => {
    renderToggle({ collapsed: false })

    expect(screen.getByRole('button')).not.toHaveAttribute('title')
  })

  test('collapsed=false: shows the "hide" a11y state', () => {
    renderToggle({ collapsed: false })

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveAttribute('aria-label', 'Hide sidebar')
  })

  test('collapsed=true: shows the "show" a11y state', () => {
    renderToggle({ collapsed: true })

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-label', 'Show sidebar')
  })

  test('hover surfaces the project tooltip with the label + shortcut chip', async () => {
    const user = userEvent.setup()
    renderToggle({ collapsed: true, shortcutHint: 'Ctrl+⇧B' })

    await user.hover(screen.getByRole('button'))

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Show sidebar')
    expect(screen.getByTestId('tooltip-shortcut')).toHaveTextContent('Ctrl+⇧B')
  })

  // Open glyph = outline rect + rail-fill rect (2); collapsed glyph drops the
  // rail fill (1). The divider <path> is always drawn either way. SVG shapes
  // have no accessible role, so container.querySelectorAll is the only option.
  test('collapsed=false: rail fill rect present (2 rects), divider path present', () => {
    const { container } = renderToggle({ collapsed: false })

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG <rect> has no a11y role
    const rects = container.querySelectorAll('rect')
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG <path> has no a11y role
    const paths = container.querySelectorAll('path')
    expect(rects).toHaveLength(2)
    expect(paths).toHaveLength(1)
  })

  test('collapsed=true: rail fill rect absent (1 rect), divider path present', () => {
    const { container } = renderToggle({ collapsed: true })

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG <rect> has no a11y role
    const rects = container.querySelectorAll('rect')
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG <path> has no a11y role
    const paths = container.querySelectorAll('path')
    expect(rects).toHaveLength(1)
    expect(paths).toHaveLength(1)
  })

  test('fireEvent: calls onClick when clicked', () => {
    const onClick = vi.fn()
    renderToggle({ collapsed: false, onClick })

    fireEvent.click(screen.getByRole('button'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test('userEvent: calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    renderToggle({ collapsed: true, onClick })

    await user.click(screen.getByRole('button'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test('variant=inset: className includes the recessed-well background', () => {
    renderToggle({ collapsed: false, variant: 'inset' })

    expect(screen.getByRole('button')).toHaveClass('bg-[rgba(13,13,28,0.45)]')
  })

  test('variant=inset: keeps the button border transparent', () => {
    renderToggle({ collapsed: false, variant: 'inset' })

    const button = screen.getByRole('button')
    expect(button).toHaveClass('border-transparent')
    expect(button).not.toHaveClass('border-[rgba(74,68,79,0.35)]')
  })

  test('default variant (ghost): className omits the inset background', () => {
    renderToggle({ collapsed: false })

    expect(screen.getByRole('button')).not.toHaveClass(
      'bg-[rgba(13,13,28,0.45)]'
    )
  })

  test('size: sets the button width/height inline style', () => {
    renderToggle({ collapsed: false, size: 34 })

    expect(screen.getByRole('button')).toHaveStyle({
      width: '34px',
      height: '34px',
    })
  })
})
