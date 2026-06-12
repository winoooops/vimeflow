import type { ReactElement, ReactNode } from 'react'
import type { LayoutId } from '../../../sessions/types'
// Source the data constant directly from its module rather than the
// `SplitView` component barrel — otherwise LayoutSwitcher silently
// breaks if `SplitView/index.ts` ever narrows its re-exports. The
// `layouts.ts` module is the canonical home for `LAYOUTS`.
import { LAYOUTS } from '../SplitView/layouts'
import { LayoutGlyph } from './LayoutGlyph'
import { Tooltip } from '../../../../components/Tooltip'

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

const BASE_BUTTON =
  'inline-flex h-5 w-6 items-center justify-center rounded text-[0px] transition-colors'
const ACTIVE_BUTTON = 'bg-primary/15 text-primary ring-1 ring-primary/45'
const INACTIVE_BUTTON = 'text-on-surface-muted hover:text-on-surface'

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
    // keyboard contract. The 5 buttons each remain in the natural tab
    // sequence — adequate for a 5-item picker.
    role="group"
    aria-label="Pane layout"
    className="inline-flex items-center gap-0.5 rounded-md bg-surface-container/60 p-0.5"
  >
    {Object.values(LAYOUTS).map((layout) => {
      const isActive = activeLayoutId === layout.id

      return (
        // Tooltip carries only the layout name — no shortcut chip.
        // The `Mod+\` shortcut cycles to the NEXT layout, not to the
        // specific one a user is hovering. Showing the chip per
        // button would advertise "press Mod+\ to switch to THIS
        // layout" which is misleading — the actual landing layout
        // depends on which layout is currently active (Claude review
        // on PR #224 cycle 3, MEDIUM finding, 83% confidence).
        <Tooltip key={layout.id} content={layout.name} placement="bottom">
          <button
            type="button"
            aria-label={layout.name}
            // `aria-pressed="true"` on the active button is the
            // canonical toggle-button signal — AT (VoiceOver, NVDA)
            // announce it as "pressed", which is the correct state for
            // a layout that's already selected. Adding `aria-disabled`
            // alongside (cycle 10 tried this) creates a contradiction:
            // ATs read "pressed AND dimmed" which implies the control
            // is broken, not "the selected layout". The onClick gate
            // below already disables Space/Enter on the active button,
            // so the ARIA state is faithful and complete.
            aria-pressed={isActive}
            data-active={isActive ? 'true' : undefined}
            // Skip the callback when the button represents the already-
            // active layout. setSessionLayout has its own same-layout
            // no-op guard, but expressing that here keeps the contract
            // honest: onPick is called only when the active layout
            // actually changes. Callers wiring different mutations
            // downstream (e.g. analytics events) won't see spurious
            // ticks for re-clicks of the active button.
            onClick={isActive ? undefined : (): void => onPick(layout.id)}
            className={`${BASE_BUTTON} ${
              isActive ? ACTIVE_BUTTON : INACTIVE_BUTTON
            }`}
          >
            <LayoutGlyph layoutId={layout.id} />
          </button>
        </Tooltip>
      )
    })}
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
