import type { ReactElement } from 'react'

interface DiffNarrowPlaceholderProps {
  min: number
}

export const DiffNarrowPlaceholder = ({
  min,
}: DiffNarrowPlaceholderProps): ReactElement => (
  <div
    role="status"
    className="flex flex-col items-center justify-center gap-2 px-4 py-10 rounded-lg bg-surface-container-low/40 text-on-surface-variant text-center"
  >
    <span className="material-symbols-outlined text-2xl leading-none opacity-70">
      unfold_more
    </span>
    <p className="text-xs leading-snug">
      Pane is too narrow to render the diff.
    </p>
    <p className="text-[0.65rem] opacity-70 leading-snug">
      Widen to ≥ {min}px to view changes.
    </p>
  </div>
)
