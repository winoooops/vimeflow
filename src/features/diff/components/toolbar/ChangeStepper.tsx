import type { ReactElement } from 'react'

export interface ChangeStepperProps {
  // 1-based `N/N` hunk position string (or `0/0` when there are no hunks),
  // built by the caller. Surfaced both as the counter text and inside the
  // group's accessible name (`hunk N/N`).
  counterText: string
  // Arrows are functional only when there is more than one hunk to navigate;
  // with <= 1 hunk they render disabled + inert (no tooltip).
  navEnabled: boolean
  onPrev: (() => void) | undefined
  onNext: (() => void) | undefined
}

// Azure (secondary) change-navigation group: a leading `data_object` glyph, the
// `N/N` counter, and a vertically stacked up (prev) / down (next) arrow pair.
// Rendered as a single inline-flex unit so PriorityPlus measures and overflows
// the whole stepper together.
//
// The accessible names stay `prev hunk` / `next hunk` (matching the pre-redesign
// chips) so the hunk-navigation behavior tests are unaffected by the layout
// change from horizontal to vertical arrows.
const VERTICAL_STEP_ARROW_CLASSES =
  'w-5 h-[13px] grid place-items-center rounded bg-transparent ' +
  'text-secondary/70 hover:text-secondary transition-colors ' +
  'disabled:opacity-40 disabled:hover:text-secondary/70 disabled:cursor-not-allowed'

export const ChangeStepper = ({
  counterText,
  navEnabled,
  onPrev,
  onNext,
}: ChangeStepperProps): ReactElement => (
  <span
    aria-label={`hunk ${counterText}`}
    className="inline-flex items-center gap-[7px] h-[30px] pl-2.5 pr-1 rounded-md bg-secondary/[0.08] ring-1 ring-inset ring-secondary/[0.16]"
  >
    <span
      aria-hidden="true"
      className="material-symbols-outlined text-sm leading-none text-secondary"
    >
      data_object
    </span>
    <span className="font-mono text-xs font-semibold text-secondary whitespace-nowrap">
      {counterText}
    </span>
    <span className="flex flex-col">
      <button
        type="button"
        disabled={!navEnabled}
        aria-label="prev hunk"
        onClick={onPrev}
        className={VERTICAL_STEP_ARROW_CLASSES}
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-sm leading-none"
        >
          keyboard_arrow_up
        </span>
      </button>
      <button
        type="button"
        disabled={!navEnabled}
        aria-label="next hunk"
        onClick={onNext}
        className={VERTICAL_STEP_ARROW_CLASSES}
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-sm leading-none"
        >
          keyboard_arrow_down
        </span>
      </button>
    </span>
  </span>
)
