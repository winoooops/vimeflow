import type {
  PTYSpawnParams,
  PTYSpawnResult,
  PTYWriteParams,
  PTYResizeParams,
  PTYKillParams,
} from '../types'
import { isTauri } from '../../../lib/environment'
import { TauriTerminalService } from './tauriTerminalService'

/**
 * Terminal service interface for PTY operations
 */
export interface ITerminalService {
  /**
   * Spawn a new PTY process
   */
  spawn(params: PTYSpawnParams): Promise<PTYSpawnResult>

  /**
   * Write data to PTY stdin
   */
  write(params: PTYWriteParams): Promise<void>

  /**
   * Resize the PTY
   */
  resize(params: PTYResizeParams): Promise<void>

  /**
   * Kill a PTY process
   */
  kill(params: PTYKillParams): Promise<void>

  /**
   * Subscribe to PTY data events
   */
  onData(callback: (sessionId: string, data: string) => void): () => void

  /**
   * Subscribe to PTY exit events
   */
  onExit(
    callback: (sessionId: string, code?: number, signal?: string) => void
  ): () => void

  /**
   * Subscribe to PTY error events
   */
  onError(
    callback: (sessionId: string, message: string, code?: string) => void
  ): () => void
}

/**
 * Mock terminal service for testing
 */
export class MockTerminalService implements ITerminalService {
  private nextPid = 1000
  private nextSessionId = 1
  private sessions = new Map<string, { pid: number; running: boolean }>()
  private dataCallbacks: ((sessionId: string, data: string) => void)[] = []
  private exitCallbacks: ((
    sessionId: string,
    code?: number,
    signal?: string
  ) => void)[] = []
  private errorCallbacks: ((
    sessionId: string,
    message: string,
    code?: string
  ) => void)[] = []

  spawn(params: PTYSpawnParams): Promise<PTYSpawnResult> {
    // Mock implementation - params unused in mock but required by interface
    void params

    const sessionId = `mock-session-${this.nextSessionId++}`
    const pid = this.nextPid++

    this.sessions.set(sessionId, { pid, running: true })

    // Simulate initial prompt
    setTimeout(() => {
      this.emitData(sessionId, `$ `)
    }, 100)

    return Promise.resolve({ sessionId, pid })
  }

  write(params: PTYWriteParams): Promise<void> {
    const session = this.sessions.get(params.sessionId)
    if (!session?.running) {
      return Promise.reject(
        new Error(`Session ${params.sessionId} not found or not running`)
      )
    }

    // Echo input back
    this.emitData(params.sessionId, params.data)

    // Simulate command output for common commands
    if (params.data.trim() === 'echo hello') {
      setTimeout(() => {
        this.emitData(params.sessionId, 'hello\r\n$ ')
      }, 50)
    } else if (params.data.trim() === 'pwd') {
      setTimeout(() => {
        this.emitData(params.sessionId, '/home/user\r\n$ ')
      }, 50)
    } else if (params.data.includes('\r') || params.data.includes('\n')) {
      setTimeout(() => {
        this.emitData(params.sessionId, '$ ')
      }, 50)
    }

    return Promise.resolve()
  }

  resize(params: PTYResizeParams): Promise<void> {
    const session = this.sessions.get(params.sessionId)
    if (!session?.running) {
      return Promise.reject(
        new Error(`Session ${params.sessionId} not found or not running`)
      )
    }

    // Mock resize - no-op
    return Promise.resolve()
  }

  kill(params: PTYKillParams): Promise<void> {
    const session = this.sessions.get(params.sessionId)
    if (!session) {
      return Promise.reject(new Error(`Session ${params.sessionId} not found`))
    }

    session.running = false
    this.emitExit(params.sessionId, 0)
    this.sessions.delete(params.sessionId)

    return Promise.resolve()
  }

  onData(callback: (sessionId: string, data: string) => void): () => void {
    this.dataCallbacks.push(callback)

    return () => {
      const index = this.dataCallbacks.indexOf(callback)
      if (index > -1) {
        this.dataCallbacks.splice(index, 1)
      }
    }
  }

  onExit(
    callback: (sessionId: string, code?: number, signal?: string) => void
  ): () => void {
    this.exitCallbacks.push(callback)

    return () => {
      const index = this.exitCallbacks.indexOf(callback)
      if (index > -1) {
        this.exitCallbacks.splice(index, 1)
      }
    }
  }

  onError(
    callback: (sessionId: string, message: string, code?: string) => void
  ): () => void {
    this.errorCallbacks.push(callback)

    return () => {
      const index = this.errorCallbacks.indexOf(callback)
      if (index > -1) {
        this.errorCallbacks.splice(index, 1)
      }
    }
  }

  // Test helpers
  emitData(sessionId: string, data: string): void {
    this.dataCallbacks.forEach((cb) => cb(sessionId, data))
  }

  emitExit(sessionId: string, code?: number, signal?: string): void {
    this.exitCallbacks.forEach((cb) => cb(sessionId, code, signal))
  }

  emitError(sessionId: string, message: string, code?: string): void {
    this.errorCallbacks.forEach((cb) => cb(sessionId, message, code))
  }

  // Generic emit for testing - dispatches to specific emit methods
  emit(
    event: 'data' | 'exit' | 'error',
    payload: {
      sessionId: string
      data?: string
      code?: number
      signal?: string
      message?: string
    }
  ): void {
    if (event === 'data' && payload.data !== undefined) {
      this.emitData(payload.sessionId, payload.data)
    } else if (event === 'exit') {
      // Allow exit events even when code is undefined (EOF case)
      this.emitExit(payload.sessionId, payload.code, payload.signal)
    } else if (event === 'error' && payload.message !== undefined) {
      this.emitError(
        payload.sessionId,
        payload.message,
        payload.code?.toString()
      )
    }
  }

  // Get active sessions for testing
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys())
  }
}

/**
 * Service factory - returns appropriate service based on environment
 */
export function createTerminalService(): ITerminalService {
  // Dynamic import avoided — isTauri() is synchronous and the service is
  // tree-shaken in browser builds by bundler dead-code elimination.
  if (isTauri()) {
    return new TauriTerminalService()
  }

  return new MockTerminalService()
}
