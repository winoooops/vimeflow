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
  type GhosttyVtRenderScrollback,
} from './ghosttyVtRenderSnapshot'
import {
  createSyncFrameParserState,
  readSyncFrameState,
} from './terminalSyncFrame'
import type { TerminalParserEngineOutput } from './terminalParserEngine'

// No-op render output: byte feed is synchronous, but the actual render is
// produced by flushOutput (coalesced to one per animation frame).
const EMPTY_RENDER_OUTPUT: TerminalParserEngineOutput = { visibleText: '' }

// Failsafe: flush even while "inside" a 2026 frame after this many held
// flushes, so a missed close marker can never freeze the surface.
const MAX_HELD_FLUSHES = 8

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
  // Lazily fetch the styled scrollback above the viewport (called on scroll-up,
  // not per frame). Optional: non-native drivers may not support it.
  readScrollback?: () => GhosttyVtRenderScrollback
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
    let syncFrameState = createSyncFrameParserState()
    let heldFlushes = 0
    let dirty = false

    return {
      writeBytes: (bytes): TerminalParserEngineOutput => {
        // Feed bytes + track 2026 synchronously (effects fire here, per chunk).
        // Defer the snapshot read+render to flushOutput so a burst of redraw
        // chunks coalesces into a single render per animation frame.
        renderStateDriver.writeBytes(bytes)
        syncFrameState = readSyncFrameState(bytes, syncFrameState)
        dirty = true

        return EMPTY_RENDER_OUTPUT
      },
      flushOutput: (): TerminalParserEngineOutput | null => {
        if (!dirty) {
          return null
        }

        // Inside an open synchronized-output frame the redraw is mid-flight;
        // hold the last complete frame instead of painting a torn intermediate.
        if (syncFrameState.insideFrame && heldFlushes < MAX_HELD_FLUSHES) {
          heldFlushes += 1

          return null
        }

        heldFlushes = 0
        dirty = false

        return createGhosttyVtRenderSnapshotOutput(
          renderStateDriver.readSnapshot()
        )
      },
      hasPendingOutput: (): boolean => dirty,
      reset: (): void => {
        syncFrameState = createSyncFrameParserState()
        heldFlushes = 0
        dirty = false
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
