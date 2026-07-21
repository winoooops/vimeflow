import { useState, type ReactElement } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { Menu } from '@/components/Menu'
import type { PaneLayoutId } from '../../../sessions/types'
import { BUILTIN_PANE_LAYOUT_REGISTRY } from '../../layout-registry'
import { builtInLayoutMenuItems } from './LayoutDisplayBuiltInLayouts'

interface BuiltInLayoutsHarnessProps {
  activeLayoutId?: PaneLayoutId
  initialVisibleLayoutIds?: readonly PaneLayoutId[]
  blockedLayoutIds?: readonly PaneLayoutId[]
  onPickLayout?: (layoutId: PaneLayoutId) => boolean
  compactSelectionMode?: boolean
}

const BuiltInLayoutsHarness = ({
  activeLayoutId = 'vsplit',
  initialVisibleLayoutIds = [
    'single',
    'vsplit',
    'hsplit',
    'threeRight',
    'quad',
    'grid3x2',
  ],
  blockedLayoutIds = [],
  onPickLayout = undefined,
  compactSelectionMode = false,
}: BuiltInLayoutsHarnessProps): ReactElement => {
  const [visibleLayoutIds, setVisibleLayoutIds] = useState(
    initialVisibleLayoutIds
  )
  const layouts = BUILTIN_PANE_LAYOUT_REGISTRY.layouts

  return (
    <>
      <Menu trigger={<button type="button">Open built-in layouts</button>}>
        <Menu.Section label="Displayed layouts">
          {builtInLayoutMenuItems({
            builtInLayouts: layouts,
            allLayouts: layouts,
            activeLayoutId,
            blockedLayoutIds,
            visibleLayoutIds,
            onVisibleLayoutIdsChange: setVisibleLayoutIds,
            onPickLayout,
            compactSelectionMode,
          })}
        </Menu.Section>
      </Menu>
      <output aria-label="Visible layout ids">
        {visibleLayoutIds.join(',')}
      </output>
    </>
  )
}

describe('builtInLayoutMenuItems', () => {
  test('renders all built-in layout rows with checkbox labels', async () => {
    const user = userEvent.setup()

    render(<BuiltInLayoutsHarness />)

    await user.click(
      screen.getByRole('button', { name: 'Open built-in layouts' })
    )

    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitemcheckbox')).toHaveLength(6)
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: '3x2 grid' })
    ).toBeInTheDocument()
  })

  test('keeps single checked and disabled as the required baseline layout', async () => {
    const user = userEvent.setup()

    render(<BuiltInLayoutsHarness activeLayoutId="vsplit" />)

    await user.click(
      screen.getByRole('button', { name: 'Open built-in layouts' })
    )

    const singleLayout = await screen.findByRole('menuitemcheckbox', {
      name: 'Single',
    })

    expect(singleLayout).toHaveAttribute('aria-disabled', 'true')
    expect(singleLayout).toHaveAttribute('aria-checked', 'true')

    await user.click(singleLayout)

    expect(screen.getByLabelText('Visible layout ids')).toHaveTextContent(
      'single,vsplit,hsplit,threeRight,quad,grid3x2'
    )
  })

  test('toggling a visible non-active layout removes it from the visible list', async () => {
    const user = userEvent.setup()

    render(<BuiltInLayoutsHarness />)

    await user.click(
      screen.getByRole('button', { name: 'Open built-in layouts' })
    )

    const gridLayout = await screen.findByRole('menuitemcheckbox', {
      name: '3x2 grid',
    })

    expect(gridLayout).not.toHaveAttribute('aria-disabled', 'true')
    expect(gridLayout).toHaveAttribute('aria-checked', 'true')

    await user.click(gridLayout)

    expect(screen.getByLabelText('Visible layout ids')).toHaveTextContent(
      'single,vsplit,hsplit,threeRight,quad'
    )
  })

  test('toggling a hidden non-active layout adds it back in registry order', async () => {
    const user = userEvent.setup()

    render(
      <BuiltInLayoutsHarness
        activeLayoutId="vsplit"
        initialVisibleLayoutIds={['single', 'vsplit', 'hsplit']}
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Open built-in layouts' })
    )

    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Quad' })
    )

    expect(screen.getByLabelText('Visible layout ids')).toHaveTextContent(
      'single,vsplit,hsplit,quad'
    )
  })

  test('compact selection mode picks a built-in layout instead of changing visibility', async () => {
    const user = userEvent.setup()
    const onPickLayout = vi.fn(() => true)

    render(
      <BuiltInLayoutsHarness
        activeLayoutId="vsplit"
        initialVisibleLayoutIds={['single', 'vsplit']}
        onPickLayout={onPickLayout}
        compactSelectionMode
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Open built-in layouts' })
    )

    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Quad' })
    )

    expect(onPickLayout).toHaveBeenCalledWith('quad')
    expect(screen.getByLabelText('Visible layout ids')).toHaveTextContent(
      'single,vsplit'
    )
  })

  test('compact selection mode allows the required single layout to be picked', async () => {
    const user = userEvent.setup()
    const onPickLayout = vi.fn(() => true)

    render(
      <BuiltInLayoutsHarness
        activeLayoutId="quad"
        onPickLayout={onPickLayout}
        compactSelectionMode
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Open built-in layouts' })
    )

    const singleLayout = await screen.findByRole('menuitemcheckbox', {
      name: 'Single',
    })

    expect(singleLayout).not.toHaveAttribute('aria-disabled', 'true')

    await user.click(singleLayout)
    expect(onPickLayout).toHaveBeenCalledWith('single')
  })

  test('compact selection mode keeps blocked layouts disabled', async () => {
    const user = userEvent.setup()
    const onPickLayout = vi.fn(() => true)

    render(
      <BuiltInLayoutsHarness
        activeLayoutId="vsplit"
        blockedLayoutIds={['quad']}
        onPickLayout={onPickLayout}
        compactSelectionMode
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Open built-in layouts' })
    )

    const quadLayout = await screen.findByRole('menuitemcheckbox', {
      name: 'Quad',
    })

    expect(quadLayout).toHaveAttribute('aria-disabled', 'true')

    await user.click(quadLayout)
    expect(onPickLayout).not.toHaveBeenCalled()
  })
})
