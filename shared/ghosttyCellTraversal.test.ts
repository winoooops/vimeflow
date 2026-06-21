// cspell:ignore ghostty
import { describe, expect, test } from 'vitest'
import {
  readCellRowVisibleText,
  readCellsByRow,
  readCursorOffsetInCellRow,
} from './ghosttyCellTraversal'

const BACKGROUND_HEX = ['#', '181825'].join('')

describe('ghosttyCellTraversal', () => {
  test('groups cells by row in row and column order', () => {
    expect(
      Array.from(
        readCellsByRow([
          { row: 1, col: 2, text: 'c', width: 1 },
          { row: 0, col: 1, text: 'b', width: 1 },
          { row: 0, col: 0, text: 'a', width: 1 },
        ])
      )
    ).toEqual([
      [
        0,
        [
          { row: 0, col: 0, text: 'a', width: 1 },
          { row: 0, col: 1, text: 'b', width: 1 },
        ],
      ],
      [1, [{ row: 1, col: 2, text: 'c', width: 1 }]],
    ])
  })

  test('preserves fallback whitespace after sparse styled blanks', () => {
    expect(
      readCellRowVisibleText('A B', [
        {
          row: 0,
          col: 1,
          text: '',
          width: 1,
          background: BACKGROUND_HEX,
        },
      ])
    ).toBe('A  B')
  })

  test('maps cursor columns after sparse trailing styled blanks', () => {
    expect(
      readCursorOffsetInCellRow(
        'A B',
        [
          {
            row: 0,
            col: 1,
            text: '',
            width: 1,
            background: BACKGROUND_HEX,
          },
        ],
        2
      )
    ).toBe(3)
  })

  test('aligns later explicit cells after styled blanks', () => {
    expect(
      readCellRowVisibleText('A B', [
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
          background: BACKGROUND_HEX,
        },
        {
          row: 0,
          col: 2,
          text: 'B',
          width: 1,
        },
      ])
    ).toBe('A B')
  })

  test('preserves fallback whitespace before non-adjacent explicit cells', () => {
    expect(
      readCellRowVisibleText('A B', [
        {
          row: 0,
          col: 1,
          text: '',
          width: 1,
          background: BACKGROUND_HEX,
        },
        {
          row: 0,
          col: 3,
          text: 'B',
          width: 1,
        },
      ])
    ).toBe('A  B')
  })

  test('maps cursor columns through skipped wide-cell continuations', () => {
    expect(
      readCursorOffsetInCellRow(
        '\uf120xy',
        [
          {
            row: 0,
            col: 0,
            text: '\uf120',
            width: 2,
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
        3
      )
    ).toBe('\uf120x'.length)
  })

  test('reserves native width for explicit wide private-use cells', () => {
    expect(
      readCellRowVisibleText('\uf120xy', [
        {
          row: 0,
          col: 0,
          text: '\uf120',
          width: 2,
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
      ])
    ).toBe('\uf120 xy')
  })

  test('keeps fallback text after sparse wide private-use cells', () => {
    expect(
      readCellRowVisibleText('\uf120xy', [
        {
          row: 0,
          col: 0,
          text: '\uf120',
          width: 2,
        },
      ])
    ).toBe('\uf120 xy')
  })
})
