import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  NativeOverlayCommandPaletteDialogPayload,
  NativeOverlayRequest,
} from '@/components/base/floating/nativeOverlay'
import { NativeOverlayHost } from './NativeOverlayHost'

const request: NativeOverlayRequest = {
  surfaceId: 'surface-1',
  kind: 'menu',
  anchorRect: { x: 24, y: 32, width: 0, height: 0 },
  placement: 'bottom-start',
  payload: {
    kind: 'menu',
    ariaLabel: 'Terminal actions',
    items: [
      {
        id: 'copy',
        label: 'Copy',
        shortcut: '⌘C',
      },
    ],
  },
}

const sectionRequest: NativeOverlayRequest = {
  surfaceId: 'surface-2',
  kind: 'menu',
  anchorRect: { x: 40, y: 48, width: 24, height: 20 },
  placement: 'bottom-end',
  payload: {
    kind: 'menu',
    ariaLabel: 'Displayed layouts',
    sections: [
      {
        label: 'Displayed layouts',
        items: [
          {
            type: 'checkbox',
            id: 'toggle-quad',
            label: 'Quad',
            checked: true,
          },
        ],
      },
      {
        items: [
          { type: 'separator' },
          {
            id: 'create-custom',
            label: 'Create custom layout',
            icon: 'dashboard_customize',
          },
        ],
      },
    ],
  },
}

const compositeRequest: NativeOverlayRequest = {
  surfaceId: 'surface-3',
  kind: 'menu',
  anchorRect: { x: 40, y: 48, width: 24, height: 20 },
  placement: 'bottom-end',
  payload: {
    kind: 'menu',
    ariaLabel: 'Displayed layouts',
    sections: [
      {
        label: 'Custom',
        items: [
          {
            type: 'composite',
            id: 'pick-custom',
            label: 'Main + bottom',
            icon: 'dashboard',
            active: true,
            actions: [
              {
                id: 'edit-custom',
                label: 'Edit Main + bottom',
                icon: 'edit',
              },
              {
                id: 'duplicate-custom',
                label: 'Duplicate Main + bottom',
                icon: 'content_copy',
              },
              {
                id: 'toggle-custom',
                label: 'Hide Main + bottom from switcher',
                icon: 'visibility',
                pressed: true,
              },
            ],
          },
        ],
      },
    ],
  },
}

const detailRequest: NativeOverlayRequest = {
  surfaceId: 'surface-4',
  kind: 'menu',
  anchorRect: { x: 40, y: 48, width: 196, height: 22 },
  placement: 'bottom',
  theme: {
    id: 'flexoki',
    colorScheme: 'light',
    variables: {
      '--color-surface-container-high': 'var(--color-test-surface-high)',
      '--color-on-surface': 'var(--color-test-on-surface)',
      '--shadow-menu': 'var(--shadow-test-menu)',
    },
  },
  payload: {
    kind: 'menu',
    ariaLabel: 'Git ref details',
    matchAnchorWidth: true,
    surfaceTone: 'primary-container-soft',
    items: [
      {
        id: 'copy-path',
        label: 'Copy path',
        detail:
          '/Users/will/projects/vimeflow/worktrees/native-overlay-git-ref',
        icon: 'folder_open',
        feedback: 'copy',
        closeOnSelect: false,
      },
    ],
  },
}

const tooltipRequest: NativeOverlayRequest = {
  surfaceId: 'tooltip-1',
  kind: 'tooltip',
  anchorRect: { x: 100, y: 120, width: 30, height: 20 },
  placement: 'top',
  payload: {
    kind: 'tooltip',
    text: 'collapse status',
    maxWidth: 240,
  },
}

const shortcutTooltipRequest: NativeOverlayRequest = {
  ...tooltipRequest,
  surfaceId: 'tooltip-2',
  payload: {
    kind: 'tooltip',
    text: 'Diff Viewer',
    shortcut: '⌘G',
  },
}

