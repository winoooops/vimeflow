import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { renameAgentSession } from '../../../lib/backend'
import type { Pane, Session } from '../../sessions/types'
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

  if (message.includes('does not support /rename')) {
    return "this agent doesn't support /rename"
  }

  if (message.includes('no live agent')) {
    return 'no agent in this pane to rename'
  }

  return `failed to send /rename: ${message}`
}

export const usePaneRenameChord = (
  resolveFocusedPane: () => FocusedPaneRef | null
): { renderNode: ReactNode } => {
  const [target, setTarget] = useState<RenameTarget>(null)
  const [error, setError] = useState<string | null>(null)
  const resolverRef = useRef(resolveFocusedPane)
  resolverRef.current = resolveFocusedPane

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
          initialValue: focused.pane.agentTitle ?? focused.session.name,
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

      try {
        await renameAgentSession(target.ptyId, title)
        setTarget(null)
        setError(null)
      } catch (renameError) {
        setError(errorMessageForRenameFailure(renameError))
      }
    },
    [target]
  )

  const handleCancel = useCallback((): void => {
    setTarget(null)
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
        })
      : null,
  }
}
