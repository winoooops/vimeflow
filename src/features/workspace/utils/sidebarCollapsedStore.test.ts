import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const STORAGE_KEY = 'vimeflow:workspace:sidebarCollapsed'

// The module seeds a module-level `current` from localStorage at import time.
// Reset the module registry and clear storage before each test, then import the
// module fresh inside each test so the seed is re-evaluated against the storage
// state we just arranged.
type SidebarCollapsedStore = typeof import('./sidebarCollapsedStore')

const importStore = async (): Promise<SidebarCollapsedStore> =>
  import('./sidebarCollapsedStore')

describe('sidebarCollapsedStore', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  test('getSidebarCollapsed defaults to false when nothing is persisted', async () => {
    const { getSidebarCollapsed } = await importStore()

    expect(getSidebarCollapsed()).toBe(false)
  })

  test('getSidebarCollapsed reflects a persisted true at import time', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'true')

    const { getSidebarCollapsed } = await importStore()

    expect(getSidebarCollapsed()).toBe(true)
  })

  test('setSidebarCollapsed(true) writes "true" and getter returns true', async () => {
    const { getSidebarCollapsed, setSidebarCollapsed } = await importStore()

    setSidebarCollapsed(true)

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true')
    expect(getSidebarCollapsed()).toBe(true)
  })

  test('setSidebarCollapsed(false) writes "false" and getter returns false', async () => {
    const { getSidebarCollapsed, setSidebarCollapsed } = await importStore()

    setSidebarCollapsed(true)
    setSidebarCollapsed(false)

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false')
    expect(getSidebarCollapsed()).toBe(false)
  })

  test('setSidebarCollapsed with the same value is a no-op: no notify, no rewrite', async () => {
    const { setSidebarCollapsed, subscribeSidebarCollapsed } =
      await importStore()

    const listener = vi.fn()
    subscribeSidebarCollapsed(listener)

    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')

    // current defaults to false, so setting false again must be a no-op.
    setSidebarCollapsed(false)

    expect(listener).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  test('setSidebarCollapsed to the current true value is a no-op', async () => {
    const { setSidebarCollapsed, subscribeSidebarCollapsed } =
      await importStore()

    setSidebarCollapsed(true)

    const listener = vi.fn()
    subscribeSidebarCollapsed(listener)
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')

    setSidebarCollapsed(true)

    expect(listener).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  test('subscribeSidebarCollapsed calls the listener on a real change', async () => {
    const { setSidebarCollapsed, subscribeSidebarCollapsed } =
      await importStore()

    const listener = vi.fn()
    subscribeSidebarCollapsed(listener)

    setSidebarCollapsed(true)

    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('subscribeSidebarCollapsed returns an unsubscribe that stops notifications', async () => {
    const { setSidebarCollapsed, subscribeSidebarCollapsed } =
      await importStore()

    const listener = vi.fn()
    const unsubscribe = subscribeSidebarCollapsed(listener)

    setSidebarCollapsed(true)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()

    setSidebarCollapsed(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('getSidebarCollapsed returns false when getItem throws at seed time', async () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    const { getSidebarCollapsed } = await importStore()

    expect(() => getSidebarCollapsed()).not.toThrow()
    expect(getSidebarCollapsed()).toBe(false)
  })

  test('setSidebarCollapsed does not throw when setItem throws and still updates in-memory + notifies', async () => {
    const {
      getSidebarCollapsed,
      setSidebarCollapsed,
      subscribeSidebarCollapsed,
    } = await importStore()

    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    const listener = vi.fn()
    subscribeSidebarCollapsed(listener)

    expect(() => setSidebarCollapsed(true)).not.toThrow()
    expect(getSidebarCollapsed()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
