// cspell:ignore ghostty
import { describe, expect, test } from 'vitest'
import { createGhosttyVtRenderSnapshotOutput } from './ghosttyVtRenderSnapshot'

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
})
