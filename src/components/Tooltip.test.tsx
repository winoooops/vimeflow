import { createRef } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { Tooltip, type TooltipProps } from './Tooltip'

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
