import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Menu } from '@/components/Menu'
import type { PaneLayoutId } from '../../../sessions/types'
import {
  PaneLayoutRegistry,
  createMainBottomRowTemplate,
  type LayoutShape,
} from '../../layout-registry'
import { LayoutDisplayMenu } from './LayoutDisplayMenu'

interface BuiltInLayoutBuilderOptions {
  builtInLayouts: readonly LayoutShape[]
  allLayouts: readonly LayoutShape[]
  activeLayoutId: PaneLayoutId
  visibleLayoutIds: readonly PaneLayoutId[]
}

interface CustomLayoutBuilderOptions {
  customLayouts: readonly LayoutShape[]
  activeLayoutId: PaneLayoutId
  blockedLayoutIds: readonly PaneLayoutId[]
  hiddenCustomLayoutIds: readonly PaneLayoutId[]
}

const builderMocks = vi.hoisted(() => ({
  builtInLayoutMenuItems: vi.fn(),
  customLayoutMenuItems: vi.fn(),
}))

vi.mock('./LayoutDisplayBuiltInLayouts', () => ({
  builtInLayoutMenuItems: builderMocks.builtInLayoutMenuItems,
}))

vi.mock('./LayoutDisplayCustomLayouts', () => ({
  customLayoutMenuItems: builderMocks.customLayoutMenuItems,
}))

describe('LayoutDisplayMenu', () => {
  beforeEach(() => {
    builderMocks.builtInLayoutMenuItems.mockReset()
    builderMocks.customLayoutMenuItems.mockReset()
    builderMocks.builtInLayoutMenuItems.mockReturnValue([
      <Menu.Item key="built-in-placeholder" onSelect={vi.fn()}>
        Built-in builder item
      </Menu.Item>,
    ])

    builderMocks.customLayoutMenuItems.mockReturnValue([
      <Menu.Item key="custom-placeholder" onSelect={vi.fn()}>
        Custom builder item
      </Menu.Item>,
    ])
  })

  test('renders the layout display menu button', () => {
    render(
      <LayoutDisplayMenu
        activeLayoutId="vsplit"
        visibleLayoutIds={['single', 'vsplit']}
        onVisibleLayoutIdsChange={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    ).toBeInTheDocument()
  })

  test('opens the menu shell with items from the built-in and custom builders', async () => {
    const user = userEvent.setup()
    const registry = new PaneLayoutRegistry([createMainBottomRowTemplate()])

    render(
      <LayoutDisplayMenu
        activeLayoutId="custom:template-main-bottom-row"
        visibleLayoutIds={['single', 'vsplit', 'hsplit']}
        blockedLayoutIds={['custom:template-main-bottom-row']}
        hiddenCustomLayoutIds={['custom:template-main-bottom-row']}
        layouts={registry.layouts}
        onVisibleLayoutIdsChange={vi.fn()}
        onHiddenCustomLayoutIdsChange={vi.fn()}
        onPickLayout={vi.fn(() => true)}
        onEditCustomLayout={vi.fn()}
        onDuplicateCustomLayout={vi.fn()}
        onDeleteCustomLayout={vi.fn()}
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    const menu = await screen.findByRole('menu')
    expect(
      within(menu).getByRole('menuitem', { name: 'Built-in builder item' })
    ).toBeInTheDocument()

    expect(
      within(menu).getByRole('menuitem', { name: 'Custom builder item' })
    ).toBeInTheDocument()

    expect(builderMocks.builtInLayoutMenuItems).toHaveBeenCalledOnce()

    const builtInOptions = builderMocks.builtInLayoutMenuItems.mock
      .calls[0][0] as BuiltInLayoutBuilderOptions

    expect(builtInOptions).toMatchObject({
      activeLayoutId: 'custom:template-main-bottom-row',
      visibleLayoutIds: ['single', 'vsplit', 'hsplit'],
    })

    expect(builtInOptions.builtInLayouts.map((layout) => layout.id)).toEqual([
      'single',
      'vsplit',
      'hsplit',
      'threeRight',
      'quad',
      'grid3x2',
    ])

    expect(builtInOptions.allLayouts.map((layout) => layout.id)).toContain(
      'custom:template-main-bottom-row'
    )

    expect(builderMocks.customLayoutMenuItems).toHaveBeenCalledOnce()

    const customOptions = builderMocks.customLayoutMenuItems.mock
      .calls[0][0] as CustomLayoutBuilderOptions

    expect(customOptions).toMatchObject({
      activeLayoutId: 'custom:template-main-bottom-row',
      blockedLayoutIds: ['custom:template-main-bottom-row'],
      hiddenCustomLayoutIds: ['custom:template-main-bottom-row'],
    })

    expect(customOptions.customLayouts.map((layout) => layout.id)).toEqual([
      'custom:template-main-bottom-row',
    ])
  })
})
