/* eslint-disable react/require-default-props -- forwardRef components: ESLint cannot see through forwardRef to find destructuring defaults */
import { forwardRef, type ReactElement } from 'react'

export type SidebarToggleVariant = 'ghost' | 'inset'

export interface SidebarToggleProps {
  /** When true, the sidebar is hidden (glyph shows the hollow "open me" state). Default false. */
  collapsed?: boolean
  onClick: () => void
  /** Square hit-target size in px. Rail wants 34 to match other rail buttons; in-card wants 28. */
  size?: number
  /**
   * `ghost` (default): transparent with a hover tint — for the icon rail.
   * `inset`: a recessed well (fill + border, lavender hover border) so the
   * control reads as belonging to the card it is docked inside.
   */
  variant?: SidebarToggleVariant
  'data-testid'?: string
  /** Platform-appropriate shortcut hint for the tooltip (e.g. '⌘B' or 'Ctrl+⇧B'). Default '⌘B'. */
  shortcutHint?: string
}

const VARIANT_CLASS: Record<SidebarToggleVariant, string> = {
  ghost:
    'border border-transparent text-on-surface-muted hover:bg-primary/[0.08] hover:text-primary',
  inset:
    'border border-[rgba(74,68,79,0.35)] bg-[rgba(13,13,28,0.45)] text-on-surface-muted hover:border-[rgba(203,166,247,0.4)] hover:text-primary',
}

// Codex / VS-Code-style "panel-left" glyph. Outline + left-rail divider are
// ALWAYS drawn so the control reads as a side-panel toggle (never a bare
// square); the rail FILL is the on/off signal — present only when the sidebar
// is showing. Geometry is fixed at viewBox 16 and scaled via the button box.
export const SidebarToggle = forwardRef<HTMLButtonElement, SidebarToggleProps>(
  (
    {
      collapsed = false,
      onClick,
      size = 28,
      variant = 'ghost',
      'data-testid': testId = 'sidebar-toggle',
      shortcutHint = '⌘B',
    },
    ref
  ): ReactElement => (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      onClick={onClick}
      title={`${collapsed ? 'Show sidebar' : 'Hide sidebar'}  ${shortcutHint}`}
      aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
      aria-expanded={!collapsed}
      style={{ width: size, height: size }}
      className={`grid shrink-0 cursor-pointer place-items-center rounded-[7px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container ${VARIANT_CLASS[variant]}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <rect
          x="1.6"
          y="2.6"
          width="12.8"
          height="10.8"
          rx="2.4"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path d="M5.9 2.9V13.1" stroke="currentColor" strokeWidth="1.3" />
        {!collapsed && (
          <rect
            x="2.2"
            y="3.2"
            width="3.1"
            height="9.6"
            rx="1.4"
            fill="currentColor"
            fillOpacity="0.28"
          />
        )}
      </svg>
    </button>
  )
)
SidebarToggle.displayName = 'SidebarToggle'