const activityPopoverRequest: NativeOverlayRequest = {
  surfaceId: 'activity-popover-1',
  kind: 'popover',
  anchorRect: { x: 640, y: 120, width: 240, height: 48 },
  placement: 'left',
  payload: {
    kind: 'popover',
    popover: 'activity',
    ariaLabel: 'BASH activity details',
    activateActionId: 'activity:activate',
    event: {
      id: 'activity-1',
      kind: 'bash',
      timestamp: '2026-07-10T12:00:00.000Z',
      status: 'done',
      body: 'npm test',
      tool: 'Bash',
      durationMs: 1200,
    },
  },
}

const commandPaletteRequest: NativeOverlayRequest & {
  payload: NativeOverlayCommandPaletteDialogPayload
} = {
  surfaceId: 'dialog-1',
  kind: 'dialog',
  anchorRect: { x: 0, y: 0, width: 900, height: 600 },
  placement: 'top',
  payload: {
    kind: 'dialog',
    dialog: 'command-palette',
    ariaLabel: 'Command palette',
    query: ':',
    selectedIndex: 0,
    activeDescendantId: 'command-help',
    results: [
      {
        id: 'help',
        label: ':help',
        description: 'Show command reference',
        icon: 'help',
        shortcut: ['Cmd', ';'],
      },
    ],
    actions: {
      selectIndex: 'command-palette:select-index',
      executeIndex: 'command-palette:execute-index',
      setQuery: 'command-palette:set-query',
    },
  },
}

const newSessionRequest: NativeOverlayRequest = {
  surfaceId: 'dialog-2',
  kind: 'dialog',
  anchorRect: { x: 0, y: 0, width: 900, height: 600 },
  placement: 'top',
  payload: {
    kind: 'dialog',
    dialog: 'new-session',
    ariaLabel: 'New session',
    name: 'vimeflow-core',
    path: '~/code/vimeflow-core',
    nameEdited: false,
    selectedLayoutId: 'vsplit',
    activeCommandPaneIndex: 1,
    layouts: [
      {
        id: 'single',
        label: 'Single',
        capacity: 1,
        cols: 'minmax(0,1fr)',
        rows: 'minmax(0,1fr)',
        areas: [['p0']],
      },
      {
        id: 'vsplit',
        label: 'Vertical split',
        capacity: 2,
        cols: 'minmax(0,1fr) minmax(0,1fr)',
        rows: 'minmax(0,1fr)',
        areas: [['p0', 'p1']],
      },
    ],
    panes: [
      { index: 0, areaName: 'p0', commandId: 'claude' },
      { index: 1, areaName: 'p1', commandId: 'shell' },
    ],
    commands: [
      {
        id: 'claude',
        label: 'Claude Code',
        accentVar: '--color-agent-claude-accent',
        glyph: 'C',
      },
      {
        id: 'codex',
        label: 'Codex CLI',
        accentVar: '--color-agent-codex-accent',
        glyph: 'X',
      },
      {
        id: 'shell',
        label: 'Shell',
        accentVar: '--color-agent-shell-accent',
        glyph: '$',
      },
    ],
    actions: {
      focusName: 'new-session:focus-name',
      resetName: 'new-session:reset-name',
      browse: 'new-session:browse',
      cancel: 'new-session:cancel',
      create: 'new-session:create',
      selectPanePrefix: 'new-session:select-pane:',
      pickLayoutPrefix: 'new-session:pick-layout:',
      pickCommandPrefix: 'new-session:pick-command:',
    },
  },
}

const sessionSwitcherRequest: NativeOverlayRequest = {
  surfaceId: 'dialog-session-switcher',
  kind: 'dialog',
  anchorRect: { x: 0, y: 0, width: 900, height: 600 },
  placement: 'top',
  payload: {
    kind: 'dialog',
    dialog: 'session-switcher',
    ariaLabel: 'Session switcher',
    selectedIndex: 1,
    items: [
      { id: 'a', title: 'api server', isActive: true },
      { id: 'b', title: 'docs', agentGlyph: 'C', isActive: false },
    ],
    actions: {
      commitIndex: 'session-switcher:commit-index',
      cancel: 'session-switcher:cancel',
    },
  },
}

