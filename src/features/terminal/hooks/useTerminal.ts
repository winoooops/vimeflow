import { useEffect, useState, useCallback, useRef } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { ITerminalService } from '../services/terminalService'
import type { TerminalSession } from '../types'

export interface UseTerminalOptions {
  /**
   * xterm.js Terminal instance
   */
  terminal: Terminal | null

  /**
   * Terminal service (MockTerminalService or TauriTerminalService)
   */
  service: ITerminalService

  /**
   * Current working directory for the shell
   */
  cwd: string

  /**
   * Optional shell path (defaults to system shell)
   */
  shell?: string

  /**
   * Optional environment variables
   */
  env?: Record<string, string>

  // sessionId removed - reconnection feature not fully implemented yet
  // Will be added back when backend supports persistent sessions
}

export interface UseTerminalReturn {
  /**
   * Current terminal session (null if not spawned)
   */
  session: TerminalSession | null

  /**
   * Terminal status
   */
  status: 'idle' | 'running' | 'exited' | 'error'

  /**
   * Error message (if status === 'error')
   */
  error: string | null

  /**
   * Resize the PTY
   */
  resize: (cols: number, rows: number) => void
}

/**
 * useTerminal hook - manages PTY lifecycle and xterm integration
 *
 * Features:
 * - Spawns PTY on mount
 * - Listens to PTY data events and writes to xterm
 * - Handles keyboard input from xterm
 * - Handles PTY exit and error events
 * - Cleans up on unmount
 */
export const useTerminal = (options: UseTerminalOptions): UseTerminalReturn => {
  const { terminal, service, cwd, shell, env } = options

  const [session, setSession] = useState<TerminalSession | null>(null)

  const [status, setStatus] = useState<'idle' | 'running' | 'exited' | 'error'>(
    'idle'
  )
  const [error, setError] = useState<string | null>(null)

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true)

  // Track whether this hook spawned the session
  const didSpawnSessionRef = useRef(false)

  // Track unmount only (not dependency changes)
  useEffect(
    () => (): void => {
      isMountedRef.current = false
    },
    []
  )

  // Spawn PTY on mount
  useEffect(() => {
    if (!terminal) {
      return
    }

    let currentSession: TerminalSession | null = null

    const initializeSession = async (): Promise<void> => {
      // Spawn a new PTY process
      try {
        const result = await service.spawn({
          shell:
            shell ??
            (typeof process !== 'undefined' ? process.env.SHELL : undefined) ??
            '/bin/bash',
          cwd,
          env: env ?? {},
        })

        if (!isMountedRef.current) {
          // Component unmounted during spawn, kill the session
          await service.kill({ sessionId: result.sessionId })

          return
        }

        didSpawnSessionRef.current = true // We spawned this session

        // Convert result to TerminalSession
        const newSession: TerminalSession = {
          id: result.sessionId,
          pid: result.pid,
          name: `Session ${result.sessionId}`,
          cwd,
          shell:
            shell ??
            (typeof process !== 'undefined' ? process.env.SHELL : undefined) ??
            '/bin/bash',
          status: 'running',
          createdAt: new Date(),
          env: {},
          lastActivityAt: new Date(),
        }

        currentSession = newSession
        setSession(newSession)
        setStatus('running')
        setError(null)
      } catch (err) {
        if (!isMountedRef.current) {
          return
        }

        const errorMessage =
          err instanceof Error ? err.message : 'Failed to spawn PTY'
        setStatus('error')
        setError(errorMessage)
      }
    }

    void initializeSession()

    // Cleanup session when dependencies change or on unmount
    return (): void => {
      const cleanupSession = async (): Promise<void> => {
        // Only kill sessions we spawned, not reconnected sessions
        if (currentSession && didSpawnSessionRef.current) {
          try {
            await service.kill({ sessionId: currentSession.id })
          } catch {
            // Ignore errors on cleanup - session may already be killed
          }
        }
      }
      void cleanupSession()
    }
  }, [terminal, service, cwd, shell, env])

  // Listen to PTY data events
  useEffect(() => {
    if (!terminal || !session) {
      return
    }

    const handleData = (eventSessionId: string, data: string): void => {
      if (eventSessionId === session.id && isMountedRef.current) {
        terminal.write(data)
      }
    }

    const handleExit = (eventSessionId: string, code: number): void => {
      if (eventSessionId === session.id && isMountedRef.current) {
        setStatus('exited')
        terminal.write(`\r\n[Process exited with code ${code}]\r\n`)
      }
    }

    const handleError = (eventSessionId: string, message: string): void => {
      if (eventSessionId === session.id && isMountedRef.current) {
        setStatus('error')
        setError(message)
        terminal.write(`\r\n[Error: ${message}]\r\n`)
      }
    }

    const unsubscribeData = service.onData(handleData)
    const unsubscribeExit = service.onExit(handleExit)
    const unsubscribeError = service.onError(handleError)

    return (): void => {
      unsubscribeData()
      unsubscribeExit()
      unsubscribeError()
    }
  }, [terminal, session, service])

  // Handle keyboard input from xterm
  useEffect(() => {
    if (!terminal || !session) {
      return
    }

    const handleInput = (data: string): void => {
      if (isMountedRef.current) {
        void service.write({ sessionId: session.id, data })
      }
    }

    const disposable = terminal.onData(handleInput)

    return (): void => {
      disposable.dispose()
    }
  }, [terminal, session, service])

  // Resize function
  const resize = useCallback(
    (cols: number, rows: number): void => {
      if (session) {
        void service.resize({ sessionId: session.id, cols, rows })
      }
    },
    [session, service]
  )

  return {
    session,
    status,
    error,
    resize,
  }
}
