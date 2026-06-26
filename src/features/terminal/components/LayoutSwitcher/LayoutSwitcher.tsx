import { useMemo, type ReactElement, type ReactNode } from 'react'
import type { PaneLayoutId } from '../../../sessions/types'
import {
  BUILTIN_PANE_LAYOUT_REGISTRY,
  type LayoutShape,
} from '../../layout-registry'
import { LayoutGlyph } from './LayoutGlyph'
import { SegmentedControl } from '@/components/SegmentedControl'

export interface LayoutSwitcherProps {
  activeLayoutId: PaneLayoutId
  visibleLayoutIds?: readonly PaneLayoutId[]
  layouts?: readonly LayoutShape[]
  /**
   * Layouts the active session cannot switch to right now because it has more
   * panes than the layout's capacity. They still render as pills (visibility
   * is decoupled from capacity) but appear dimmed and non-clickable with a
   * tooltip explaining why. The active layout is never treated as blocked.
   */
  blockedLayoutIds?: readonly PaneLayoutId[]
  onPick: (next: PaneLayoutId) => void
  /**
   * Optional control docked INSIDE the pill container, after a hairline
   * divider. The workspace top chrome uses it to seat the layout-display
   * configuration button alongside the pills as one pillar, leaving the
   * separate pin toggle to stand alone. Omit it and no divider renders.
   */
  trailing?: ReactNode
}

export const LayoutSwitcher = ({
  activeLayoutId,
  visibleLayoutIds = BUILTIN_PANE_LAYOUT_REGISTRY.layouts.map(
    (layout) => layout.id
  ),
  layouts = BUILTIN_PANE_LAYOUT_REGISTRY.layouts,
  blockedLayoutIds = [],
  onPick,
  trailing = undefined,
}: LayoutSwitcherProps): ReactElement => {
  const layoutIds = useMemo(() => layouts.map((layout) => layout.id), [layouts])

  const layoutById = useMemo(
    () => new Map(layouts.map((layout) => [layout.id, layout])),
    [layouts]
  )

  const normalizedVisibleLayoutIds = layoutIds.filter(
    (layoutId) => layoutId === 'single' || visibleLayoutIds.includes(layoutId)
  )

  const renderedLayoutIds = layoutIds.filter(
    (layoutId) =>
      layoutId === activeLayoutId ||
      normalizedVisibleLayoutIds.includes(layoutId)
  )

  return (
    <div
      data-testid="layout-switcher"
      // `role="group"` (not "toolbar") because we don't implement the
      // roving-tabindex / arrow-key navigation pattern the ARIA toolbar
      // role implies. `role="group"` + `aria-label` correctly names the
      // region for screen readers without advertising an unimplemented
      // keyboard contract. The layout buttons remain in the natural tab
      // sequence — adequate for this small picker.
      role="group"
      aria-label="Pane layout"
      className="vf-app-no-drag inline-flex items-center gap-0.5 rounded-md bg-surface-container/60 p-0.5"
    >
      <SegmentedControl
        aria-label="Pane layout"
        role="presentation"
        variant="toolbarInline"
        value={activeLayoutId}
        options={renderedLayoutIds.map((layoutId) => {
          const name = layoutById.get(layoutId)?.name ?? layoutId

          const disabled =
            blockedLayoutIds.includes(layoutId) && layoutId !== activeLayoutId
          const label = disabled ? `Reduce panes to switch to ${name}` : name

          return {
            value: layoutId,
            label: name,
            // Drive both the accessible name and the tooltip from the same
            // string so the reduce-panes explanation is reachable by screen
            // readers and on hover when the layout is blocked.
            ariaLabel: label,
            tooltip: label,
            disabled,
          }
        })}
        onChange={onPick}
        skipActiveReselect
        renderOption={(layout) => (
          <LayoutGlyph
            layoutId={layout.value}
            definition={layoutById.get(layout.value)?.definition}
          />
        )}
      />
      {trailing !== undefined && (
        <>
          {/* Hairline divider seats the docked control as part of the same
              pillar without merging it into the pill toggle group visually. */}
          <span
            aria-hidden="true"
            data-testid="layout-switcher-divider"
            className="mx-0.5 h-[14px] w-px shrink-0 bg-outline-variant/50"
          />
          {trailing}
        </>
      )}
    </div>
  )
}
