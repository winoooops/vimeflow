import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { LayoutPicker } from './LayoutPicker'

describe('LayoutPicker', () => {
  test('selecting a quick layout reports it', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <LayoutPicker
        layoutId="single"
        pinnedLayout={null}
        onSelect={onSelect}
        onPin={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: /vertical/i }))
    expect(onSelect).toHaveBeenCalledWith('vsplit')
  })

  test('More layouts pins + selects a non-quick layout', async () => {
    const onSelect = vi.fn()
    const onPin = vi.fn()
    const user = userEvent.setup()
    render(
      <LayoutPicker
        layoutId="single"
        pinnedLayout={null}
        onSelect={onSelect}
        onPin={onPin}
      />
    )
    await user.click(screen.getByRole('button', { name: /more layouts/i }))
    await user.click(screen.getByRole('menuitem', { name: /quad/i }))
    expect(onPin).toHaveBeenCalledWith('quad')
    expect(onSelect).toHaveBeenCalledWith('quad')
  })
})
