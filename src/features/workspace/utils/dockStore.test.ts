import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  getDockState,
  setDockOpen,
  setDockPosition,
  setDockTab,
  subscribeDockState,
} from './dockStore'

const STORAGE_KEY = 'vimeflow:workspace:dock'
const DEFAULT_STATE = { open: false, tab: 'diff', position: 'bottom' } as const

describe('dockStore', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setDockOpen(false)
    setDockTab('diff')
    setDockPosition('bottom')
  })

  test('defaults to closed/diff/bottom when nothing is persisted', () => {
    expect(getDockState()).toEqual(DEFAULT_STATE)
  })

  test('setters update the snapshot and persist the whole object', () => {
    setDockOpen(true)
    setDockTab('editor')
    setDockPosition('right')
    expect(getDockState()).toEqual({
      open: true,
      tab: 'editor',
      position: 'right',
    })
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '')).toEqual({
      open: true,
      tab: 'editor',
      position: 'right',
    })
  })

  test('setter is a no-op when the value is unchanged', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeDockState(listener)
    setDockOpen(false)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  test('subscribers are notified once per change', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeDockState(listener)
    setDockOpen(true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  test('a fresh module load seeds from persisted localStorage', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ open: true, tab: 'editor', position: 'left' })
    )
    vi.resetModules()
    const fresh = await import('./dockStore')
    expect(fresh.getDockState()).toEqual({
      open: true,
      tab: 'editor',
      position: 'left',
    })
  })

  test('a fresh module load falls back per-field on malformed or invalid data', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ open: true, tab: 'bogus', position: 42 })
    )
    vi.resetModules()
    const fresh = await import('./dockStore')
    expect(fresh.getDockState()).toEqual({
      open: true,
      tab: 'diff',
      position: 'bottom',
    })
  })

  test('a fresh module load falls back to defaults on unparseable JSON', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    vi.resetModules()
    const fresh = await import('./dockStore')
    expect(fresh.getDockState()).toEqual(DEFAULT_STATE)
  })
})
