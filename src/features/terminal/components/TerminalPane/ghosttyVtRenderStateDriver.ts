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
  encodeScrollback,
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

// The live viewport sits below the history region, so follow the bottom on each
// frame (the surface's sticky-scroll freeze still wins while the user reads up).
const pinViewportToBottom = (
  output: TerminalParserEngineOutput
): TerminalParserEngineOutput =>
  output.displayDelta
    ? {
        ...output,
        displayDelta: { ...output.displayDelta, pinToBottom: true },
      }
    : output

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
    // History renders into the surface's SEPARATE static region, rebuilt only
    // when it changes — so return viewport-only output every frame and attach
    // the encoded scrollback (a sync-IPC fetch) ONLY when the native row count
    // changes. This keeps the per-frame work viewport-sized; the heavy history
    // DOM is not re-parsed or re-rendered while the agent redraws the viewport.
    let cachedScrollbackRowCount = -1

    const attachScrollback = (
      snapshot: GhosttyVtRenderSnapshot,
      output: TerminalParserEngineOutput
    ): TerminalParserEngineOutput => {
      // Non-native drivers have no scrollback region: leave the output alone.
      if (!renderStateDriver.readScrollback) {
        return output
      }

      const count = snapshot.isAltScreen
        ? 0
        : (snapshot.scrollbackRowCount ?? 0)
      const viewport = count > 0 ? pinViewportToBottom(output) : output

      // Unchanged count → keep the surface's current static region (no field).
      if (count === cachedScrollbackRowCount) {
        return viewport
      }

      if (count <= 0) {
        cachedScrollbackRowCount = count

        return { ...viewport, scrollback: null }
      }

      const scrollback = renderStateDriver.readScrollback()
      if (scrollback.rows.length === 0) {
        return viewport
      }

      cachedScrollbackRowCount = count

      return {
        ...viewport,
        scrollback: encodeScrollback(scrollback),
      }
    }

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

        const snapshot = renderStateDriver.readSnapshot()

        return attachScrollback(
          snapshot,
          createGhosttyVtRenderSnapshotOutput(snapshot)
        )
      },
      hasPendingOutput: (): boolean => dirty,
      reset: (): void => {
        syncFrameState = createSyncFrameParserState()
        heldFlushes = 0
        dirty = false
        cachedScrollbackRowCount = -1
        renderStateDriver.reset?.()
      },
      resize: (size): void => {
        cachedScrollbackRowCount = -1
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
