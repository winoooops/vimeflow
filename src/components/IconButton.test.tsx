import { test, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Menu } from '@/components/Menu'
import { IconButton } from './IconButton'

test('icon-only: aria-label from label, aria-hidden icon', () => {
  render(<IconButton icon="close" label="Close pane" />)
  const btn = screen.getByRole('button', { name: 'Close pane' })
  // eslint-disable-next-line testing-library/no-node-access -- asserting icon a11y
  expect(btn.querySelector('.material-symbols-outlined')).toHaveAttribute(
    'aria-hidden',
    'true'
  )
})

test('serves as a Menu trigger: ref + onClick + aria-expanded', async () => {
  const user = userEvent.setup()
  const spy = vi.fn()
  const ref = createRef<HTMLButtonElement>()
  render(
    <Menu
      trigger={
        <IconButton ref={ref} icon="more_vert" label="Actions" onClick={spy} />
      }
    >
      <Menu.Item onSelect={vi.fn()}>One</Menu.Item>
    </Menu>
  )
  const btn = screen.getByRole('button', { name: 'Actions' })
  expect(ref.current).toBe(btn)
  await user.click(btn)
  expect(spy).toHaveBeenCalledTimes(1)
  expect(await screen.findByRole('menu')).toBeInTheDocument()
  expect(btn).toHaveAttribute('aria-expanded', 'true')
})
