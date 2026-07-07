import { type ReactElement } from 'react'
import { Menu } from '@/components/Menu'
import type { PaneLayoutId } from '../../../sessions/types'
import { type LayoutShape } from '../../layout-registry'
import {
  buildNextVisibleLayoutIds,
  isLockedDisplayLayout,
  LayoutGlyphSlot,
} from './LayoutDisplayMenu.shared'

interface BuiltInLayoutCheckboxContentProps {
  layout: LayoutShape
}

const BuiltInLayoutCheckboxContent = ({
  layout,
}: BuiltInLayoutCheckboxContentProps): ReactElement => (
  <span className="flex items-center gap-2.5">
    <LayoutGlyphSlot layout={layout} />
    <span>{layout.name}</span>
  </span>
)

interface BuiltInLayoutMenuItemsOptions {
  builtInLayouts: readonly LayoutShape[]
  allLayouts: readonly LayoutShape[]
  activeLayoutId: PaneLayoutId
  visibleLayoutIds: readonly PaneLayoutId[]
  onVisibleLayoutIdsChange: (next: readonly PaneLayoutId[]) => void
}

export const builtInLayoutMenuItems = ({
  builtInLayouts,
  allLayouts,
  activeLayoutId,
  visibleLayoutIds,
  onVisibleLayoutIdsChange,
}: BuiltInLayoutMenuItemsOptions): ReactElement[] =>
  builtInLayouts.map((layout) => {
    const layoutId = layout.id

    const checked =
      isLockedDisplayLayout(layoutId) || visibleLayoutIds.includes(layoutId)
    const isActive = layoutId === activeLayoutId

    const disabled = isLockedDisplayLayout(layoutId) || isActive

    return (
      <Menu.Checkbox
        key={layoutId}
        aria-label={layout.name}
        checked={checked || isActive}
        disabled={disabled}
        onChange={(next): void =>
          onVisibleLayoutIdsChange(
            buildNextVisibleLayoutIds(
              visibleLayoutIds,
              layoutId,
              next,
              allLayouts
            )
          )
        }
      >
        <BuiltInLayoutCheckboxContent layout={layout} />
      </Menu.Checkbox>
    )
  })
