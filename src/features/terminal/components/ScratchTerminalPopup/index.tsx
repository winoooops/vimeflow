import type { ReactElement } from 'react'
import { Body } from '../TerminalPane/Body'
import { AGENTS } from '../../../../agents/registry'
import type { RestoreData } from '../../types'
import type { ITerminalService } from '../../services/terminalService'
import type { NotifyPaneReady } from '../../hooks/useTerminal'

// Scratch wears the registered `shell` agent's amber identity (design handoff).
const SHELL_ACCENT = AGENTS.shell.accent
const SHELL_ACCENT_DIM = AGENTS.shell.accentDim

export interface ScratchTerminalPopupProps {
  /** Whether the popup is visible. Hidden ≠ unmounted — the shell keeps running. */
  open: boolean
  /** The ephemeral PTY id this popup is attached to (distinct from any pane). */
  scratchPtyId: string
  /** The cwd the scratch shell was spawned at (shown in the header). */
  cwd: string
  /** The scratch shell's OS process id (for the attach snapshot). */
  pid: number
  service: ITerminalService
  /** Hide the popup (does NOT kill the shell). */
  onHide: () => void
  /** Drain the spawn→attach buffer once the terminal subscribes. */
  onPaneReady?: NotifyPaneReady
}

/**
 * Ephemeral "scratch" terminal popup — the command-palette's sibling overlay.
 *
 * Kept mounted for its shell's whole life; `open` toggles CSS visibility so the
 * PTY keeps running while hidden (hide ≠ kill). Renders the existing terminal
 * `<Body>` in `attach` mode against `scratchPtyId`. Visual fidelity against the
 * handoff mockup is refined in the dedicated design pass (VIM-53 T8).
 */
export const ScratchTerminalPopup = ({
  open,
  scratchPtyId,
  cwd,
  pid,
  service,
  onHide,
  onPaneReady = undefined,
}: ScratchTerminalPopupProps): ReactElement => {
  // Fresh attach: no prior history. The live subscription streams everything
  // from spawn onward; the spawn→attach gap is covered by the buffer-drain
  // (registerPending at spawn, onPaneReady on subscribe).
  const snapshot: RestoreData = {
    sessionId: scratchPtyId,
    cwd,
    pid,
    replayData: '',
    replayEndOffset: 0,
    bufferedEvents: [],
  }

  return (
    <div
      data-testid="scratch-popup"
      role="dialog"
      aria-label="Scratch terminal"
      aria-hidden={!open}
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh]"
      style={{ display: open ? 'flex' : 'none' }}
    >
      <button
        type="button"
        aria-label="Dismiss scratch terminal"
        onClick={onHide}
        className="absolute inset-0 cursor-default"
        style={{
          background: 'rgba(13, 13, 28, 0.55)',
          backdropFilter: 'blur(14px) saturate(120%)',
        }}
      />
      <div
        data-testid="scratch-panel"
        className="relative flex h-[600px] w-[760px] max-w-[92vw] flex-col overflow-hidden rounded-2xl shadow-2xl"
        style={{
          background: 'rgba(30, 30, 46, 0.88)',
          borderTop: `2px solid ${SHELL_ACCENT}`,
        }}
      >
        <header className="flex items-center gap-2.5 px-4 py-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-xs font-semibold tracking-wide"
            style={{ color: SHELL_ACCENT, background: SHELL_ACCENT_DIM }}
          >
            <span className="material-symbols-outlined text-base leading-none">
              terminal
            </span>
            SCRATCH
          </span>
          <span className="text-on-surface-variant truncate font-mono text-xs">
            {cwd}
          </span>
          <span className="text-on-surface-muted inline-flex items-center gap-1 text-xs">
            <span className="material-symbols-outlined text-sm leading-none">
              link_off
            </span>
            cd stays in scratch
          </span>
          <span className="text-on-surface-muted inline-flex items-center gap-1 text-xs">
            <span className="material-symbols-outlined text-sm leading-none">
              auto_delete
            </span>
            throwaway
          </span>
          <button
            type="button"
            data-testid="scratch-hide"
            aria-label="Hide scratch terminal"
            onClick={onHide}
            className="text-on-surface-muted hover:text-on-surface ml-auto inline-flex items-center"
          >
            <span className="material-symbols-outlined text-lg leading-none">
              close
            </span>
          </button>
        </header>
        <div
          data-testid="scratch-body"
          data-mode="attach"
          className="min-h-0 flex-1"
        >
          <Body
            mode="attach"
            sessionId={scratchPtyId}
            cwd={cwd}
            service={service}
            restoredFrom={snapshot}
            onPaneReady={onPaneReady}
          />
        </div>
        <footer className="text-on-surface-muted flex items-center gap-1.5 px-4 py-1.5 font-mono text-xs">
          <span className="material-symbols-outlined text-sm leading-none">
            keyboard_return
          </span>
          run · ⌃C cancel · esc hides — shell keeps running
        </footer>
      </div>
    </div>
  )
}
