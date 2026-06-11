import type { ReactElement } from 'react'

export type ViewMode = 'reading' | 'source'

interface ViewModeToggleProps {
  value: ViewMode
  onChange: (next: ViewMode) => void
}

// Mirrors the DockTab `tabButtonClass` look (font-mono, ~10.5px, rounded-md,
// primary-tinted when active) so the Source/Reading toggle reads as the same
// dock-chrome family as the Editor/Diff tabs. Semantic tokens match DockTab
// (same values asserted in DockPanel.test.tsx).
const segmentClass = (active: boolean): string =>
  `flex items-center justify-center font-mono text-[10.5px] h-[26px] rounded-md border px-[11px] transition-colors ${
    active
      ? 'bg-primary/[0.08] border-primary-container/30 text-primary'
      : 'bg-transparent border-transparent text-on-surface-muted hover:text-primary'
  }`

/**
 * Segmented Source ⇄ Reading control for the markdown reading view. Two
 * buttons, `aria-pressed` reflecting the active mode. Composed alongside (not
 * replacing) `<DockSwitcher>` in the `DockTab` children slot, shown only for
 * markdown files on the editor tab.
 */
export const ViewModeToggle = ({
  value,
  onChange,
}: ViewModeToggleProps): ReactElement => (
  <div
    className="flex shrink-0 items-center gap-1"
    role="group"
    aria-label="Markdown view mode"
  >
    <button
      type="button"
      aria-pressed={value === 'reading'}
      onClick={() => onChange('reading')}
      className={segmentClass(value === 'reading')}
    >
      Reading
    </button>
    <button
      type="button"
      aria-pressed={value === 'source'}
      onClick={() => onChange('source')}
      className={segmentClass(value === 'source')}
    >
      Source
    </button>
  </div>
)
