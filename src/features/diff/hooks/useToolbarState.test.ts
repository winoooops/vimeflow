import { act, renderHook, waitFor } from '@testing-library/react'
import type { FileDiffOptions } from '@pierre/diffs'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ReviewComment } from './useFeedbackBatch'
import { useToolbarState } from './useToolbarState'

let workspaceThemeKind: 'dark' | 'light' = 'dark'
let workerPool: unknown = null

type ExpectedPierreOptions = Pick<
  FileDiffOptions<ReviewComment>,
  | 'diffStyle'
  | 'theme'
  | 'lineDiffType'
  | 'diffIndicators'
  | 'overflow'
  | 'enableGutterUtility'
>

vi.mock('@pierre/diffs/react', () => ({
  useWorkerPool: (): unknown => workerPool,
}))

vi.mock('../../../theme', () => ({
  useTheme: (): { kind: 'dark' | 'light' } => ({ kind: workspaceThemeKind }),
}))

describe('useToolbarState', () => {
  beforeEach(() => {
    workspaceThemeKind = 'dark'
    workerPool = null
  })

  test('maps toolbar settings into Pierre render options', () => {
    const { result } = renderHook(() => useToolbarState())

    const expectedOptions: ExpectedPierreOptions = {
      diffStyle: 'split',
      theme: 'pierre-dark',
      lineDiffType: 'word',
      diffIndicators: 'classic',
      overflow: 'scroll',
      enableGutterUtility: true,
    }

    expect(result.current.toolbarSettingsProps.diffStyle).toBe('split')
    expect(result.current.multiFileDiffOptions).toMatchObject(expectedOptions)

    act(() => {
      result.current.toggleDiffStyle()
    })

    expect(result.current.toolbarSettingsProps.diffStyle).toBe('unified')
    expect(result.current.multiFileDiffOptions.diffStyle).toBe('unified')
  })

  test('resets the Pierre theme when the workspace theme changes', async () => {
    const { result, rerender } = renderHook(() => useToolbarState())

    expect(result.current.toolbarSettingsProps.theme).toBe('pierre-dark')

    workspaceThemeKind = 'light'
    rerender()

    await waitFor(() => {
      expect(result.current.toolbarSettingsProps.theme).toBe('pierre-light')
    })
  })

  test('coerces split mode to unified when the diff pane is too narrow', () => {
    let resizeCallback: ResizeObserverCallback | null = null
    const observe = vi.fn()
    const disconnect = vi.fn()

    vi.stubGlobal(
      'ResizeObserver',
      vi.fn((callback: ResizeObserverCallback) => {
        resizeCallback = callback

        return {
          observe,
          unobserve: vi.fn(),
          disconnect,
        }
      })
    )

    const diffPaneElement = document.createElement('div')
    const { result, unmount } = renderHook(() => useToolbarState())

    act(() => {
      result.current.setDiffPaneElement(diffPaneElement)
    })

    expect(observe).toHaveBeenCalledWith(diffPaneElement)

    act(() => {
      resizeCallback?.(
        [{ contentRect: { width: 500 } } as ResizeObserverEntry],
        {} as ResizeObserver
      )
    })

    expect(result.current.effectiveDiffStyle).toBe('unified')
    expect(result.current.tooNarrow).toBe(false)

    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})
