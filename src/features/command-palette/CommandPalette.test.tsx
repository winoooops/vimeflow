import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { CommandPalette } from './CommandPalette'
import { renderPalette } from './CommandPalette.testUtils'
import type { Command, CommandPaletteState } from './registry/types'

const sampleCommand: Command = {
  id: 'help',
  label: ':help',
  description: 'Show command reference',
  icon: 'help',
}

let restorePlatform: (() => void) | null = null
let closeNativeOverlaySession: (() => void) | null = null

interface CommandPaletteNativeRequest {
  surfaceId: string
  payload: {
    actions: {
      selectIndex: string
      executeIndex: string
    }
  }
}

const setNavigatorPlatform = (platform: string): void => {
  restorePlatform?.()
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'platform')

  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  })

  restorePlatform = (): void => {
    if (original === undefined) {
      delete (window.navigator as unknown as { platform?: string }).platform

      return
    }

    Object.defineProperty(window.navigator, 'platform', original)
  }
}

const installNativeOverlayBridge = (): {
  open: ReturnType<typeof vi.fn>
  action: (event: unknown) => void
} => {
  let actionListener: ((event: unknown) => void) | null = null
  let closeListener: ((event: unknown) => void) | null = null
  const open = vi.fn().mockResolvedValue({ accepted: true })

  window.vimeflow = {
    invoke: <T,>(): Promise<T> => Promise.resolve(null as T),
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    nativeOverlay: {
      open,
      close: vi.fn(() => Promise.resolve()),
      actionResult: vi.fn(() => Promise.resolve()),
      resume: vi.fn(() => Promise.resolve()),
      onAction: vi.fn((callback: (event: unknown) => void) => {
        actionListener = callback

        return vi.fn()
      }),
      onClose: vi.fn((callback: (event: unknown) => void) => {
        closeListener = callback

        return vi.fn()
      }),
    },
  }

  closeNativeOverlaySession = (): void => {
    const request = open.mock.calls[0]?.[0] as
      | CommandPaletteNativeRequest
      | undefined

    if (request !== undefined) {
      closeListener?.({ surfaceId: request.surfaceId, reason: 'test' })
    }
  }

  return {
    open,
    action: (event): void => {
      actionListener?.(event)
    },
  }
}

afterEach(() => {
  closeNativeOverlaySession?.()
  closeNativeOverlaySession = null
  vi.unstubAllEnvs()
  restorePlatform?.()
  restorePlatform = null
  delete window.vimeflow
})

