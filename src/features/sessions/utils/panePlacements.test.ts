import { describe, expect, test } from 'vitest'
import type { Pane } from '../types'
import { LAYOUTS } from '../../terminal/layout-registry'
import {
  movePaneToSlot,
  normalizePanePlacements,
  resolvePanePlacement,
  swapPanePlacements,
} from './panePlacements'

const pane = (id: string): Pane => ({
  id,
  ptyId: `pty-${id}`,
  cwd: '/repo',
  agentType: 'generic',
  status: 'running',
  active: id === 'p0',
})

describe('normalizePanePlacements', () => {
  test('derives placements from pane order and layout addOrder when absent', () => {
    expect(
      normalizePanePlacements(
        [pane('p0'), pane('p1')],
        LAYOUTS.vsplit,
        undefined
      )
    ).toEqual([
      { paneId: 'p0', slotId: 'slot:p0' },
      { paneId: 'p1', slotId: 'slot:p1' },
    ])
  })

  test('preserves valid explicit placements and fills missing panes', () => {
    expect(
      normalizePanePlacements(
        [pane('p0'), pane('p1'), pane('p2')],
        LAYOUTS.quad,
        [
          { paneId: 'p2', slotId: 'slot:p1' },
          { paneId: 'missing', slotId: 'slot:p0' },
          { paneId: 'p1', slotId: 'slot:missing' },
          { paneId: 'p0', slotId: 'slot:p1' },
        ]
      )
    ).toEqual([
      { paneId: 'p2', slotId: 'slot:p1' },
      { paneId: 'p0', slotId: 'slot:p0' },
      { paneId: 'p1', slotId: 'slot:p2' },
    ])
  })

  test('omits panes when the layout has no remaining slots', () => {
    expect(
      normalizePanePlacements(
        [pane('p0'), pane('p1')],
        LAYOUTS.single,
        undefined
      )
    ).toEqual([{ paneId: 'p0', slotId: 'slot:p0' }])
  })
})

describe('resolvePanePlacement', () => {
  test('returns assignments in pane order and empty slots in layout order', () => {
    const resolution = resolvePanePlacement(
      [pane('p0'), pane('p1')],
      LAYOUTS.quad,
      [
        { paneId: 'p1', slotId: 'slot:p3' },
        { paneId: 'p0', slotId: 'slot:p1' },
      ]
    )

    expect(
      resolution.assignments.map(({ pane: assignedPane, slotId }) => ({
        paneId: assignedPane.id,
        slotId,
      }))
    ).toEqual([
      { paneId: 'p0', slotId: 'slot:p1' },
      { paneId: 'p1', slotId: 'slot:p3' },
    ])
    expect(resolution.emptySlotIds).toEqual(['slot:p0', 'slot:p2'])
  })
})

describe('swapPanePlacements', () => {
  test('exchanges the two panes slot assignments', () => {
    const result = swapPanePlacements(
      [pane('p0'), pane('p1')],
      LAYOUTS.vsplit,
      undefined,
      'p0',
      'p1'
    )

    expect(result).toHaveLength(2)
    expect(result).toEqual(
      expect.arrayContaining([
        { paneId: 'p0', slotId: 'slot:p1' },
        { paneId: 'p1', slotId: 'slot:p0' },
      ])
    )
  })

  test('captures explicit placements for every visible pane (stable vs addOrder)', () => {
    // Only p1 has an explicit placement; p0/p2 fall back to addOrder. After a
    // swap of p0 and p2, ALL three panes must carry explicit placements so the
    // result no longer depends on addOrder.
    const result = swapPanePlacements(
      [pane('p0'), pane('p1'), pane('p2')],
      LAYOUTS.threeRight,
      [{ paneId: 'p1', slotId: 'slot:p1' }],
      'p0',
      'p2'
    )

    expect(result).toHaveLength(3)
    expect(result).toEqual(
      expect.arrayContaining([
        { paneId: 'p2', slotId: 'slot:p0' },
        { paneId: 'p1', slotId: 'slot:p1' },
        { paneId: 'p0', slotId: 'slot:p2' },
      ])
    )
  })

  test('returns the same normalized placements when both ids are equal', () => {
    expect(
      swapPanePlacements(
        [pane('p0'), pane('p1')],
        LAYOUTS.vsplit,
        undefined,
        'p0',
        'p0'
      )
    ).toEqual([
      { paneId: 'p0', slotId: 'slot:p0' },
      { paneId: 'p1', slotId: 'slot:p1' },
    ])
  })

  test('returns normalized placements unchanged when a pane id is unknown', () => {
    expect(
      swapPanePlacements(
        [pane('p0'), pane('p1')],
        LAYOUTS.vsplit,
        undefined,
        'p0',
        'ghost'
      )
    ).toEqual([
      { paneId: 'p0', slotId: 'slot:p0' },
      { paneId: 'p1', slotId: 'slot:p1' },
    ])
  })
})

