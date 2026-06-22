// cspell:ignore ghostty libghostty
import {
  createGhosttyParserEngine,
  type GhosttyByteParserAdapter,
  type GhosttyParserEngine,
} from './ghosttyParserEngine'
import type { TerminalSize } from '../../types'
import {
  createGhosttyVtByteParserAdapter,
  type GhosttyVtParserDriver,
  type GhosttyVtParserDriverFactory,
  type GhosttyVtParserEffects,
} from './ghosttyVtByteParserAdapter'
import {
  createGhosttyVtRenderSnapshotOutput,
  type GhosttyVtRenderSnapshot,
} from './ghosttyVtRenderSnapshot'
import { readSyncFrameState } from './terminalSyncFrame'
import type { TerminalParserEngineOutput } from './terminalParserEngine'

// No-op render output: holds the surface on its last complete frame.
const EMPTY_RENDER_OUTPUT: TerminalParserEngineOutput = { visibleText: '' }

// Failsafe: render even while "inside" a 2026 frame after this many held
// chunks, so a missed close marker can never freeze the surface.
const MAX_SUPPRESSED_FRAMES = 8

export interface GhosttyVtRenderStateDriver {
  /**
   * Consume raw PTY bytes and update driver-owned terminal/render state.
   *
   * A native libghostty-vt bridge should keep cursor, scrollback, attributes,
   * and OSC effects inside this driver boundary.
   *
   * Any `effects` callbacks, such as `effects.onCwdChange`, must be invoked
   * synchronously before `writeBytes` returns, because the adapter path clears
   * active input immediately after the call and will drop asynchronously
   * dispatched events.
   */
  writeBytes: (bytes: Uint8Array) => void
  readSnapshot: () => GhosttyVtRenderSnapshot
  reset?: () => void
  resize?: (size: TerminalSize) => void
  dispose?: () => void
}

export type GhosttyVtRenderStateDriverFactory = (
  effects: GhosttyVtParserEffects
) => GhosttyVtRenderStateDriver

export const createGhosttyVtRenderStateParserDriverFactory =
  (
    createRenderStateDriver: GhosttyVtRenderStateDriverFactory
  ): GhosttyVtParserDriverFactory =>
  (effects): GhosttyVtParserDriver => {
    const renderStateDriver = createRenderStateDriver(effects)
    let insideSyncFrame = false
    let suppressedFrames = 0

    return {
      writeBytes: (bytes): TerminalParserEngineOutput => {
        renderStateDriver.writeBytes(bytes)

        insideSyncFrame = readSyncFrameState(bytes, insideSyncFrame)

        // Inside a synchronized-output frame the redraw is mid-flight; holding
        // the last complete frame avoids rendering a torn/blank intermediate.
        if (insideSyncFrame && suppressedFrames < MAX_SUPPRESSED_FRAMES) {
          suppressedFrames += 1

          return EMPTY_RENDER_OUTPUT
        }

        suppressedFrames = 0

        return createGhosttyVtRenderSnapshotOutput(
          renderStateDriver.readSnapshot()
        )
      },
      reset: (): void => {
        insideSyncFrame = false
        suppressedFrames = 0
        renderStateDriver.reset?.()
      },
      resize: (size): void => {
        renderStateDriver.resize?.(size)
      },
      dispose: (): void => {
        renderStateDriver.dispose?.()
      },
    }
  }

export const createGhosttyVtRenderStateByteParserAdapter = (
  createRenderStateDriver: GhosttyVtRenderStateDriverFactory
): GhosttyByteParserAdapter =>
  createGhosttyVtByteParserAdapter(
    createGhosttyVtRenderStateParserDriverFactory(createRenderStateDriver)
  )

export const createGhosttyVtRenderStateParserEngine = (
  createRenderStateDriver: GhosttyVtRenderStateDriverFactory
): GhosttyParserEngine =>
  createGhosttyParserEngine({
    byteOnly: true,
    byteParserAdapter: createGhosttyVtRenderStateByteParserAdapter(
      createRenderStateDriver
    ),
  })
