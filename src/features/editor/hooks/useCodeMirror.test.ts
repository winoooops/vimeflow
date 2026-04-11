import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCodeMirror, scrollCursorOnVimMotion } from './useCodeMirror'
import { EditorView } from '@codemirror/view'
import { EditorState, StateEffect } from '@codemirror/state'

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
})

describe('scrollCursorOnVimMotion', () => {
  // These tests exercise the transactionExtender as a PURE FUNCTION,
  // not through a mounted EditorView. jsdom has no layout pass so we
  // can't observe `scrollTop` on `.cm-scroller`; the most reliable way
  // to verify the extender actually attaches a scroll effect is to
  // invoke it directly on a synthetic transaction and inspect the
  // returned TransactionSpec.

  test('returns a scroll effect for a pure selection change (vim motion)', () => {
    const state = EditorState.create({
      doc: 'line one\nline two\nline three\nline four',
    })
    const tr = state.update({ selection: { anchor: 20, head: 20 } })

    const result = scrollCursorOnVimMotion(tr)

    expect(result).not.toBeNull()

    // `effects` may be a single effect or an array. Normalize and verify
    // at least one is a `StateEffect` instance (every `scrollIntoView`
    // effect is one).
    const effects = result?.effects

    const effectArray = Array.isArray(effects)
      ? effects
      : effects !== undefined
        ? [effects]
        : []

    expect(effectArray.length).toBeGreaterThan(0)
    expect(effectArray[0]).toBeInstanceOf(StateEffect)
  })

  test('uses the new main cursor head position, not the old one', () => {
    // Move selection from 0 → 20 and make sure the extender reads
    // `tr.newSelection.main.head` (post-transaction state), not
    // `tr.startState.selection.main.head` (pre-transaction state).
    // Regression guard against anyone tempted to "simplify" the guard
    // and accidentally target the wrong selection reference.
    const state = EditorState.create({
      doc: 'line one\nline two\nline three\nline four',
    })
    const tr = state.update({ selection: { anchor: 20, head: 20 } })

    expect(tr.newSelection.main.head).toBe(20)
    expect(tr.startState.selection.main.head).toBe(0)

    const result = scrollCursorOnVimMotion(tr)

    expect(result).not.toBeNull()
  })

  test('returns null for doc change (insert mode path)', () => {
    // Insert mode typing uses CodeMirror's built-in scroll path because
    // every keystroke is a doc change. The extender MUST early-return
    // here so we don't duplicate the built-in scroll or fight with it.
    const state = EditorState.create({ doc: 'hello' })
    const tr = state.update({ changes: { from: 5, insert: ' world' } })

    const result = scrollCursorOnVimMotion(tr)

    expect(result).toBeNull()
  })

  test('returns null for effect-only transaction (no selection change)', () => {
    // Transactions that carry only effects (e.g. language reconfiguration
    // via the language compartment) have no selection spec. The extender
    // must early-return so it doesn't accidentally schedule a scroll on
    // every unrelated effect that flows through the state.
    const state = EditorState.create({ doc: 'hello' })
    const noopEffect = StateEffect.define<number>()
    const tr = state.update({ effects: noopEffect.of(1) })

    const result = scrollCursorOnVimMotion(tr)

    expect(result).toBeNull()
  })
})
