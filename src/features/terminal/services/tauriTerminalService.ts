import { invoke, listen, type UnlistenFn } from '../../../lib/backend'
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
  SessionList,
  SetActiveSessionRequest,
  ReorderSessionsRequest,
  UpdateSessionCwdRequest,
} from '../../../bindings'
import type { ITerminalService } from './terminalService'

/**
 * Tauri terminal service — bridges ITerminalService to Tauri IPC commands and events.
 *
 * Commands (invoke): spawn_pty, write_pty, resize_pty, kill_pty
 * Events (listen): pty-data, pty-exit, pty-error
 */
export class TauriTerminalService implements ITerminalService {
  private dataCallbacks: ((
    sessionId: string,
    data: string,
    offsetStart: number,
    byteLen: number
  ) => void)[] = []
  private exitCallbacks: ((sessionId: string, code: number | null) => void)[] =
    []
  private errorCallbacks: ((sessionId: string, message: string) => void)[] = []

  private unlistenFns: UnlistenFn[] = []
  private initPromise: Promise<void> | null = null

  /**
   * Lazily initialize Tauri event listeners on first use.
   * Listeners are shared across all sessions — callbacks filter by sessionId.
   *
   * Uses promise memoization: the first caller drives initialization; concurrent
   * callers await the same promise. This guarantees that any caller awaiting
   * ensureListeners() resumes only after listen() has fully attached, avoiding
   * the previous race where `initialized = true` was set synchronously and let
   * a second caller through before the underlying listener was wired up.
   */
  private ensureListeners(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = (async (): Promise<void> => {
      const unlistenData = await listen<PtyDataEvent>('pty-data', (payload) => {
        const { sessionId, data, offsetStart, byteLen } = payload

        // PtyDataEvent.offset_start and .byte_len are u64 — bindings may emit
        // as bigint or number. Coerce to number; safe up to 2^53 = ~9 PB per
        // session.
        const offset =
          typeof offsetStart === 'bigint' ? Number(offsetStart) : offsetStart
        const len = typeof byteLen === 'bigint' ? Number(byteLen) : byteLen
        this.dataCallbacks.forEach((cb) => cb(sessionId, data, offset, len))
      })

      const unlistenExit = await listen<PtyExitEvent>('pty-exit', (payload) => {
        const { sessionId, code } = payload
        this.exitCallbacks.forEach((cb) => cb(sessionId, code))
      })

      const unlistenError = await listen<PtyErrorEvent>(
        'pty-error',
        (payload) => {
          const { sessionId, message } = payload
          this.errorCallbacks.forEach((cb) => cb(sessionId, message))
        }
      )

      this.unlistenFns.push(unlistenData, unlistenExit, unlistenError)
    })()

    return this.initPromise
  }

  async spawn(params: PTYSpawnParams): Promise<PTYSpawnResult> {
    await this.ensureListeners()

    const sessionId = crypto.randomUUID()

    // Round 8, Finding 3 (claude MEDIUM): forward the caller's intent
    // instead of hardcoding `true`. Previously every spawn created a
    // `.vimeflow/sessions/<uuid>/` tree in the cwd — including `/tmp`, the
    // user's home, third-party project roots — which showed up in
    // `git status` and was excluded from Vite's HMR watch list as a
    // workaround. The agent statusline IS the product when the workspace
    // UI explicitly spawns a tab (useSessionManager passes `true`); other
    // callers default to `false` so ad-hoc spawns don't pollute arbitrary
    // working directories.
    const request: SpawnPtyRequest = {
      sessionId,
      cwd: params.cwd,
      shell: params.shell,
      env: params.env,
      enableAgentBridge: params.enableAgentBridge ?? false,
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

  async onData(
    callback: (
      sessionId: string,
      data: string,
      offsetStart: number,
      byteLen: number
    ) => void
  ): Promise<() => void> {
    // Push the callback BEFORE awaiting so that any callbacks already queued
    // during a concurrent ensureListeners() in-flight don't race with the listen()
    // attachment — once the listener fires, it iterates this.dataCallbacks.
    this.dataCallbacks.push(callback)

    // CRITICAL: await ensureListeners so the underlying tauri.listen('pty-data', ...)
    // is attached before the caller proceeds. The restore orchestrator depends on
    // being able to await this method — without it, PTY events emitted between this
    // call returning and listen() resolving go to nobody (irrecoverable lost bytes).
    await this.ensureListeners()

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
    this.initPromise = null
  }

  async listSessions(): Promise<SessionList> {
    return invoke<SessionList>('list_sessions')
  }

  async setActiveSession(id: string): Promise<void> {
    await invoke('set_active_session', {
      request: { id } satisfies SetActiveSessionRequest,
    })
  }

  async reorderSessions(ids: string[]): Promise<void> {
    await invoke('reorder_sessions', {
      request: { ids } satisfies ReorderSessionsRequest,
    })
  }

  async updateSessionCwd(id: string, cwd: string): Promise<void> {
    await invoke('update_session_cwd', {
      request: { id, cwd } satisfies UpdateSessionCwdRequest,
    })
  }
}
