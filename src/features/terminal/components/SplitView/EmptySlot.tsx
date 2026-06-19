import { useCallback, type ReactElement } from 'react'
import type { LayoutSlotId, PaneKind } from '../../../sessions/types'

export interface EmptySlotProps {
  sessionId: string
  slotId: LayoutSlotId
  onAddPane: (sessionId: string, kind?: PaneKind, slotId?: LayoutSlotId) => void
}

export const EmptySlot = ({
  sessionId,
  slotId,
  onAddPane,
}: EmptySlotProps): ReactElement => {
  // Round 13, Claude LOW: dropped the previous `event.stopPropagation()`.
  // SplitView's empty-slot `motion.div` wrapper carries no `onClick`, and
  // the outer grid container doesn't either — the call was inert. If a
  // future ancestor adds a container-level click handler, that's the
  // place to gate it; the empty slot's button shouldn't silently
  // suppress unknown future handlers.
  const handleShellClick = useCallback((): void => {
    onAddPane(sessionId, 'shell', slotId)
  }, [onAddPane, sessionId, slotId])

  const handleBrowserClick = useCallback((): void => {
    onAddPane(sessionId, 'browser', slotId)
  }, [onAddPane, sessionId, slotId])

  return (
    <div className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-outline-variant/35 bg-surface-container/35">
      <div className="flex flex-col items-center gap-3 font-mono text-on-surface-muted">
        <span
          className="material-symbols-outlined text-[30px] leading-none"
          aria-hidden="true"
        >
          add
        </span>
        <span className="text-[11px] uppercase tracking-[0.18em]">
          add pane
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="add shell pane"
            onClick={handleShellClick}
            className="rounded-md bg-wash-subtle px-3 py-2 text-[11px] text-on-surface transition hover:bg-wash-soft focus:outline-none focus:ring-2 focus:ring-primary/45"
          >
            Shell
          </button>
          <button
            type="button"
            aria-label="add browser pane"
            onClick={handleBrowserClick}
            className="rounded-md bg-primary/15 px-3 py-2 text-[11px] text-primary transition hover:bg-primary/25 focus:outline-none focus:ring-2 focus:ring-primary/45"
          >
            Browser
          </button>
        </div>
      </div>
    </div>
  )
}
