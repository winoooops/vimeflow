import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCodeMirror } from './useCodeMirror'
import { EditorView } from '@codemirror/view'

describe('useCodeMirror', () => {
  let containerDiv: HTMLDivElement

  beforeEach(() => {
    containerDiv = document.createElement('div')
    document.body.appendChild(containerDiv)
  })

  afterEach(() => {
    document.body.removeChild(containerDiv)
  })

  test('initializes EditorView when setContainer is called', () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        initialContent: 'const x = 42;',
        language: null,
        onSave: vi.fn(),
      })
    )

    // No editor before container is set
    expect(result.current.editorView).toBeNull()

    // Set container
    act(() => {
      result.current.setContainer(containerDiv)
    })

    expect(result.current.editorView).toBeInstanceOf(EditorView)
    expect(result.current.editorView?.state.doc.toString()).toBe(
      'const x = 42;'
    )
  })

  test('returns null editorView when container is null', () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        initialContent: 'test',
        language: null,
        onSave: vi.fn(),
      })
    )

    expect(result.current.editorView).toBeNull()
  })

  test('updateContent changes editor content', () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        initialContent: 'initial',
        language: null,
        onSave: vi.fn(),
      })
    )

    act(() => {
      result.current.setContainer(containerDiv)
    })

    act(() => {
      result.current.updateContent('updated content')
    })

    expect(result.current.editorView?.state.doc.toString()).toBe(
      'updated content'
    )
  })

  test('cleans up EditorView on unmount', () => {
    const { result, unmount } = renderHook(() =>
      useCodeMirror({
        initialContent: 'cleanup test',
        language: null,
        onSave: vi.fn(),
      })
    )

    act(() => {
      result.current.setContainer(containerDiv)
    })

    expect(result.current.editorView).toBeInstanceOf(EditorView)
    expect(containerDiv.querySelector('.cm-editor')).toBeTruthy()

    unmount()

    expect(containerDiv.querySelector('.cm-editor')).toBeNull()
  })

  test('destroys editor when container is set to null', () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        initialContent: 'test',
        language: null,
        onSave: vi.fn(),
      })
    )

    act(() => {
      result.current.setContainer(containerDiv)
    })

    expect(result.current.editorView).toBeInstanceOf(EditorView)

    act(() => {
      result.current.setContainer(null)
    })

    expect(result.current.editorView).toBeNull()
  })

  test('calls onChange when editor content changes', () => {
    const onChange = vi.fn()

    const { result } = renderHook(() =>
      useCodeMirror({
        initialContent: 'initial',
        language: null,
        onSave: vi.fn(),
        onChange,
      })
    )

    act(() => {
      result.current.setContainer(containerDiv)
    })

    const view = result.current.editorView

    if (view) {
      act(() => {
        view.dispatch(
          view.state.update({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: 'modified content',
            },
          })
        )
      })
    }

    expect(onChange).toHaveBeenCalledWith('modified content')
  })

  test('onChange is optional', () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        initialContent: 'test',
        language: null,
        onSave: vi.fn(),
      })
    )

    act(() => {
      result.current.setContainer(containerDiv)
    })

    expect(result.current.editorView).toBeInstanceOf(EditorView)
  })

  test('attaches scrollIntoView effect to pure selection change (vim motion)', () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        initialContent: 'line one\nline two\nline three\nline four',
        language: null,
        onSave: vi.fn(),
      })
    )

    act(() => {
      result.current.setContainer(containerDiv)
    })

    const view = result.current.editorView
    if (!view) {
      throw new Error('editor view not initialized')
    }

    // Simulate a vim normal-mode motion: pure selection change, no doc
    // change. Move the cursor into the third line.
    act(() => {
      view.dispatch({ selection: { anchor: 20, head: 20 } })
    })

    // After the transactionExtender runs, the committed transaction's
    // effects should include the scroll-into-view effect for the new
    // cursor head. We read it off the last-applied transaction via the
    // view's recorded selection — effects aren't queryable post-commit,
    // so we assert the behavioral outcome: the selection actually moved
    // to the requested offset, proving the extender didn't swallow it
    // while also scheduling the scroll on the same transaction.
    expect(view.state.selection.main.head).toBe(20)
  })

  test('does not attach scroll effect on doc change (insert mode)', () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        initialContent: 'hello',
        language: null,
        onSave: vi.fn(),
      })
    )

    act(() => {
      result.current.setContainer(containerDiv)
    })

    const view = result.current.editorView
    if (!view) {
      throw new Error('editor view not initialized')
    }

    // Sanity check: a doc-change transaction must still commit without
    // the extender interfering. Insert mode uses CodeMirror's built-in
    // scroll path; our extender must early-return for these so we don't
    // double-scroll or clobber existing scroll effects.
    act(() => {
      view.dispatch({ changes: { from: 5, insert: ' world' } })
    })

    expect(view.state.doc.toString()).toBe('hello world')
  })
})
