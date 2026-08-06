import { useEffect, useRef } from 'react'
import type { AgentLifecycleEvent, AgentNotificationEvent } from '@/bindings'
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

const TURN_COMPLETE_SETTLE_DELAY_MS = 750

const SEMANTIC_AGENT_TYPES = new Set<Pane['agentType']>([
  'claude-code',
  'codex',
  'kimi',
  'opencode',
])

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
  sessionsRef.current = sessions
  activeSessionIdRef.current = activeSessionId
  publishRef.current = publish

  useEffect(() => {
    let cancelled = false
    const unlisten: UnlistenFn[] = []

    // Per-PTY settle timers for confirmed turn-complete events from normalized
    // agent notifications or the legacy lifecycle fallback.
    const completionTimers = new Map<string, ReturnType<typeof setTimeout>>()

    const cancelTurnComplete = (ptyId: string): void => {
      const timer = completionTimers.get(ptyId)
      if (timer === undefined) {
        return
      }

      clearTimeout(timer)
      completionTimers.delete(ptyId)
    }

    const scheduleTurnComplete = (
      ptyId: string,
      candidate: {
        readonly agentSessionId: string | null
        readonly title: string
        readonly body?: string
        readonly occurredAt: number
        readonly dedupeKey?: string
        readonly requireLifecycle: boolean
      }
    ): void => {
      const scheduledTarget = findTarget(sessionsRef.current, ptyId)
      if (
        scheduledTarget === undefined ||
        !isBackgroundTarget(scheduledTarget, activeSessionIdRef.current)
      ) {
        return
      }

      cancelTurnComplete(ptyId)

      const timer = setTimeout(() => {
        completionTimers.delete(ptyId)
        const phase = phasesRef.current.get(ptyId)
        const target = findTarget(sessionsRef.current, ptyId)
        if (
          (candidate.requireLifecycle &&
            (phase?.phase !== 'idle' ||
              phase.agentSessionId !== candidate.agentSessionId)) ||
          target === undefined ||
          !isBackgroundTarget(target, activeSessionIdRef.current)
        ) {
          return
        }

        publishRef.current({
          sessionId: target.session.id,
          ptyId: target.pane.ptyId,
          reason: 'turn-complete',
          title: candidate.title,
          ...(candidate.body === undefined ? {} : { body: candidate.body }),
          occurredAt: candidate.occurredAt,
          ...(candidate.dedupeKey === undefined
            ? {}
            : { dedupeKey: candidate.dedupeKey }),
        })
      }, TURN_COMPLETE_SETTLE_DELAY_MS)

      completionTimers.set(ptyId, timer)
    }

    const stopTerminalAttention = subscribeTerminalAttention((payload) => {
      const target = findTarget(sessionsRef.current, payload.ptyId)
      if (
        target === undefined ||
        !isBackgroundTarget(target, activeSessionIdRef.current) ||
        SEMANTIC_AGENT_TYPES.has(target.pane.agentType)
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

    const cleanupTimers = (): void => {
      completionTimers.forEach((timer) => clearTimeout(timer))
      completionTimers.clear()
    }

    if (!isDesktop()) {
      return (): void => {
        stopTerminalAttention()
        cleanupTimers()
      }
    }

    const lifecycle = listen<AgentLifecycleEvent>(
      'agent-lifecycle',
      (payload) => {
        const target = findTarget(sessionsRef.current, payload.sessionId)
        if (
          target === undefined ||
          SEMANTIC_AGENT_TYPES.has(target.pane.agentType) ||
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
          cancelTurnComplete(payload.sessionId)
        }

        if (
          payload.phase !== 'idle' ||
          previous?.phase !== 'running' ||
          previous.agentSessionId !== payload.agentSessionId
        ) {
          return
        }

        scheduleTurnComplete(payload.sessionId, {
          agentSessionId: payload.agentSessionId,
          title: `${agentForPane(target.pane).name} finished`,
          occurredAt: Date.now(),
          requireLifecycle: true,
        })
      }
    )

    const notification = listen<AgentNotificationEvent>(
      'agent-notification',
      (payload) => {
        const target = findTarget(sessionsRef.current, payload.ptyId)
        if (target === undefined) {
          return
        }

        if (payload.reason === 'turn-complete') {
          scheduleTurnComplete(payload.ptyId, {
            agentSessionId: payload.agentSessionId,
            title: payload.title,
            ...(payload.body === null ? {} : { body: payload.body }),
            occurredAt: Number(payload.occurredAt),
            ...(payload.dedupeKey === null
              ? {}
              : { dedupeKey: payload.dedupeKey }),
            requireLifecycle: false,
          })

          return
        }

        if (payload.reason === 'agent-error') {
          cancelTurnComplete(payload.ptyId)
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
      const results = await Promise.allSettled([lifecycle, notification])

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
      cleanupTimers()
    }
  }, [])
}
