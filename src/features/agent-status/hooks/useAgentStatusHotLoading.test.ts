import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { refreshVisibleAgentStatusPanes } from '../utils/statusRefreshCoordinator'
import { useAgentStatusHotLoading } from './useAgentStatusHotLoading'

vi.mock('../utils/statusRefreshCoordinator', async () => {
  const actual = await vi.importActual<
    typeof import('../utils/statusRefreshCoordinator')
  >('../utils/statusRefreshCoordinator')

  return {
    ...actual,
    refreshVisibleAgentStatusPanes: vi.fn().mockResolvedValue([]),
  }
})

describe('useAgentStatusHotLoading', () => {
  beforeEach(() => {
    vi.mocked(refreshVisibleAgentStatusPanes).mockClear()
    vi.mocked(refreshVisibleAgentStatusPanes).mockResolvedValue([])
  })

  test('does not refresh when no visible panes are available', () => {
    const { result } = renderHook(() =>
      useAgentStatusHotLoading({
        activePtyId: null,
        visiblePtyIds: [],
      })
    )

    expect(refreshVisibleAgentStatusPanes).not.toHaveBeenCalled()
    expect(result.current).toBe(false)
  })

  test('refreshes visible panes through the coordinator', async () => {
    const { result } = renderHook(() =>
      useAgentStatusHotLoading({
        activePtyId: 'pty-b',
        visiblePtyIds: ['pty-a', 'pty-b', 'pty-a'],
      })
    )

    await waitFor(() => {
      expect(refreshVisibleAgentStatusPanes).toHaveBeenCalledWith({
        activePtyId: 'pty-b',
        visiblePtyIds: ['pty-a', 'pty-b', 'pty-a'],
      })
    })

    await waitFor(() => expect(result.current).toBe(false))
  })

  test('reports refreshing until the coordinator settles', async () => {
    let resolveRefresh: (
      value: Awaited<ReturnType<typeof refreshVisibleAgentStatusPanes>>
    ) => void = () => undefined

    vi.mocked(refreshVisibleAgentStatusPanes).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve
      })
    )

    const { result } = renderHook(() =>
      useAgentStatusHotLoading({
        activePtyId: 'pty-a',
        visiblePtyIds: ['pty-a'],
      })
    )

    await waitFor(() => expect(result.current).toBe(true))

    resolveRefresh([])

    await waitFor(() => expect(result.current).toBe(false))
  })
})
