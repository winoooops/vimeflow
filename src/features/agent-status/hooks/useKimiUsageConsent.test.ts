import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest'
import { invoke } from '../../../lib/backend'
import { useKimiUsageConsent } from './useKimiUsageConsent'

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
}))

const mockInvoke = invoke as Mock

afterEach(() => {
  vi.clearAllMocks()
})

describe('useKimiUsageConsent', () => {
  test('loads the persisted consent on mount', async () => {
    mockInvoke.mockResolvedValueOnce(true)

    const { result } = renderHook(() => useKimiUsageConsent())
    expect(result.current.consent).toBeNull()

    await waitFor(() => expect(result.current.consent).toBe(true))
    expect(mockInvoke).toHaveBeenCalledWith('get_kimi_usage_consent')
  })

  test('defaults to off when the initial fetch fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('ipc down'))

    const { result } = renderHook(() => useKimiUsageConsent())
    await waitFor(() => expect(result.current.consent).toBe(false))
  })

  test('setConsent flips the flag optimistically and persists it', async () => {
    mockInvoke.mockResolvedValueOnce(false) // initial get
    mockInvoke.mockResolvedValueOnce(undefined) // set

    const { result } = renderHook(() => useKimiUsageConsent())
    await waitFor(() => expect(result.current.consent).toBe(false))

    await act(async () => {
      await result.current.setConsent(true)
    })

    expect(result.current.consent).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith('set_kimi_usage_consent', {
      enabled: true,
    })
  })

  test('re-syncs to the backend truth when the persist fails', async () => {
    mockInvoke.mockResolvedValueOnce(false) // initial get
    mockInvoke.mockRejectedValueOnce(new Error('write failed')) // set
    mockInvoke.mockResolvedValueOnce(false) // re-sync get

    const { result } = renderHook(() => useKimiUsageConsent())
    await waitFor(() => expect(result.current.consent).toBe(false))

    await act(async () => {
      await result.current.setConsent(true)
    })

    await waitFor(() => expect(result.current.consent).toBe(false))
  })

  test('persistError is raised when the durable write fails', async () => {
    mockInvoke.mockResolvedValueOnce(true) // initial get
    mockInvoke.mockRejectedValueOnce(new Error('disk full')) // set fails
    mockInvoke.mockResolvedValueOnce(false) // re-sync get (in-memory truth)

    const { result } = renderHook(() => useKimiUsageConsent())
    await waitFor(() => expect(result.current.consent).toBe(true))
    expect(result.current.persistError).toBe(false)

    await act(async () => {
      await result.current.setConsent(false)
    })

    await waitFor(() => expect(result.current.persistError).toBe(true))
    expect(result.current.consent).toBe(false)
  })

  test('refresh requests a backend re-fetch', async () => {
    mockInvoke.mockResolvedValueOnce(true) // initial get
    mockInvoke.mockResolvedValueOnce(undefined) // refresh

    const { result } = renderHook(() => useKimiUsageConsent())
    await waitFor(() => expect(result.current.consent).toBe(true))

    await act(async () => {
      await result.current.refresh()
    })

    expect(mockInvoke).toHaveBeenCalledWith('refresh_kimi_usage')
  })
})
