// cspell:ignore ghostty libghostty
import { describe, expect, test, vi } from 'vitest'
import type { GhosttyByteParserAdapterInput } from './ghosttyParserEngine'
import { createGhosttyParserEngine } from './ghosttyParserEngine'
import {
  createGhosttyVtRenderStateByteParserAdapter,
  createGhosttyVtRenderStateParserEngine,
  type GhosttyVtRenderStateDriver,
} from './ghosttyVtRenderStateDriver'
import type { GhosttyVtRenderSnapshot } from './ghosttyVtRenderSnapshot'

const createInput = (
  bytes: Uint8Array,
  emitEvent = vi.fn()
): GhosttyByteParserAdapterInput => ({
  bytes,
  decodedText: 'decoded fallback',
  output: {
    offsetStart: 13,
    byteLen: bytes.length,
    phase: 'live',
  },
  emitEvent,
})

describe('ghosttyVtRenderStateDriver', () => {
  test('bridges driver-owned render state into replace snapshot output', () => {
    const writeBytes = vi.fn()

    const readSnapshot = vi.fn(() => ({
      rows: ['prompt', 'output'],
      cursor: {
        rowIndex: 1,
        columnOffset: 3,
      },
    }))

    const adapter = createGhosttyVtRenderStateByteParserAdapter(() => ({
      writeBytes,
      readSnapshot,
    }))

    const bytes = new Uint8Array([0x70, 0x74, 0x79])

    expect(adapter.parseBytes(createInput(bytes))).toEqual({
      visibleText: 'prompt\noutput',
      displayDelta: {
        operations: [
          {
            type: 'replace',
            text: 'prompt\noutput',
            cursorOffset: 10,
          },
        ],
      },
    })
    expect(writeBytes).toHaveBeenCalledWith(bytes)
    expect(readSnapshot).toHaveBeenCalledOnce()
  })

  test('can be injected behind the Ghostty parser engine byte path', () => {
    const writeBytes = vi.fn()

    const byteParserAdapter = createGhosttyVtRenderStateByteParserAdapter(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes,
        readSnapshot: () => ({
          rows: ['vt prompt'],
          cursor: {
            rowIndex: 0,
            columnOffset: 2,
          },
        }),
      })
    )

    const parserEngine = createGhosttyParserEngine({ byteParserAdapter })
    const bytes = new Uint8Array([0xff, 0xfe])

    expect(
      parserEngine.parseInput({
        inputMode: 'bytes',
        bytes,
        text: 'lossy fallback',
        output: null,
      })
    ).toEqual({
      visibleText: 'vt prompt',
      displayDelta: {
        operations: [
          {
            type: 'replace',
            text: 'vt prompt',
            cursorOffset: 2,
          },
        ],
      },
    })
    expect(writeBytes).toHaveBeenCalledWith(bytes)
  })

  test('keeps cwd effects on the parser event path', () => {
    const adapter = createGhosttyVtRenderStateByteParserAdapter((effects) => ({
      writeBytes: (): void => {
        effects.onCwdChange('file://localhost/tmp/render-state')
      },
      readSnapshot: (): GhosttyVtRenderSnapshot => ({
        rows: ['rendered'],
      }),
    }))

    const emitEvent = vi.fn()

    adapter.parseBytes(createInput(new Uint8Array([0x1b]), emitEvent))

    expect(emitEvent).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/render-state',
      output: {
        offsetStart: 13,
        byteLen: 1,
        phase: 'live',
      },
    })
  })

  test('forwards lifecycle and size changes to the render-state driver', () => {
    const reset = vi.fn()
    const resize = vi.fn()
    const dispose = vi.fn()

    const adapter = createGhosttyVtRenderStateByteParserAdapter(() => ({
      writeBytes: vi.fn(),
      readSnapshot: (): GhosttyVtRenderSnapshot => ({
        rows: [],
      }),
      reset,
      resize,
      dispose,
    }))

    adapter.resize?.({ cols: 132, rows: 43 })
    adapter.reset?.()
    adapter.dispose?.()
    adapter.dispose?.()
    adapter.resize?.({ cols: 80, rows: 24 })
    adapter.reset?.()

    expect(resize).toHaveBeenCalledOnce()
    expect(resize).toHaveBeenCalledWith({ cols: 132, rows: 43 })
    expect(reset).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  test('holds the last frame while inside a synchronized-output (2026) frame', () => {
    let snapshotReads = 0

    const adapter = createGhosttyVtRenderStateByteParserAdapter(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: (): GhosttyVtRenderSnapshot => {
          snapshotReads += 1

          return {
            rows: ['composer'],
            cursor: { rowIndex: 0, columnOffset: 2 },
          }
        },
      })
    )
    const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

    // chunk ends inside an open 2026 frame (clear sent, redraw pending)
    expect(
      adapter.parseBytes(createInput(encode('\x1b[?2026h\x1b[2J partial')))
    ).toEqual({ visibleText: '' })
    expect(snapshotReads).toBe(0)

    // closing chunk completes the frame -> full render
    expect(
      adapter.parseBytes(createInput(encode('redraw\x1b[?2026l')))
    ).toEqual({
      visibleText: 'composer',
      displayDelta: {
        operations: [{ type: 'replace', text: 'composer', cursorOffset: 2 }],
      },
    })
    expect(snapshotReads).toBe(1)
  })

  test('failsafe renders if a 2026 frame never closes', () => {
    const adapter = createGhosttyVtRenderStateByteParserAdapter(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: (): GhosttyVtRenderSnapshot => ({
          rows: ['held'],
          cursor: { rowIndex: 0, columnOffset: 0 },
        }),
      })
    )
    const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

    let output = adapter.parseBytes(createInput(encode('\x1b[?2026h open')))
    // 8 held chunks, then the failsafe forces a render on the 9th
    for (let index = 0; index < 8; index += 1) {
      output = adapter.parseBytes(createInput(encode('still drawing')))
    }

    expect(output).not.toEqual({ visibleText: '' })
    expect(output.visibleText).toBe('held')
  })

  test('rejects text input instead of falling back to the text parser', () => {
    const writeBytes = vi.fn()
    const reset = vi.fn()

    const engine = createGhosttyVtRenderStateParserEngine(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes,
        readSnapshot: () => ({
          rows: ['vt text path'],
          cursor: { rowIndex: 0, columnOffset: 4 },
        }),
        reset,
      })
    )

    expect(() =>
      engine.parseInput({
        inputMode: 'text',
        text: 'hello',
        output: null,
      })
    ).toThrow(
      'Ghostty VT render-state parser engine does not accept text input; use byte output chunks'
    )
    expect(writeBytes).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
  })
})