describe('movePaneToSlot', () => {
  test('moves a pane to an empty slot and frees its old slot', () => {
    // p0 -> slot:p0, p1 -> slot:p1 in vsplit (capacity 2). Move p0 onto the
    // empty quad slot:p2: p0 leaves slot:p0 (now empty) and occupies slot:p2.
    const result = movePaneToSlot(
      [pane('p0'), pane('p1')],
      LAYOUTS.quad,
      [
        { paneId: 'p0', slotId: 'slot:p0' },
        { paneId: 'p1', slotId: 'slot:p1' },
      ],
      'p0',
      'slot:p2'
    )

    expect(result).toEqual(
      expect.arrayContaining([
        { paneId: 'p0', slotId: 'slot:p2' },
        { paneId: 'p1', slotId: 'slot:p1' },
      ])
    )
    expect(result).toHaveLength(2)
    expect(result.some((placement) => placement.slotId === 'slot:p0')).toBe(
      false
    )
  })

  test('captures explicit placements for every visible pane', () => {
    const result = movePaneToSlot(
      [pane('p0'), pane('p1')],
      LAYOUTS.quad,
      undefined,
      'p1',
      'slot:p3'
    )

    expect(result).toHaveLength(2)
    expect(result).toEqual(
      expect.arrayContaining([
        { paneId: 'p0', slotId: 'slot:p0' },
        { paneId: 'p1', slotId: 'slot:p3' },
      ])
    )
  })

  test('swaps assignments when the destination slot is occupied', () => {
    // Moving onto an occupied slot behaves like a swap: the occupant takes the
    // mover's old slot.
    const result = movePaneToSlot(
      [pane('p0'), pane('p1')],
      LAYOUTS.vsplit,
      [
        { paneId: 'p0', slotId: 'slot:p0' },
        { paneId: 'p1', slotId: 'slot:p1' },
      ],
      'p0',
      'slot:p1'
    )

    expect(result).toEqual(
      expect.arrayContaining([
        { paneId: 'p0', slotId: 'slot:p1' },
        { paneId: 'p1', slotId: 'slot:p0' },
      ])
    )
  })

  test('returns normalized placements unchanged for an unknown pane id', () => {
    expect(
      movePaneToSlot(
        [pane('p0'), pane('p1')],
        LAYOUTS.quad,
        undefined,
        'ghost',
        'slot:p2'
      )
    ).toEqual([
      { paneId: 'p0', slotId: 'slot:p0' },
      { paneId: 'p1', slotId: 'slot:p1' },
    ])
  })

  test('returns normalized placements unchanged for an unknown destination slot', () => {
    expect(
      movePaneToSlot(
        [pane('p0'), pane('p1')],
        LAYOUTS.vsplit,
        undefined,
        'p0',
        'slot:does-not-exist'
      )
    ).toEqual([
      { paneId: 'p0', slotId: 'slot:p0' },
      { paneId: 'p1', slotId: 'slot:p1' },
    ])
  })
})
