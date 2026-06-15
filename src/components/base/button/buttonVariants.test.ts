import { test, expect } from 'vitest'
import { buttonVariants } from './buttonVariants'

test('defaults to a md pill default variant', () => {
  const cls = buttonVariants()
  expect(cls).toContain('h-[30px]')
  expect(cls).toContain('bg-surface-container-high')
  expect(cls).toContain('focus-visible:ring-1')
})

test('ghost icon sm: square geometry, ghost tokens, rounded-chip', () => {
  const cls = buttonVariants({ variant: 'ghost', size: 'sm', shape: 'icon' })
  expect(cls).toContain('h-[22px]')
  expect(cls).toContain('w-[22px]')
  expect(cls).toContain('bg-transparent')
  expect(cls).toContain('hover:bg-surface-container-high')
  expect(cls).toContain('rounded-chip')
})

test('active state is keyed off aria-pressed AND aria-expanded', () => {
  const cls = buttonVariants({ variant: 'ghost' })
  expect(cls).toContain('aria-pressed:bg-primary/10')
  expect(cls).toContain('aria-expanded:bg-primary/10')
})

test('danger is a self-contained skin (no ghost/default base bleed)', () => {
  const cls = buttonVariants({ variant: 'danger', shape: 'icon' })
  expect(cls).toContain('text-error')
  expect(cls).not.toContain('text-on-surface-muted')
})

test('tailwind-merge keeps custom tokens: font-size AND color survive', () => {
  const cls = buttonVariants({ variant: 'ghost', size: 'sm', shape: 'icon' })
  expect(cls).toContain('text-[13px]') // font-size
  expect(cls).toContain('text-on-surface-muted') // color
})

test('class passthrough merges layout', () => {
  const cls = buttonVariants({ variant: 'ghost', shape: 'icon', class: 'mx-2' })
  expect(cls).toContain('mx-2')
  expect(cls).toContain('text-on-surface-muted')
})
