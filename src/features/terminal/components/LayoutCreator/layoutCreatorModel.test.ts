import { describe, expect, test } from 'vitest'
import type { PaneLayoutDefinition } from '../../layout-registry'
import {
  addSlotRect,
  addFirstFreeSlot,
  createSingleDraftLayout,
  definitionFromDraft,
  draftFromDefinition,
  evenUnits,
  parseDraftLayoutText,
  serializeDraftLayout,
  setTrackCount,
  updateTrackBoundary,
  validateDraftLayout,
  type DraftPaneLayout,
} from './layoutCreatorModel'

const mainWithBottomStack = (): PaneLayoutDefinition => ({
  schemaVersion: 1,
  id: 'custom:main-bottom',
  title: 'Main + bottom stack',
  source: 'workspace',
  tracks: {
    columns: [
      { id: 'col-0', units: 8 },
      { id: 'col-1', units: 8 },
      { id: 'col-2', units: 8 },
    ],
    rows: [
      { id: 'row-0', units: 16 },
      { id: 'row-1', units: 8 },
    ],
  },
  slots: [
    { id: 'slot:p0', rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 } },
    { id: 'slot:p1', rect: { col: 0, row: 1, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p2', rect: { col: 1, row: 1, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p3', rect: { col: 2, row: 1, colSpan: 1, rowSpan: 1 } },
  ],
  addOrder: ['slot:p0', 'slot:p1', 'slot:p2', 'slot:p3'],
})

