export { PriorityPlus } from './PriorityPlus'

export { Dropdown, type DropdownOption } from './Dropdown'

export { Segmented } from './Segmented'

export { Toggle } from './Toggle'
// DiffChipToolbar arrives in Task 1.8 — re-export it from this index then.

// Below this many CSS pixels of diff pane width, split's two columns get
// too cramped to read, so the renderer silently coerces to unified mode
// regardless of the saved preference. Tune freely; no behavioral risk to
// changing it.
export const SPLIT_MIN_WIDTH_PX = 720

// Below this width, even unified mode is too narrow to be useful — wrap-
// or-truncate everywhere, gutters dominate the row. Skip rendering Pierre
// entirely and show <DiffNarrowPlaceholder>. The toolbar stays mounted so
// the user can still adjust controls while the pane is too small.
export const DIFF_MIN_WIDTH_PX = 360

// Rendered overflow chip width (`w-8 h-8` = 32 px) — kept here so the
// PriorityPlus measurement step and the toolbar share a single source.
export const OVERFLOW_CHIP_WIDTH_PX = 32

// Toolbar `gap-x-3` = 12 px. Reserved alongside the chip width when
// measuring whether the chip will fit on the last visible row.
export const OVERFLOW_GAP_PX = 12
