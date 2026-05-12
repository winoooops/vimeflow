// cspell:ignore vsplit hsplit
import type { ReactElement } from 'react'
import type { Pane, Session } from '../../../sessions/types'
import type { NotifyPaneReady } from '../../hooks/useTerminal'
import type { ITerminalService } from '../../services/terminalService'
import { TerminalPane, type TerminalPaneMode } from '../TerminalPane'
import { LAYOUTS } from './layouts'

export interface SplitViewProps {
  session: Session
  service: ITerminalService
  isActive: boolean
  onSessionCwdChange?: (sessionId: string, paneId: string, cwd: string) => void
  onPaneReady?: NotifyPaneReady
  onSessionRestart?: (sessionId: string) => void
  deferTerminalFit?: boolean
}

const paneMode = (pane: Pane): TerminalPaneMode => {
  if (pane.status === 'completed' || pane.status === 'errored') {
    return 'awaiting-restart'
  }

  if (pane.restoreData) {
    return 'attach'
  }

  return 'spawn'
}

/** Pick the panes that should be rendered for `layout.capacity` slots.
 *  Normally the prefix slice; if the active pane is beyond the slice
 *  (only reachable in production when `panes.length > capacity` — the
 *  DEV throw in `SplitView` catches the same case for fixtures/tests),
 *  the active pane replaces the last visible slot so focus/agent/cwd
 *  signals stay reachable from the UI. Exported for unit testing. */
export const selectVisiblePanes = (
  panes: readonly Pane[],
  capacity: number
): Pane[] => {
  const sliced = panes.slice(0, capacity)
  const activeIdx = panes.findIndex((p) => p.active)
  if (activeIdx >= capacity) {
    return [...sliced.slice(0, capacity - 1), panes[activeIdx]]
  }

  return sliced
}

export const SplitView = ({
  session,
  service,
  isActive,
  onSessionCwdChange = undefined,
  onPaneReady = undefined,
  onSessionRestart = undefined,
  deferTerminalFit = false,
}: SplitViewProps): ReactElement => {
  const layout = LAYOUTS[session.layout]

  if (import.meta.env.DEV && session.panes.length > layout.capacity) {
    throw new Error(
      `SplitView invariant violation: session ${session.id} has ` +
        `${session.panes.length} panes but layout '${session.layout}' ` +
        `has capacity ${layout.capacity}`
    )
  }

  const visiblePanes = selectVisiblePanes(session.panes, layout.capacity)

  const gridTemplateAreas = layout.areas
    .map((row) => `"${row.join(' ')}"`)
    .join(' ')

  return (
    <div
      data-testid="split-view"
      data-session-id={session.id}
      data-layout={session.layout}
      className="grid h-full w-full gap-2 bg-surface p-2.5"
      style={{
        gridTemplateColumns: layout.cols,
        gridTemplateRows: layout.rows,
        gridTemplateAreas,
      }}
    >
      {visiblePanes.map((pane, i) => {
        const mode = paneMode(pane)

        return (
          <div
            key={pane.id}
            data-testid="split-view-slot"
            data-pane-id={pane.id}
            data-pty-id={pane.ptyId}
            data-mode={mode}
            data-cwd={pane.cwd}
            className="relative min-h-0 min-w-0"
            style={{ gridArea: `p${i}` }}
          >
            <TerminalPane
              key={pane.ptyId}
              session={session}
              pane={pane}
              service={service}
              mode={mode}
              onCwdChange={(cwd) =>
                onSessionCwdChange?.(session.id, pane.id, cwd)
              }
              onPaneReady={onPaneReady}
              onRestart={onSessionRestart}
              isActive={isActive}
              deferFit={deferTerminalFit}
            />
          </div>
        )
      })}
    </div>
  )
}
