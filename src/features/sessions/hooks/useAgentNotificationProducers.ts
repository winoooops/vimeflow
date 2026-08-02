import { useEffect, useRef } from 'react'
import type { AgentAttentionEvent, AgentLifecycleEvent } from '@/bindings'
import { listen, type UnlistenFn } from '@/lib/backend'
import { isDesktop } from '@/lib/environment'
import { subscribeTerminalAttention } from '@/features/terminal/notifications'
import type { NotificationInput } from './useNotificationCenter'
import type { Pane, Session } from '../types'
import { agentForPane } from '../utils/agentForSession'
import { findActivePane } from '../utils/activeSessionPane'

interface AgentNotificationProducerOptions {
  readonly sessions: readonly Session[]
  readonly activeSessionId: string | null
  readonly publish: (input: NotificationInput) => void
}

interface TargetPane {
  readonly session: Session
  readonly pane: Pane
}

const findTarget = (
  sessions: readonly Session[],
  ptyId: string
): TargetPane | undefined => {
  for (const session of sessions) {
    const pane = session.panes.find((candidate) => candidate.ptyId === ptyId)
    if (pane !== undefined) {
      return { session, pane }
    }
  }

  return undefined
}

const isBackgroundTarget = (
  target: TargetPane,
  activeSessionId: string | null
): boolean =>
  target.session.id !== activeSessionId ||
  findActivePane(target.session)?.ptyId !== target.pane.ptyId

export const useAgentNotificationProducers = ({
  sessions,
  activeSessionId,
  publish,
}: AgentNotificationProducerOptions): void => {
  const sessionsRef = useRef(sessions)
  const activeSessionIdRef = useRef(activeSessionId)
  const publishRef = useRef(publish)

  const phasesRef = useRef(
    new Map<string, Pick<AgentLifecycleEvent, 'agentSessionId' | 'phase'>>()
  )
  const erroredPtyIdsRef = useRef(new Set<string>())

  sessionsRef.current = sessions
  activeSessionIdRef.current = activeSessionId
  publishRef.current = publish

  useEffect(() => {
    let cancelled = false
    const unlisten: UnlistenFn[] = []

    const stopTerminalAttention = subscribeTerminalAttention((payload) => {
      const target = findTarget(sessionsRef.current, payload.ptyId)
      if (
        target === undefined ||
        !isBackgroundTarget(target, activeSessionIdRef.current)
      ) {
        return
      }

      publishRef.current({
        sessionId: target.session.id,
        ptyId: target.pane.ptyId,
        reason: 'terminal-attention',
        title: 'Terminal requested attention',
        ...(payload.body === undefined || payload.body.length === 0
          ? {}
          : { body: payload.body }),
        occurredAt: Date.now(),
      })
    })

    if (!isDesktop()) {
      return stopTerminalAttention
    }

    const lifecycle = listen<AgentLifecycleEvent>(
      'agent-lifecycle',
      (payload) => {
        const target = findTarget(sessionsRef.current, payload.sessionId)
        if (
          target === undefined ||
          (target.pane.agentSessionId !== undefined &&
            target.pane.agentSessionId !== payload.agentSessionId)
        ) {
          return
        }

        const previous = phasesRef.current.get(payload.sessionId)
        phasesRef.current.set(payload.sessionId, {
          agentSessionId: payload.agentSessionId,
          phase: payload.phase,
        })

        if (payload.phase === 'running') {
          erroredPtyIdsRef.current.delete(payload.sessionId)
        }

        if (
          payload.phase !== 'idle' ||
          previous?.phase !== 'running' ||
          previous.agentSessionId !== payload.agentSessionId ||
          erroredPtyIdsRef.current.delete(payload.sessionId) ||
          !isBackgroundTarget(target, activeSessionIdRef.current)
        ) {
          return
        }

        publishRef.current({
          sessionId: target.session.id,
          ptyId: target.pane.ptyId,
          reason: 'turn-complete',
          title: `${agentForPane(target.pane).name} finished`,
          occurredAt: Date.now(),
        })
      }
    )

    const attention = listen<AgentAttentionEvent>(
      'agent-attention',
      (payload) => {
        const target = findTarget(sessionsRef.current, payload.ptyId)
        if (target === undefined) {
          return
        }

        if (payload.reason === 'agent-error') {
          erroredPtyIdsRef.current.add(payload.ptyId)
        }

        if (!isBackgroundTarget(target, activeSessionIdRef.current)) {
          return
        }

        publishRef.current({
          sessionId: target.session.id,
          ptyId: target.pane.ptyId,
          reason: payload.reason,
          title: payload.title,
          ...(payload.body === null ? {} : { body: payload.body }),
          occurredAt: Number(payload.occurredAt),
          ...(payload.dedupeKey === null
            ? {}
            : { dedupeKey: payload.dedupeKey }),
        })
      }
    )

    const registerListeners = async (): Promise<void> => {
      const results = await Promise.allSettled([lifecycle, attention])

      for (const result of results) {
        if (result.status !== 'fulfilled') {
          continue
        }

        if (cancelled) {
          result.value()
        } else {
          unlisten.push(result.value)
        }
      }
    }

    void registerListeners()

    return (): void => {
      cancelled = true
      stopTerminalAttention()
      unlisten.forEach((stop) => stop())
    }
  }, [])
}
