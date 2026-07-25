import { describe, expect, test } from 'vitest'
import { orderSwitcherSessionIds } from './orderSwitcherSessionIds'

describe('orderSwitcherSessionIds', () => {
  test('settled MRU (active already first) is returned unchanged', () => {
    expect(
      orderSwitcherSessionIds(['B', 'A', 'C'], ['A', 'B', 'C'], 'B')
    ).toEqual(['B', 'A', 'C'])
  })

  test('settlement lag: optimistic active moves to the front of a stale MRU', () => {
    expect(
      orderSwitcherSessionIds(['A', 'B', 'C'], ['A', 'B', 'C'], 'B')
    ).toEqual(['B', 'A', 'C'])
  })

  test('null active id yields the plain merged order', () => {
    expect(orderSwitcherSessionIds(['A', 'B'], ['A', 'B', 'C'], null)).toEqual([
      'A',
      'B',
      'C',
    ])
  })

  test('active id outside the switchable set is not hoisted', () => {
    expect(orderSwitcherSessionIds(['A', 'B'], ['A', 'B'], 'Z')).toEqual([
      'A',
      'B',
    ])
  })

  test('filters MRU ids that are no longer switchable', () => {
    expect(orderSwitcherSessionIds(['X', 'A', 'B'], ['A', 'B'], 'A')).toEqual([
      'A',
      'B',
    ])
  })

  test('switchable ids missing from the MRU append in switchable order', () => {
    expect(orderSwitcherSessionIds(['C'], ['A', 'B', 'C'], 'C')).toEqual([
      'C',
      'A',
      'B',
    ])
  })

  test('hoisting an appended (never-activated) active id also works', () => {
    expect(orderSwitcherSessionIds(['A'], ['A', 'B'], 'B')).toEqual(['B', 'A'])
  })

  test('does not mutate its inputs', () => {
    const mru = ['A', 'B', 'C']
    const switchable = ['A', 'B', 'C']
    orderSwitcherSessionIds(mru, switchable, 'B')

    expect(mru).toEqual(['A', 'B', 'C'])
    expect(switchable).toEqual(['A', 'B', 'C'])
  })
})
