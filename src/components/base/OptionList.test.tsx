import { type HTMLProps } from 'react'
import { test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OptionList, type DropdownOption } from './OptionList'

const OPTIONS: readonly DropdownOption<string>[] = [
  { value: 'a', label: 'Apple', description: 'pome' },
  { value: 'b', label: 'Pear' },
]

const passThroughItemProps = (
  props?: HTMLProps<HTMLElement>
): Record<string, unknown> => ({ ...props })

const noopRegister = (): void => undefined

test('renders option labels and optional descriptions', () => {
  render(
    <OptionList
      options={OPTIONS}
      value="a"
      activeIndex={0}
      onSelect={vi.fn()}
      getItemProps={passThroughItemProps}
      registerItem={noopRegister}
    />
  )

  expect(screen.getByText('Apple')).toBeInTheDocument()
  expect(screen.getByText('pome')).toBeInTheDocument()
  expect(screen.getByText('Pear')).toBeInTheDocument()
})

test('renders each option as a menuitem button', () => {
  render(
    <OptionList
      options={OPTIONS}
      value="a"
      activeIndex={0}
      onSelect={vi.fn()}
      getItemProps={passThroughItemProps}
      registerItem={noopRegister}
    />
  )

  const items = screen.getAllByRole('menuitem')
  expect(items).toHaveLength(2)
  items.forEach((item) => expect(item).toHaveAttribute('type', 'button'))
})

test('clicking an option reports its value through onSelect', async () => {
  const onSelect = vi.fn<(value: string) => void>()

  render(
    <OptionList
      options={OPTIONS}
      value="a"
      activeIndex={0}
      onSelect={onSelect}
      getItemProps={passThroughItemProps}
      registerItem={noopRegister}
    />
  )

  await userEvent.click(screen.getByRole('menuitem', { name: /Pear/ }))
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onSelect).toHaveBeenCalledWith('b')
})

test('the selected option carries text-primary; others carry text-on-surface', () => {
  render(
    <OptionList
      options={OPTIONS}
      value="a"
      activeIndex={0}
      onSelect={vi.fn()}
      getItemProps={passThroughItemProps}
      registerItem={noopRegister}
    />
  )

  const selected = screen.getByRole('menuitem', { name: /Apple/ })
  expect(selected.className).toContain('text-primary')

  const unselected = screen.getByRole('menuitem', { name: /Pear/ })
  expect(unselected.className).not.toContain('text-primary')
  expect(unselected.className).toContain('text-on-surface')
})

test('spreads getItemProps and calls registerItem with each row node', () => {
  const getItemProps = vi.fn(() => ({ 'data-from-get-item-props': 'yes' }))
  const registered: (HTMLElement | null)[] = []

  render(
    <OptionList
      options={OPTIONS}
      value="a"
      activeIndex={0}
      onSelect={vi.fn()}
      getItemProps={getItemProps}
      registerItem={(index, node) => {
        registered[index] = node
      }}
    />
  )

  expect(getItemProps).toHaveBeenCalled()
  const apple = screen.getByRole('menuitem', { name: /Apple/ })
  expect(apple).toHaveAttribute('data-from-get-item-props', 'yes')
  expect(registered[0]).toBe(apple)
  expect(registered[1]).toBe(screen.getByRole('menuitem', { name: /Pear/ }))
})

test('accepts numeric option values', async () => {
  const onSelect = vi.fn<(value: number) => void>()

  const numeric: readonly DropdownOption<number>[] = [
    { value: 12, label: '12 px' },
    { value: 14, label: '14 px' },
  ]

  render(
    <OptionList
      options={numeric}
      value={12}
      activeIndex={0}
      onSelect={onSelect}
      getItemProps={passThroughItemProps}
      registerItem={noopRegister}
    />
  )

  await userEvent.click(screen.getByRole('menuitem', { name: /14 px/ }))
  expect(onSelect).toHaveBeenCalledWith(14)
})

test('roving tabIndex: active row has tabindex 0, others have tabindex -1', () => {
  render(
    <OptionList
      options={OPTIONS}
      value="a"
      activeIndex={1}
      onSelect={vi.fn()}
      getItemProps={passThroughItemProps}
      registerItem={noopRegister}
    />
  )

  const apple = screen.getByRole('menuitem', { name: /Apple/ })
  const pear = screen.getByRole('menuitem', { name: /Pear/ })

  expect(apple).toHaveAttribute('tabindex', '-1')
  expect(pear).toHaveAttribute('tabindex', '0')
})
