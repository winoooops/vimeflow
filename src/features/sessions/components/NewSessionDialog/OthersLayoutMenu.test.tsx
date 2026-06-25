import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { OthersLayoutMenu } from './OthersLayoutMenu'
import type { LayoutShape } from '../../../terminal/layout-registry'

// LayoutGlyph needs a full PaneLayoutDefinition to draw; stub it — this test
// covers the overflow menu's trigger/items/pick wiring, not glyph rendering.
vi.mock('../../../terminal/components/LayoutSwitcher/LayoutGlyph', () => ({
  LayoutGlyph: (): null => null,
}))

const layout = (id: string, name: string): LayoutShape =>
  ({ id, name }) as unknown as LayoutShape

describe('OthersLayoutMenu', () => {
  test('lists the overflow layouts and picks one', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(
      <OthersLayoutMenu
        layouts={[
          layout('custom:a', 'Preset A'),
          layout('custom:b', 'Preset B'),
        ]}
        onPick={onPick}
      />
    )

    await user.click(screen.getByRole('button', { name: /more layouts/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Preset B' }))

    expect(onPick).toHaveBeenCalledWith('custom:b')
  })
})
