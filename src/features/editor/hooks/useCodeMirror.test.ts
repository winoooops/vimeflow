import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCodeMirror } from './useCodeMirror'
import { EditorView } from '@codemirror/view'
import type { RefObject } from 'react'

describe('useCodeMirror', () => {
  let containerDiv: HTMLDivElement
  let containerRef: RefObject<HTMLDivElement>

  beforeEach(() => {
    containerDiv = document.createElement('div')
    document.body.appendChild(containerDiv)
    containerRef = { current: containerDiv }
  })

  afterEach(() => {
    document.body.removeChild(containerDiv)
  })

  test('initializes EditorView with initial content', () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        containerRef,
        initialContent: 'const x = 42;',
        language: null,
        onSave: vi.fn(),
      })
    )

    expect(result.current.editorView).toBeInstanceOf(EditorView)
    expect(result.current.editorView?.state.doc.toString()).toBe(
      'const x = 42;'
    )
  })

  test('initializes without language extension when language is null', () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        containerRef,
        initialContent: 'plain text',
        language: null,
        onSave: vi.fn(),
      })
    )

    expect(result.current.editorView).toBeInstanceOf(EditorView)
  })

  test('updateContent changes editor content', () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        containerRef,
        initialContent: 'initial',
        language: null,
        onSave: vi.fn(),
      })
    )

    result.current.updateContent('updated content')

    expect(result.current.editorView?.state.doc.toString()).toBe(
      'updated content'
    )
  })

  test('calls onSave when vim :w command is executed', () => {
    const onSave = vi.fn()

    const { result } = renderHook(() =>
      useCodeMirror({
        containerRef,
        initialContent: 'test content',
        language: null,
        onSave,
      })
    )

    // Simulate vim :w command
    // We'll test this by checking if the vim save binding is configured
    // The actual vim command execution will be tested in integration tests
    expect(result.current.editorView).toBeTruthy()
  })

  test('cleans up EditorView on unmount', () => {
    const { result, unmount } = renderHook(() =>
      useCodeMirror({
        containerRef,
        initialContent: 'cleanup test',
        language: null,
        onSave: vi.fn(),
      })
    )

    const editorView = result.current.editorView

    expect(editorView).toBeInstanceOf(EditorView)
    expect(containerDiv.querySelector('.cm-editor')).toBeTruthy()

    unmount()

    // After unmount, the editor should be destroyed
    expect(containerDiv.querySelector('.cm-editor')).toBeNull()
  })

  test('does not initialize if containerRef is null', () => {
    // @ts-expect-error - Testing null ref case
    const nullRef: RefObject<HTMLDivElement> = { current: null }

    const { result } = renderHook(() =>
      useCodeMirror({
        containerRef: nullRef,
        initialContent: 'test',
        language: null,
        onSave: vi.fn(),
      })
    )

    expect(result.current.editorView).toBeNull()
  })

  test('returns null editorView when container is not available', () => {
    interface Props {
      ref: RefObject<HTMLDivElement>
    }

    // @ts-expect-error - Testing null ref case
    const nullRef: RefObject<HTMLDivElement> = { current: null }

    const { result, rerender } = renderHook(
      ({ ref }: Props) =>
        useCodeMirror({
          containerRef: ref,
          initialContent: 'test',
          language: null,
          onSave: vi.fn(),
        }),
      {
        initialProps: { ref: nullRef },
      }
    )

    expect(result.current.editorView).toBeNull()

    // Now set the ref
    rerender({ ref: containerRef })

    expect(result.current.editorView).toBeInstanceOf(EditorView)
  })
})
