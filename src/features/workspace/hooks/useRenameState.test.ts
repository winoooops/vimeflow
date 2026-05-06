import { describe, test, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRenameState } from './useRenameState'
import type { Session } from '../types'

const buildSession = (name = 'auth'): Session => ({
  id: 'sess-1',
  projectId: 'p1',
  name,
  status: 'running',
  workingDirectory: '~',
  agentType: 'claude-code',
  createdAt: '2026-05-06T00:00:00Z',
  lastActivityAt: '2026-05-06T00:00:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 200_000, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 200 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
})

describe('useRenameState', () => {
  test('starts not editing with editValue seeded from session name', () => {
    const { result } = renderHook(() =>
      useRenameState(buildSession('auth'), vi.fn())
    )
    expect(result.current.isEditing).toBe(false)
    expect(result.current.editValue).toBe('auth')
  })

  test('beginEdit enters editing mode', () => {
    const { result } = renderHook(() =>
      useRenameState(buildSession('auth'), vi.fn())
    )
    act(() => {
      result.current.beginEdit()
    })
    expect(result.current.isEditing).toBe(true)
  })

  test('beginEdit is a no-op when onRename is undefined', () => {
    const { result } = renderHook(() =>
      useRenameState(buildSession('auth'), undefined)
    )
    act(() => {
      result.current.beginEdit()
    })
    expect(result.current.isEditing).toBe(false)
  })

  test('commitRename fires onRename with the trimmed new value', () => {
    const onRename = vi.fn()

    const { result } = renderHook(() =>
      useRenameState(buildSession('auth'), onRename)
    )
    act(() => {
      result.current.beginEdit()
      result.current.setEditValue('  new name  ')
    })

    act(() => {
      result.current.commitRename()
    })
    expect(onRename).toHaveBeenCalledWith('sess-1', 'new name')
    expect(result.current.isEditing).toBe(false)
  })

  test('commitRename does NOT fire onRename when trimmed value equals current name', () => {
    const onRename = vi.fn()

    const { result } = renderHook(() =>
      useRenameState(buildSession('auth'), onRename)
    )
    act(() => {
      result.current.beginEdit()
      result.current.setEditValue('  auth  ')
    })

    act(() => {
      result.current.commitRename()
    })
    expect(onRename).not.toHaveBeenCalled()
  })

  test('commitRename does NOT fire onRename when trimmed value is empty', () => {
    const onRename = vi.fn()

    const { result } = renderHook(() =>
      useRenameState(buildSession('auth'), onRename)
    )
    act(() => {
      result.current.beginEdit()
      result.current.setEditValue('   ')
    })

    act(() => {
      result.current.commitRename()
    })
    expect(onRename).not.toHaveBeenCalled()
    expect(result.current.editValue).toBe('auth')
  })

  test('cancelRename exits editing without firing onRename and reverts edit value', () => {
    const onRename = vi.fn()

    const { result } = renderHook(() =>
      useRenameState(buildSession('auth'), onRename)
    )
    act(() => {
      result.current.beginEdit()
      result.current.setEditValue('mid-edit')
    })

    act(() => {
      result.current.cancelRename()
    })
    expect(result.current.isEditing).toBe(false)
    expect(result.current.editValue).toBe('auth')
    expect(onRename).not.toHaveBeenCalled()
  })
})
