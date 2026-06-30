import { type ReactElement } from 'react'
import type { PaneLayoutId } from '../../../sessions/types'
import { type LayoutShape } from '../../layout-registry'
import { LayoutGlyph } from './LayoutGlyph'

export interface LayoutDisplayMenuModel {
  builtInLayouts: readonly LayoutShape[]
  customLayouts: readonly LayoutShape[]
}

export interface LayoutDisplayNativeOverlayAction {
  label: string
  icon: string
  pressed?: boolean
  disabled?: boolean
  onSelect: () => void
}

export const layoutDisplayMenuModel = (
  layouts: readonly LayoutShape[]
): LayoutDisplayMenuModel => ({
  builtInLayouts: layouts.filter(
    (layout) => layout.definition.source === 'builtin'
  ),
  customLayouts: layouts.filter(
    (layout) => layout.definition.source === 'workspace'
  ),
})

const LOCKED_DISPLAY_LAYOUT_IDS = new Set<PaneLayoutId>(['single'])

export const isLockedDisplayLayout = (layoutId: PaneLayoutId): boolean =>
  LOCKED_DISPLAY_LAYOUT_IDS.has(layoutId)

export const normalizeVisibleLayoutIds = (
  visibleLayoutIds: readonly PaneLayoutId[],
  layouts: readonly LayoutShape[]
): readonly PaneLayoutId[] =>
  layouts
    .filter((layout) => layout.definition.source === 'builtin')
    .map((layout) => layout.id)
    .filter(
      (layoutId) =>
        isLockedDisplayLayout(layoutId) || visibleLayoutIds.includes(layoutId)
    )

export const buildNextVisibleLayoutIds = (
  visibleLayoutIds: readonly PaneLayoutId[],
  layoutId: PaneLayoutId,
  checked: boolean,
  layouts: readonly LayoutShape[]
): readonly PaneLayoutId[] => {
  const normalized = normalizeVisibleLayoutIds(visibleLayoutIds, layouts)

  return checked
    ? layouts
        .map((layout) => layout.id)
        .filter(
          (candidate) =>
            candidate === layoutId || normalized.includes(candidate)
        )
    : normalized.filter((candidate) => candidate !== layoutId)
}

export const editCustomLayoutLabel = (layout: LayoutShape): string =>
  `Edit ${layout.name}`

export const duplicateCustomLayoutLabel = (layout: LayoutShape): string =>
  `Duplicate ${layout.name}`

export const deleteCustomLayoutLabel = (layout: LayoutShape): string =>
  `Delete ${layout.name}`

export const customLayoutVisibilityLabel = (
  layout: LayoutShape,
  checked: boolean
): string =>
  checked
    ? `Hide ${layout.name} from switcher`
    : `Show ${layout.name} in switcher`

export const nextHiddenCustomLayoutIds = (
  hiddenCustomLayoutIds: readonly PaneLayoutId[],
  layoutId: PaneLayoutId,
  checked: boolean
): readonly PaneLayoutId[] =>
  checked
    ? [...hiddenCustomLayoutIds, layoutId]
    : hiddenCustomLayoutIds.filter((candidate) => candidate !== layoutId)

interface LayoutGlyphSlotProps {
  layout: LayoutShape
  active?: boolean
}

export const LayoutGlyphSlot = ({
  layout,
  active = false,
}: LayoutGlyphSlotProps): ReactElement => (
  <span
    aria-hidden="true"
    className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${
      active ? 'text-primary' : 'text-on-surface-variant'
    }`}
  >
    <LayoutGlyph layoutId={layout.id} definition={layout.definition} />
  </span>
)
