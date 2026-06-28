import { useMemo, type ReactElement, type ReactNode } from 'react'
import type { PaneLayoutId } from '../../../sessions/types'
import {
  BUILTIN_PANE_LAYOUT_REGISTRY,
  SINGLE_PANE_FOCUS_LABEL,
  SINGLE_PANE_FOCUS_LAYOUT_ID,
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
  /**
   * Stack the pills in a column instead of a row. The toolbar leaves this
   * false (horizontal); the new-session dialog sets it so the picker fits the
   * narrow Layout column. Arrow Up/Down already drive selection either way.
   */
  vertical?: boolean
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
  vertical = false,
}: LayoutSwitcherProps): ReactElement => {
  const layoutIds = useMemo(() => layouts.map((layout) => layout.id), [layouts])

  const layoutById = useMemo(
    () => new Map(layouts.map((layout) => [layout.id, layout])),
    [layouts]
  )

  const normalizedVisibleLayoutIds = layoutIds.filter(
    (layoutId) =>
      layoutId === SINGLE_PANE_FOCUS_LAYOUT_ID ||
      visibleLayoutIds.includes(layoutId)
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
      className={`vf-app-no-drag gap-0.5 rounded-md bg-surface-container/60 p-0.5 ${
        vertical
          ? 'flex w-full flex-col items-stretch'
          : 'inline-flex items-center'
      }`}
    >
      <SegmentedControl
        aria-label="Pane layout"
        role="presentation"
        variant="toolbarInline"
        value={activeLayoutId}
        options={renderedLayoutIds.map((layoutId) => {
          const name = layoutById.get(layoutId)?.name ?? layoutId
          const isSingleFocus = layoutId === SINGLE_PANE_FOCUS_LAYOUT_ID

          const disabled =
            blockedLayoutIds.includes(layoutId) && layoutId !== activeLayoutId

          const label = disabled
            ? `Reduce panes to switch to ${name}`
            : isSingleFocus
              ? SINGLE_PANE_FOCUS_LABEL
              : name

          return {
            value: layoutId,
            label: name,
            // Drive both the accessible name and the tooltip from the same
            // string so the reduce-panes explanation is reachable by screen
            // readers and on hover when the layout is blocked.
            ariaLabel: label,
            tooltip: label,
            shortcut: isSingleFocus ? ['Mod', 'Z'] : undefined,
            disabled,
          }
        })}
        onChange={onPick}
        skipActiveReselect
        // Vertical mode fills the column as a grouped list: each row is a
        // full-width glyph + name. Horizontal mode keeps the compact icon pill.
        buttonClassName={
          vertical
            ? 'w-full h-8 justify-start gap-2 px-2 text-[12px] rounded-[7px]'
            : undefined
        }
        renderOption={(layout) => (
          <>
            <LayoutGlyph
              layoutId={layout.value}
              definition={layoutById.get(layout.value)?.definition}
            />
            {vertical && (
              <span className="truncate font-medium">{layout.label}</span>
            )}
          </>
        )}
      />
      {trailing !== undefined && (
        <>
          {/* Hairline divider seats the docked control as part of the same
              pillar without merging it into the pill toggle group visually. */}
          <span
            aria-hidden="true"
            data-testid="layout-switcher-divider"
            className={`shrink-0 bg-outline-variant/50 ${
              vertical ? 'my-0.5 h-px w-[14px]' : 'mx-0.5 h-[14px] w-px'
            }`}
          />
          {trailing}
        </>
      )}
    </div>
  )
}
