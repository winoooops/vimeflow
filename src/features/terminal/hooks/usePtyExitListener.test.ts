import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ITerminalService } from '../services/terminalService'
import { usePtyExitListener } from './usePtyExitListener'

const buildMockService = (): {
  service: ITerminalService
  fireExit: (sid: string) => void
  unsubscribed: () => boolean
} => {
  let cb: ((sid: string) => void) | null = null
  let didUnsubscribe = false

  return {
    service: {
      onExit: (callback: (sid: string) => void) => {
        cb = callback

        return Promise.resolve(() => {
          didUnsubscribe = true
        })
      },
    } as unknown as ITerminalService,
    fireExit: (sid) => cb?.(sid),
    unsubscribed: () => didUnsubscribe,
  }
}

describe('usePtyExitListener', () => {
  test('subscribes to service.onExit and forwards ptyId to onExit callback', () => {
    const { service, fireExit } = buildMockService()
    const onExit = vi.fn()
    renderHook(() => usePtyExitListener({ service, onExit }))

    fireExit('pty-1')
    expect(onExit).toHaveBeenCalledWith('pty-1')
  })

  test('unsubscribes on unmount', async () => {
    const { service, unsubscribed } = buildMockService()

    const { unmount } = renderHook(() =>
      usePtyExitListener({ service, onExit: vi.fn() })
    )
    expect(unsubscribed()).toBe(false)

    unmount()
    await waitFor(() => {
      expect(unsubscribed()).toBe(true)
    })
  })
})
