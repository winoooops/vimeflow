import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createRef, type RefObject } from 'react'
import { useKeyboard, type UseKeyboardOptions } from './useKeyboard'

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
  overrides: Partial<UseKeyboardOptions> = {}
): {
  root: HTMLDivElement
  props: UseKeyboardOptions
  unmount: () => void
} => {
  const { root, ref } = appendDiffRoot()

  const props: UseKeyboardOptions = {
    enabled: true,
    rootRef: ref,
    confirming: false,
    onMoveLine: vi.fn(),
    onScrollPage: vi.fn(),
    onPreviousFile: vi.fn(),
    onNextFile: vi.fn(),
    onToggleFilesList: vi.fn(),
    onToggleFilesListPinned: vi.fn(),
    onRefreshDiff: vi.fn(),
    searchOpen: false,
    onOpenSearch: vi.fn(),
    onCloseSearch: vi.fn(),
    onNextMatch: vi.fn(),
    onPreviousMatch: vi.fn(),
    onPreviousHunk: vi.fn(),
    onNextHunk: vi.fn(),
    onComment: vi.fn(),
    onFileComment: vi.fn(),
    onUpdateComment: vi.fn(),
    onUpdateFileComment: vi.fn(),
    onDeleteComment: vi.fn(),
    onFinishReview: vi.fn(),
    onRequestReview: vi.fn(),
    onStageHunk: vi.fn(),
    onDiscardHunk: vi.fn(),
    onDiscardFile: vi.fn(),
    onToggleView: vi.fn(),
    onMoveLineSide: vi.fn(),
    visualMode: false,
    onStartVisualSelection: vi.fn(),
    onYankSelection: vi.fn(),
    onCancelVisualSelection: vi.fn(),
    onConfirm: vi.fn(),
    onCancelConfirm: vi.fn(),
    ...overrides,
  }
  const { unmount } = renderHook(() => useKeyboard(props))

  return { root, props, unmount }
}

