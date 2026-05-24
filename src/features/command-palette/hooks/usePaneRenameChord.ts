import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { renameAgentSession } from '../../../lib/backend'
import type { Pane, Session } from '../../sessions/types'
import { isExpectedLocalOnlyRenameFailure } from '../../sessions/utils/agentRenameErrors'
import { PaneRenameInput } from '../../terminal/components/PaneRenameInput'
import { registerChord } from '../chordRegistry'

export interface FocusedPaneRef {
  pane: Pane
  session: Session
}

type RenameTarget = {
  requestId: number
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
  const targetRef = useRef<RenameTarget>(null)
  const nextRequestIdRef = useRef(0)
  const resolverRef = useRef(resolveFocusedPane)
  resolverRef.current = resolveFocusedPane
  const setPaneUserLabelRef = useRef(setPaneUserLabel)
  setPaneUserLabelRef.current = setPaneUserLabel
  const pendingSubmitCountRef = useRef(0)

  const setRenameTarget = useCallback((nextTarget: RenameTarget): void => {
    targetRef.current = nextTarget
    setTarget(nextTarget)
  }, [])

  const setRenameError = useCallback((nextError: string | null): void => {
    setError(nextError)
  }, [])

  const clearRenameTargetIfCurrent = useCallback(
    (requestId: number): void => {
      if (targetRef.current?.requestId !== requestId) {
        return
      }

      setRenameTarget(null)
      setRenameError(null)
    },
    [setRenameError, setRenameTarget]
  )

  useEffect(
    () =>
      registerChord('r', () => {
        const focused = resolverRef.current()
        if (!focused) {
          return false
        }

        nextRequestIdRef.current += 1
        setRenameTarget({
          requestId: nextRequestIdRef.current,
          ptyId: focused.pane.ptyId,
          pane: focused.pane,
          initialValue:
            focused.pane.userLabel ??
            focused.pane.agentTitle ??
            focused.session.name,
        })
        setRenameError(null)

        return true
      }),
    [setRenameError, setRenameTarget]
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

      pendingSubmitCountRef.current += 1

      try {
        await renameAgentSession(target.ptyId, title)
        clearRenameTargetIfCurrent(target.requestId)
      } catch (renameError) {
        if (
          isExpectedLocalOnlyRenameFailure(renameError, target.pane.agentType)
        ) {
          clearRenameTargetIfCurrent(target.requestId)

          return
        }

        if (targetRef.current?.requestId === target.requestId) {
          setPaneUserLabelRef.current(target.ptyId, undefined)
          setRenameError(errorMessageForRenameFailure(renameError))
        }
      } finally {
        pendingSubmitCountRef.current = Math.max(
          0,
          pendingSubmitCountRef.current - 1
        )
      }
    },
    [clearRenameTargetIfCurrent, setRenameError, target]
  )

  const handleCancel = useCallback((): void => {
    if (pendingSubmitCountRef.current > 0) {
      return
    }

    setRenameTarget(null)
    setRenameError(null)
  }, [setRenameError, setRenameTarget])

  const handleExternalErrorDismiss = useCallback((): void => {
    setRenameError(null)
  }, [setRenameError])

  return {
    renderNode: target
      ? createElement(PaneRenameInput, {
          key: target.requestId,
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
