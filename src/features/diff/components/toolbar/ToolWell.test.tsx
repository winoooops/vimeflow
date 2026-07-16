import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { ToolWell, type ToolWellProps } from './ToolWell'

const renderWell = (
  overrides: Partial<ToolWellProps> = {}
): ReturnType<typeof render> => {
  const baseProps: ToolWellProps = {
    showUnstage: false,
    staging: false,
    onStage: undefined,
    onUnstage: undefined,
    onDiscard: undefined,
    stageShortcut: 's',
    stageAriaKeyshortcuts: 's',
    discardShortcut: 'd',
    discardAriaKeyshortcuts: 'd',
    discardAllSlot: (
      <button type="button" aria-label="discard all">
        slot
      </button>
    ),
  }

  return render(<ToolWell {...baseProps} {...overrides} />)
}

describe('ToolWell', () => {
  test('omits the unstage button when showUnstage is false', () => {
    renderWell({ showUnstage: false })

    expect(screen.queryByRole('button', { name: /unstage/i })).toBeNull()
  })

  test('renders the unstage button when showUnstage is true', () => {
    renderWell({ showUnstage: true })

    expect(screen.getByRole('button', { name: /unstage/i })).toBeInTheDocument()
  })

  test('staging buttons fire their handlers when provided', async () => {
    const user = userEvent.setup()
    const onStage = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const onDiscard = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

    renderWell({ onStage, onDiscard })

    await user.click(screen.getByRole('button', { name: /^stage$/i }))
    expect(onStage).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /^discard$/i }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  test('staging tooltips show keyboard shortcuts', async () => {
    const user = userEvent.setup()

    renderWell({
      onStage: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      onDiscard: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    })

    await user.hover(screen.getByRole('button', { name: /^stage$/i }))

    expect(await screen.findByText('Stage hunk')).toBeInTheDocument()
    expect(screen.getByTestId('tooltip-shortcut')).toHaveTextContent('s')
    expect(screen.getByRole('button', { name: /^stage$/i })).toHaveAttribute(
      'aria-keyshortcuts',
      's'
    )
  })

  test('staging buttons render as placeholders when no handlers provided', () => {
    renderWell()

    const stage = screen.getByRole('button', { name: /^stage$/i })
    expect(stage).toHaveAttribute('aria-disabled', 'true')
    expect(stage.className).toContain('text-on-surface-variant/40')
  })

  test('staging === true disables the functional staging buttons', () => {
    renderWell({
      onStage: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      onDiscard: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      staging: true,
    })

    expect(screen.getByRole('button', { name: /^stage$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^discard$/i })).toBeDisabled()
  })

  test('renders the discard-all slot supplied by the parent', () => {
    renderWell()

    expect(
      screen.getByRole('button', { name: /^discard all$/i })
    ).toBeInTheDocument()
  })
})
