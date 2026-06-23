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
  test('feeds bytes on parseBytes and renders the snapshot only on flushOutput', () => {
    const writeBytes = vi.fn()

    const readSnapshot = vi.fn(() => ({
      rows: ['prompt', 'output'],
      cursor: {
        rowIndex: 1,
        columnOffset: 3,
      },
    }))

    const adapter = createGhosttyVtRenderStateByteParserAdapter(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes,
        readSnapshot,
      })
    )

    const bytes = new Uint8Array([0x70, 0x74, 0x79])

    // parseBytes feeds synchronously and defers rendering
    expect(adapter.parseBytes(createInput(bytes))).toEqual({ visibleText: '' })
    expect(writeBytes).toHaveBeenCalledWith(bytes)
    expect(readSnapshot).not.toHaveBeenCalled()

    // flushOutput reads the settled snapshot once and renders it
    expect(adapter.flushOutput?.()).toEqual({
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
    expect(readSnapshot).toHaveBeenCalledOnce()
  })

  test('coalesces multiple chunks into one flushed render of the latest state', () => {
    let snapshotReads = 0
    const writeBytes = vi.fn()

    const adapter = createGhosttyVtRenderStateByteParserAdapter(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes,
        readSnapshot: (): GhosttyVtRenderSnapshot => {
          snapshotReads += 1

          return {
            rows: [`frame${snapshotReads}`],
            cursor: { rowIndex: 0, columnOffset: 0 },
          }
        },
      })
    )
    const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

    // three chunks fed without an intervening flush -> no snapshot reads
    adapter.parseBytes(createInput(encode('a')))
    adapter.parseBytes(createInput(encode('b')))
    adapter.parseBytes(createInput(encode('c')))
    expect(writeBytes).toHaveBeenCalledTimes(3)
    expect(snapshotReads).toBe(0)

    // one flush -> one snapshot read
    expect(adapter.flushOutput?.()?.visibleText).toBe('frame1')
    expect(snapshotReads).toBe(1)

    // a flush with no new bytes paints nothing
    expect(adapter.flushOutput?.()).toBeNull()
    expect(snapshotReads).toBe(1)
  })

  test('prepends scrollback above the viewport when the snapshot reports it', () => {
    const readScrollback = vi.fn(() => ({
      rows: ['history line'],
      cells: [],
    }))

    const adapter = createGhosttyVtRenderStateByteParserAdapter(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: (): GhosttyVtRenderSnapshot => ({
          rows: ['prompt'],
          cursor: { rowIndex: 0, columnOffset: 2 },
          scrollbackRowCount: 1,
        }),
        readScrollback,
      })
    )

    adapter.parseBytes(createInput(new Uint8Array([0x61])))
    const output = adapter.flushOutput?.()

    expect(output?.visibleText).toBe('history line\nprompt')
    expect(output?.displayDelta?.operations[0]).toEqual({
      type: 'replace',
      text: 'history line\nprompt',
      // 12 (scrollback visible) + 1 (newline) + 2 (viewport cursor) = 15
      cursorOffset: 15,
    })
    expect(readScrollback).toHaveBeenCalledOnce()
  })

  test('re-fetches scrollback only when the row count changes', () => {
    let scrollbackRowCount = 1
    const readScrollback = vi.fn(() => ({ rows: ['h'], cells: [] }))

    const adapter = createGhosttyVtRenderStateByteParserAdapter(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: (): GhosttyVtRenderSnapshot => ({
          rows: ['p'],
          cursor: { rowIndex: 0, columnOffset: 0 },
          scrollbackRowCount,
        }),
        readScrollback,
      })
    )

    adapter.parseBytes(createInput(new Uint8Array([0x61])))
    adapter.flushOutput?.()
    adapter.parseBytes(createInput(new Uint8Array([0x62])))
    adapter.flushOutput?.()
    expect(readScrollback).toHaveBeenCalledOnce() // count unchanged → cached

    scrollbackRowCount = 2
    adapter.parseBytes(createInput(new Uint8Array([0x63])))
    adapter.flushOutput?.()
    expect(readScrollback).toHaveBeenCalledTimes(2) // count grew → re-fetch
  })

  test('suppresses scrollback on the alt screen', () => {
    const readScrollback = vi.fn(() => ({ rows: ['stale'], cells: [] }))

    const adapter = createGhosttyVtRenderStateByteParserAdapter(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: (): GhosttyVtRenderSnapshot => ({
          rows: ['vim'],
          cursor: { rowIndex: 0, columnOffset: 0 },
          scrollbackRowCount: 5,
          isAltScreen: true,
        }),
        readScrollback,
      })
    )

    adapter.parseBytes(createInput(new Uint8Array([0x61])))
    const output = adapter.flushOutput?.()

    expect(output?.visibleText).toBe('vim')
    expect(readScrollback).not.toHaveBeenCalled()
  })

  test('drops scrollback entering the alt screen and restores it on exit', () => {
    let isAltScreen = false
    const readScrollback = vi.fn(() => ({ rows: ['h1', 'h2'], cells: [] }))

    const adapter = createGhosttyVtRenderStateByteParserAdapter(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: (): GhosttyVtRenderSnapshot => ({
          rows: ['p'],
          cursor: { rowIndex: 0, columnOffset: 0 },
          scrollbackRowCount: 2,
          isAltScreen,
        }),
        readScrollback,
      })
    )

    const flush = (byte: number): string | undefined => {
      adapter.parseBytes(createInput(new Uint8Array([byte])))

      return adapter.flushOutput?.()?.visibleText
    }

    expect(flush(0x61)).toBe('h1\nh2\np') // main screen: history shown
    isAltScreen = true
    expect(flush(0x62)).toBe('p') // alt screen: history dropped
    isAltScreen = false
    expect(flush(0x63)).toBe('h1\nh2\np') // back to main: history restored
    expect(readScrollback).toHaveBeenCalledTimes(2) // re-fetched on return
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

    // parseInput feeds (returns empty); flushOutput produces the render
    expect(
      parserEngine.parseInput({
        inputMode: 'bytes',
        bytes,
        text: 'lossy fallback',
        output: null,
      })
    ).toEqual({ visibleText: '' })
    expect(writeBytes).toHaveBeenCalledWith(bytes)

    expect(parserEngine.flushOutput?.()).toEqual({
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
    adapter.parseBytes(createInput(encode('\x1b[?2026h\x1b[2J partial')))
    expect(adapter.flushOutput?.()).toBeNull()
    expect(snapshotReads).toBe(0)

    // closing chunk completes the frame -> flush renders it
    adapter.parseBytes(createInput(encode('redraw\x1b[?2026l')))
    expect(adapter.flushOutput?.()).toEqual({
      visibleText: 'composer',
      displayDelta: {
        operations: [{ type: 'replace', text: 'composer', cursorOffset: 2 }],
      },
    })
    expect(snapshotReads).toBe(1)
  })

  test('failsafe flushes if a 2026 frame never closes', () => {
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

    // open a 2026 frame and never close it
    adapter.parseBytes(createInput(encode('\x1b[?2026h open')))

    // first 8 flushes are held; the failsafe forces a render on the 9th
    let output: ReturnType<NonNullable<typeof adapter.flushOutput>> = null
    for (let index = 0; index < 9; index += 1) {
      output = adapter.flushOutput?.() ?? null
    }

    expect(output).not.toBeNull()
    expect(output?.visibleText).toBe('held')
  })

  test('reports pending output while a 2026 frame is held', () => {
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

    adapter.parseBytes(createInput(encode('\x1b[?2026h open')))

    expect(adapter.hasPendingOutput?.()).toBe(true)
    expect(adapter.flushOutput?.()).toBeNull()
    expect(adapter.hasPendingOutput?.()).toBe(true)

    let output: ReturnType<NonNullable<typeof adapter.flushOutput>> = null
    for (let index = 0; index < 8; index += 1) {
      output = adapter.flushOutput?.() ?? null
    }

    expect(output?.visibleText).toBe('held')
    expect(adapter.hasPendingOutput?.()).toBe(false)
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