describe('useKeyboard', () => {
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

  test('[ and ] navigate hunks', () => {
    const { props } = renderKeyboard()

    dispatch('[')
    dispatch(']')

    expect(props.onPreviousHunk).toHaveBeenCalledOnce()
    expect(props.onNextHunk).toHaveBeenCalledOnce()
  })

  test('e toggles the changed-files list', () => {
    const { props } = renderKeyboard()

    dispatch('e')

    expect(props.onToggleFilesList).toHaveBeenCalledOnce()
  })

  test('Shift+E toggles the sticky changed-files list', () => {
    const { props } = renderKeyboard()

    dispatch('E')

    expect(props.onToggleFilesListPinned).toHaveBeenCalledOnce()
    expect(props.onToggleFilesList).not.toHaveBeenCalled()
  })

  test('r refreshes the diff', () => {
    const { props } = renderKeyboard()

    dispatch('r')

    expect(props.onRefreshDiff).toHaveBeenCalledOnce()
  })

  test('i opens comment editor for the selected line', () => {
    const { props } = renderKeyboard()

    dispatch('i')

    expect(props.onComment).toHaveBeenCalledOnce()
  })

  test('Shift+I opens comment editor for the selected file', () => {
    const { props } = renderKeyboard()

    dispatch('I')

    expect(props.onFileComment).toHaveBeenCalledOnce()
    expect(props.onComment).not.toHaveBeenCalled()
  })

  test('u and x update or delete the selected comment', () => {
    const { props } = renderKeyboard()

    dispatch('u')
    dispatch('x')

    expect(props.onUpdateComment).toHaveBeenCalledOnce()
    expect(props.onDeleteComment).toHaveBeenCalledOnce()
  })

  test('Shift+U updates the selected file comment', () => {
    const { props } = renderKeyboard()

    dispatch('U')

    expect(props.onUpdateFileComment).toHaveBeenCalledOnce()
    expect(props.onUpdateComment).not.toHaveBeenCalled()
  })

  test('Y opens finish review', () => {
    const { props } = renderKeyboard()

    dispatch('Y')

    expect(props.onFinishReview).toHaveBeenCalledOnce()
  })

  test('@ opens request review', () => {
    const { props } = renderKeyboard()

    dispatch('@')

    expect(props.onRequestReview).toHaveBeenCalledOnce()
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

  test('h and l move the keyboard line between split sides', () => {
    const { props } = renderKeyboard()

    dispatch('h')
    dispatch('l')

    expect(props.onMoveLineSide).toHaveBeenNthCalledWith(1, 'deletions')
    expect(props.onMoveLineSide).toHaveBeenNthCalledWith(2, 'additions')
  })

  test('v starts visual mode and y yanks the selection', () => {
    const { props } = renderKeyboard()

    dispatch('v')
    dispatch('y')

    expect(props.onStartVisualSelection).toHaveBeenCalledOnce()
    expect(props.onYankSelection).toHaveBeenCalledOnce()
  })

  test('Escape cancels only while visual mode is active', () => {
    const inactive = renderKeyboard()

    dispatch('Escape')
    expect(inactive.props.onCancelVisualSelection).not.toHaveBeenCalled()
    inactive.unmount()

    const active = renderKeyboard({ visualMode: true })
    const event = dispatch('Escape')

    expect(active.props.onCancelVisualSelection).toHaveBeenCalledOnce()
    expect(event.preventDefaultSpy).toHaveBeenCalledOnce()
    expect(event.stopPropagationSpy).toHaveBeenCalledOnce()
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

  test('r is inert while a keyboard confirmation is open', () => {
    const { props } = renderKeyboard({ confirming: true })

    dispatch('r')

    expect(props.onRefreshDiff).not.toHaveBeenCalled()
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
    const props: UseKeyboardOptions = {
      enabled: true,
      rootRef: createRef<HTMLElement>(),
      confirming: false,
      onMoveLine: vi.fn(),
      onScrollPage: vi.fn(),
      onPreviousFile: vi.fn(),
      onNextFile: vi.fn(),
      onToggleFilesList: vi.fn(),
      onToggleFilesListPinned: vi.fn(),
      onRefreshDiff: vi.fn(),
      searchOpen: false,
      onOpenSearch: vi.fn(),
      onCloseSearch: vi.fn(),
      onNextMatch: vi.fn(),
      onPreviousMatch: vi.fn(),
      onPreviousHunk: vi.fn(),
      onNextHunk: vi.fn(),
      onComment: vi.fn(),
      onFileComment: vi.fn(),
      onUpdateComment: vi.fn(),
      onUpdateFileComment: vi.fn(),
      onDeleteComment: vi.fn(),
      onFinishReview: vi.fn(),
      onRequestReview: vi.fn(),
      onStageHunk: vi.fn(),
      onDiscardHunk: vi.fn(),
      onDiscardFile: vi.fn(),
      onToggleView: vi.fn(),
      onMoveLineSide: vi.fn(),
      visualMode: false,
      onStartVisualSelection: vi.fn(),
      onYankSelection: vi.fn(),
      onCancelVisualSelection: vi.fn(),
      onConfirm: vi.fn(),
      onCancelConfirm: vi.fn(),
    }

    renderHook(() => useKeyboard(props))
    dispatch('j')

    expect(props.onMoveLine).not.toHaveBeenCalled()
  })

  describe('search mode', () => {
    test('/ fires onOpenSearch and is prevented', () => {
      const onOpenSearch = vi.fn()
      renderKeyboard({ onOpenSearch })

      const event = dispatch('/')

      expect(onOpenSearch).toHaveBeenCalledTimes(1)
      expect(event.preventDefaultSpy).toHaveBeenCalled()
    })

    test('searchOpen remaps n/p to match navigation', () => {
      const onNextMatch = vi.fn()
      const onPreviousMatch = vi.fn()
      const onNextFile = vi.fn()
      renderKeyboard({
        searchOpen: true,
        onNextMatch,
        onPreviousMatch,
        onNextFile,
      })

      dispatch('n')
      dispatch('p')

      expect(onNextMatch).toHaveBeenCalledTimes(1)
      expect(onPreviousMatch).toHaveBeenCalledTimes(1)
      expect(onNextFile).not.toHaveBeenCalled()
    })

    test('search closed keeps n/p on file navigation', () => {
      const onNextFile = vi.fn()
      const onNextMatch = vi.fn()
      renderKeyboard({ searchOpen: false, onNextFile, onNextMatch })

      dispatch('n')

      expect(onNextFile).toHaveBeenCalledTimes(1)
      expect(onNextMatch).not.toHaveBeenCalled()
    })

    test('Esc closes search before cancelling visual mode', () => {
      const onCloseSearch = vi.fn()
      const onCancelVisualSelection = vi.fn()
      renderKeyboard({
        searchOpen: true,
        visualMode: true,
        onCloseSearch,
        onCancelVisualSelection,
      })

      dispatch('Escape')

      expect(onCloseSearch).toHaveBeenCalledTimes(1)
      expect(onCancelVisualSelection).not.toHaveBeenCalled()
    })

    test('confirming keeps Esc and / inert', () => {
      const onCloseSearch = vi.fn()
      const onOpenSearch = vi.fn()
      renderKeyboard({
        confirming: true,
        searchOpen: true,
        onCloseSearch,
        onOpenSearch,
      })

      dispatch('Escape')
      dispatch('/')

      expect(onCloseSearch).not.toHaveBeenCalled()
      expect(onOpenSearch).not.toHaveBeenCalled()
    })

    test('other diff keys stay bound while search is open', () => {
      const onStageHunk = vi.fn()
      renderKeyboard({ searchOpen: true, onStageHunk })

      dispatch('s')

      expect(onStageHunk).toHaveBeenCalledTimes(1)
    })

    test('r still refreshes the diff while search is open', () => {
      const onRefreshDiff = vi.fn()
      renderKeyboard({ searchOpen: true, onRefreshDiff })

      dispatch('r')

      expect(onRefreshDiff).toHaveBeenCalledTimes(1)
    })
  })
})
