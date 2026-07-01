import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { writeClipboardText } from '@/lib/clipboard'
import type { DiffHunk } from '../types'
import type { ReviewNavigationTarget } from './useReviewTargetNavigation'
import { useVisualSelection } from './useVisualSelection'

vi.mock('@/lib/clipboard', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(true),
}))

const targets: ReviewNavigationTarget[] = [
  {
    lineNumber: 1,
    side: 'additions',
    hunkIndex: 0,
    splitRowIndex: 0,
    changed: false,
  },
  {
    lineNumber: 2,
    side: 'additions',
    hunkIndex: 0,
    splitRowIndex: 1,
    changed: true,
  },
  {
    lineNumber: 3,
    side: 'additions',
    hunkIndex: 0,
    splitRowIndex: 2,
    changed: true,
  },
]

const hunks: DiffHunk[] = [
  {
    id: 'hunk-0',
    header: '@@ -1,3 +1,3 @@',
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 3,
    lines: [
      { type: 'context', oldLineNumber: 1, newLineNumber: 1, content: 'one' },
      { type: 'added', newLineNumber: 2, content: 'two' },
      { type: 'added', newLineNumber: 3, content: 'three' },
    ],
  },
]

type VisualSelectionHook = ReturnType<typeof useVisualSelection>

interface RenderedVisualSelection {
  result: { current: VisualSelectionHook }
  rerender: (props: { nextFileKey: string }) => void
  activateTarget: ReturnType<typeof vi.fn>
  focusDiffRoot: ReturnType<typeof vi.fn>
  moveTargetLine: ReturnType<typeof vi.fn>
  notifyInfo: ReturnType<typeof vi.fn>
  scrollTargetIntoView: ReturnType<typeof vi.fn>
}

const renderVisualSelection = (
  fileKey = 'src/foo.ts:unstaged'
): RenderedVisualSelection => {
  const activateTarget = vi.fn()
  const focusDiffRoot = vi.fn()
  const moveTargetLine = vi.fn()
  const moveTargetSide = vi.fn()
  const notifyInfo = vi.fn()
  const onPointerHover = vi.fn()
  const scrollTargetIntoView = vi.fn()
  const targetIndexFromPointerEvent = vi.fn()

  const hook = renderHook(
    ({ nextFileKey }) =>
      useVisualSelection({
        activeHunks: hunks,
        activeTargetIndex: 0,
        activateTarget,
        diffStyle: 'split',
        fileKey: nextFileKey,
        focusDiffRoot,
        moveTargetLine,
        moveTargetSide,
        notifyInfo,
        onPointerHover,
        scrollTargetIntoView,
        targetIndexFromPointerEvent,
        targets,
      }),
    { initialProps: { nextFileKey: fileKey } }
  )

  return {
    result: hook.result,
    rerender: hook.rerender,
    activateTarget,
    focusDiffRoot,
    moveTargetLine,
    notifyInfo,
    scrollTargetIntoView,
  }
}

describe('useVisualSelection', () => {
  beforeEach(() => {
    vi.mocked(writeClipboardText).mockClear()
  })

  test('extends a selected range and yanks the selected snippet', async () => {
    const { result, activateTarget, scrollTargetIntoView } =
      renderVisualSelection()

    act(() => {
      result.current.start()
    })

    expect(result.current.selectedLines).toEqual({
      start: 1,
      end: 1,
      side: 'additions',
    })

    act(() => {
      result.current.moveLine(1)
    })

    expect(result.current.selectedLines).toEqual({
      start: 1,
      end: 2,
      side: 'additions',
    })
    expect(activateTarget).toHaveBeenLastCalledWith(1)
    expect(scrollTargetIntoView).toHaveBeenCalledWith(targets[1], 1, 1)

    act(() => {
      result.current.yank()
    })

    await waitFor(() => {
      expect(writeClipboardText).toHaveBeenCalledWith('one\ntwo')
    })
    expect(result.current.selectedLines).toBeNull()
  })

  test('clears visual selection when the file changes', () => {
    const { result, rerender } = renderVisualSelection()

    act(() => {
      result.current.start()
    })

    expect(result.current.active).toBe(true)

    rerender({ nextFileKey: 'src/bar.ts:unstaged' })

    expect(result.current.active).toBe(false)
  })

  test('falls back to normal line navigation outside visual mode', () => {
    const { result, focusDiffRoot, moveTargetLine } = renderVisualSelection()

    act(() => {
      result.current.moveLine(1)
    })

    expect(moveTargetLine).toHaveBeenCalledWith(1)
    expect(focusDiffRoot).toHaveBeenCalled()
  })
})
