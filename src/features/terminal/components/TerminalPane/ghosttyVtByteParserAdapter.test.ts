// cspell:ignore ghostty libghostty
import { describe, expect, test, vi } from 'vitest'
import type { GhosttyByteParserAdapterInput } from './ghosttyParserEngine'
import type { TerminalParserEngineOutput } from './terminalParserEngine'
import {
  createGhosttyVtByteParserAdapter,
  type GhosttyVtParserEffects,
  type GhosttyVtParserDriver,
} from './ghosttyVtByteParserAdapter'

const createInput = (
  bytes: Uint8Array,
  emitEvent = vi.fn()
): GhosttyByteParserAdapterInput => ({
  bytes,
  decodedText: 'decoded fallback',
  output: {
    offsetStart: 9,
    byteLen: bytes.length,
    phase: 'live',
  },
  emitEvent,
})

describe('ghosttyVtByteParserAdapter', () => {
  test('passes raw bytes into the VT parser driver', () => {
    const writeBytes = vi.fn(
      (): TerminalParserEngineOutput => ({ visibleText: 'driver output' })
    )

    const adapter = createGhosttyVtByteParserAdapter(() => ({ writeBytes }))
    const bytes = new Uint8Array([0xff, 0xfe])

    expect(adapter.parseBytes(createInput(bytes))).toEqual({
      visibleText: 'driver output',
    })
    expect(writeBytes).toHaveBeenCalledWith(bytes)
  })

  test('routes VT cwd effects into parser events with output context', () => {
    const adapter = createGhosttyVtByteParserAdapter(
      (createdEffects): GhosttyVtParserDriver => ({
        writeBytes: (): TerminalParserEngineOutput => {
          createdEffects.onCwdChange('file://localhost/tmp/from-libghostty')

          return { visibleText: 'rendered' }
        },
      })
    )

    const emitEvent = vi.fn()

    expect(
      adapter.parseBytes(createInput(new Uint8Array([0x67]), emitEvent))
    ).toEqual({
      visibleText: 'rendered',
    })

    expect(emitEvent).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/from-libghostty',
      output: {
        offsetStart: 9,
        byteLen: 1,
        phase: 'live',
      },
    })
  })

  test('ignores VT cwd effects fired outside an active byte write', () => {
    const capturedEffects: {
      onCwdChange?: GhosttyVtParserEffects['onCwdChange']
    } = {}

    const adapter = createGhosttyVtByteParserAdapter(
      (createdEffects): GhosttyVtParserDriver => {
        capturedEffects.onCwdChange = createdEffects.onCwdChange

        return {
          writeBytes: (): TerminalParserEngineOutput => ({ visibleText: '' }),
        }
      }
    )

    const emitEvent = vi.fn()

    adapter.parseBytes(createInput(new Uint8Array([0x67]), emitEvent))

    const onCwdChange = capturedEffects.onCwdChange

    if (!onCwdChange) {
      throw new Error('Expected VT parser effect callback to be captured')
    }

    onCwdChange('file://localhost/tmp/outside-write')

    expect(emitEvent).not.toHaveBeenCalled()
  })

  test('resets and disposes the VT parser driver once', () => {
    const reset = vi.fn()
    const dispose = vi.fn()

    const adapter = createGhosttyVtByteParserAdapter(() => ({
      writeBytes: (): TerminalParserEngineOutput => ({ visibleText: '' }),
      reset,
      dispose,
    }))

    adapter.reset?.()
    adapter.dispose?.()
    adapter.dispose?.()

    expect(reset).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  test('ignores reset after disposal', () => {
    const reset = vi.fn()
    const dispose = vi.fn()

    const adapter = createGhosttyVtByteParserAdapter(() => ({
      writeBytes: (): TerminalParserEngineOutput => ({ visibleText: '' }),
      reset,
      dispose,
    }))

    adapter.dispose?.()
    adapter.reset?.()

    expect(dispose).toHaveBeenCalledOnce()
    expect(reset).not.toHaveBeenCalled()
  })
})
