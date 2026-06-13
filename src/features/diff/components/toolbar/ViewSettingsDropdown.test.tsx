import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { BaseDiffOptions } from '@pierre/diffs'
import {
  ViewSettingsDropdown,
  type ViewSettingsDropdownProps,
} from './ViewSettingsDropdown'

type DiffIndicators = NonNullable<BaseDiffOptions['diffIndicators']>
type Overflow = NonNullable<BaseDiffOptions['overflow']>

const renderDropdown = (
  overrides: Partial<ViewSettingsDropdownProps> = {}
): ReturnType<typeof render> => {
  const baseProps: ViewSettingsDropdownProps = {
    diffIndicators: 'classic',
    onDiffIndicatorsChange: vi.fn<(next: DiffIndicators) => void>(),
    overflow: 'scroll',
    onOverflowChange: vi.fn<(next: Overflow) => void>(),
    disableLineNumbers: false,
    onDisableLineNumbersChange: vi.fn<(next: boolean) => void>(),
    disableBackground: false,
    onDisableBackgroundChange: vi.fn<(next: boolean) => void>(),
    disableFileHeader: false,
    onDisableFileHeaderChange: vi.fn<(next: boolean) => void>(),
    stickyHeader: true,
    onStickyHeaderChange: vi.fn<(next: boolean) => void>(),
  }

  return render(<ViewSettingsDropdown {...baseProps} {...overrides} />)
}

