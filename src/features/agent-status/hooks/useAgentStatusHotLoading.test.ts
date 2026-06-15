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
  })

  test('does not refresh when no visible panes are available', () => {
    renderHook(() =>
      useAgentStatusHotLoading({
        activePtyId: null,
        visiblePtyIds: [],
      })
    )

    expect(refreshVisibleAgentStatusPanes).not.toHaveBeenCalled()
  })

  test('refreshes visible panes through the coordinator', async () => {
    renderHook(() =>
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
  })
})
