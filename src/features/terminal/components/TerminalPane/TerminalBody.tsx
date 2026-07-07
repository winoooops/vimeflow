/* eslint-disable react/require-default-props -- forwardRef destructuring defaults */
// cspell:ignore Ghostty
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import type { NotifyPaneReady, RestoreData } from '../../hooks/useTerminal'
import type { ITerminalService } from '../../services/terminalService'
import {
  focusNativeGhostty,
  shouldUseNativeGhostty,
  type NativeGhosttyShortcutContext,
} from '../../nativeGhosttyClient'
import { Body as XtermBody, type BodyHandle, type BodyMode } from './Body'
import { GhosttyBody } from './GhosttyBody'

interface TerminalBodyProps {
  paneId: string
  ptyId: string
  cwd: string
  active: boolean
  service: ITerminalService
  restoredFrom?: RestoreData
  onCwdChange?: (cwd: string) => void
  onPaneReady?: NotifyPaneReady
  onCommandSubmit?: (ptyId: string, command: string) => void
  onRequestActive?: () => void
  onRequestFocus?: () => void
  shortcutContext?: NativeGhosttyShortcutContext
  bottomCornerRadius?: number
  mode: BodyMode
  deferFit: boolean
  terminalFontFamily?: string
  enableImagePaste: boolean
}

export interface TerminalBodyHandle {
  focusTerminal: () => void
}

// forwardRef lets TerminalPane keep calling focusTerminal() without knowing
// whether this body is currently backed by xterm or native Ghostty.
export const TerminalBody = forwardRef<TerminalBodyHandle, TerminalBodyProps>(
  function TerminalBody(
    {
      paneId,
      ptyId,
      cwd,
      active,
      service,
      restoredFrom = undefined,
      onCwdChange = undefined,
      onPaneReady = undefined,
      onCommandSubmit = undefined,
      onRequestActive = undefined,
      onRequestFocus = undefined,
      shortcutContext = undefined,
      bottomCornerRadius = 0,
      mode,
      deferFit,
      terminalFontFamily = undefined,
      enableImagePaste,
    },
    ref
  ): ReactElement {
    const xtermRef = useRef<BodyHandle>(null)
    const [nativeUnavailable, setNativeUnavailable] = useState(false)
    const useNativeGhostty = shouldUseNativeGhostty() && !nativeUnavailable

    const handleNativeUnavailable = useCallback((): void => {
      setNativeUnavailable(true)
    }, [])

    useEffect(() => {
      setNativeUnavailable(false)
    }, [paneId, ptyId])

    useImperativeHandle(
      ref,
      () => ({
        focusTerminal(): void {
          if (useNativeGhostty) {
            if (!active) {
              return
            }

            void (async (): Promise<void> => {
              try {
                const enabled = await focusNativeGhostty({
                  sessionId: ptyId,
                  paneId,
                })
                if (!enabled) {
                  handleNativeUnavailable()
                }
              } catch {
                handleNativeUnavailable()
              }
            })()

            return
          }

          xtermRef.current?.focusTerminal()
        },
      }),
      [active, handleNativeUnavailable, paneId, ptyId, useNativeGhostty]
    )

    if (useNativeGhostty) {
      return (
        <GhosttyBody
          paneId={paneId}
          ptyId={ptyId}
          cwd={cwd}
          active={active}
          service={service}
          restoredFrom={restoredFrom}
          onCwdChange={onCwdChange}
          onPaneReady={onPaneReady}
          onCommandSubmit={onCommandSubmit}
          onRequestActive={onRequestActive}
          onRequestFocus={onRequestFocus}
          shortcutContext={shortcutContext}
          bottomCornerRadius={bottomCornerRadius}
          onUnavailable={handleNativeUnavailable}
        />
      )
    }

    return (
      <XtermBody
        ref={xtermRef}
        sessionId={ptyId}
        cwd={cwd}
        service={service}
        restoredFrom={restoredFrom}
        onCwdChange={onCwdChange}
        onPaneReady={onPaneReady}
        onCommandSubmit={onCommandSubmit}
        mode={mode}
        deferFit={deferFit}
        terminalFontFamily={terminalFontFamily}
        enableImagePaste={enableImagePaste}
      />
    )
  }
)
