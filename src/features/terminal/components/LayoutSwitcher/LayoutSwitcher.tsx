import type { ReactElement } from 'react'
import type { LayoutId } from '../../../sessions/types'
// Source the data constant directly from its module rather than the
// `SplitView` component barrel — otherwise LayoutSwitcher silently
// breaks if `SplitView/index.ts` ever narrows its re-exports. The
// `layouts.ts` module is the canonical home for `LAYOUTS`.
import { LAYOUTS } from '../SplitView/layouts'
import { LayoutGlyph } from './LayoutGlyph'

export interface LayoutSwitcherProps {
  activeLayoutId: LayoutId
  onPick: (next: LayoutId) => void
}

const BASE_BUTTON =
  'inline-flex h-5 w-6 items-center justify-center rounded text-[0px] transition-colors'
const ACTIVE_BUTTON = 'bg-primary/15 text-primary ring-1 ring-primary/45'
const INACTIVE_BUTTON = 'text-on-surface-muted hover:text-on-surface'

export const LayoutSwitcher = ({
  activeLayoutId,
  onPick,
}: LayoutSwitcherProps): ReactElement => (
  <div
    data-testid="layout-switcher"
    role="toolbar"
    aria-label="Pane layout"
    className="inline-flex items-center gap-0.5 rounded-md bg-surface-container/60 p-0.5"
  >
    {Object.values(LAYOUTS).map((layout) => {
      const isActive = activeLayoutId === layout.id

      return (
        <button
          key={layout.id}
          type="button"
          title={layout.name}
          aria-label={layout.name}
          aria-pressed={isActive}
          // `aria-disabled` pairs with `aria-pressed` so screen readers
          // can distinguish a clickable toggle from one that's already
          // in its terminal state. Without it, Space/Enter on the
          // active button is silently a no-op — the AT user gets no
          // signal that the layout is "the currently selected one"
          // and not "broken". The underlying onClick is also gated to
          // undefined, so keyboard activation is consistent with the
          // ARIA-advertised state.
          aria-disabled={isActive}
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
      )
    })}
  </div>
)
