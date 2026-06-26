import { test, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, type ButtonVariantProps } from './Button'

// Type-only re-export must compile from the public surface.
const _variantProbe: ButtonVariantProps = { variant: 'primary' }
void _variantProbe

test('renders children as the label', () => {
  render(<Button>Save</Button>)
  expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
})

test('leadingIcon renders an aria-hidden material symbol', () => {
  render(<Button leadingIcon="add">New</Button>)
  const btn = screen.getByRole('button', { name: 'New' })
  // eslint-disable-next-line testing-library/no-node-access -- asserting icon a11y
  const icon = btn.querySelector('.material-symbols-outlined')
  expect(icon).toHaveAttribute('aria-hidden', 'true')
  expect(icon).toHaveTextContent('add')
})

test('keyboard Enter fires onClick', async () => {
  const user = userEvent.setup()
  const spy = vi.fn()
  render(<Button onClick={spy}>Go</Button>)
  await user.tab()
  await user.keyboard('{Enter}')
  expect(spy).toHaveBeenCalledTimes(1)
})

test('forwards ref to the button', () => {
  const ref = createRef<HTMLButtonElement>()
  render(<Button ref={ref}>Ok</Button>)
  expect(ref.current).toBe(screen.getByRole('button', { name: 'Ok' }))
})
