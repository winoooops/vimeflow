import { describe, test, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import IconRail from './IconRail'

describe('IconRail', () => {
  test('renders brand logo with V character', () => {
    render(<IconRail />)
    const logo = screen.getByRole('img', { name: /vimeflow logo/i })
    expect(logo).toBeInTheDocument()
    expect(logo).toHaveClass(
      'text-[#cba6f7]',
      'font-black',
      'text-xl',
      'font-headline'
    )
    expect(logo).toHaveTextContent('V')
  })

  test('applies correct container styling', () => {
    render(<IconRail />)
    const aside = screen.getByRole('complementary')
    expect(aside).toHaveClass(
      'w-[48px]',
      'h-screen',
      'fixed',
      'left-0',
      'top-0',
      'flex',
      'flex-col',
      'items-center',
      'py-4',
      'z-50',
      'bg-[#1a1a2a]/80',
      'backdrop-blur-xl'
    )
  })

  test('renders active project icon with correct styling', () => {
    render(<IconRail />)
    const terminalButton = screen.getByRole('button', { name: /terminal/i })
    expect(terminalButton).toBeInTheDocument()
    // eslint-disable-next-line testing-library/no-node-access -- verifying icon CSS class
    const icon = terminalButton.querySelector('.material-symbols-outlined')
    expect(icon).toBeInTheDocument()
  })

  test('renders inactive project icons', () => {
    render(<IconRail />)
    expect(screen.getByRole('button', { name: /code/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /dashboard/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /database/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /new project/i })
    ).toBeInTheDocument()
  })

  test('all project icons use Material Symbols', () => {
    render(<IconRail />)

    const nav = screen.getByRole('navigation')

    const buttons = within(nav).getAllByRole('button')

    buttons.forEach((button) => {
      // eslint-disable-next-line testing-library/no-node-access -- verifying icon CSS class
      const iconEl = button.querySelector('.material-symbols-outlined')
      expect(iconEl).toBeInTheDocument()
    })
  })

  test('renders user avatar at bottom', () => {
    render(<IconRail />)
    const avatar = screen.getByAltText('User Profile')
    expect(avatar).toBeInTheDocument()
    expect(avatar).toHaveClass('w-full', 'h-full', 'object-cover')
  })

  test('applies shadow styling to container', () => {
    render(<IconRail />)
    const aside = screen.getByRole('complementary')
    expect(aside).toHaveClass('shadow-[0px_10px_40px_rgba(0,0,0,0.4)]')
  })

  test('uses semantic HTML with aside and nav elements', () => {
    render(<IconRail />)
    const aside = screen.getByRole('complementary')
    expect(aside).toBeInTheDocument()

    const nav = screen.getByRole('navigation')
    expect(nav).toBeInTheDocument()
  })

  test('navigation section has correct flex styling', () => {
    render(<IconRail />)
    const nav = screen.getByRole('navigation')
    expect(nav).toHaveClass(
      'flex',
      'flex-col',
      'gap-4',
      'items-center',
      'flex-1'
    )
  })

  test('renders 5 project icons in navigation', () => {
    render(<IconRail />)

    const nav = screen.getByRole('navigation')
    const buttons = within(nav).getAllByRole('button')
    expect(buttons).toHaveLength(5)
  })
})
