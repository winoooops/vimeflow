import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  PTYSpawnParams,
  PTYSpawnResult,
  PTYWriteParams,
  PTYResizeParams,
  PTYKillParams,
} from '../types'
import type {
  SpawnPtyRequest,
  PtySession,
  PtyDataEvent,
  PtyExitEvent,
  PtyErrorEvent,
} from '../../../bindings'
import type { ITerminalService } from './terminalService'

/**
 * Tauri terminal service — bridges ITerminalService to Tauri IPC commands and events.
 *
 * Commands (invoke): spawn_pty, write_pty, resize_pty, kill_pty
 * Events (listen): pty-data, pty-exit, pty-error
 */
export class TauriTerminalService implements ITerminalService {
  private dataCallbacks: ((sessionId: string, data: string) => void)[] = []
  private exitCallbacks: ((sessionId: string, code: number | null) => void)[] =
    []
  private errorCallbacks: ((sessionId: string, message: string) => void)[] = []

  private unlistenFns: UnlistenFn[] = []
  private initialized = false

  /**
   * Lazily initialize Tauri event listeners on first use.
   * Listeners are shared across all sessions — callbacks filter by sessionId.
   */
  private async ensureListeners(): Promise<void> {
    if (this.initialized) {
      return
    }
    this.initialized = true

    const unlistenData = await listen<PtyDataEvent>('pty-data', (event) => {
      const { sessionId, data } = event.payload
      this.dataCallbacks.forEach((cb) => cb(sessionId, data))
    })

    const unlistenExit = await listen<PtyExitEvent>('pty-exit', (event) => {
      const { sessionId, code } = event.payload
      this.exitCallbacks.forEach((cb) => cb(sessionId, code))
    })

    const unlistenError = await listen<PtyErrorEvent>('pty-error', (event) => {
      const { sessionId, message } = event.payload
      this.errorCallbacks.forEach((cb) => cb(sessionId, message))
    })

    this.unlistenFns.push(unlistenData, unlistenExit, unlistenError)
  }

  async spawn(params: PTYSpawnParams): Promise<PTYSpawnResult> {
    await this.ensureListeners()

    const sessionId = crypto.randomUUID()

    const request: SpawnPtyRequest = {
      sessionId,
      cwd: params.cwd,
      shell: params.shell,
      env: params.env,
      enableAgentBridge: true,
    }

    const response = await invoke<PtySession>('spawn_pty', {
      request,
    })

    return {
      sessionId: response.id,
      pid: response.pid,
      cwd: response.cwd,
    }
  }

  async write(params: PTYWriteParams): Promise<void> {
    await invoke('write_pty', {
      request: {
        sessionId: params.sessionId,
        data: params.data,
      },
    })
  }

  async resize(params: PTYResizeParams): Promise<void> {
    await invoke('resize_pty', {
      request: {
        sessionId: params.sessionId,
        rows: params.rows,
        cols: params.cols,
      },
    })
  }

  async kill(params: PTYKillParams): Promise<void> {
    await invoke('kill_pty', {
      request: {
        sessionId: params.sessionId,
      },
    })
  }

  onData(callback: (sessionId: string, data: string) => void): () => void {
    this.dataCallbacks.push(callback)
    void this.ensureListeners()

    return () => {
      const index = this.dataCallbacks.indexOf(callback)
      if (index > -1) {
        this.dataCallbacks.splice(index, 1)
      }
    }
  }

  onExit(
    callback: (sessionId: string, code: number | null) => void
  ): () => void {
    this.exitCallbacks.push(callback)
    void this.ensureListeners()

    return () => {
      const index = this.exitCallbacks.indexOf(callback)
      if (index > -1) {
        this.exitCallbacks.splice(index, 1)
      }
    }
  }

  onError(callback: (sessionId: string, message: string) => void): () => void {
    this.errorCallbacks.push(callback)
    void this.ensureListeners()

    return () => {
      const index = this.errorCallbacks.indexOf(callback)
      if (index > -1) {
        this.errorCallbacks.splice(index, 1)
      }
    }
  }

  /**
   * Dispose all Tauri event listeners. Call when the service is no longer needed.
   */
  dispose(): void {
    this.unlistenFns.forEach((fn) => fn())
    this.unlistenFns = []
    this.dataCallbacks = []
    this.exitCallbacks = []
    this.errorCallbacks = []
    this.initialized = false
  }
}