let cleanupHostBridgeEvents: (() => void) | null = null

const installNativeOverlayHostBridge = (): {
  ready: ReturnType<typeof vi.fn>
  action: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  ownerOverlayClose: ReturnType<typeof vi.fn>
  emitRender: (payload: unknown) => void
  emitClear: () => void
  emitActionResult: (payload: unknown) => void
  emitKeyDown: (payload: unknown) => void
} => {
  cleanupHostBridgeEvents?.()
  const renderEvent = 'native-overlay-host-render'
  const clearEvent = 'native-overlay-host-clear'
  const actionResultEvent = 'native-overlay-host-action-result'
  const keyDownEvent = 'native-overlay-host-keydown'
  let renderListener: ((payload: unknown) => void) | null = null
  let clearListener: (() => void) | null = null
  let actionResultListener: ((payload: unknown) => void) | null = null
  let keyDownListener: ((payload: unknown) => void) | null = null
  const ready = vi.fn(() => Promise.resolve())
  const action = vi.fn(() => Promise.resolve())
  const close = vi.fn(() => Promise.resolve())
  const ownerOverlayClose = vi.fn(() => Promise.resolve())

  const handleRenderEvent = (event: Event): void => {
    renderListener?.((event as CustomEvent<unknown>).detail)
  }

  const handleClearEvent = (): void => {
    clearListener?.()
  }

  const handleActionResultEvent = (event: Event): void => {
    actionResultListener?.((event as CustomEvent<unknown>).detail)
  }

  const handleKeyDownEvent = (event: Event): void => {
    keyDownListener?.((event as CustomEvent<unknown>).detail)
  }

  window.addEventListener(renderEvent, handleRenderEvent)
  window.addEventListener(clearEvent, handleClearEvent)
  window.addEventListener(actionResultEvent, handleActionResultEvent)
  window.addEventListener(keyDownEvent, handleKeyDownEvent)
  cleanupHostBridgeEvents = (): void => {
    window.removeEventListener(renderEvent, handleRenderEvent)
    window.removeEventListener(clearEvent, handleClearEvent)
    window.removeEventListener(actionResultEvent, handleActionResultEvent)
    window.removeEventListener(keyDownEvent, handleKeyDownEvent)
    cleanupHostBridgeEvents = null
  }

  window.vimeflow = {
    invoke: <T,>(): Promise<T> => Promise.resolve(null as T),
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    nativeOverlayHost: {
      ready,
      action,
      close,
      onRender: vi.fn((callback: (payload: unknown) => void) => {
        renderListener = callback

        return vi.fn()
      }),
      onClear: vi.fn((callback: () => void) => {
        clearListener = callback

        return vi.fn()
      }),
      onActionResult: vi.fn((callback: (payload: unknown) => void) => {
        actionResultListener = callback

        return vi.fn()
      }),
      onKeyDown: vi.fn((callback: (payload: unknown) => void) => {
        keyDownListener = callback

        return vi.fn()
      }),
    },
    nativeOverlay: {
      open: vi.fn(() => Promise.resolve({ accepted: true })),
      close: ownerOverlayClose,
      actionResult: vi.fn(() => Promise.resolve()),
      resume: vi.fn(() => Promise.resolve()),
      onAction: vi.fn(() => vi.fn()),
      onClose: vi.fn(() => vi.fn()),
    },
  }

  return {
    ready,
    action,
    close,
    ownerOverlayClose,
    emitRender: (payload): void => {
      fireEvent(window, new CustomEvent(renderEvent, { detail: payload }))
    },
    emitClear: (): void => {
      fireEvent(window, new CustomEvent(clearEvent))
    },
    emitActionResult: (payload): void => {
      fireEvent(window, new CustomEvent(actionResultEvent, { detail: payload }))
    },
    emitKeyDown: (payload): void => {
      fireEvent(window, new CustomEvent(keyDownEvent, { detail: payload }))
    },
  }
}

