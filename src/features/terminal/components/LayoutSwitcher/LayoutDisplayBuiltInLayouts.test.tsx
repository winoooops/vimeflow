import { useState, type ReactElement } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { Menu } from '@/components/Menu'
import type { PaneLayoutId } from '../../../sessions/types'
import { BUILTIN_PANE_LAYOUT_REGISTRY } from '../../layout-registry'
import { builtInLayoutMenuItems } from './LayoutDisplayBuiltInLayouts'

interface BuiltInLayoutsHarnessProps {
  activeLayoutId?: PaneLayoutId
  initialVisibleLayoutIds?: readonly PaneLayoutId[]
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
            visibleLayoutIds,
            onVisibleLayoutIdsChange: setVisibleLayoutIds,
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
})
