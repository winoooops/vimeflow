// cspell:ignore ghostty winoooops
import { describe, expect, test } from 'vitest'
import { TerminalDisplayBuffer } from './terminalDisplayBuffer'
import { createGhosttyVtRenderSnapshotOutput } from './ghosttyVtRenderSnapshot'

const TRUE_COLOR_PINK_HEX = ['#', 'f38ba8'].join('')
const TRUE_COLOR_BASE_HEX = ['#', '181825'].join('')
const TRUE_COLOR_PINK = ['rgb', '(243, 139, 168)'].join('')
const TRUE_COLOR_BASE = ['rgb', '(24, 24, 37)'].join('')
const NERD_FONT_TERMINAL_ICON = '\uf120'

describe('ghosttyVtRenderSnapshot', () => {
  test('converts a VT screen snapshot into a replace display delta', () => {
    expect(
      createGhosttyVtRenderSnapshotOutput({
        rows: ['prompt', 'output'],
        cursor: {
          rowIndex: 0,
          columnOffset: 2,
        },
      })
    ).toEqual({
      visibleText: 'prompt\noutput',
      displayDelta: {
        operations: [
          {
            type: 'replace',
            text: 'prompt\noutput',
            cursorOffset: 2,
          },
        ],
      },
    })
  })

  test('shifts clear-style snapshots with leading empty rows to the viewport top', () => {
    const output = createGhosttyVtRenderSnapshotOutput({
      rows: ['', 'prompt', '', ''],
      cursor: {
        rowIndex: 1,
        columnOffset: 6,
      },
      cells: [
        {
          row: 1,
          col: 0,
          text: 'prompt',
          width: 6,
        },
      ],
    })
    const operation = output.displayDelta?.operations[0]
    const buffer = new TerminalDisplayBuffer()

    if (operation?.type !== 'replace') {
      throw new Error('Expected replace operation')
    }

    buffer.applyDelta({ operations: [operation] })

    expect(operation.text.startsWith('\n')).toBe(false)
    expect(operation.cursorOffset).toBe('prompt'.length)
    expect(buffer.readVisibleText()).toBe('prompt')
  })

  test('preserves an intentional empty top row when the cursor is above content', () => {
    expect(
      createGhosttyVtRenderSnapshotOutput({
        rows: ['', 'menu'],
        cursor: {
          rowIndex: 0,
          columnOffset: 0,
        },
      }).displayDelta?.operations[0]
    ).toEqual({
      type: 'replace',
      text: '\nmenu',
      cursorOffset: 0,
    })
  })

  test('converts later-row cursor coordinates into a text offset', () => {
    expect(
      createGhosttyVtRenderSnapshotOutput({
        rows: ['one', 'two', 'three'],
        cursor: {
          rowIndex: 2,
          columnOffset: 2,
        },
      }).displayDelta?.operations[0]
    ).toEqual({
      type: 'replace',
      text: 'one\ntwo\nthree',
      cursorOffset: 'one\ntwo\nth'.length,
    })
  })

  test('clamps cursor coordinates to the snapshot bounds', () => {
    expect(
      createGhosttyVtRenderSnapshotOutput({
        rows: ['one', 'two'],
        cursor: {
          rowIndex: 99,
          columnOffset: 99,
        },
      }).displayDelta?.operations[0]
    ).toEqual({
      type: 'replace',
      text: 'one\ntwo',
      cursorOffset: 'one\ntwo'.length,
    })
  })

  test('uses the snapshot end when no cursor is supplied', () => {
    expect(
      createGhosttyVtRenderSnapshotOutput({
        rows: ['prompt'],
      }).displayDelta?.operations[0]
    ).toEqual({
      type: 'replace',
      text: 'prompt',
      cursorOffset: 'prompt'.length,
    })
  })

  test('propagates snapshot cursor visibility into the display delta', () => {
    expect(
      createGhosttyVtRenderSnapshotOutput({
        rows: ['Manual', 'Auto'],
        cursor: {
          rowIndex: 1,
          columnOffset: 0,
          visible: false,
        },
      }).displayDelta
    ).toEqual({
      cursorVisible: false,
      operations: [
        {
          type: 'replace',
          text: 'Manual\nAuto',
          cursorOffset: 'Manual\n'.length,
        },
      ],
    })
  })

  test('maps wide characters to a single terminal cell without splitting', () => {
    const row = 'a漢'

    expect(
      createGhosttyVtRenderSnapshotOutput({
        rows: [row],
        cursor: {
          rowIndex: 0,
          columnOffset: 2,
        },
      }).displayDelta?.operations[0]
    ).toEqual({
      type: 'replace',
      text: row,
      cursorOffset: 1,
    })
  })

  test('advances through combining marks at the cell boundary', () => {
    const row = 'e\u0301' // e + combining acute

    expect(
      createGhosttyVtRenderSnapshotOutput({
        rows: [row],
        cursor: {
          rowIndex: 0,
          columnOffset: 1,
        },
      }).displayDelta?.operations[0]
    ).toEqual({
      type: 'replace',
      text: row,
      cursorOffset: row.length,
    })
  })

  test('emits styled native cells through the display-buffer style pipeline', () => {
    const output = createGhosttyVtRenderSnapshotOutput({
      rows: [' winoooops $ '],
      cursor: {
        rowIndex: 0,
        columnOffset: 15,
      },
      cells: [
        {
          row: 0,
          col: 0,
          text: '',
          width: 1,
          foreground: TRUE_COLOR_PINK_HEX,
          background: TRUE_COLOR_BASE_HEX,
        },
        {
          row: 0,
          col: 1,
          text: ' ',
          width: 1,
          foreground: TRUE_COLOR_PINK_HEX,
          background: TRUE_COLOR_BASE_HEX,
        },
        {
          row: 0,
          col: 2,
          text: 'winoooops',
          width: 9,
          foreground: TRUE_COLOR_PINK_HEX,
          background: TRUE_COLOR_BASE_HEX,
        },
        {
          row: 0,
          col: 11,
          text: '',
          width: 1,
        },
      ],
    })
    const operation = output.displayDelta?.operations[0]
    const buffer = new TerminalDisplayBuffer()

    if (operation?.type !== 'replace') {
      throw new Error('Expected replace operation')
    }

    buffer.applyDelta({ operations: [operation] })

    expect(output.visibleText).toBe(' winoooops $ ')
    expect(buffer.readVisibleText()).toBe(' winoooops $ ')
    expect(buffer.readCursorOffset()).toBe(' winoooops $ '.length)
    expect(buffer.readStyledRuns()).toEqual([
      {
        text: ' winoooops',
        style: {
          foreground: TRUE_COLOR_PINK,
          background: TRUE_COLOR_BASE,
        },
      },
      {
        text: ' $ ',
        style: {},
      },
    ])
  })

  test('preserves fallback gaps before sparse styled cells', () => {
    const output = createGhosttyVtRenderSnapshotOutput({
      rows: ['plain red'],
      cursor: {
        rowIndex: 0,
        columnOffset: 9,
      },
      cells: [
        {
          row: 0,
          col: 6,
          text: 'red',
          width: 3,
          foreground: TRUE_COLOR_PINK_HEX,
        },
      ],
    })
    const operation = output.displayDelta?.operations[0]
    const buffer = new TerminalDisplayBuffer()

    if (operation?.type !== 'replace') {
      throw new Error('Expected replace operation')
    }

    buffer.applyDelta({ operations: [operation] })

    expect(output.visibleText).toBe('plain red')
    expect(buffer.readVisibleText()).toBe('plain red')
    expect(buffer.readStyledRuns()).toEqual([
      {
        text: 'plain ',
        style: {},
      },
      {
        text: 'red',
        style: {
          foreground: TRUE_COLOR_PINK,
        },
      },
    ])
  })

  test('uses native cursor columns instead of stale text offsets', () => {
    const output = createGhosttyVtRenderSnapshotOutput({
      rows: ['> Explain this codebase'],
      cursor: {
        rowIndex: 0,
        columnOffset: 2,
        textOffset: 10,
      },
      cells: [
        {
          row: 0,
          col: 0,
          text: '> Explain this codebase',
          width: 23,
          reverse: true,
        },
      ],
    })
    const operation = output.displayDelta?.operations[0]
    const buffer = new TerminalDisplayBuffer()

    if (operation?.type !== 'replace') {
      throw new Error('Expected replace operation')
    }

    buffer.applyDelta({ operations: [operation] })

    expect(buffer.readVisibleText()).toBe('> Explain this codebase')
    expect(buffer.readCursorOffset()).toBe(2)
  })

  test('renders styled empty native cells as occupied blanks', () => {
    const output = createGhosttyVtRenderSnapshotOutput({
      rows: ['A B'],
      cursor: {
        rowIndex: 0,
        columnOffset: 3,
      },
      cells: [
        {
          row: 0,
          col: 0,
          text: 'A',
          width: 1,
        },
        {
          row: 0,
          col: 1,
          text: '',
          width: 1,
          background: TRUE_COLOR_BASE_HEX,
        },
        {
          row: 0,
          col: 2,
          text: 'B',
          width: 1,
        },
      ],
    })
    const operation = output.displayDelta?.operations[0]
    const buffer = new TerminalDisplayBuffer()

    if (operation?.type !== 'replace') {
      throw new Error('Expected replace operation')
    }

    buffer.applyDelta({ operations: [operation] })

    expect(output.visibleText).toBe('A B')
    expect(buffer.readVisibleText()).toBe('A B')
    expect(buffer.readStyledRuns()).toEqual([
      {
        text: 'A',
        style: {},
      },
      {
        text: ' ',
        style: {
          background: TRUE_COLOR_BASE,
        },
      },
      {
        text: 'B',
        style: {},
      },
    ])
  })

  test('renders reverse-video native cells as styled occupied content', () => {
    const output = createGhosttyVtRenderSnapshotOutput({
      rows: [' Explain this codebase'],
      cursor: {
        rowIndex: 0,
        columnOffset: 22,
      },
      cells: [
        {
          row: 0,
          col: 0,
          text: ' Explain this codebase',
          width: 22,
          reverse: true,
        },
        {
          row: 0,
          col: 22,
          text: '',
          width: 2,
          reverse: true,
        },
      ],
    })
    const operation = output.displayDelta?.operations[0]
    const buffer = new TerminalDisplayBuffer()

    if (operation?.type !== 'replace') {
      throw new Error('Expected replace operation')
    }

    buffer.applyDelta({ operations: [operation] })

    expect(buffer.readVisibleText()).toBe(' Explain this codebase  ')
    expect(buffer.readStyledRuns()).toEqual([
      {
        text: ' Explain this codebase  ',
        style: {
          reverse: true,
        },
      },
    ])
  })

  test('preserves trailing fallback text after sparse styled empty cells', () => {
    const output = createGhosttyVtRenderSnapshotOutput({
      rows: ['AB'],
      cursor: {
        rowIndex: 0,
        columnOffset: 3,
      },
      cells: [
        {
          row: 0,
          col: 1,
          text: '',
          width: 1,
          background: TRUE_COLOR_BASE_HEX,
        },
      ],
    })
    const operation = output.displayDelta?.operations[0]
    const buffer = new TerminalDisplayBuffer()

    if (operation?.type !== 'replace') {
      throw new Error('Expected replace operation')
    }

    buffer.applyDelta({ operations: [operation] })

    expect(buffer.readVisibleText()).toBe('A B')
    expect(buffer.readCursorOffset()).toBe('A B'.length)
    expect(buffer.readStyledRuns()).toEqual([
      {
        text: 'A',
        style: {},
      },
      {
        text: ' ',
        style: {
          background: TRUE_COLOR_BASE,
        },
      },
      {
        text: 'B',
        style: {},
      },
    ])
  })

  test('recomputes native cursor offsets after renderer row padding', () => {
    const output = createGhosttyVtRenderSnapshotOutput({
      rows: ['A   '],
      cursor: {
        rowIndex: 0,
        columnOffset: 4,
        textOffset: 1,
      },
      cells: [
        {
          row: 0,
          col: 0,
          text: 'A',
          width: 1,
        },
      ],
    })
    const operation = output.displayDelta?.operations[0]
    const buffer = new TerminalDisplayBuffer()

    if (operation?.type !== 'replace') {
      throw new Error('Expected replace operation')
    }

    buffer.applyDelta({ operations: [operation] })

    expect(buffer.readVisibleText()).toBe('A   ')
    expect(buffer.readCursorOffset()).toBe('A   '.length)
  })

  test('skips overlapping empty native cells after a declared wide glyph', () => {
    const output = createGhosttyVtRenderSnapshotOutput({
      rows: [`${NERD_FONT_TERMINAL_ICON}x`],
      cursor: {
        rowIndex: 0,
        columnOffset: 3,
      },
      cells: [
        {
          row: 0,
          col: 0,
          text: NERD_FONT_TERMINAL_ICON,
          width: 2,
          foreground: TRUE_COLOR_PINK_HEX,
        },
        {
          row: 0,
          col: 1,
          text: '',
          width: 1,
        },
        {
          row: 0,
          col: 2,
          text: 'x',
          width: 1,
        },
      ],
    })
    const operation = output.displayDelta?.operations[0]
    const buffer = new TerminalDisplayBuffer()

    if (operation?.type !== 'replace') {
      throw new Error('Expected replace operation')
    }

    buffer.applyDelta({ operations: [operation] })

    expect(output.visibleText).toBe(`${NERD_FONT_TERMINAL_ICON}x`)
    expect(buffer.readVisibleText()).toBe(`${NERD_FONT_TERMINAL_ICON}x`)
    expect(buffer.readStyledRuns()).toEqual([
      {
        text: NERD_FONT_TERMINAL_ICON,
        style: {
          foreground: TRUE_COLOR_PINK,
        },
      },
      {
        text: 'x',
        style: {},
      },
    ])
  })

  test('maps cursor columns through native cell widths after wide glyph continuations', () => {
    const output = createGhosttyVtRenderSnapshotOutput({
      rows: [`${NERD_FONT_TERMINAL_ICON}xy`],
      cursor: {
        rowIndex: 0,
        columnOffset: 3,
      },
      cells: [
        {
          row: 0,
          col: 0,
          text: NERD_FONT_TERMINAL_ICON,
          width: 2,
          foreground: TRUE_COLOR_PINK_HEX,
        },
        {
          row: 0,
          col: 1,
          text: '',
          width: 1,
        },
        {
          row: 0,
          col: 2,
          text: 'x',
          width: 1,
        },
        {
          row: 0,
          col: 3,
          text: 'y',
          width: 1,
        },
      ],
    })
    const operation = output.displayDelta?.operations[0]
    const buffer = new TerminalDisplayBuffer()

    if (operation?.type !== 'replace') {
      throw new Error('Expected replace operation')
    }

    buffer.applyDelta({ operations: [operation] })

    expect(buffer.readVisibleText()).toBe(`${NERD_FONT_TERMINAL_ICON}xy`)
    expect(buffer.readCursorOffset()).toBe(`${NERD_FONT_TERMINAL_ICON}x`.length)
  })
})
