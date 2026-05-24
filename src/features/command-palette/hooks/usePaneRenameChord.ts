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

/**
 * Pane types that round-trip the rename through the agent's `/rename`
 * slash command via the `rename_agent_session` IPC. Other types
 * (`aider`, `generic`, shell PTYs with no detected agent) only get the
 * local `pane.userLabel` update — no IPC, no PTY write.
 */
const ROUND_TRIP_AGENTS: readonly Pane['agentType'][] = ['claude-code', 'codex']

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
  resolveFocusedPane: () => FocusedPaneRef | null,
  setPaneUserLabel: (ptyId: string, label: string | undefined) => void
): { renderNode: ReactNode } => {
  const [target, setTarget] = useState<RenameTarget>(null)
  const [error, setError] = useState<string | null>(null)
  const resolverRef = useRef(resolveFocusedPane)
  resolverRef.current = resolveFocusedPane
  const setPaneUserLabelRef = useRef(setPaneUserLabel)
  setPaneUserLabelRef.current = setPaneUserLabel

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
      // visual confirmation regardless of agent type, and is the only
      // path for non-`/rename`-supporting panes (aider, generic, bare
      // shells). For Claude/Codex panes the agent-session-title round
      // trip will converge `agentTitle` to the same value shortly
      // after.
      setPaneUserLabelRef.current(target.ptyId, title)

      if (!ROUND_TRIP_AGENTS.includes(target.pane.agentType)) {
        // Non-agent pane: local update only; close the input.
        setTarget(null)
        setError(null)

        return
      }

      try {
        await renameAgentSession(target.ptyId, title)
        setTarget(null)
        setError(null)
      } catch (renameError) {
        // Local label is already set; surface the IPC failure inline
        // so the user knows the agent's transcript was NOT updated.
        // The header will still reflect the new label via userLabel.
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
