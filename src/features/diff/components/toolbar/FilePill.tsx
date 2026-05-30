import type { ReactElement } from 'react'

export interface FilePillProps {
  // Basename + count are rendered on the lavender pill body. `fileName` is the
  // full path (basename is derived for display, the path stays on `title` /
  // `aria-label` so the accessible name is unambiguous). Undefined renders the
  // em-dash placeholder until a file is selected.
  fileName: string | undefined
  // 1-based `N/M` position string (already clamped by the caller). Surfaced both
  // as the count badge text and inside the group's accessible name.
  counterText: string
  // Both arrows are functional only when there is more than one file to step
  // through; with a single file they render disabled + inert (no tooltip).
  navEnabled: boolean
  onPrev: (() => void) | undefined
  onNext: (() => void) | undefined
}

// Lavender (primary) file-navigation group: a previous-file ghost arrow, the
// pill body (description icon + basename + `N/M` count badge), and a next-file
// ghost arrow. Rendered as a single inline-flex unit so PriorityPlus measures
// and overflows the whole group together (it never spills individual arrows).
//
// The pill body itself is non-interactive today — there is no file-picker
// affordance — so it renders as a labelled `div`. The arrows carry the
// position-stepping behavior via `onPrev` / `onNext`.
const GHOST_ARROW_CLASSES =
  'w-[26px] h-[30px] grid place-items-center rounded-md bg-transparent ' +
  'text-on-surface-muted hover:bg-surface-bright hover:text-primary-container ' +
  'transition-colors disabled:opacity-40 disabled:hover:bg-transparent ' +
  'disabled:hover:text-on-surface-muted disabled:cursor-not-allowed'

export const FilePill = ({
  fileName,
  counterText,
  navEnabled,
  onPrev,
  onNext,
}: FilePillProps): ReactElement => {
  // Show only the trailing path segment on the pill; keep the full path on the
  // accessible name + title so users can disambiguate same-named files.
  const baseName = fileName?.split('/').pop() ?? fileName ?? '—'

  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        disabled={!navEnabled}
        aria-label="previous file"
        onClick={onPrev}
        className={GHOST_ARROW_CLASSES}
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-base leading-none"
        >
          chevron_left
        </span>
      </button>
      <div
        title={fileName ?? undefined}
        aria-label={
          fileName ? `file ${counterText}: ${fileName}` : `file ${counterText}`
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
      <button
        type="button"
        disabled={!navEnabled}
        aria-label="next file"
        onClick={onNext}
        className={GHOST_ARROW_CLASSES}
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-base leading-none"
        >
          chevron_right
        </span>
      </button>
    </span>
  )
}
