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

  test('attaches scrollback as a separate field and keeps viewport output standalone', () => {
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

    // The viewport output is standalone: no prepended history, no cursor shift.
    expect(output?.visibleText).toBe('prompt')
    expect(output?.displayDelta?.operations[0]).toEqual({
      type: 'replace',
      text: 'prompt',
      cursorOffset: 2,
    })
    // The viewport follows the bottom while history sits above it.
    expect(output?.displayDelta?.pinToBottom).toBe(true)
    // History travels as a separate static payload for the surface's region.
    expect(output?.scrollback).toEqual({ displayText: 'history line' })
    expect(readScrollback).toHaveBeenCalledOnce()
  })

  test('attaches scrollback only when the row count changes', () => {
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
    expect(adapter.flushOutput?.()?.scrollback).toEqual({ displayText: 'h' })

    adapter.parseBytes(createInput(new Uint8Array([0x62])))
    // Count unchanged → no payload; the surface keeps its static region.
    expect(adapter.flushOutput?.()?.scrollback).toBeUndefined()
    expect(readScrollback).toHaveBeenCalledOnce()

    scrollbackRowCount = 2
    adapter.parseBytes(createInput(new Uint8Array([0x63])))
    expect(adapter.flushOutput?.()?.scrollback).toEqual({ displayText: 'h' })
    expect(readScrollback).toHaveBeenCalledTimes(2) // count grew → re-fetch
  })

  test('retries empty positive-count scrollback fetches without clearing', () => {
    const readScrollback = vi
      .fn()
      .mockReturnValueOnce({ rows: [], cells: [] })
      .mockReturnValueOnce({ rows: ['history'], cells: [] })

    const adapter = createGhosttyVtRenderStateByteParserAdapter(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: (): GhosttyVtRenderSnapshot => ({
          rows: ['p'],
          cursor: { rowIndex: 0, columnOffset: 0 },
          scrollbackRowCount: 1,
        }),
        readScrollback,
      })
    )

    adapter.parseBytes(createInput(new Uint8Array([0x61])))
    expect(adapter.flushOutput?.()?.scrollback).toBeUndefined()

    adapter.parseBytes(createInput(new Uint8Array([0x62])))
    expect(adapter.flushOutput?.()?.scrollback).toEqual({
      displayText: 'history',
    })
    expect(readScrollback).toHaveBeenCalledTimes(2)
  })

  test('stops retrying persistent empty positive-count scrollback fetches', () => {
    const readScrollback = vi.fn(() => ({ rows: [], cells: [] }))

    const adapter = createGhosttyVtRenderStateByteParserAdapter(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: (): GhosttyVtRenderSnapshot => ({
          rows: ['p'],
          cursor: { rowIndex: 0, columnOffset: 0 },
          scrollbackRowCount: 1,
        }),
        readScrollback,
      })
    )

    for (const byte of [0x61, 0x62, 0x63]) {
      adapter.parseBytes(createInput(new Uint8Array([byte])))
      expect(adapter.flushOutput?.()?.scrollback).toBeUndefined()
    }

    adapter.parseBytes(createInput(new Uint8Array([0x64])))
    expect(adapter.flushOutput?.()?.scrollback).toBeUndefined()
    expect(readScrollback).toHaveBeenCalledTimes(3)
  })

  test('retries empty scrollback fetches again when the row count changes', () => {
    let scrollbackRowCount = 1

    const readScrollback = vi
      .fn()
      .mockReturnValueOnce({ rows: [], cells: [] })
      .mockReturnValueOnce({ rows: [], cells: [] })
      .mockReturnValueOnce({ rows: [], cells: [] })
      .mockReturnValueOnce({ rows: [], cells: [] })
      .mockReturnValueOnce({ rows: ['history'], cells: [] })

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

    for (const byte of [0x61, 0x62, 0x63]) {
      adapter.parseBytes(createInput(new Uint8Array([byte])))
      expect(adapter.flushOutput?.()?.scrollback).toBeUndefined()
    }

    scrollbackRowCount = 2
    adapter.parseBytes(createInput(new Uint8Array([0x64])))
    expect(adapter.flushOutput?.()?.scrollback).toBeUndefined()

    adapter.parseBytes(createInput(new Uint8Array([0x65])))
    expect(adapter.flushOutput?.()?.scrollback).toEqual({
      displayText: 'history',
    })
    expect(readScrollback).toHaveBeenCalledTimes(5)
  })

  test('re-attaches scrollback after resize even when the row count is unchanged', () => {
    const readScrollback = vi
      .fn()
      .mockReturnValueOnce({ rows: ['wide history'], cells: [] })
      .mockReturnValueOnce({ rows: ['narrow history'], cells: [] })

    const adapter = createGhosttyVtRenderStateByteParserAdapter(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: (): GhosttyVtRenderSnapshot => ({
          rows: ['p'],
          cursor: { rowIndex: 0, columnOffset: 0 },
          scrollbackRowCount: 1,
        }),
        readScrollback,
        resize: vi.fn(),
      })
    )

    adapter.parseBytes(createInput(new Uint8Array([0x61])))
    expect(adapter.flushOutput?.()?.scrollback).toEqual({
      displayText: 'wide history',
    })

    adapter.resize?.({ cols: 40, rows: 24 })
    adapter.parseBytes(createInput(new Uint8Array([0x62])))

    expect(adapter.flushOutput?.()?.scrollback).toEqual({
      displayText: 'narrow history',
    })
    expect(readScrollback).toHaveBeenCalledTimes(2)
  })

  test('clears scrollback (null payload) on the alt screen without fetching', () => {
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
    expect(output?.scrollback).toBeNull()
    expect(readScrollback).not.toHaveBeenCalled()
  })

  test('clears scrollback entering the alt screen and re-attaches it on exit', () => {
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

    const flush = (
      byte: number
    ): ReturnType<NonNullable<typeof adapter.flushOutput>> => {
      adapter.parseBytes(createInput(new Uint8Array([byte])))

      return adapter.flushOutput?.() ?? null
    }

    const main1 = flush(0x61) // main screen: history attached
    expect(main1?.visibleText).toBe('p')
    expect(main1?.scrollback).toEqual({ displayText: 'h1\nh2' })

    isAltScreen = true
    const alt = flush(0x62) // alt screen: history cleared (null)
    expect(alt?.visibleText).toBe('p')
    expect(alt?.scrollback).toBeNull()

    isAltScreen = false
    const main2 = flush(0x63) // back to main: history re-attached
    expect(main2?.visibleText).toBe('p')
    expect(main2?.scrollback).toEqual({ displayText: 'h1\nh2' })

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
