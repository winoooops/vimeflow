import type { ReactElement } from 'react'
import { Tooltip } from '@/components/Tooltip'
import { IconButton } from '@/components/IconButton'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'

export interface FilePillProps {
  // Basename + count are rendered on the lavender pill body. `fileName` is the
  // full path (basename is derived for display, the path stays on the pill's
  // tooltip + aria-label so the accessible name is unambiguous). Undefined
  // renders the em-dash placeholder until a file is selected.
  fileName: string | undefined
  // 1-based `N/M` position string (already clamped by the caller). Surfaced both
  // as the count badge text and inside the group's accessible name.
  counterText: string
  // Both arrows are functional only when there is more than one file to step
  // through; with a single file they render disabled + inert.
  navEnabled: boolean
  onPrev: (() => void) | undefined
  onNext: (() => void) | undefined
}

// Lavender (primary) file-navigation group: a previous-file ghost arrow, the
// pill body (description icon + basename + `N/M` count badge), and a next-file
// ghost arrow. Rendered as a single inline-flex unit so PriorityPlus measures
// and overflows the whole group together (it never spills individual arrows).
//
// Disabled arrows dim by color and drop pointer events entirely — no
// `not-allowed` cursor, no hover, no tooltip — rather than showing the blocked
// cursor (matches the design's unavailable affordance).
const GHOST_ARROW_CLASSES =
  'w-[26px] h-[30px] grid place-items-center rounded-md bg-transparent ' +
  'text-on-surface-muted hover:bg-surface-bright hover:text-primary-container ' +
  'transition-colors disabled:opacity-40 disabled:pointer-events-none'

export const FilePill = ({
  fileName,
  counterText,
  navEnabled,
  onPrev,
  onNext,
}: FilePillProps): ReactElement => {
  // Show only the trailing path segment on the pill; keep the full path on the
  // accessible name + tooltip so users can disambiguate same-named files.
  const baseName = fileName?.split('/').pop() ?? fileName ?? '—'

  return (
    <span className="inline-flex items-center gap-0.5">
      <Tooltip content="Previous file">
        <IconButton
          icon="chevron_left"
          label="previous file"
          size="sm"
          disabled={!navEnabled}
          onClick={onPrev}
          showTooltip={TOOLTIP_SUPPRESSED} // explicit outer Tooltip owns the label
          className={GHOST_ARROW_CLASSES}
        />
      </Tooltip>
      <Tooltip content={fileName ?? `File ${counterText}`}>
        {/* role="group" makes the aria-label a valid author name. ARIA 1.2
            forbids names on the implicit `generic` role of a bare <div>, so
            screen readers would otherwise discard the path + N/M position
            (the visible text only shows the basename). */}
        <div
          role="group"
          aria-label={
            fileName
              ? `file ${counterText}: ${fileName}`
              : `file ${counterText}`
          }
          className="inline-flex items-center gap-2 h-[30px] px-3 rounded-md bg-primary/10 ring-1 ring-inset ring-primary/20"
        >
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-base leading-none text-primary-container"
          >
            description
          </span>
          <span className="font-mono text-xs font-medium text-on-surface truncate max-w-[12rem]">
            {baseName}
          </span>
          <span className="font-mono text-[0.625rem] text-primary-dim bg-primary/[0.14] px-1.5 py-0.5 rounded-full whitespace-nowrap">
            {counterText}
          </span>
        </div>
      </Tooltip>
      <Tooltip content="Next file">
        <IconButton
          icon="chevron_right"
          label="next file"
          size="sm"
          disabled={!navEnabled}
          onClick={onNext}
          showTooltip={TOOLTIP_SUPPRESSED} // explicit outer Tooltip owns the label
          className={GHOST_ARROW_CLASSES}
        />
      </Tooltip>
    </span>
  )
}
