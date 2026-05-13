import { useCallback, type MouseEvent, type ReactElement } from 'react'

export interface EmptySlotProps {
  sessionId: string
  onAddPane: (sessionId: string) => void
}

export const EmptySlot = ({
  sessionId,
  onAddPane,
}: EmptySlotProps): ReactElement => {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      event.stopPropagation()
      onAddPane(sessionId)
    },
    [onAddPane, sessionId]
  )

  return (
    <div className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-outline-variant/35 bg-surface-container/35">
      <button
        type="button"
        aria-label="add pane"
        onClick={handleClick}
        className="group inline-flex flex-col items-center gap-2 rounded-md px-5 py-4 font-mono text-on-surface-muted transition hover:bg-white/[0.04] hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/45"
      >
        <span
          className="material-symbols-outlined text-[30px] leading-none"
          aria-hidden="true"
        >
          add
        </span>
        <span className="text-[11px]">add pane</span>
      </button>
    </div>
  )
}
