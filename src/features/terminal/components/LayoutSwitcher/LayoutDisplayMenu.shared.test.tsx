import { describe, expect, test } from 'vitest'
import type { PaneLayoutId } from '../../../sessions/types'
import {
  PaneLayoutRegistry,
  createMainBottomRowTemplate,
  type LayoutShape,
} from '../../layout-registry'
import {
  buildNextVisibleLayoutIds,
  customLayoutVisibilityLabel,
  deleteCustomLayoutLabel,
  duplicateCustomLayoutLabel,
  editCustomLayoutLabel,
  isLockedDisplayLayout,
  layoutDisplayMenuModel,
  nextHiddenCustomLayoutIds,
  normalizeVisibleLayoutIds,
} from './LayoutDisplayMenu.shared'

const registryWithCustomLayout = (): PaneLayoutRegistry =>
  new PaneLayoutRegistry([createMainBottomRowTemplate()])

const customLayout = (): LayoutShape => {
  const layout = registryWithCustomLayout().layouts.find(
    (candidate) => candidate.definition.source === 'workspace'
  )

  if (layout === undefined) {
    throw new Error('expected custom layout fixture')
  }

  return layout
}

const layoutIds = (layouts: readonly LayoutShape[]): readonly PaneLayoutId[] =>
  layouts.map((layout) => layout.id)

describe('LayoutDisplayMenu shared helpers', () => {
  test('splits the display menu model into built-in and custom layouts', () => {
    const model = layoutDisplayMenuModel(registryWithCustomLayout().layouts)

    expect(layoutIds(model.builtInLayouts)).toEqual([
      'single',
      'vsplit',
      'hsplit',
      'threeRight',
      'quad',
      'grid3x2',
    ])

    expect(layoutIds(model.customLayouts)).toEqual([
      'custom:template-main-bottom-row',
    ])
  })

  test('normalizes visible ids to required built-ins in registry order', () => {
    expect(
      normalizeVisibleLayoutIds(
        ['custom:template-main-bottom-row', 'quad', 'vsplit'],
        registryWithCustomLayout().layouts
      )
    ).toEqual(['single', 'vsplit', 'quad'])
  })

  test('builds the next visible id list for checked and unchecked built-ins', () => {
    const layouts = registryWithCustomLayout().layouts

    expect(
      buildNextVisibleLayoutIds(['single', 'vsplit'], 'quad', true, layouts)
    ).toEqual(['single', 'vsplit', 'quad'])

    expect(
      buildNextVisibleLayoutIds(
        ['single', 'vsplit', 'quad'],
        'quad',
        false,
        layouts
      )
    ).toEqual(['single', 'vsplit'])
  })

  test('detects locked display layouts', () => {
    expect(isLockedDisplayLayout('single')).toBe(true)
    expect(isLockedDisplayLayout('quad')).toBe(false)
  })

  test('builds custom layout labels', () => {
    const layout = customLayout()

    expect(editCustomLayoutLabel(layout)).toBe('Edit Main + bottom row')
    expect(duplicateCustomLayoutLabel(layout)).toBe(
      'Duplicate Main + bottom row'
    )
    expect(deleteCustomLayoutLabel(layout)).toBe('Delete Main + bottom row')
    expect(customLayoutVisibilityLabel(layout, true)).toBe(
      'Hide Main + bottom row from switcher'
    )

    expect(customLayoutVisibilityLabel(layout, false)).toBe(
      'Show Main + bottom row in switcher'
    )
  })

  test('builds the next hidden custom layout id list', () => {
    expect(
      nextHiddenCustomLayoutIds([], 'custom:template-main-bottom-row', true)
    ).toEqual(['custom:template-main-bottom-row'])

    expect(
      nextHiddenCustomLayoutIds(
        ['custom:template-main-bottom-row'],
        'custom:template-main-bottom-row',
        false
      )
    ).toEqual([])
  })
})