describe('CommandPalette', () => {
  test('does not render the dialog when state.isOpen is false', () => {
    renderPalette({ state: { isOpen: false } })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('renders the dialog when state.isOpen is true', () => {
    renderPalette({ state: { isOpen: true } })

    expect(
      screen.getByRole('dialog', { name: 'Command palette' })
    ).toBeInTheDocument()
  })

  test('calls close when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const { close } = renderPalette({ state: { isOpen: true } })

    await user.click(screen.getByTestId('command-palette-backdrop'))

    expect(close).toHaveBeenCalledTimes(1)
  })

  test('renders the controlled query value and forwards input changes', async () => {
    const user = userEvent.setup()

    const { setQuery } = renderPalette({
      state: { isOpen: true, query: ':open' },
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })

    expect(input).toHaveValue(':open')

    await user.type(input, 'x')

    expect(setQuery).toHaveBeenLastCalledWith(':open' + 'x')
  })

  test('renders controlled results and selected index', () => {
    renderPalette({
      filteredResults: [sampleCommand],
      clampedSelectedIndex: 0,
    })

    const option = screen.getByRole('option', { name: /:help/i })

    expect(option).toHaveAttribute('aria-selected', 'true')
  })

  test('renders selected command argument placeholder while waiting for args', () => {
    renderPalette({
      state: { isOpen: true, query: ':rename-pane ' },
      filteredResults: [
        {
          id: 'rename-pane',
          label: ':rename-pane',
          description: 'Rename pane',
          icon: 'edit',
          requiresArgument: true,
          argumentPlaceholder: '<name>',
        },
      ],
      clampedSelectedIndex: 0,
    })

    expect(screen.getByText('<name>')).toBeInTheDocument()
  })

  test('calls executeAt when a result is clicked', async () => {
    const user = userEvent.setup()

    const { executeAt } = renderPalette({
      filteredResults: [sampleCommand],
      clampedSelectedIndex: 0,
    })

    await user.click(screen.getByRole('option', { name: /:help/i }))

    expect(executeAt).toHaveBeenCalledWith(0)
  })

  test('renders the footer and overlay z-index', () => {
    renderPalette()

    // Footer uses KeyCap spans with unicode chars (↵ run / ↑↓ navigate)
    expect(screen.getByText('↵')).toBeInTheDocument()
    expect(screen.getByText('↑')).toBeInTheDocument()
    expect(screen.queryByText("Type '?' for help")).toBeNull()
    expect(screen.getByRole('dialog')).toHaveClass('z-[100]')
  })

  test('survives mismatched clampedSelectedIndex without crashing the dialog', () => {
    // A caller wiring CommandPalette without going through
    // useCommandPalette could pass a non-negative index against an
    // empty filteredResults array. The component must NOT crash on
    // `filteredResults[idx].id` — the guard yields no
    // aria-activedescendant instead.
    renderPalette({
      state: { isOpen: true },
      filteredResults: [],
      clampedSelectedIndex: 0,
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })

    expect(input).not.toHaveAttribute('aria-activedescendant')
  })

  test('sends a native overlay dialog payload and dispatches overlay actions', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()

    const { selectIndex, executeAt } = renderPalette({
      state: { isOpen: true, query: ':he' },
      filteredResults: [sampleCommand],
      clampedSelectedIndex: 0,
    })

    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalled())

    const request = nativeBridge.open.mock
      .calls[0][0] as CommandPaletteNativeRequest

    expect(request).toMatchObject({
      kind: 'dialog',
      placement: 'top',
      payload: {
        kind: 'dialog',
        dialog: 'command-palette',
        ariaLabel: 'Command palette',
        query: ':he',
        selectedIndex: 0,
        results: [
          {
            id: 'help',
            label: ':help',
            description: 'Show command reference',
            icon: 'help',
          },
        ],
      },
    })

    act(() => {
      nativeBridge.action({
        surfaceId: request.surfaceId,
        actionId: request.payload.actions.selectIndex,
        index: 0,
      })

      nativeBridge.action({
        surfaceId: request.surfaceId,
        actionId: request.payload.actions.executeIndex,
        index: 0,
      })
    })

    expect(selectIndex).toHaveBeenCalledWith(0)
    expect(executeAt).toHaveBeenCalledWith(0)
  })

  test('does not reopen the native overlay on unrelated parent rerenders', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()

    const state: CommandPaletteState = {
      isOpen: true,
      query: ':he',
      selectedIndex: 0,
      currentNamespace: null,
    }
    const filteredResults = [sampleCommand]
    const close = vi.fn()
    const setQuery = vi.fn()
    const selectIndex = vi.fn()
    const executeAt = vi.fn()

    const Harness = (): ReactElement => {
      const [, setTick] = useState(0)

      return (
        <>
          <button
            type="button"
            onClick={(): void => setTick((value) => value + 1)}
          >
            Re-render
          </button>
          <CommandPalette
            state={state}
            filteredResults={filteredResults}
            clampedSelectedIndex={0}
            close={close}
            setQuery={setQuery}
            selectIndex={selectIndex}
            executeAt={executeAt}
          />
        </>
      )
    }

    const user = userEvent.setup()
    render(<Harness />)

    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())

    await user.click(screen.getByRole('button', { name: 'Re-render' }))

    expect(nativeBridge.open).toHaveBeenCalledOnce()
  })
})
