import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCodeMirror, scrollCursorOnSelectionChange } from './useCodeMirror'
import { EditorView } from '@codemirror/view'
import { EditorState, StateEffect } from '@codemirror/state'

/**
 * Read the target position out of an `EditorView.scrollIntoView` effect.
 *
 * CodeMirror's `scrollIntoView` effect is a `StateEffect<ScrollTarget>`
 * where `ScrollTarget` is an internal class with shape
 * `{ range: SelectionRange, y, x, yMargin, xMargin, isSnapshot }`.
 * The type isn't exported, so we duck-type it: look for a `range.head`
 * field and return it. Returns `undefined` if the effect isn't a scroll
 * effect or the shape doesn't match.
 */
const readScrollTargetPos = (
  effect: StateEffect<unknown>
): number | undefined => {
  const value = effect.value as
    | { range?: { head?: unknown } }
    | null
    | undefined
  const head = value?.range?.head

  return typeof head === 'number' ? head : undefined
}

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

describe('scrollCursorOnSelectionChange', () => {
  // These tests exercise the transactionExtender as a PURE FUNCTION,
  // not through a mounted EditorView. jsdom has no layout pass so we
  // can't observe `scrollTop` on `.cm-scroller`; the most reliable way
  // to verify the extender actually attaches a scroll effect is to
  // invoke it directly on a synthetic transaction and inspect the
  // returned TransactionSpec.

  const getScrollEffects = (
    spec: ReturnType<typeof scrollCursorOnSelectionChange>
  ): StateEffect<unknown>[] => {
    const effects = spec?.effects

    if (Array.isArray(effects)) {
      return effects as StateEffect<unknown>[]
    }

    return effects !== undefined ? [effects as StateEffect<unknown>] : []
  }

  test('returns a scroll effect for a pure selection change', () => {
    const state = EditorState.create({
      doc: 'line one\nline two\nline three\nline four',
    })
    const tr = state.update({ selection: { anchor: 20, head: 20 } })

    const result = scrollCursorOnSelectionChange(tr)
    const effects = getScrollEffects(result)

    expect(result).not.toBeNull()
    expect(effects.length).toBeGreaterThan(0)
    expect(effects[0]).toBeInstanceOf(StateEffect)
  })

  test('targets the NEW cursor head position, not the old one', () => {
    // Move selection from 0 → 20 and verify the scroll effect's target
    // position is 20 (new head), not 0 (old head). Regression guard
    // against anyone swapping `tr.newSelection.main.head` for
    // `tr.startState.selection.main.head` — exactly the kind of subtle
    // bug that would resurrect the original "cursor leaves viewport"
    // problem in a form that passes every selection-doesn't-move test.
    //
    // We inspect the scroll effect's value directly (via
    // `readScrollTargetPos`) so the assertion catches the regression
    // even when the selection itself commits to the right offset.
    const state = EditorState.create({
      doc: 'line one\nline two\nline three\nline four',
    })
    const tr = state.update({ selection: { anchor: 20, head: 20 } })

    expect(tr.newSelection.main.head).toBe(20)
    expect(tr.startState.selection.main.head).toBe(0)

    const result = scrollCursorOnSelectionChange(tr)
    const effects = getScrollEffects(result)

    const targetPos =
      effects.length > 0 ? readScrollTargetPos(effects[0]) : undefined

    expect(targetPos).toBe(20)
  })

  test('returns null for doc change (insert mode path)', () => {
    // Insert mode typing uses CodeMirror's built-in scroll path because
    // every keystroke is a doc change. The extender MUST early-return
    // here so we don't duplicate the built-in scroll or fight with it.
    const state = EditorState.create({ doc: 'hello' })
    const tr = state.update({ changes: { from: 5, insert: ' world' } })

    const result = scrollCursorOnSelectionChange(tr)

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

    const result = scrollCursorOnSelectionChange(tr)

    expect(result).toBeNull()
  })
})
