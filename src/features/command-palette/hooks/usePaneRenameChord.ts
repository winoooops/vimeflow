import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { renameAgentSession } from '../../../lib/backend'
import type { Pane, Session } from '../../sessions/types'
import { isExpectedNonAgentRenameFailure } from '../../sessions/utils/agentRenameErrors'
import { PaneRenameInput } from '../../terminal/components/PaneRenameInput'
import { registerChord } from '../chordRegistry'

export interface FocusedPaneRef {
  pane: Pane
  session: Session
}

type RenameTarget = {
  ptyId: string
  pane: Pane
  initialValue: string
} | null

const errorMessageForRenameFailure = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)

  return `failed to send /rename: ${message}`
}

export const usePaneRenameChord = (
  resolveFocusedPane: () => FocusedPaneRef | null,
  setPaneUserLabel: (ptyId: string, label: string | undefined) => void
): { renderNode: ReactNode } => {
  const [target, setTarget] = useState<RenameTarget>(null)
  const [error, setError] = useState<string | null>(null)
  const resolverRef = useRef(resolveFocusedPane)
  resolverRef.current = resolveFocusedPane
  const setPaneUserLabelRef = useRef(setPaneUserLabel)
  setPaneUserLabelRef.current = setPaneUserLabel
  const isSubmittingRef = useRef(false)

  useEffect(
    () =>
      registerChord('r', () => {
        const focused = resolverRef.current()
        if (!focused) {
          return false
        }

        setTarget({
          ptyId: focused.pane.ptyId,
          pane: focused.pane,
          initialValue:
            focused.pane.userLabel ??
            focused.pane.agentTitle ??
            focused.session.name,
        })
        setError(null)

        return true
      }),
    []
  )

  const handleSubmit = useCallback(
    async (title: string): Promise<void> => {
      if (!target) {
        return
      }

      // Always set the local label first — gives the user immediate
      // visual confirmation regardless of agent type. The backend owns
      // live-agent detection, so we still ask it to write `/rename` and
      // suppress expected shell / unsupported-agent failures below.
      setPaneUserLabelRef.current(target.ptyId, title)

      isSubmittingRef.current = true

      try {
        await renameAgentSession(target.ptyId, title)
        setTarget(null)
        setError(null)
      } catch (renameError) {
        const message =
          renameError instanceof Error
            ? renameError.message
            : String(renameError)
        if (isExpectedNonAgentRenameFailure(message)) {
          setTarget(null)
          setError(null)

          return
        }

        // Local label is already set; surface the IPC failure inline
        // so the user knows the agent's transcript was NOT updated.
        // The header will still reflect the new label via userLabel.
        setError(errorMessageForRenameFailure(renameError))
      } finally {
        isSubmittingRef.current = false
      }
    },
    [target]
  )

  const handleCancel = useCallback((): void => {
    if (isSubmittingRef.current) {
      return
    }

    setTarget(null)
    setError(null)
  }, [])

  const handleExternalErrorDismiss = useCallback((): void => {
    setError(null)
  }, [])

  return {
    renderNode: target
      ? createElement(PaneRenameInput, {
          pane: target.pane,
          initialValue: target.initialValue,
          onSubmit: handleSubmit,
          onCancel: handleCancel,
          externalError: error,
          onExternalErrorDismiss: handleExternalErrorDismiss,
        })
      : null,
  }
}
