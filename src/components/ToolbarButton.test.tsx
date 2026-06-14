import { test, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Menu } from '@/components/Menu'
import { ToolbarButton } from './ToolbarButton'

test('renders icon + visible label + optional trailing caret', () => {
  render(<ToolbarButton icon="tune" label="View" trailingIcon="expand_more" />)
  const btn = screen.getByRole('button', { name: /view/i })
  expect(btn).toHaveTextContent('View')
  // eslint-disable-next-line testing-library/no-node-access -- asserting icon a11y
  const icons = btn.querySelectorAll('.material-symbols-outlined')
  expect(icons).toHaveLength(2)
  icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'))
  expect(btn).toHaveTextContent('tune')
  expect(btn).toHaveTextContent('expand_more')
})

test('label-only: no icon spans rendered', () => {
  render(<ToolbarButton label="View" />)
  const btn = screen.getByRole('button', { name: 'View' })
  // eslint-disable-next-line testing-library/no-node-access -- asserting no decorative icons
  expect(btn.querySelectorAll('.material-symbols-outlined')).toHaveLength(0)
})

test('defaults to the toolbar variant', () => {
  render(<ToolbarButton label="View" />)
  expect(screen.getByRole('button', { name: 'View' }).className).toContain(
    'text-on-surface-variant'
  )
})

test('forwards ref + rest props to the button', () => {
  const ref = createRef<HTMLButtonElement>()
  render(<ToolbarButton ref={ref} label="View" data-testid="vs" />)
  const btn = screen.getByRole('button', { name: 'View' })
  expect(ref.current).toBe(btn)
  expect(btn).toHaveAttribute('data-testid', 'vs')
})

test('serves as a Menu trigger: ref + onClick + aria-expanded drives open tint', async () => {
  const user = userEvent.setup()
  const spy = vi.fn()
  const ref = createRef<HTMLButtonElement>()
  render(
    <Menu
      trigger={
        <ToolbarButton
          ref={ref}
          icon="tune"
          label="View"
          trailingIcon="expand_more"
          onClick={spy}
        />
      }
    >
      <Menu.Item onSelect={vi.fn()}>One</Menu.Item>
    </Menu>
  )
  const btn = screen.getByRole('button', { name: /view/i })
  expect(ref.current).toBe(btn)
  await user.click(btn)
  expect(spy).toHaveBeenCalledTimes(1)
  expect(await screen.findByRole('menu')).toBeInTheDocument()
  expect(btn).toHaveAttribute('aria-expanded', 'true')
})
