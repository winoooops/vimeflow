import type { ReactElement } from 'react'
import type { LayoutId } from '../../../sessions/types'
import { LAYOUTS } from '../SplitView'
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
          data-active={isActive ? 'true' : undefined}
          onClick={() => onPick(layout.id)}
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
