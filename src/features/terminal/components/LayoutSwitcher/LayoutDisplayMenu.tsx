import { useEffect, type ReactElement } from 'react'
import { Menu } from '@/components/Menu'
import type { PaneLayoutId } from '../../../sessions/types'
import {
  BUILTIN_PANE_LAYOUT_REGISTRY,
  type LayoutShape,
} from '../../layout-registry'
import { LayoutGlyph } from './LayoutGlyph'

export interface LayoutDisplayMenuProps {
  activeLayoutId: PaneLayoutId
  visibleLayoutIds: readonly PaneLayoutId[]
  layouts?: readonly LayoutShape[]
  onVisibleLayoutIdsChange: (next: readonly PaneLayoutId[]) => void
  onOpenChange?: (open: boolean) => void
}

const normalizeVisibleLayoutIds = (
  visibleLayoutIds: readonly PaneLayoutId[],
  layouts: readonly LayoutShape[]
): readonly PaneLayoutId[] =>
  layouts
    .map((layout) => layout.id)
    .filter(
      (layoutId) => layoutId === 'single' || visibleLayoutIds.includes(layoutId)
    )

const buildNextVisibleLayoutIds = (
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

export const LayoutDisplayMenu = ({
  activeLayoutId,
  visibleLayoutIds,
  layouts = BUILTIN_PANE_LAYOUT_REGISTRY.layouts,
  onVisibleLayoutIdsChange,
  onOpenChange = undefined,
}: LayoutDisplayMenuProps): ReactElement => {
  useEffect(() => {
    const normalized = normalizeVisibleLayoutIds(visibleLayoutIds, layouts)

    if (
      normalized.length !== visibleLayoutIds.length ||
      normalized.some((layoutId, index) => layoutId !== visibleLayoutIds[index])
    ) {
      onVisibleLayoutIdsChange(normalized)
    }
  }, [layouts, onVisibleLayoutIdsChange, visibleLayoutIds])

  return (
    <Menu
      placement="bottom-end"
      aria-label="Displayed layouts"
      onOpenChange={onOpenChange}
      tooltip="Configure displayed layouts"
      tooltipPlacement="bottom"
      trigger={
        <button
          type="button"
          aria-label="Configure displayed layouts"
          className="inline-flex h-5 w-6 items-center justify-center rounded text-on-surface-muted transition-colors hover:bg-primary/[0.08] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 4.5H6.2M9.8 4.5H13M3 8H9.2M12.2 8H13M3 11.5H4.8M8.2 11.5H13"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
            />
            <circle
              cx="8"
              cy="4.5"
              r="1.6"
              stroke="currentColor"
              strokeWidth="1.25"
            />
            <circle
              cx="10.7"
              cy="8"
              r="1.45"
              stroke="currentColor"
              strokeWidth="1.25"
            />
            <circle
              cx="6.5"
              cy="11.5"
              r="1.55"
              stroke="currentColor"
              strokeWidth="1.25"
            />
          </svg>
        </button>
      }
    >
      <Menu.Section label="Displayed layouts">
        {layouts.map((layout) => {
          const layoutId = layout.id

          const checked =
            layoutId === 'single' || visibleLayoutIds.includes(layoutId)
          const isActive = layoutId === activeLayoutId

          return (
            <Menu.Checkbox
              key={layoutId}
              checked={checked || isActive}
              disabled={layoutId === 'single' || isActive}
              onChange={(next): void =>
                onVisibleLayoutIdsChange(
                  buildNextVisibleLayoutIds(
                    visibleLayoutIds,
                    layoutId,
                    next,
                    layouts
                  )
                )
              }
            >
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-on-surface-variant"
                >
                  <LayoutGlyph
                    layoutId={layoutId}
                    definition={layout.definition}
                  />
                </span>
                <span>{layout.name}</span>
              </span>
            </Menu.Checkbox>
          )
        })}
      </Menu.Section>
    </Menu>
  )
}
