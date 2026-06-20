// cspell:ignore ghostty
import { ipcRenderer } from 'electron'
import {
  GHOSTTY_RENDER_STATE_CREATE,
  GHOSTTY_RENDER_STATE_DISPOSE,
  GHOSTTY_RENDER_STATE_READ_SNAPSHOT,
  GHOSTTY_RENDER_STATE_RESET,
  GHOSTTY_RENDER_STATE_RESIZE,
  GHOSTTY_RENDER_STATE_STATUS,
  GHOSTTY_RENDER_STATE_WRITE_BYTES,
} from './ghostty-render-state-channels'

export interface GhosttyRenderStateBridgeEffects {
  onCwdChange: (uri: string) => void
}

export interface GhosttyRenderStateBridgeSize {
  cols: number
  rows: number
}

export interface GhosttyRenderStateBridgeSnapshot {
  rows: readonly string[]
  cursor?: {
    rowIndex: number
    columnOffset: number
  }
  cells?: readonly GhosttyRenderStateBridgeSnapshotCell[]
}

export interface GhosttyRenderStateBridgeSnapshotCell {
  row: number
  col: number
  text: string
  width: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  foreground?: string
  background?: string
}

export interface GhosttyRenderStateBridgeDriver {
  writeBytes: (bytes: Uint8Array) => void
  readSnapshot: () => GhosttyRenderStateBridgeSnapshot
  reset: () => void
  resize: (size: GhosttyRenderStateBridgeSize) => void
  dispose: () => void
}

export interface GhosttyRenderStateBridge {
  createDriver: (
    effects: GhosttyRenderStateBridgeEffects
  ) => GhosttyRenderStateBridgeDriver
}

export interface GhosttyRenderStateBridgeLoadResult {
  bridge?: GhosttyRenderStateBridge
  error?: string
}

interface IpcSuccess<T> {
  ok: true
  result: T
}

interface IpcFailure {
  ok: false
  error: string
}

type IpcResult<T> = IpcSuccess<T> | IpcFailure

interface CreateResult {
  driverId: string
}

interface WriteBytesResult {
  events: readonly GhosttyRenderStateEvent[]
}

interface GhosttyRenderStateEvent {
  type: 'cwd'
  uri: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isIpcResult = <T>(value: unknown): value is IpcResult<T> =>
  isRecord(value) &&
  typeof value.ok === 'boolean' &&
  (value.ok || typeof value.error === 'string')

const readIpcResult = <T>(channel: string, payload?: unknown): T => {
  const result = ipcRenderer.sendSync(channel, payload) as unknown

  if (!isIpcResult<T>(result)) {
    throw new Error(`Ghostty native render-state IPC result is invalid`)
  }

  if (!result.ok) {
    throw new Error(result.error)
  }

  return result.result
}

const applyEvents = (
  events: readonly GhosttyRenderStateEvent[],
  effects: GhosttyRenderStateBridgeEffects
): void => {
  events.forEach((event) => {
    effects.onCwdChange(event.uri)
  })
}

export const createGhosttyRenderStateBridgeFromIpc =
  (): GhosttyRenderStateBridge => ({
    createDriver: (effects): GhosttyRenderStateBridgeDriver => {
      const { driverId } = readIpcResult<CreateResult>(
        GHOSTTY_RENDER_STATE_CREATE
      )
      let disposed = false

      const assertActive = (): void => {
        if (disposed) {
          throw new Error(
            'Ghostty native render-state driver has been disposed'
          )
        }
      }

      return {
        writeBytes: (bytes): void => {
          assertActive()

          const result = readIpcResult<WriteBytesResult>(
            GHOSTTY_RENDER_STATE_WRITE_BYTES,
            {
              driverId,
              bytes,
            }
          )
          applyEvents(result.events, effects)
        },
        readSnapshot: (): GhosttyRenderStateBridgeSnapshot => {
          assertActive()

          return readIpcResult<GhosttyRenderStateBridgeSnapshot>(
            GHOSTTY_RENDER_STATE_READ_SNAPSHOT,
            { driverId }
          )
        },
        reset: (): void => {
          assertActive()
          readIpcResult<null>(GHOSTTY_RENDER_STATE_RESET, { driverId })
        },
        resize: (size): void => {
          assertActive()
          readIpcResult<null>(GHOSTTY_RENDER_STATE_RESIZE, {
            driverId,
            size,
          })
        },
        dispose: (): void => {
          if (disposed) {
            return
          }

          disposed = true
          readIpcResult<null>(GHOSTTY_RENDER_STATE_DISPOSE, { driverId })
        },
      }
    },
  })

export const loadOptionalGhosttyRenderStateBridge =
  (): GhosttyRenderStateBridgeLoadResult => {
    try {
      readIpcResult<null>(GHOSTTY_RENDER_STATE_STATUS)

      return {
        bridge: createGhosttyRenderStateBridgeFromIpc(),
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
