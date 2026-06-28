import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createRef, type RefObject } from 'react'
import { useDiffKeyboard, type UseDiffKeyboardOptions } from './useDiffKeyboard'

const dispatch = (
  key: string,
  target?: Element,
  init: KeyboardEventInit = {}
): KeyboardEvent & {
  preventDefaultSpy: ReturnType<typeof vi.spyOn>
  stopPropagationSpy: ReturnType<typeof vi.spyOn>
} => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
  const stopPropagationSpy = vi.spyOn(event, 'stopPropagation')

  if (target) {
    target.dispatchEvent(event)
  } else {
    document.dispatchEvent(event)
  }

  return Object.assign(event, {
    preventDefaultSpy,
    stopPropagationSpy,
  })
}

const appendDiffRoot = (): {
  root: HTMLDivElement
  ref: RefObject<HTMLElement | null>
} => {
  const panel = document.createElement('div')
  panel.setAttribute('data-testid', 'diff-panel')
  const root = document.createElement('div')
  root.tabIndex = -1
  panel.appendChild(root)
  document.body.appendChild(panel)
  root.focus()

  return {
    root,
    ref: { current: root },
  }
}

const renderKeyboard = (
  overrides: Partial<UseDiffKeyboardOptions> = {}
): {
  root: HTMLDivElement
  props: UseDiffKeyboardOptions
  unmount: () => void
} => {
  const { root, ref } = appendDiffRoot()

  const props: UseDiffKeyboardOptions = {
    enabled: true,
    rootRef: ref,
    confirming: false,
    onMoveLine: vi.fn(),
    onScrollPage: vi.fn(),
    onPreviousFile: vi.fn(),
    onNextFile: vi.fn(),
    onComment: vi.fn(),
    onStageHunk: vi.fn(),
    onDiscardHunk: vi.fn(),
    onDiscardFile: vi.fn(),
    onToggleView: vi.fn(),
    onConfirm: vi.fn(),
    onCancelConfirm: vi.fn(),
    ...overrides,
  }
  const { unmount } = renderHook(() => useDiffKeyboard(props))

  return { root, props, unmount }
}

describe('useDiffKeyboard', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  test('j and k move the selected line down and up', () => {
    const { props } = renderKeyboard()

    dispatch('j')
    dispatch('k')

    expect(props.onMoveLine).toHaveBeenNthCalledWith(1, 1)
    expect(props.onMoveLine).toHaveBeenNthCalledWith(2, -1)
  })

  test('n and p navigate files', () => {
    const { props } = renderKeyboard()

    dispatch('n')
    dispatch('p')

    expect(props.onNextFile).toHaveBeenCalledOnce()
    expect(props.onPreviousFile).toHaveBeenCalledOnce()
  })

  test('c opens comment composer for the selected line', () => {
    const { props } = renderKeyboard()

    dispatch('c')

    expect(props.onComment).toHaveBeenCalledOnce()
  })

  test('s, d, and D request keyboard confirmations for hunk/file actions', () => {
    const { props } = renderKeyboard()

    dispatch('s')
    dispatch('d')
    dispatch('D')

    expect(props.onStageHunk).toHaveBeenCalledOnce()
    expect(props.onDiscardHunk).toHaveBeenCalledOnce()
    expect(props.onDiscardFile).toHaveBeenCalledOnce()
  })

  test('t toggles split/unified view', () => {
    const { props } = renderKeyboard()

    dispatch('t')

    expect(props.onToggleView).toHaveBeenCalledOnce()
  })

  test('Ctrl+D and Ctrl+U scroll the current file', () => {
    const { props } = renderKeyboard()

    dispatch('d', undefined, { ctrlKey: true })
    dispatch('u', undefined, { ctrlKey: true })

    expect(props.onScrollPage).toHaveBeenNthCalledWith(1, 1)
    expect(props.onScrollPage).toHaveBeenNthCalledWith(2, -1)
  })

  test('y and n confirm or cancel while a keyboard confirmation is open', () => {
    const { props } = renderKeyboard({ confirming: true })

    dispatch('y')
    dispatch('n')

    expect(props.onConfirm).toHaveBeenCalledOnce()
    expect(props.onCancelConfirm).toHaveBeenCalledOnce()
    expect(props.onNextFile).not.toHaveBeenCalled()
  })

  test('handled shortcuts prevent default and stop propagation', () => {
    renderKeyboard()

    const event = dispatch('j')

    expect(event.preventDefaultSpy).toHaveBeenCalledOnce()
    expect(event.stopPropagationSpy).toHaveBeenCalledOnce()
  })

  test('does nothing when disabled', () => {
    const { props } = renderKeyboard({ enabled: false })

    dispatch('j')

    expect(props.onMoveLine).not.toHaveBeenCalled()
  })

  test('ignores events when diff root does not own focus', () => {
    const { props } = renderKeyboard()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    dispatch('j', outside)

    expect(props.onMoveLine).not.toHaveBeenCalled()
  })

  test('ignores keyboard events in text inputs', () => {
    const { props, root } = renderKeyboard()
    const input = document.createElement('input')
    root.appendChild(input)
    input.focus()

    dispatch('j', input)

    expect(props.onMoveLine).not.toHaveBeenCalled()
  })

  test('ignores keyboard events in textarea elements', () => {
    const { props, root } = renderKeyboard()
    const textarea = document.createElement('textarea')
    root.appendChild(textarea)
    textarea.focus()

    dispatch('j', textarea)

    expect(props.onMoveLine).not.toHaveBeenCalled()
  })

  test('ignores keyboard events in contenteditable elements', () => {
    const { props, root } = renderKeyboard()
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    root.appendChild(editable)
    editable.focus()

    dispatch('j', editable)

    expect(props.onMoveLine).not.toHaveBeenCalled()
  })

  test('ignores shortcuts while a dialog is open', () => {
    const { props } = renderKeyboard()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)

    dispatch('j')

    expect(props.onMoveLine).not.toHaveBeenCalled()
  })

  test('ignores shortcuts from terminal zone and CodeMirror', () => {
    const { props } = renderKeyboard()

    const terminal = document.createElement('div')
    terminal.setAttribute('data-container-id', 'terminal')
    document.body.appendChild(terminal)
    terminal.focus()
    dispatch('j', terminal)

    const cm = document.createElement('div')
    cm.className = 'cm-editor'
    document.body.appendChild(cm)
    cm.focus()
    dispatch('k', cm)

    expect(props.onMoveLine).not.toHaveBeenCalled()
  })

  test('unmount removes listener', () => {
    const { props, unmount } = renderKeyboard()

    unmount()
    dispatch('j')

    expect(props.onMoveLine).not.toHaveBeenCalled()
  })

  test('null root ref is ignored', () => {
    const props: UseDiffKeyboardOptions = {
      enabled: true,
      rootRef: createRef<HTMLElement>(),
      confirming: false,
      onMoveLine: vi.fn(),
      onScrollPage: vi.fn(),
      onPreviousFile: vi.fn(),
      onNextFile: vi.fn(),
      onComment: vi.fn(),
      onStageHunk: vi.fn(),
      onDiscardHunk: vi.fn(),
      onDiscardFile: vi.fn(),
      onToggleView: vi.fn(),
      onConfirm: vi.fn(),
      onCancelConfirm: vi.fn(),
    }

    renderHook(() => useDiffKeyboard(props))
    dispatch('j')

    expect(props.onMoveLine).not.toHaveBeenCalled()
  })
})
