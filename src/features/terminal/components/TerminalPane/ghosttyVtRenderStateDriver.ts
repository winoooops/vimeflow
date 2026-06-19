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
import type { TerminalParserEngineOutput } from './terminalParserEngine'

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

    return {
      writeBytes: (bytes): TerminalParserEngineOutput => {
        renderStateDriver.writeBytes(bytes)

        return createGhosttyVtRenderSnapshotOutput(
          renderStateDriver.readSnapshot()
        )
      },
      reset: (): void => {
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
