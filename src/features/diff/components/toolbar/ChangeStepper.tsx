import type { ReactElement } from 'react'
import { Chip } from '@/components/Chip'
import { Tooltip } from '@/components/Tooltip'
import { IconButton } from '@/components/IconButton'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'

export interface ChangeStepperProps {
  // 1-based `N/N` hunk position string (or `0/0` when there are no hunks),
  // built by the caller. Surfaced both as the counter text and inside the
  // group's accessible name (`hunk N/N`).
  counterText: string
  // Arrows are functional only when there is more than one hunk to navigate;
  // with <= 1 hunk they render disabled + inert.
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
// change. Disabled arrows dim + drop pointer events (no `not-allowed` cursor).
// Tooltips are split — the glyph+counter carries the group label and each arrow
// its own — so they never nest.
const VERTICAL_STEP_ARROW_CLASSES =
  'w-5 h-[13px] grid place-items-center rounded bg-transparent ' +
  'text-secondary/70 hover:text-secondary transition-colors ' +
  'disabled:opacity-40 disabled:pointer-events-none'

export const ChangeStepper = ({
  counterText,
  navEnabled,
  onPrev,
  onNext,
}: ChangeStepperProps): ReactElement => (
  // role="group" makes the aria-label a valid author name — ARIA 1.2 forbids
  // names on the implicit `generic` role of a bare <span>, so the hunk
  // position would otherwise be discarded by screen readers.
  <Chip
    role="group"
    aria-label={`hunk ${counterText}`}
    tone="secondary"
    variant="tinted"
    radius="md"
    size="custom"
    className="h-7 gap-[7px] rounded-md bg-secondary/[0.08] pl-2.5 pr-1 ring-1 ring-inset ring-secondary/[0.16]"
  >
    <Tooltip content="Jump between changes in this file">
      <span className="inline-flex items-center gap-[7px]">
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-sm leading-none text-secondary"
        >
          data_object
        </span>
        <span className="font-mono text-xs font-semibold text-secondary whitespace-nowrap">
          {counterText}
        </span>
      </span>
    </Tooltip>
    <span className="flex flex-col">
      <Tooltip content="Previous change" shortcut="[">
        <IconButton
          icon="keyboard_arrow_up"
          label="prev hunk"
          size="sm"
          disabled={!navEnabled}
          aria-keyshortcuts="["
          onClick={onPrev}
          showTooltip={TOOLTIP_SUPPRESSED} // explicit outer Tooltip owns the label
          className={VERTICAL_STEP_ARROW_CLASSES}
        />
      </Tooltip>
      <Tooltip content="Next change" shortcut="]">
        <IconButton
          icon="keyboard_arrow_down"
          label="next hunk"
          size="sm"
          disabled={!navEnabled}
          aria-keyshortcuts="]"
          onClick={onNext}
          showTooltip={TOOLTIP_SUPPRESSED} // explicit outer Tooltip owns the label
          className={VERTICAL_STEP_ARROW_CLASSES}
        />
      </Tooltip>
    </span>
  </Chip>
)
