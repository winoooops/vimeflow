import { describe, expect, test } from 'vitest'
import type { Pane } from '../types'
import { LAYOUTS } from '../../terminal/layout-registry'
import { normalizePanePlacements, resolvePanePlacement } from './panePlacements'

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
