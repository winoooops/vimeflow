import { useCallback, type ReactElement } from 'react'

export interface EmptySlotProps {
  sessionId: string
  onAddPane: (sessionId: string) => void
}

export const EmptySlot = ({
  sessionId,
  onAddPane,
}: EmptySlotProps): ReactElement => {
  // Round 13, Claude LOW: dropped the previous `event.stopPropagation()`.
  // SplitView's empty-slot `motion.div` wrapper carries no `onClick`, and
  // the outer grid container doesn't either — the call was inert. If a
  // future ancestor adds a container-level click handler, that's the
  // place to gate it; the empty slot's button shouldn't silently
  // suppress unknown future handlers.
  const handleClick = useCallback((): void => {
    onAddPane(sessionId)
  }, [onAddPane, sessionId])

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
