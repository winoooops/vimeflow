import type {
  PTYSpawnParams,
  PTYSpawnResult,
  PTYWriteParams,
  PTYResizeParams,
  PTYKillParams,
} from '../types'

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
  private sessions = new Map<
    string,
    { pid: number; running: boolean; inputBuffer: string }
  >()
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

    this.sessions.set(sessionId, { pid, running: true, inputBuffer: '' })

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

    // Process each character individually to handle pasted text and buffered input
    for (const ch of params.data) {
      this.processChar(params.sessionId, session, ch)
    }

    return Promise.resolve()
  }

  private processChar(
    sessionId: string,
    session: { pid: number; running: boolean; inputBuffer: string },
    ch: string
  ): void {
    // Backspace/delete — erase last character from buffer
    if (ch === '\x7f' || ch === '\b') {
      if (session.inputBuffer.length > 0) {
        session.inputBuffer = session.inputBuffer.slice(0, -1)
        this.emitData(sessionId, '\b \b')
      }

      return
    }

    // Enter — execute buffered command
    if (ch === '\r' || ch === '\n') {
      this.emitData(sessionId, '\r\n')
      this.executeCommand(sessionId, session)

      return
    }

    // Regular character — echo and append to buffer
    session.inputBuffer = session.inputBuffer + ch
    this.emitData(sessionId, ch)
  }

  private executeCommand(
    sessionId: string,
    session: { pid: number; running: boolean; inputBuffer: string }
  ): void {
    const cmd = session.inputBuffer.trim()
    session.inputBuffer = ''

    if (cmd === 'echo hello') {
      setTimeout(() => {
        this.emitData(sessionId, 'hello\r\n$ ')
      }, 50)
    } else if (cmd === 'pwd') {
      setTimeout(() => {
        this.emitData(sessionId, '/home/user\r\n$ ')
      }, 50)
    } else if (cmd === 'help') {
      setTimeout(() => {
        this.emitData(
          sessionId,
          'Mock terminal — commands: echo hello, pwd, help, clear\r\n$ '
        )
      }, 50)
    } else if (cmd === 'clear') {
      this.emitData(sessionId, '\x1b[2J\x1b[H$ ')
    } else if (cmd.length > 0) {
      setTimeout(() => {
        this.emitData(sessionId, `mock: command not found: ${cmd}\r\n$ `)
      }, 50)
    } else {
      setTimeout(() => {
        this.emitData(sessionId, '$ ')
      }, 50)
    }
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
  // For now, always return mock service
  // TODO: Replace with TauriTerminalService when Tauri backend is ready
  return new MockTerminalService()
}
