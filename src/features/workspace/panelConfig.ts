/**
 * Elastic config for the vertical dock axis (top/bottom positions).
 * 5% of an 800 px canvas = 40 px, which fits the DockTab header comfortably.
 */
export const DOCK_VERTICAL_ELASTIC_CONFIG = {
  minPercent: 0.05,
  maxPercent: 0.8,
  initialPercent: 0.3,
} as const

/** Vertical-axis elastic config for the dock panel (top/bottom positions). */
export const DOCK_VERTICAL_ELASTIC_CONFIG = DOCK_ELASTIC_CONFIG

/** Horizontal-axis elastic config for the dock panel (left/right positions). */
export const DOCK_HORIZONTAL_ELASTIC_CONFIG = DOCK_ELASTIC_CONFIG

/**
 * Elastic config for the horizontal dock axis (left/right positions).
 * 15% of a 1200 px canvas = 180 px, wide enough to render the compact
 * DockTab header (two 30 px icon buttons + overflow) without overflow.
 */
export const DOCK_HORIZONTAL_ELASTIC_CONFIG = {
  minPercent: 0.15,
  maxPercent: 0.8,
  initialPercent: 0.3,
} as const

/**
 * @deprecated Use DOCK_VERTICAL_ELASTIC_CONFIG or DOCK_HORIZONTAL_ELASTIC_CONFIG
 */
export const DOCK_ELASTIC_CONFIG = DOCK_VERTICAL_ELASTIC_CONFIG

/**
 * Terminal zone outer elastic config, reserved for future useElasticContainer
 * wiring of the whole terminal zone.
 */
export const TERMINAL_ZONE_ELASTIC_CONFIG = {
  minPercent: 0.1,
  maxPercent: 0.9,
  initialPercent: 0.5,
} as const

/**
 * Per-pane elastic config descriptor for TerminalZone's 1-4 pane splits.
 * Intentionally omits `containerRef` and `axis`; those are call-site concerns.
 * Out of scope for this PR, but defined here to avoid a future breaking change.
 */
export interface PaneElasticConfig {
  minPercent: number
  maxPercent: number
  /** undefined = compute as 1/paneCount at runtime. */
  initialPercent: number | undefined
}

export const TERMINAL_PANE_ELASTIC_CONFIGS: PaneElasticConfig[] = [
  { minPercent: 0.1, maxPercent: 0.9, initialPercent: undefined },
  { minPercent: 0.1, maxPercent: 0.9, initialPercent: undefined },
  { minPercent: 0.1, maxPercent: 0.9, initialPercent: undefined },
  { minPercent: 0.1, maxPercent: 0.9, initialPercent: undefined },
]

/** Keyboard resize step sizes (pixels), shared by all panels. */
export const KEYBOARD_STEP_PX = 20

export const KEYBOARD_STEP_SHIFT_PX = 100

/**
 * Minimum side-dock width required to keep DockTab actions inline. Below this,
 * the dock switcher/file/collapse controls move into the overflow menu.
 */
export const DOCK_INLINE_ACTIONS_MIN_WIDTH_PX = 420