describe('ViewSettingsDropdown', () => {
  test('renders the View trigger and keeps the menu closed initially', () => {
    renderDropdown()

    expect(
      screen.getByRole('button', { name: /view settings/i })
    ).toBeInTheDocument()

    // No menu is rendered until the trigger is clicked.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('clicking the trigger opens the consolidated menu with all six controls', async () => {
    const user = userEvent.setup()
    renderDropdown()

    await user.click(screen.getByRole('button', { name: /view settings/i }))

    // Section headers.
    expect(await screen.findByText('Format')).toBeInTheDocument()
    expect(screen.getByText('View options')).toBeInTheDocument()

    // Two Format submenu rows render as menuitems; their accessible name
    // includes the current value label so query by substring.
    expect(
      screen.getByRole('menuitem', { name: /indicators/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('menuitem', { name: /overflow/i })
    ).toBeInTheDocument()

    // Four View-options rows render with the menuitemcheckbox role. The icon
    // is aria-hidden so the visible label is the only accessible name.
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Line numbers' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Background tint' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'File header' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Sticky header' })
    ).toBeInTheDocument()
  })

  test('reflects checkbox state from the disable* / stickyHeader props', async () => {
    const user = userEvent.setup()
    renderDropdown({
      disableLineNumbers: false,
      disableBackground: false,
      disableFileHeader: false,
      stickyHeader: true,
    })

    await user.click(screen.getByRole('button', { name: /view settings/i }))

    // All four checkbox rows should be aria-checked="true" because the disable
    // flags are inverted (false => checked) and stickyHeader is direct (true =>
    // checked).
    const lineNumbers = await screen.findByRole('menuitemcheckbox', {
      name: 'Line numbers',
    })

    expect(lineNumbers).toHaveAttribute('aria-checked', 'true')

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Background tint' })
    ).toHaveAttribute('aria-checked', 'true')

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'File header' })
    ).toHaveAttribute('aria-checked', 'true')

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Sticky header' })
    ).toHaveAttribute('aria-checked', 'true')
  })

  test('reflects mixed initial state correctly', async () => {
    const user = userEvent.setup()
    renderDropdown({
      disableLineNumbers: true,
      disableBackground: false,
      disableFileHeader: true,
      stickyHeader: false,
    })

    await user.click(screen.getByRole('button', { name: /view settings/i }))

    expect(
      await screen.findByRole('menuitemcheckbox', { name: 'Line numbers' })
    ).toHaveAttribute('aria-checked', 'false')

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Background tint' })
    ).toHaveAttribute('aria-checked', 'true')

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'File header' })
    ).toHaveAttribute('aria-checked', 'false')

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Sticky header' })
    ).toHaveAttribute('aria-checked', 'false')
  })

  test('clicking Line numbers fires onDisableLineNumbersChange with the inverted value', async () => {
    const user = userEvent.setup()
    const onDisableLineNumbersChange = vi.fn<(next: boolean) => void>()

    renderDropdown({
      disableLineNumbers: false,
      onDisableLineNumbersChange,
    })

    await user.click(screen.getByRole('button', { name: /view settings/i }))

    const row = await screen.findByRole('menuitemcheckbox', {
      name: 'Line numbers',
    })
    await user.click(row)

    expect(onDisableLineNumbersChange).toHaveBeenCalledTimes(1)
    expect(onDisableLineNumbersChange).toHaveBeenCalledWith(true)
  })

  test('clicking Background tint fires onDisableBackgroundChange with the inverted value', async () => {
    const user = userEvent.setup()
    const onDisableBackgroundChange = vi.fn<(next: boolean) => void>()

    renderDropdown({
      disableBackground: true,
      onDisableBackgroundChange,
    })

    await user.click(screen.getByRole('button', { name: /view settings/i }))

    const row = await screen.findByRole('menuitemcheckbox', {
      name: 'Background tint',
    })
    await user.click(row)

    expect(onDisableBackgroundChange).toHaveBeenCalledTimes(1)
    expect(onDisableBackgroundChange).toHaveBeenCalledWith(false)
  })

  test('clicking File header fires onDisableFileHeaderChange with the inverted value', async () => {
    const user = userEvent.setup()
    const onDisableFileHeaderChange = vi.fn<(next: boolean) => void>()

    renderDropdown({
      disableFileHeader: false,
      onDisableFileHeaderChange,
    })

    await user.click(screen.getByRole('button', { name: /view settings/i }))

    const row = await screen.findByRole('menuitemcheckbox', {
      name: 'File header',
    })
    await user.click(row)

    expect(onDisableFileHeaderChange).toHaveBeenCalledTimes(1)
    expect(onDisableFileHeaderChange).toHaveBeenCalledWith(true)
  })

  test('clicking Sticky header fires onStickyHeaderChange directly (no inversion)', async () => {
    const user = userEvent.setup()
    const onStickyHeaderChange = vi.fn<(next: boolean) => void>()

    renderDropdown({
      stickyHeader: true,
      onStickyHeaderChange,
    })

    await user.click(screen.getByRole('button', { name: /view settings/i }))

    const row = await screen.findByRole('menuitemcheckbox', {
      name: 'Sticky header',
    })
    await user.click(row)

    expect(onStickyHeaderChange).toHaveBeenCalledTimes(1)
    expect(onStickyHeaderChange).toHaveBeenCalledWith(false)
  })

  test('opening the Indicators sub-menu and selecting bars fires onDiffIndicatorsChange', async () => {
    const user = userEvent.setup()
    const onDiffIndicatorsChange = vi.fn<(next: DiffIndicators) => void>()

    renderDropdown({
      diffIndicators: 'classic',
      onDiffIndicatorsChange,
    })

    await user.click(screen.getByRole('button', { name: /view settings/i }))

    const indicatorsRow = await screen.findByRole('menuitem', {
      name: /indicators/i,
    })
    await user.click(indicatorsRow)

    // The sub-list opens as a separate portal-rendered menu; find the one that
    // hosts the indicator options (look for "bars") and select it.
    const subMenus = await screen.findAllByRole('menu')

    const indicatorMenu = subMenus.find((menu) =>
      within(menu).queryByRole('menuitem', { name: /bars/i })
    )

    if (!indicatorMenu) {
      throw new Error('Indicators sub-menu did not render')
    }

    await user.click(
      within(indicatorMenu).getByRole('menuitem', { name: /bars/i })
    )

    expect(onDiffIndicatorsChange).toHaveBeenCalledTimes(1)
    expect(onDiffIndicatorsChange).toHaveBeenCalledWith('bars')
  })

  test('opening the Overflow sub-menu and selecting wrap fires onOverflowChange', async () => {
    const user = userEvent.setup()
    const onOverflowChange = vi.fn<(next: Overflow) => void>()

    renderDropdown({
      overflow: 'scroll',
      onOverflowChange,
    })

    await user.click(screen.getByRole('button', { name: /view settings/i }))

    const overflowRow = await screen.findByRole('menuitem', {
      name: /overflow/i,
    })
    await user.click(overflowRow)

    const subMenus = await screen.findAllByRole('menu')

    const overflowMenu = subMenus.find((menu) =>
      within(menu).queryByRole('menuitem', { name: /wrap/i })
    )

    if (!overflowMenu) {
      throw new Error('Overflow sub-menu did not render')
    }

    await user.click(
      within(overflowMenu).getByRole('menuitem', { name: /wrap/i })
    )

    expect(onOverflowChange).toHaveBeenCalledTimes(1)
    expect(onOverflowChange).toHaveBeenCalledWith('wrap')
  })

  test('the Format submenu rows surface the current indicator / overflow values', async () => {
    const user = userEvent.setup()
    renderDropdown({
      diffIndicators: 'bars',
      overflow: 'wrap',
    })

    await user.click(screen.getByRole('button', { name: /view settings/i }))

    // Each Format submenu row shows its current value as text on the right.
    expect(await screen.findByText('bars')).toBeInTheDocument()
    expect(screen.getByText('wrap')).toBeInTheDocument()
  })
})
