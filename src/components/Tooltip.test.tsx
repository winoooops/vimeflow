import { createRef } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { __resetNativeOverlayForTest } from '@/components/base/floating/nativeOverlay'
import { Tooltip, type TooltipProps } from './Tooltip'

let restorePlatform: (() => void) | null = null

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
  close: ReturnType<typeof vi.fn>
} => {
  const open = vi.fn().mockResolvedValue({ accepted: true })
  const close = vi.fn().mockResolvedValue(undefined)

  window.vimeflow = {
    invoke: <T,>(): Promise<T> => Promise.resolve(null as T),
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    nativeOverlay: {
      open,
      close,
      actionResult: vi.fn(() => Promise.resolve()),
      resume: vi.fn(() => Promise.resolve()),
      onAction: vi.fn(() => vi.fn()),
      onClose: vi.fn(() => vi.fn()),
    },
  }

  return { open, close }
}

const rect = ({
  x,
  y,
  width,
  height,
}: {
  x: number
  y: number
  width: number
  height: number
}): DOMRect =>
  ({
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  }) as DOMRect

const deferredNativeOpen = (): {
  promise: Promise<{ accepted: boolean }>
  resolve: (value: { accepted: boolean }) => void
} => {
  let resolvePromise: ((value: { accepted: boolean }) => void) | null = null

  const promise = new Promise<{ accepted: boolean }>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve: (value): void => {
      resolvePromise?.(value)
    },
  }
}

afterEach(() => {
  restorePlatform?.()
  restorePlatform = null
  vi.unstubAllEnvs()
  __resetNativeOverlayForTest()
  delete window.vimeflow
})

