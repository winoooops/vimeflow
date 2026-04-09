import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useVimMode } from './useVimMode'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { vim } from '@replit/codemirror-vim'

describe('useVimMode', () => {
  let containerDiv: HTMLDivElement
  let editorView: EditorView

  beforeEach(() => {
    containerDiv = document.createElement('div')
    document.body.appendChild(containerDiv)

    // Create an EditorView with vim mode
    const state = EditorState.create({
      doc: 'test content',
      extensions: [vim()],
    })

    editorView = new EditorView({
      state,
      parent: containerDiv,
    })
  })

  afterEach(() => {
    editorView.destroy()
    document.body.removeChild(containerDiv)
  })

  test('returns NORMAL mode by default', () => {
    const { result } = renderHook(() => useVimMode(editorView))

    expect(result.current).toBe('NORMAL')
  })

  test('returns null when editorView is null', () => {
    const { result } = renderHook(() => useVimMode(null))

    expect(result.current).toBeNull()
  })

  test('handles editorView change from null to valid', () => {
    const { result, rerender } = renderHook(
      ({ view }: { view: EditorView | null }) => useVimMode(view),
      {
        initialProps: { view: null as EditorView | null },
      }
    )

    expect(result.current).toBeNull()

    // Now set the editorView
    rerender({ view: editorView as EditorView | null })

    expect(result.current).toBe('NORMAL')
  })

  test('handles editorView change from valid to null', () => {
    const { result, rerender } = renderHook(
      ({ view }: { view: EditorView | null }) => useVimMode(view),
      {
        initialProps: { view: editorView as EditorView | null },
      }
    )

    expect(result.current).toBe('NORMAL')

    // Now set to null
    rerender({ view: null as EditorView | null })

    expect(result.current).toBeNull()
  })

  test('handles editorView change between different instances', () => {
    const { result, rerender } = renderHook(
      ({ view }: { view: EditorView | null }) => useVimMode(view),
      {
        initialProps: { view: editorView },
      }
    )

    expect(result.current).toBe('NORMAL')

    // Create a new editor view
    const newContainerDiv = document.createElement('div')
    document.body.appendChild(newContainerDiv)

    const newState = EditorState.create({
      doc: 'new content',
      extensions: [vim()],
    })

    const newEditorView = new EditorView({
      state: newState,
      parent: newContainerDiv,
    })

    rerender({ view: newEditorView })

    expect(result.current).toBe('NORMAL')

    // Cleanup
    newEditorView.destroy()
    document.body.removeChild(newContainerDiv)
  })

  test('cleans up interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')

    const { unmount } = renderHook(() => useVimMode(editorView))

    unmount()

    expect(clearIntervalSpy).toHaveBeenCalled()

    clearIntervalSpy.mockRestore()
  })
})
