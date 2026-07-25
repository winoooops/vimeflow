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
  blockedLayoutIds?: readonly PaneLayoutId[]
  visibleLayoutIds: readonly PaneLayoutId[]
  onVisibleLayoutIdsChange: (next: readonly PaneLayoutId[]) => void
  onPickLayout?: (layoutId: PaneLayoutId) => boolean
  onClose?: () => void
  compactSelectionMode?: boolean
}

export const builtInLayoutMenuItems = ({
  builtInLayouts,
  allLayouts,
  activeLayoutId,
  blockedLayoutIds = [],
  visibleLayoutIds,
  onVisibleLayoutIdsChange,
  onPickLayout = undefined,
  onClose = undefined,
  compactSelectionMode = false,
}: BuiltInLayoutMenuItemsOptions): ReactElement[] =>
  builtInLayouts.map((layout) => {
    const layoutId = layout.id

    const checked =
      isLockedDisplayLayout(layoutId) || visibleLayoutIds.includes(layoutId)
    const isActive = layoutId === activeLayoutId

    const blocked = blockedLayoutIds.includes(layoutId)

    const disabled = compactSelectionMode
      ? isActive || blocked
      : isLockedDisplayLayout(layoutId) || isActive

    return (
      <Menu.Checkbox
        key={layoutId}
        aria-label={layout.name}
        checked={checked || isActive}
        disabled={disabled}
        onChange={(next): void => {
          if (compactSelectionMode) {
            if (onPickLayout?.(layoutId) === true) {
              onClose?.()
            }

            return
          }

          onVisibleLayoutIdsChange(
            buildNextVisibleLayoutIds(
              visibleLayoutIds,
              layoutId,
              next,
              allLayouts
            )
          )
        }}
      >
        <BuiltInLayoutCheckboxContent layout={layout} />
      </Menu.Checkbox>
    )
  })