describe('Tooltip', () => {
  test('returns children unchanged when disabled', () => {
    render(
      <Tooltip content="hello" disabled>
        <button type="button">trigger</button>
      </Tooltip>
    )

    expect(screen.getByRole('button', { name: 'trigger' })).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('returns children unchanged when content is null', () => {
    render(
      <Tooltip content={null}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    expect(screen.getByRole('button', { name: 'trigger' })).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('returns children unchanged when content is false (cond && text idiom)', () => {
    const showTooltip = false

    render(
      <Tooltip content={showTooltip && 'hidden text'}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    expect(screen.getByRole('button', { name: 'trigger' })).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('returns children unchanged when content is an empty string', () => {
    render(
      <Tooltip content="">
        <button type="button">trigger</button>
      </Tooltip>
    )

    expect(screen.getByRole('button', { name: 'trigger' })).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('opens on hover after delayMs and renders content', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="full body text" delayMs={0}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.hover(screen.getByRole('button', { name: 'trigger' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'full body text'
    )
  })

  test('closes on mouse leave', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="hello" delayMs={0}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    const btn = screen.getByRole('button', { name: 'trigger' })
    await user.hover(btn)
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
    await user.unhover(btn)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('opens on focus', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="hello" delayMs={0}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.tab()
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
  })

  test('closes on Escape', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="hello" delayMs={0}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    await user.hover(screen.getByRole('button', { name: 'trigger' }))
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('exposes content as accessible description on the trigger', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="hello" delayMs={0}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    const btn = screen.getByRole('button', { name: 'trigger' })
    await user.hover(btn)
    // Wait for tooltip to open so the accessible description becomes available
    await screen.findByRole('tooltip')
    expect(btn).toHaveAccessibleDescription('hello')
  })

  test('respects placement prop via data-placement attribute', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="hello" delayMs={0} placement="bottom">
        <button type="button">trigger</button>
      </Tooltip>
    )

    await user.hover(screen.getByRole('button', { name: 'trigger' }))
    expect(
      (await screen.findByRole('tooltip')).getAttribute('data-placement')
    ).toMatch(/^bottom/)
  })

  test('applies maxWidth to the floating element', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="hello" delayMs={0} maxWidth={200}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    await user.hover(screen.getByRole('button', { name: 'trigger' }))
    expect(await screen.findByRole('tooltip')).toHaveStyle({
      maxWidth: '200px',
    })
  })

  test('preserves an existing ref on the trigger', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Tooltip content="hello" delayMs={0}>
        <button ref={ref} type="button">
          trigger
        </button>
      </Tooltip>
    )

    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    expect(ref.current?.textContent).toBe('trigger')
  })

  test('anchors the floating element when the trigger has its own ref', async () => {
    const user = userEvent.setup()
    const ref = createRef<HTMLButtonElement>()

    const getBoundingClientRect = vi.spyOn(
      HTMLElement.prototype,
      'getBoundingClientRect'
    )

    getBoundingClientRect.mockImplementation(function (
      this: HTMLElement
    ): DOMRect {
      if (this === ref.current) {
        return rect({ x: 300, y: 100, width: 80, height: 32 })
      }

      if (this.getAttribute('role') === 'tooltip') {
        return rect({ x: 0, y: 0, width: 64, height: 28 })
      }

      return rect({ x: 0, y: 0, width: 0, height: 0 })
    })

    try {
      render(
        <Tooltip content="hello" delayMs={0} placement="right">
          <button ref={ref} type="button">
            trigger
          </button>
        </Tooltip>
      )

      await user.hover(screen.getByRole('button', { name: 'trigger' }))
      const tip = await screen.findByRole('tooltip')

      await waitFor(() => {
        expect(tip.getAttribute('style')).toMatch(/translate\((?!0px, 0px)/)
      })
    } finally {
      getBoundingClientRect.mockRestore()
    }
  })

  test('appends className to the baseline classes', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="hello" delayMs={0} className="custom-extra">
        <button type="button">trigger</button>
      </Tooltip>
    )

    await user.hover(screen.getByRole('button', { name: 'trigger' }))
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveClass('custom-extra')
    expect(tip).toHaveClass('backdrop-blur-md')
  })

  test('renders a shortcut chip when shortcut prop is provided', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="Open Editor" shortcut={['Mod', 'E']} delayMs={0}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    await user.hover(screen.getByRole('button', { name: 'trigger' }))
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Open Editor')
    // Don't assert exact glyph (platform-dependent); just confirm the
    // chip element is present and contains the key letter.
    const chip = screen.getByTestId('tooltip-shortcut')
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveTextContent('E')
  })

  test('omits the shortcut chip when shortcut prop is absent', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="Open Editor" delayMs={0}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    await user.hover(screen.getByRole('button', { name: 'trigger' }))
    await screen.findByRole('tooltip')
    expect(screen.queryByTestId('tooltip-shortcut')).not.toBeInTheDocument()
  })

  test('sends plain text tooltip requests through native overlay when opted in', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const user = userEvent.setup()

    render(
      <Tooltip
        content="collapse status"
        delayMs={0}
        placement="bottom"
        maxWidth={180}
        nativeOverlay
      >
        <button type="button">trigger</button>
      </Tooltip>
    )

    const trigger = screen.getByRole('button', { name: 'trigger' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      rect({ x: 20, y: 30, width: 40, height: 12 })
    )

    await user.hover(trigger)

    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())
    const request = nativeBridge.open.mock.calls[0][0] as { surfaceId: string }

    expect(request).toMatchObject({
      surfaceId: expect.stringMatching(/^tooltip:/),
      kind: 'tooltip',
      anchorRect: { x: 20, y: 30, width: 40, height: 12 },
      placement: 'bottom',
      payload: {
        kind: 'tooltip',
        text: 'collapse status',
        maxWidth: 180,
      },
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.unhover(trigger)

    await waitFor(() => {
      expect(nativeBridge.close).toHaveBeenCalledWith({
        surfaceId: request.surfaceId,
        reason: 'renderer',
      })
    })
  })

  test('sends shortcut chips through native tooltip overlay', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const user = userEvent.setup()

    render(
      <Tooltip
        content="Open diff"
        delayMs={0}
        shortcut={['Mod', 'G']}
        nativeOverlay
      >
        <button type="button">trigger</button>
      </Tooltip>
    )

    await user.hover(screen.getByRole('button', { name: 'trigger' }))

    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())
    expect(nativeBridge.open.mock.calls[0][0]).toMatchObject({
      kind: 'tooltip',
      payload: {
        kind: 'tooltip',
        text: 'Open diff',
        shortcut: '⌘G',
      },
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('resyncs native tooltip anchor geometry after resize', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const user = userEvent.setup()

    render(
      <Tooltip content="collapse status" delayMs={0} nativeOverlay>
        <button type="button">trigger</button>
      </Tooltip>
    )

    const trigger = screen.getByRole('button', { name: 'trigger' })

    const rectSpy = vi
      .spyOn(trigger, 'getBoundingClientRect')
      .mockReturnValueOnce(rect({ x: 20, y: 30, width: 40, height: 12 }))
      .mockReturnValue(rect({ x: 50, y: 60, width: 70, height: 18 }))

    await user.hover(trigger)

    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())

    const firstRequest = nativeBridge.open.mock.calls[0][0] as {
      surfaceId: string
    }

    window.dispatchEvent(new Event('resize'))

    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledTimes(2))
    expect(nativeBridge.open.mock.calls[1][0]).toMatchObject({
      surfaceId: firstRequest.surfaceId,
      kind: 'tooltip',
      anchorRect: { x: 50, y: 60, width: 70, height: 18 },
    })

    rectSpy.mockRestore()
  })

  test('closes accepted native tooltip resize requests after dismissal', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const pending = deferredNativeOpen()
    nativeBridge.open
      .mockResolvedValueOnce({ accepted: true })
      .mockReturnValueOnce(pending.promise)
    const user = userEvent.setup()

    render(
      <Tooltip content="collapse status" delayMs={0} nativeOverlay>
        <button type="button">trigger</button>
      </Tooltip>
    )

    const trigger = screen.getByRole('button', { name: 'trigger' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      rect({ x: 50, y: 60, width: 70, height: 18 })
    )

    await user.hover(trigger)
    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())
    const request = nativeBridge.open.mock.calls[0][0] as { surfaceId: string }

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledTimes(2))
    await user.unhover(trigger)
    const closeCountAfterDismiss = nativeBridge.close.mock.calls.length

    await act(async () => {
      pending.resolve({ accepted: true })
      await pending.promise
    })

    expect(nativeBridge.close).toHaveBeenCalledTimes(closeCountAfterDismiss + 1)
    expect(nativeBridge.close).toHaveBeenLastCalledWith({
      surfaceId: request.surfaceId,
      reason: 'renderer',
    })
  })

  test('falls back locally when native tooltip overlay is rejected', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    nativeBridge.open.mockResolvedValue({ accepted: false })
    const user = userEvent.setup()

    render(
      <Tooltip content="collapse status" delayMs={0} nativeOverlay>
        <button type="button">trigger</button>
      </Tooltip>
    )

    await user.hover(screen.getByRole('button', { name: 'trigger' }))

    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'collapse status'
    )
  })

  test('supports interactive floating content when requested', async () => {
    const user = userEvent.setup()
    const handleCopy = vi.fn()

    render(
      <Tooltip
        content={
          <button type="button" onClick={handleCopy}>
            Copy
          </button>
        }
        delayMs={0}
        interactive
        ariaLabel="Activity details"
      >
        <button type="button">trigger</button>
      </Tooltip>
    )

    await user.hover(screen.getByRole('button', { name: 'trigger' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Activity details',
    })

    expect(dialog).toHaveClass('pointer-events-auto')
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(handleCopy).toHaveBeenCalledTimes(1)
  })

  test('tabs from trigger into interactive floating content', async () => {
    const user = userEvent.setup()
    const handleCopy = vi.fn()

    render(
      <>
        <Tooltip
          content={
            <button type="button" onClick={handleCopy}>
              Copy
            </button>
          }
          delayMs={0}
          interactive
          ariaLabel="Activity details"
        >
          <button type="button">trigger</button>
        </Tooltip>
        <button type="button">next action</button>
      </>
    )

    const trigger = screen.getByRole('button', { name: 'trigger' })

    await user.tab()
    expect(trigger).toHaveFocus()

    const dialog = await screen.findByRole('dialog', {
      name: 'Activity details',
    })

    await user.tab()

    const copyButton = within(dialog).getByRole('button', { name: 'Copy' })
    expect(copyButton).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(handleCopy).toHaveBeenCalledTimes(1)
  })

  test('clears stale open state when tooltip becomes disabled mid-flight', async () => {
    const user = userEvent.setup()

    const { rerender } = render(
      <Tooltip content="hello" delayMs={0}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    await user.hover(screen.getByRole('button', { name: 'trigger' }))
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()

    // Disable while open — tooltip should disappear immediately.
    rerender(
      <Tooltip content="hello" delayMs={0} disabled>
        <button type="button">trigger</button>
      </Tooltip>
    )
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    // Re-enable — tooltip must NOT resurrect without fresh interaction.
    rerender(
      <Tooltip content="hello" delayMs={0}>
        <button type="button">trigger</button>
      </Tooltip>
    )
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('bare mode omits default visual chrome and maxWidth', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="hello" delayMs={0} bare>
        <button type="button">trigger</button>
      </Tooltip>
    )

    await user.hover(screen.getByRole('button', { name: 'trigger' }))
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveClass('z-50')
    expect(tip).not.toHaveClass('rounded-md')
    expect(tip).not.toHaveClass('backdrop-blur-md')
    expect(tip).not.toHaveStyle({ maxWidth: '320px' })
  })

  test('bare mode appends custom className to the stripped surface', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="hello" delayMs={0} bare className="custom-surface">
        <button type="button">trigger</button>
      </Tooltip>
    )

    await user.hover(screen.getByRole('button', { name: 'trigger' }))
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveClass('custom-surface')
    expect(tip).toHaveClass('z-50')
    expect(tip).not.toHaveClass('rounded-md')
  })

  test('bare interactive mode still uses pointer-events-auto and dialog role', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip
        content="hello"
        delayMs={0}
        bare
        interactive
        ariaLabel="Details"
        className="custom-surface"
      >
        <button type="button">trigger</button>
      </Tooltip>
    )

    await user.hover(screen.getByRole('button', { name: 'trigger' }))
    const dialog = await screen.findByRole('dialog', { name: 'Details' })
    expect(dialog).toHaveClass('pointer-events-auto')
    expect(dialog).toHaveClass('custom-surface')
    expect(dialog).not.toHaveClass('rounded-md')
  })

  test('bare is compile-incompatible with the chrome-only shortcut and maxWidth props', () => {
    // A `bare` tooltip owns its surface, so the chrome-only `shortcut` chip and
    // `maxWidth` clamp are typed `never`. The @ts-expect-error directives below
    // fail `tsc -b` if the discriminated union ever stops enforcing that —
    // guarding against a future caller getting a chip in an unstyled surface.

    // @ts-expect-error `bare` owns its surface; `shortcut` is chrome-only
    const bareWithShortcut: TooltipProps = {
      content: 'x',
      children: <button type="button">a</button>,
      bare: true,
      shortcut: ['Mod', 'E'],
    }

    // @ts-expect-error `bare` omits the `maxWidth` clamp
    const bareWithMaxWidth: TooltipProps = {
      content: 'x',
      children: <button type="button">b</button>,
      bare: true,
      maxWidth: 200,
    }

    expect(bareWithShortcut.bare).toBe(true)
    expect(bareWithMaxWidth.bare).toBe(true)
  })
})