afterEach(() => {
  cleanupHostBridgeEvents?.()
  document.body.removeAttribute('data-native-overlay-host')
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-theme')
  delete window.vimeflow
})

describe('NativeOverlayHost', () => {
  test('renders a native overlay menu request with the shared Menu primitive', async () => {
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(request)

    expect(
      await screen.findByRole('menu', { name: 'Terminal actions' })
    ).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument()
    expect(document.body.dataset.nativeOverlayHost).toBe('true')
    await waitFor(() => {
      expect(bridge.ready).toHaveBeenCalledWith({ surfaceId: 'surface-1' })
    })
    expect(bridge.ownerOverlayClose).not.toHaveBeenCalled()
  })

  test('renders a passive native overlay tooltip request in tooltip mode', async () => {
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost mode="tooltip" />)

    bridge.emitRender(tooltipRequest)

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('collapse status')
    expect(tooltip).toHaveClass('whitespace-nowrap')
    expect(tooltip).toHaveStyle({
      left: '115px',
      top: '114px',
      transform: 'translate(-50%, -100%)',
    })

    await waitFor(() => {
      expect(bridge.ready).toHaveBeenCalledWith({ surfaceId: 'tooltip-1' })
    })

    bridge.emitClear()

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('renders a shortcut chip for native overlay tooltip requests', async () => {
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost mode="tooltip" />)

    bridge.emitRender(shortcutTooltipRequest)

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Diff Viewer')
    expect(
      within(tooltip).getByTestId('native-overlay-tooltip-shortcut')
    ).toHaveTextContent('⌘G')
  })

  test('renders activity popovers on the interactive menu layer', async () => {
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(activityPopoverRequest)

    const dialog = await screen.findByRole('dialog', {
      name: 'BASH activity details',
    })
    expect(dialog).toHaveClass('w-[min(24rem,calc(100vw-2rem))]')
    expect(within(dialog).getByText('npm test')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Copy activity details' })
    ).toBeInTheDocument()

    const trigger = screen.getByRole('button', {
      name: 'BASH activity details',
    })

    fireEvent.pointerDown(trigger)
    expect(bridge.close).not.toHaveBeenCalled()
    fireEvent.click(trigger)

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'activity-popover-1',
      actionId: 'activity:activate',
    })
  })

  test('renders command palette dialog requests on the menu layer', async () => {
    const user = userEvent.setup()
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(commandPaletteRequest)

    const dialog = await screen.findByRole('dialog', {
      name: 'Command palette',
    })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveClass('bg-scrim/60')
    expect(screen.getByRole('combobox')).toHaveValue(':')
    expect(screen.getByRole('combobox')).toHaveAttribute('readonly')
    expect(screen.getByRole('option', { name: /:help/i })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    await user.click(screen.getByRole('option', { name: /:help/i }))

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'dialog-1',
      actionId: 'command-palette:execute-index',
      closeOnSelect: false,
      index: 0,
    })

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBe(dialog)
  })

  test('forwards command palette typed query and keyboard actions', async () => {
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(commandPaletteRequest)

    await screen.findByRole('dialog', {
      name: 'Command palette',
    })

    bridge.emitKeyDown({
      surfaceId: 'dialog-1',
      key: 'o',
      code: 'KeyO',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    })

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'dialog-1',
      actionId: 'command-palette:set-query',
      closeOnSelect: false,
      query: ':o',
    })

    bridge.emitKeyDown({
      surfaceId: 'dialog-1',
      key: 'p',
      code: 'KeyP',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    })

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'dialog-1',
      actionId: 'command-palette:set-query',
      closeOnSelect: false,
      query: ':op',
    })

    bridge.emitRender({
      ...commandPaletteRequest,
      payload: {
        ...commandPaletteRequest.payload,
        query: ':o',
      },
    })

    bridge.emitKeyDown({
      surfaceId: 'dialog-1',
      key: 'Backspace',
      code: 'Backspace',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    })

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'dialog-1',
      actionId: 'command-palette:set-query',
      closeOnSelect: false,
      query: ':o',
    })

    bridge.emitKeyDown({
      surfaceId: 'dialog-1',
      key: 'Enter',
      code: 'Enter',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    })

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'dialog-1',
      actionId: 'command-palette:execute-index',
      closeOnSelect: false,
      index: 0,
    })
  })

  test('does not execute a stale command palette selection', async () => {
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender({
      ...commandPaletteRequest,
      payload: {
        ...commandPaletteRequest.payload,
        selectedIndex: 1,
        results: [
          ...commandPaletteRequest.payload.results,
          {
            id: 'open',
            label: ':open',
            description: 'Open file',
            icon: 'folder_open',
          },
        ],
      },
    })

    await screen.findByRole('dialog', {
      name: 'Command palette',
    })

    bridge.emitRender({
      ...commandPaletteRequest,
      payload: {
        ...commandPaletteRequest.payload,
        selectedIndex: 1,
        results: commandPaletteRequest.payload.results,
      },
    })

    bridge.action.mockClear()
    bridge.emitKeyDown({
      surfaceId: 'dialog-1',
      key: 'Enter',
      code: 'Enter',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    })

    expect(bridge.action).not.toHaveBeenCalled()
  })

  test('resets optimistic command palette selection on query edits', async () => {
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender({
      ...commandPaletteRequest,
      payload: {
        ...commandPaletteRequest.payload,
        results: [
          ...commandPaletteRequest.payload.results,
          {
            id: 'open',
            label: ':open',
            description: 'Open file',
            icon: 'folder_open',
          },
        ],
      },
    })

    await screen.findByRole('dialog', {
      name: 'Command palette',
    })

    bridge.emitKeyDown({
      surfaceId: 'dialog-1',
      key: 'ArrowDown',
      code: 'ArrowDown',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    })

    bridge.action.mockClear()
    bridge.emitKeyDown({
      surfaceId: 'dialog-1',
      key: 'o',
      code: 'KeyO',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    })

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'dialog-1',
      actionId: 'command-palette:set-query',
      closeOnSelect: false,
      query: ':o',
    })

    bridge.emitKeyDown({
      surfaceId: 'dialog-1',
      key: 'Enter',
      code: 'Enter',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    })

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'dialog-1',
      actionId: 'command-palette:execute-index',
      closeOnSelect: false,
      index: 0,
    })
  })

  test('renders new session dialog requests and dispatches actions', async () => {
    const user = userEvent.setup()
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(newSessionRequest)

    const dialog = await screen.findByRole('dialog', {
      name: 'New session',
    })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('vimeflow-core')).toBeInTheDocument()
    expect(screen.getByText('~/code/vimeflow-core')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Single 1' }))
    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'dialog-2',
      actionId: 'new-session:pick-layout:single',
      closeOnSelect: false,
    })

    await user.click(screen.getByRole('button', { name: 'Codex CLI' }))
    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'dialog-2',
      actionId: 'new-session:pick-command:1:codex',
      closeOnSelect: false,
    })

    const browseButton = screen.getByRole('button', { name: 'Browse' })
    expect(browseButton).toHaveClass('cursor-pointer')

    await user.click(browseButton)
    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'dialog-2',
      actionId: 'new-session:browse',
      closeOnSelect: false,
      suspendOnSelect: true,
    })

    await user.click(screen.getByRole('button', { name: 'Create session' }))
    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'dialog-2',
      actionId: 'new-session:create',
      closeOnSelect: true,
    })
  })

  test('renders session switcher dialog requests and dispatches the commit action', async () => {
    const user = userEvent.setup()
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(sessionSwitcherRequest)

    const listbox = await screen.findByRole('listbox', {
      name: 'Session switcher',
    })
    const options = within(listbox).getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]).toHaveAttribute('aria-selected', 'false')

    await user.click(screen.getByRole('option', { name: /docs/ }))
    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'dialog-session-switcher',
      actionId: 'session-switcher:commit-index',
      closeOnSelect: false,
      index: 1,
    })
  })

  test('renders the session switcher inside a modal dialog shell that closes on outside mousedown', async () => {
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(sessionSwitcherRequest)

    const dialog = await screen.findByRole('dialog', {
      name: 'Session switcher',
    })
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    const listbox = within(dialog).getByRole('listbox', {
      name: 'Session switcher',
    })
    expect(listbox).toBeInTheDocument()
    // eslint-disable-next-line testing-library/no-node-access -- the viewport bound lives on the scrollable panel wrapping the list
    expect(listbox.closest('.overflow-y-auto')).toHaveClass(
      'max-h-[min(480px,60vh)]'
    )

    fireEvent.mouseDown(dialog)
    await waitFor(() => {
      expect(bridge.close).toHaveBeenCalledWith({
        surfaceId: 'dialog-session-switcher',
        reason: 'outside',
      })
    })
  })

  test('scrolls the selected session switcher option into view', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    try {
      bridge.emitRender(sessionSwitcherRequest)
      await screen.findByRole('listbox', { name: 'Session switcher' })
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })

      scrollIntoView.mockClear()
      bridge.emitRender({
        ...sessionSwitcherRequest,
        payload: { ...sessionSwitcherRequest.payload, selectedIndex: 0 },
      })

      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
      })
    } finally {
      scrollIntoView.mockRestore()
    }
  })

  test('scrolls the selected command palette row into view', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    try {
      bridge.emitRender({
        ...commandPaletteRequest,
        payload: {
          kind: 'dialog',
          dialog: 'command-palette',
          ariaLabel: 'Command palette',
          query: ':',
          selectedIndex: 1,
          activeDescendantId: 'command-open',
          results: [
            {
              id: 'help',
              label: ':help',
              description: 'Show command reference',
              icon: 'help',
            },
            {
              id: 'open',
              label: ':open',
              description: 'Open file',
              icon: 'folder_open',
            },
          ],
          actions: {
            selectIndex: 'command-palette:select-index',
            executeIndex: 'command-palette:execute-index',
            setQuery: 'command-palette:set-query',
          },
        },
      })

      expect(
        await screen.findByRole('option', { name: /:open/i })
      ).toHaveAttribute('aria-selected', 'true')

      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({
          block: 'nearest',
          inline: 'nearest',
        })
      })
    } finally {
      scrollIntoView.mockRestore()
    }
  })

  test('dispatches forwarded menu keydown events to the active menu', async () => {
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(request)
    expect(
      await screen.findByRole('menu', { name: 'Terminal actions' })
    ).toBeInTheDocument()

    bridge.emitKeyDown({
      surfaceId: request.surfaceId,
      key: 'Escape',
      code: 'Escape',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    })

    await waitFor(() => {
      expect(bridge.close).toHaveBeenCalledWith({
        surfaceId: request.surfaceId,
        reason: 'outside',
      })
    })
  })

  test('dispatches the selected action and hides the menu', async () => {
    const user = userEvent.setup()
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(request)
    await user.click(await screen.findByRole('menuitem', { name: 'Copy' }))

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'surface-1',
      actionId: 'copy',
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('renders v1 sections and dispatches checkbox actions', async () => {
    const user = userEvent.setup()
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(sectionRequest)

    expect(
      await screen.findByRole('menu', { name: 'Displayed layouts' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('group', { name: 'Displayed layouts' })
    ).toBeInTheDocument()

    const quad = screen.getByRole('menuitemcheckbox', { name: 'Quad' })
    expect(quad).toHaveAttribute('aria-checked', 'true')

    await user.click(quad)

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'surface-2',
      actionId: 'toggle-quad',
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('renders composite menu rows and dispatches trailing actions', async () => {
    const user = userEvent.setup()
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(compositeRequest)

    expect(
      await screen.findByRole('menuitem', { name: 'Main + bottom' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Hide Main + bottom from switcher' })
    ).toHaveAttribute('aria-pressed', 'true')

    await user.click(
      screen.getByRole('button', { name: 'Duplicate Main + bottom' })
    )

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'surface-3',
      actionId: 'duplicate-custom',
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('renders copy detail rows with anchor width and copied feedback', async () => {
    const user = userEvent.setup()
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(detailRequest)

    const menu = await screen.findByRole('menu', { name: 'Git ref details' })
    const row = screen.getByRole('menuitem', { name: 'Copy path' })

    expect(menu).toHaveStyle({ width: '196px' })
    expect(menu).toHaveClass('vf-native-overlay-primary-container-soft')
    expect(document.documentElement.dataset.theme).toBe('flexoki')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(
      document.documentElement.style.getPropertyValue(
        '--color-surface-container-high'
      )
    ).toBe('var(--color-test-surface-high)')

    expect(row).toHaveTextContent(
      '/Users/will/projects/vimeflow/worktrees/native-overlay-git-ref'
    )
    expect(row).toHaveClass('rounded-chip')
    expect(within(row).getByText('Copy path')).toHaveClass(
      'text-on-surface-muted'
    )

    expect(
      within(row).getByText(
        '/Users/will/projects/vimeflow/worktrees/native-overlay-git-ref'
      )
    ).toHaveClass('text-on-surface')

    expect(within(row).getByText('content_copy')).toBeInTheDocument()

    await waitFor(() => {
      expect(bridge.ready).toHaveBeenCalledWith({ surfaceId: 'surface-4' })
    })

    await user.click(row)

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'surface-4',
      actionId: 'copy-path',
      closeOnSelect: false,
      feedback: 'copy',
    })
    expect(screen.getByRole('menu', { name: 'Git ref details' })).toBe(menu)
    expect(within(row).queryByText('check')).not.toBeInTheDocument()

    bridge.emitActionResult({
      surfaceId: 'surface-4',
      actionId: 'copy-path',
      feedback: 'copy',
      ok: false,
    })

    expect(within(row).queryByText('check')).not.toBeInTheDocument()

    bridge.emitActionResult({
      surfaceId: 'surface-4',
      actionId: 'copy-path',
      feedback: 'copy',
      ok: true,
    })

    expect(within(row).getByText('check')).toBeInTheDocument()
    expect(within(row).getByText('Copied')).toHaveClass('text-[10px]')
  })

  test('clears prior theme tokens when a later request has no theme', async () => {
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(detailRequest)
    expect(
      await screen.findByRole('menu', { name: 'Git ref details' })
    ).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('flexoki')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(
      document.documentElement.style.getPropertyValue(
        '--color-surface-container-high'
      )
    ).toBe('var(--color-test-surface-high)')

    expect(
      document.documentElement.style.getPropertyValue('--shadow-menu')
    ).toBe('var(--shadow-test-menu)')

    bridge.emitRender(request)

    expect(
      await screen.findByRole('menu', { name: 'Terminal actions' })
    ).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(
      document.documentElement.style.getPropertyValue(
        '--color-surface-container-high'
      )
    ).toBe('')

    expect(
      document.documentElement.style.getPropertyValue('--shadow-menu')
    ).toBe('')
  })

  test('closes on Escape and clears on host clear', async () => {
    const user = userEvent.setup()
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(request)
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(bridge.close).toHaveBeenCalledWith({
        surfaceId: 'surface-1',
        reason: 'outside',
      })
    })

    bridge.emitRender(request)
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    bridge.emitClear()
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })
})
