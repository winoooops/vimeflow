import { useCallback, useEffect, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Tooltip } from '../../../../components/Tooltip'
import { Body } from '../TerminalPane/Body'
import type { BodyHandle } from '../TerminalPane/Body'
import { AGENTS } from '../../../../agents/registry'
import type { RestoreData } from '../../types'
import type { ITerminalService } from '../../services/terminalService'
import type { NotifyPaneReady } from '../../hooks/useTerminal'

// Amber shell accent — kept for the footer hint and panel glow.
const SHELL_ACCENT = AGENTS.shell.accent

// Release-handle fallback when no drain notifier is wired.
const releaseNoop = (): void => undefined

// Footer key-chip — mirrors the handoff `.kbd` style.
const Kbd = ({ children }: { children: ReactNode }): ReactElement => (
  <span
    className="inline-flex h-4 min-w-[17px] items-center justify-center rounded px-1 font-mono text-[9.5px]"
    style={{
      background: 'rgba(51,51,68,0.6)',
      border: '1px solid rgba(74,68,79,0.6)',
      color: '#cdc3d1',
    }}
  >
    {children}
  </span>
)

export interface BurnerTerminalPopupProps {
  /** Whether the popup is visible. Hidden ≠ unmounted — the shell keeps running. */
  open: boolean
  /** The ephemeral PTY id this popup is attached to (distinct from any pane). */
  burnerPtyId: string
  /** The cwd the burner shell was spawned at (shown in the header). */
  cwd: string
  /** The burner shell's OS process id (for the attach snapshot). */
  pid: number
  service: ITerminalService
  /** Hide the popup (does NOT kill the shell). */
  onHide: () => void
  /** Drain the spawn→attach buffer once the terminal subscribes. */
  onPaneReady?: NotifyPaneReady
  /**
   * Pull the host pane's current cwd into the burner shell (VIM-81) — one
   * directional. Omitted when the live host cwd can't be resolved, in which
   * case the button does not render.
   */
  onAlignCwd?: () => void
  /**
   * A foreground command is running in the burner (VIM-71). Aligning would feed
   * `cd` to that program's stdin instead of the shell, so the button disables.
   */
  alignBusy?: boolean
}

/**
 * Ephemeral "burner" terminal popup — the command-palette's sibling overlay.
 *
 * Kept mounted for its shell's whole life; `open` toggles CSS visibility so the
 * PTY keeps running while hidden (hide ≠ kill). Renders the existing terminal
 * `<Body>` in `attach` mode against `burnerPtyId`.
 *
 * Because it renders `<Body>` directly (no `TerminalPane` wrapper to drive
 * focus), it moves DOM focus into the burner xterm itself when shown —
 * otherwise a chord-opened popup leaves focus on the pane underneath and sends
 * keystrokes there.
 */
