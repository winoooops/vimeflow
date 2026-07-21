export {
  OVERFLOW_CHIP_WIDTH_PX,
  OVERFLOW_GAP_PX,
  PriorityPlus,
} from './PriorityPlus'

export { FilePill, type FilePillProps } from './FilePill'

export { ChangeStepper, type ChangeStepperProps } from './ChangeStepper'

export { ToolWell, type ToolWellProps } from './ToolWell'

export {
  DiffChipToolbar,
  type DiffChipToolbarProps,
  type DiffMode,
} from './DiffChipToolbar'

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
