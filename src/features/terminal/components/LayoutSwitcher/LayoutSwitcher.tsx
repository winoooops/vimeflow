import type { ReactElement, ReactNode } from 'react'
import type { LayoutId } from '../../../sessions/types'
// Source the data constant directly from its module rather than the
// `SplitView` component barrel — otherwise LayoutSwitcher silently
// breaks if `SplitView/index.ts` ever narrows its re-exports. The
// `layouts.ts` module is the canonical home for `LAYOUTS`.
import { LAYOUTS } from '../SplitView/layouts'
import { LayoutGlyph } from './LayoutGlyph'
import { SegmentedControl } from '@/components/SegmentedControl'

export interface LayoutSwitcherProps {
  activeLayoutId: LayoutId
  onPick: (next: LayoutId) => void
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
  onPick,
  trailing = undefined,
}: LayoutSwitcherProps): ReactElement => (
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
      options={Object.values(LAYOUTS).map((layout) => ({
        value: layout.id,
        label: layout.name,
        tooltip: layout.name,
      }))}
      onChange={onPick}
      skipActiveReselect
      renderOption={(layout) => <LayoutGlyph layoutId={layout.value} />}
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
