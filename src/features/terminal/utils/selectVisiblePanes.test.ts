import { describe, expect, test } from 'vitest'
import type { Pane } from '../../sessions/types'
import { selectVisiblePanes } from './selectVisiblePanes'

describe('selectVisiblePanes', () => {
  const makePane = (id: string, active = false): Pane => ({
    id,
    ptyId: `pty-${id}`,
    cwd: '/tmp/fixture',
    agentType: 'generic',
    status: 'running',
    active,
    pid: 1,
  })

  test('returns the prefix slice when panes.length <= capacity', () => {
    const panes = [makePane('p0', true), makePane('p1')]
    expect(selectVisiblePanes(panes, 4)).toEqual(panes)
  })

  test('returns the prefix slice when active pane is already inside it', () => {
    const panes = [
      makePane('p0', true),
      makePane('p1'),
      makePane('p2'),
      makePane('p3'),
      makePane('p4'),
    ]
    // capacity=2 → first 2 panes; active (idx 0) is already inside.
    expect(selectVisiblePanes(panes, 2)).toEqual([panes[0], panes[1]])
  })

  test('replaces the LAST visible slot with the active pane when it is beyond capacity', () => {
    // panes.length (5) > capacity (3); active at idx 4 would be sliced off
    // by a naive prefix slice. selectVisiblePanes must keep the active
    // pane reachable.
    const panes = [
      makePane('p0'),
      makePane('p1'),
      makePane('p2'),
      makePane('p3'),
      makePane('p4', true),
    ]
    const visible = selectVisiblePanes(panes, 3)
    expect(visible).toHaveLength(3)
    expect(visible[0]).toBe(panes[0])
    expect(visible[1]).toBe(panes[1])
    // panes[2] (the original capacity-1 slot) is replaced by the active
    // pane at idx 4.
    expect(visible[2]).toBe(panes[4])
    // The displaced panes[2] and pane[3] are NOT in the visible set —
    // they are the cost of preserving active visibility.
    expect(visible).not.toContain(panes[2])
    expect(visible).not.toContain(panes[3])
  })

  test('preserves the active pane when active is exactly at capacity (idx === capacity)', () => {
    const panes = [makePane('p0'), makePane('p1'), makePane('p2', true)]
    const visible = selectVisiblePanes(panes, 2)
    expect(visible).toHaveLength(2)
    expect(visible[0]).toBe(panes[0])
    expect(visible[1]).toBe(panes[2])
  })

  test('falls back to the prefix slice when no pane is active (invariant violation)', () => {
    // Defensive: the 5a invariant says exactly-one-active per session;
    // if every pane has active=false (a write-site bug), the helper
    // returns the prefix slice rather than throwing.
    const panes = [
      makePane('p0'),
      makePane('p1'),
      makePane('p2'),
      makePane('p3'),
      makePane('p4'),
    ]
    const visible = selectVisiblePanes(panes, 2)
    expect(visible).toEqual([panes[0], panes[1]])
  })

  // Note: capacity=0 isn't a real input — `LayoutShape.capacity` is typed
  // `1 | 2 | 3 | 4` — so no test for it. The helper's behavior in that
  // degenerate case isn't load-bearing.
})
