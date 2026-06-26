import { WTerm } from '@wterm/dom'
import type { CellData, CursorState, TerminalCore } from '@wterm/core'
import { afterEach, describe, expect, test, vi } from 'vitest'

const DEFAULT_COLOR = 256

class FakeTerminalCore implements TerminalCore {
  readonly rawWrites: Uint8Array[] = []
  readonly stringWrites: string[] = []
  dirtyClearCount = 0

  private cols = 0
  private rows = 0

  init(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
  }

  writeString(str: string): void {
    this.stringWrites.push(str)
  }

  writeRaw(data: Uint8Array): void {
    this.rawWrites.push(new Uint8Array(data))
  }

  getCell(): CellData {
    return { char: 32, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, flags: 0 }
  }

  isDirtyRow(): boolean {
    return false
  }

  clearDirty(): void {
    this.dirtyClearCount += 1
  }

  getCols(): number {
    return this.cols
  }

  getRows(): number {
    return this.rows
  }

  getCursor(): CursorState {
    return { row: 0, col: 0, visible: false }
  }

  cursorKeysApp(): boolean {
    return false
  }

  bracketedPaste(): boolean {
    return false
  }

  usingAltScreen(): boolean {
    return false
  }

  getTitle(): string | null {
    return null
  }

  getResponse(): string | null {
    return null
  }

  getScrollbackCount(): number {
    return 0
  }

  getScrollbackCell(): CellData {
    return { char: 32, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, flags: 0 }
  }

  getScrollbackLineLen(): number {
    return 0
  }

  getUnhandledSequences(): [] {
    return []
  }
}

describe('WTerm raw-byte scheduling', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('feeds every raw byte chunk before the next paint while coalescing render to one frame', async () => {
    vi.useFakeTimers()

    const frameCallbacks: FrameRequestCallback[] = []
    const cancelledFrameIds: number[] = []
    vi.stubGlobal(
      'requestAnimationFrame',
      (callback: FrameRequestCallback): number => {
        frameCallbacks.push(callback)

        return frameCallbacks.length
      }
    )

    vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
      cancelledFrameIds.push(id)
    })

    const element = document.createElement('div')
    document.body.append(element)

    const core = new FakeTerminalCore()

    const terminal = new WTerm(element, {
      core,
      cols: 80,
      rows: 24,
      autoResize: false,
    })

    await terminal.init()

    for (let index = 0; index < 120; index += 1) {
      terminal.write(new Uint8Array([index & 0xff]))
    }

    expect(core.rawWrites).toHaveLength(120)
    expect(frameCallbacks).toHaveLength(0)

    await vi.runOnlyPendingTimersAsync()

    expect(frameCallbacks).toHaveLength(1)

    terminal.destroy()
    expect(cancelledFrameIds).toEqual([1])
  })
})