describe('layoutCreatorModel', () => {
  test('splits the 24-unit axis evenly', () => {
    expect(evenUnits(3)).toEqual([8, 8, 8])
    expect(evenUnits(5)).toEqual([5, 5, 5, 5, 4])
    expect(evenUnits(24)).toHaveLength(24)
  })

  test('round-trips a custom definition through the draft editor model', () => {
    const draft = draftFromDefinition(mainWithBottomStack())
    const serialized = serializeDraftLayout(draft, 'json')
    const parsed = parseDraftLayoutText(serialized, 'json')

    expect(parsed).toEqual(draft)
    expect(validateDraftLayout(parsed).ok).toBe(true)
  })

  test('emits canonical PaneLayoutDefinition with slot:p pane order ids', () => {
    const definition = definitionFromDraft({
      title: 'My layout',
      draft: draftFromDefinition(mainWithBottomStack()),
      existingIds: new Set(),
    })

    expect(definition.id).toMatch(/^custom:my-layout-/)
    expect(definition.tracks.columns.map((track) => track.units)).toEqual([
      8, 8, 8,
    ])

    expect(definition.addOrder).toEqual([
      'slot:p0',
      'slot:p1',
      'slot:p2',
      'slot:p3',
    ])
  })

  test('detects gaps until every grid cell is covered', () => {
    const draft = setTrackCount(createSingleDraftLayout(), 'cols', 2)

    expect(validateDraftLayout(draft)).toMatchObject({
      ok: false,
      emptyCells: 1,
    })

    const filled = addSlotRect(draft, {
      col: 1,
      row: 0,
      colSpan: 1,
      rowSpan: 1,
    })

    expect(validateDraftLayout(filled).ok).toBe(true)
  })

  test('drops panes outside reduced rows instead of clamping them into overlaps', () => {
    const draft = {
      cols: [12, 12],
      rows: [4, 4, 4, 4, 4, 4],
      slots: Array.from({ length: 6 }).flatMap((_, row) => [
        { col: 0, row, colSpan: 1, rowSpan: 1 },
        { col: 1, row, colSpan: 1, rowSpan: 1 },
      ]),
    }

    const reduced = setTrackCount(draft, 'rows', 3)

    expect(reduced.slots).toEqual([
      { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
      { col: 0, row: 1, colSpan: 1, rowSpan: 1 },
      { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { col: 0, row: 2, colSpan: 1, rowSpan: 1 },
      { col: 1, row: 2, colSpan: 1, rowSpan: 1 },
    ])

    expect(validateDraftLayout(reduced)).toMatchObject({
      ok: true,
      overlap: false,
      emptyCells: 0,
    })
  })

  test('drops panes outside reduced columns instead of clamping them into overlaps', () => {
    const draft = {
      cols: [8, 8, 8],
      rows: [12, 12],
      slots: [
        { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
        { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
        { col: 2, row: 0, colSpan: 1, rowSpan: 1 },
        { col: 0, row: 1, colSpan: 1, rowSpan: 1 },
        { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
        { col: 2, row: 1, colSpan: 1, rowSpan: 1 },
      ],
    }

    const reduced = setTrackCount(draft, 'cols', 2)

    expect(reduced.slots).toEqual([
      { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
      { col: 0, row: 1, colSpan: 1, rowSpan: 1 },
      { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
    ])

    expect(validateDraftLayout(reduced)).toMatchObject({
      ok: true,
      overlap: false,
      emptyCells: 0,
    })
  })

  test('adjusts adjacent tracks while preserving the 24-unit total', () => {
    const draft = setTrackCount(createSingleDraftLayout(), 'cols', 2)
    const adjusted = updateTrackBoundary(draft, 'cols', 0, 16 / 24)

    expect(adjusted.cols).toEqual([16, 8])
    expect(adjusted.cols.reduce((sum, unit) => sum + unit, 0)).toBe(24)
  })

  test('rejects otherwise tiled drafts that exceed the pane capacity', () => {
    const draft = {
      cols: [24],
      rows: evenUnits(17),
      slots: Array.from({ length: 17 }, (_, row) => ({
        col: 0,
        row,
        colSpan: 1,
        rowSpan: 1,
      })),
    }

    expect(validateDraftLayout(draft)).toMatchObject({
      ok: false,
      overlap: false,
      emptyCells: 0,
      overCapacity: true,
      slotCount: 17,
      maxSlots: 16,
    })

    expect(() =>
      definitionFromDraft({
        title: 'Too many',
        draft,
        existingIds: new Set(),
      })
    ).toThrow('Layouts must have 1-16 slots.')
  })

  test('does not add panes after the pane capacity is reached', () => {
    const draft = {
      cols: [24],
      rows: evenUnits(17),
      slots: Array.from({ length: 16 }, (_, row) => ({
        col: 0,
        row,
        colSpan: 1,
        rowSpan: 1,
      })),
    }

    expect(addFirstFreeSlot(draft)).toBe(draft)
    expect(
      addSlotRect(draft, { col: 0, row: 16, colSpan: 1, rowSpan: 1 })
    ).toBe(draft)
  })

  test('parses the emitted yaml shape', () => {
    const draft = draftFromDefinition(mainWithBottomStack())
    const yaml = serializeDraftLayout(draft, 'yaml')

    expect(parseDraftLayoutText(yaml, 'yaml')).toEqual(draft)
  })

  test('rejects drafts whose track count exceeds the layout track cap', () => {
    const draft = {
      cols: Array.from({ length: 25 }, () => 1),
      rows: [24],
      slots: [{ col: 0, row: 0, colSpan: 1, rowSpan: 1 }],
    }

    expect(validateDraftLayout(draft)).toMatchObject({
      ok: false,
      trackOverCapacity: true,
      overCapacity: false,
      overlap: false,
    })
  })

  test('emits slot.accepts from a draft slot restriction', () => {
    const definition = definitionFromDraft({
      title: 'Restricted',
      draft: {
        cols: [12, 12],
        rows: [24],
        slots: [
          { col: 0, row: 0, colSpan: 1, rowSpan: 1, accepts: ['browser'] },
          { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
        ],
      },
      existingIds: new Set(),
    })

    expect(definition.slots[0].accepts).toEqual(['browser'])
    expect(definition.slots[1].accepts).toBeUndefined()
  })

  test('omits slot.accepts when the draft restriction is empty', () => {
    const definition = definitionFromDraft({
      title: 'Unrestricted',
      draft: {
        cols: [24],
        rows: [24],
        slots: [{ col: 0, row: 0, colSpan: 1, rowSpan: 1, accepts: [] }],
      },
      existingIds: new Set(),
    })

    expect(definition.slots[0].accepts).toBeUndefined()
  })

  test('reads slot.accepts back into the draft via draftFromDefinition', () => {
    const definition = definitionFromDraft({
      title: 'Restricted',
      draft: {
        cols: [12, 12],
        rows: [24],
        slots: [
          { col: 0, row: 0, colSpan: 1, rowSpan: 1, accepts: ['shell'] },
          { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
        ],
      },
      existingIds: new Set(),
    })

    const draft = draftFromDefinition(definition)

    expect(draft.slots[0].accepts).toEqual(['shell'])
    expect(draft.slots[1].accepts).toBeUndefined()
  })

  test('round-trips slot.accepts through JSON serialization', () => {
    const draft: DraftPaneLayout = {
      cols: [12, 12],
      rows: [24],
      slots: [
        { col: 0, row: 0, colSpan: 1, rowSpan: 1, accepts: ['browser'] },
        { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
      ],
    }

    const json = serializeDraftLayout(draft, 'json')

    expect(parseDraftLayoutText(json, 'json')).toEqual(draft)
  })

  test('round-trips slot.accepts through YAML serialization', () => {
    const draft: DraftPaneLayout = {
      cols: [12, 12],
      rows: [24],
      slots: [
        { col: 0, row: 0, colSpan: 1, rowSpan: 1, accepts: ['browser'] },
        { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
      ],
    }

    const yaml = serializeDraftLayout(draft, 'yaml')

    expect(parseDraftLayoutText(yaml, 'yaml')).toEqual(draft)
  })

  test('round-trips a two-kind slot.accepts list through YAML', () => {
    // Exercises the inline-sequence parser with more than one entry
    // (`accepts: [browser, shell]`).
    const draft: DraftPaneLayout = {
      cols: [12, 12],
      rows: [24],
      slots: [
        {
          col: 0,
          row: 0,
          colSpan: 1,
          rowSpan: 1,
          accepts: ['browser', 'shell'],
        },
        { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
      ],
    }

    const yaml = serializeDraftLayout(draft, 'yaml')

    expect(parseDraftLayoutText(yaml, 'yaml')).toEqual(draft)
  })

  test('parses quoted slot.accepts entries from YAML flow sequences', () => {
    const yaml = [
      'tracks:',
      '  columns:',
      '    - id: c0',
      '      units: 12',
      '    - id: c1',
      '      units: 12',
      '  rows:',
      '    - id: r0',
      '      units: 24',
      'slots:',
      '  - id: slot:p0',
      '    rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }',
      "    accepts: ['browser', \"shell\"]",
      '  - id: slot:p1',
      '    rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }',
    ].join('\n')

    expect(parseDraftLayoutText(yaml, 'yaml').slots[0].accepts).toEqual([
      'browser',
      'shell',
    ])
  })

  test('parses slot.accepts entries from YAML block sequences', () => {
    const yaml = [
      'tracks:',
      '  columns:',
      '    - id: c0',
      '      units: 12',
      '    - id: c1',
      '      units: 12',
      '  rows:',
      '    - id: r0',
      '      units: 24',
      'slots:',
      '  - id: slot:p0',
      '    rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }',
      '    accepts:',
      '      - browser',
      '      - shell',
      '  - id: slot:p1',
      '    rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }',
    ].join('\n')

    expect(parseDraftLayoutText(yaml, 'yaml').slots[0].accepts).toEqual([
      'browser',
      'shell',
    ])
  })
})