export const BurnerTerminalPopup = ({
  open,
  burnerPtyId,
  cwd,
  pid,
  service,
  onHide,
  onPaneReady = undefined,
  onAlignCwd = undefined,
  alignBusy = false,
}: BurnerTerminalPopupProps): ReactElement => {
  const bodyRef = useRef<BodyHandle>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(open)
  openRef.current = open

  // Re-show: the terminal is already attached, so focus lands immediately.
  useEffect(() => {
    if (open) {
      bodyRef.current?.focusTerminal()
    }
  }, [open])

  // Esc hides the popup. The burner xterm holds focus, so without a native
  // capture-phase intercept the keydown reaches the terminal and is sent to the
  // shell as ^[. Capturing on the overlay fires before xterm's textarea handler.
  useEffect(() => {
    const overlay = overlayRef.current
    if (!open || !overlay) {
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onHide()
      }
    }
    overlay.addEventListener('keydown', onKeyDown, { capture: true })

    return (): void => {
      overlay.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [open, onHide])

  // First open: focus once Body signals its xterm attached (also drains).
  const handlePaneReady = useCallback<NotifyPaneReady>(
    (ptyId, handler) => {
      const release = onPaneReady?.(ptyId, handler)
      if (openRef.current) {
        bodyRef.current?.focusTerminal()
      }

      return release ?? releaseNoop
    },
    [onPaneReady]
  )

  // Aligning moves DOM focus onto the toolbar button; hand it back to the xterm
  // so the next keystrokes land in the burner instead of the document.
  const handleAlign = useCallback((): void => {
    onAlignCwd?.()
    bodyRef.current?.focusTerminal()
  }, [onAlignCwd])

  // Fresh attach: no prior history. The live subscription streams everything
  // from spawn onward; the spawn→attach gap is covered by the buffer-drain
  // (registerPending at spawn, onPaneReady on subscribe).
  const snapshot: RestoreData = {
    sessionId: burnerPtyId,
    cwd,
    pid,
    replayData: '',
    replayEndOffset: 0,
    bufferedEvents: [],
  }

  return (
    <div
      ref={overlayRef}
      data-testid="burner-popup"
      role="dialog"
      aria-label="Burner terminal"
      aria-hidden={!open}
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh]"
      style={{ display: open ? 'flex' : 'none' }}
    >
      <button
        type="button"
        aria-label="Dismiss burner terminal"
        onClick={onHide}
        className="absolute inset-0 cursor-default"
        style={{
          background: 'rgba(13, 13, 28, 0.55)',
          backdropFilter: 'blur(14px) saturate(120%)',
        }}
      />
      <div
        data-testid="burner-panel"
        className="relative flex h-[600px] w-[760px] max-w-[92vw] flex-col overflow-hidden rounded-[14px]"
        style={{
          background: 'rgba(24, 22, 30, 0.9)',
          backdropFilter: 'blur(24px) saturate(160%)',
          border: '1px solid rgba(240, 198, 116, 0.2)',
          boxShadow:
            '0 24px 70px rgba(0,0,0,0.62), 0 0 0 1px rgba(240,198,116,0.08), 0 0 40px rgba(240,198,116,0.18)',
        }}
      >
        <header
          className="flex flex-col gap-[9px] px-[12px] py-[7px]"
          style={{
            borderBottom: '1px solid rgba(74,68,79,0.18)',
            background: 'rgba(13,13,28,0.35)',
          }}
        >
          <div className="flex items-center gap-[9px]">
            {/* Dashed gray pill — the burner's "throwaway" identity. */}
            <span
              className="inline-flex items-center gap-[7px] rounded-[7px] py-[3px] pr-[9px] pl-[7px] font-mono text-[10.5px] font-bold tracking-[0.06em]"
              style={{
                color: '#8a8299',
                border: '1px dashed rgba(138,130,153,0.45)',
              }}
            >
              <span className="material-symbols-outlined text-[13px] leading-none">
                terminal
              </span>
              BURNER
            </span>

            <span className="flex-1" />

            {onAlignCwd && (
              <Tooltip
                content={
                  alignBusy
                    ? 'Finish the command to align'
                    : "Align to pane's directory"
                }
                placement="bottom"
                // Lift above the z-[100] popup — the shared tooltip portals to
                // body at z-50 and would otherwise paint behind the overlay.
                className="!z-[110]"
              >
                <button
                  type="button"
                  data-testid="burner-align"
                  aria-label="Align burner to pane directory"
                  onClick={handleAlign}
                  disabled={alignBusy}
                  className={`grid h-[26px] w-[26px] place-items-center rounded-[7px] ${
                    alignBusy
                      ? 'text-on-surface-muted/40 cursor-not-allowed'
                      : 'text-on-surface-muted hover:text-on-surface hover:bg-white/5'
                  }`}
                >
                  <span
                    className="material-symbols-outlined text-[15px] leading-none"
                    aria-hidden="true"
                  >
                    sync
                  </span>
                </button>
              </Tooltip>
            )}

            <button
              type="button"
              data-testid="burner-hide"
              aria-label="Hide burner terminal"
              onClick={onHide}
              className="text-on-surface-muted hover:text-on-surface grid h-[26px] w-[26px] place-items-center rounded-[7px] hover:bg-white/5"
            >
              <span className="material-symbols-outlined text-[15px] leading-none">
                close
              </span>
            </button>
          </div>
        </header>

        <div
          data-testid="burner-body"
          data-mode="attach"
          className="min-h-0 flex-1"
        >
          <Body
            ref={bodyRef}
            mode="attach"
            sessionId={burnerPtyId}
            cwd={cwd}
            service={service}
            restoredFrom={snapshot}
            onPaneReady={handlePaneReady}
          />
        </div>

        <footer
          className="flex items-center gap-2 px-[14px] py-[9px] font-mono text-[10px]"
          style={{
            borderTop: '1px solid rgba(74,68,79,0.18)',
            background: 'rgba(13,13,28,0.5)',
            color: '#6c7086',
          }}
        >
          <span className="inline-flex items-center gap-[5px]">
            <Kbd>↵</Kbd> run
          </span>
          <span className="inline-flex items-center gap-[5px]">
            <Kbd>⌃C</Kbd> cancel
          </span>
          <span className="flex-1" />
          <span style={{ color: SHELL_ACCENT }}>
            esc hides — shell keeps running
          </span>
        </footer>
      </div>
    </div>
  )
}
