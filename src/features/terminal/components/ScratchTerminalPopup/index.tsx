import { useCallback, useEffect, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Body } from '../TerminalPane/Body'
import type { BodyHandle } from '../TerminalPane/Body'
import { AGENTS } from '../../../../agents/registry'
import { isMacPlatform } from '../../../../lib/formatShortcut'
import type { RestoreData } from '../../types'
import type { ITerminalService } from '../../services/terminalService'
import type { NotifyPaneReady } from '../../hooks/useTerminal'

// Scratch wears the registered `shell` agent's amber identity (design handoff).
const SHELL_ACCENT = AGENTS.shell.accent
const SHELL_ACCENT_DIM = AGENTS.shell.accentDim

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
 * `<Body>` in `attach` mode against `scratchPtyId`.
 *
 * Because it renders `<Body>` directly (no `TerminalPane` wrapper to drive
 * focus), it moves DOM focus into the scratch xterm itself when shown —
 * otherwise a chord-opened popup leaves focus on the pane underneath and sends
 * keystrokes there.
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

  // Esc hides the popup. The scratch xterm holds focus, so without a native
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
      ref={overlayRef}
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
        className="relative flex h-[600px] w-[760px] max-w-[92vw] flex-col overflow-hidden rounded-[14px]"
        style={{
          background: 'rgba(24, 22, 30, 0.9)',
          backdropFilter: 'blur(24px) saturate(160%)',
          border: '1px solid rgba(240, 198, 116, 0.2)',
          boxShadow:
            '0 24px 70px rgba(0,0,0,0.62), 0 0 0 1px rgba(240,198,116,0.08), 0 0 40px rgba(240,198,116,0.18)',
        }}
      >
        {/* amber identity hairline at the very top */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-60"
          style={{
            background:
              'linear-gradient(90deg, transparent, #f0c674, transparent)',
          }}
        />

        <header
          className="flex flex-col gap-[9px] px-[14px] pb-[11px] pt-[13px]"
          style={{
            borderBottom: '1px solid rgba(74,68,79,0.18)',
            background: 'rgba(13,13,28,0.35)',
          }}
        >
          <div className="flex items-center gap-[9px]">
            <span
              className="inline-flex items-center gap-[7px] rounded-[7px] py-1 pl-2 pr-2.5 font-mono text-[11px] font-bold tracking-[0.06em]"
              style={{
                color: SHELL_ACCENT,
                background: SHELL_ACCENT_DIM,
                border: '1px solid rgba(240,198,116,0.34)',
              }}
            >
              <span className="material-symbols-outlined text-[14px] leading-none">
                terminal
              </span>
              SCRATCH
            </span>

            <span className="flex-1" />

            <span
              className="inline-flex h-[23px] items-center gap-[5px] rounded-md px-2 font-mono text-[9.5px] uppercase tracking-[0.04em]"
              style={{
                border: '1px dashed rgba(138,130,153,0.45)',
                color: '#8a8299',
              }}
            >
              <span className="material-symbols-outlined text-[13px] leading-none">
                auto_delete
              </span>
              throwaway
            </span>

            <button
              type="button"
              data-testid="scratch-hide"
              aria-label="Hide scratch terminal"
              onClick={onHide}
              className="text-on-surface-muted hover:text-on-surface grid h-[26px] w-[26px] place-items-center rounded-[7px] hover:bg-white/5"
            >
              <span className="material-symbols-outlined text-[15px] leading-none">
                close
              </span>
            </button>
          </div>

          <div className="flex items-center gap-[10px] font-mono text-[10.5px]">
            <span className="inline-flex items-center gap-[6px]">
              <span
                className="material-symbols-outlined text-[13px] leading-none"
                style={{ color: SHELL_ACCENT }}
              >
                folder_open
              </span>
              <span className="truncate" style={{ color: '#a8c8ff' }}>
                {cwd}
              </span>
            </span>
            <span className="text-on-surface-muted">·</span>
            <span className="text-on-surface-muted inline-flex shrink-0 items-center gap-[5px]">
              <span className="material-symbols-outlined text-[13px] leading-none">
                link_off
              </span>
              cd stays in scratch
            </span>
          </div>
        </header>

        <div
          data-testid="scratch-body"
          data-mode="attach"
          className="min-h-0 flex-1"
        >
          <Body
            ref={bodyRef}
            mode="attach"
            sessionId={scratchPtyId}
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
          <span className="inline-flex items-center gap-[5px]">
            <Kbd>{isMacPlatform() ? '⌘;' : '⌃;'}</Kbd> <Kbd>`</Kbd> toggle
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
