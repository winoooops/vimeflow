import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { useState, type ReactElement } from 'react'
import type { PaneLayoutId } from '../../../sessions/types'
import {
  PaneLayoutRegistry,
  type PaneLayoutDefinition,
} from '../../layout-registry'
import { LayoutDisplayMenu } from './LayoutDisplayMenu'

const customMainBottomLayout: PaneLayoutDefinition = {
  schemaVersion: 1,
  id: 'custom:main-bottom',
  title: 'Main + bottom',
  source: 'workspace',
  tracks: {
    columns: [
      { id: 'col-0', units: 8 },
      { id: 'col-1', units: 8 },
      { id: 'col-2', units: 8 },
    ],
    rows: [
      { id: 'row-0', units: 16 },
      { id: 'row-1', units: 8 },
    ],
  },
  slots: [
    { id: 'slot:p0', rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 } },
    { id: 'slot:p1', rect: { col: 0, row: 1, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p2', rect: { col: 1, row: 1, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p3', rect: { col: 2, row: 1, colSpan: 1, rowSpan: 1 } },
  ],
  addOrder: ['slot:p0', 'slot:p1', 'slot:p2', 'slot:p3'],
}

interface HarnessProps {
  activeLayoutId?: PaneLayoutId
  initialVisibleLayoutIds?: readonly PaneLayoutId[]
  layouts?: readonly PaneLayoutDefinition[]
  onPickLayout?: (layoutId: PaneLayoutId) => void
  onEditCustomLayout?: (layoutId: PaneLayoutId) => void
  onDeleteCustomLayout?: (layoutId: PaneLayoutId) => void
  onCreateCustomLayout?: () => void
}

const LayoutDisplayMenuHarness = ({
  activeLayoutId = 'vsplit',
  initialVisibleLayoutIds = [
    'single',
    'vsplit',
    'hsplit',
    'threeRight',
    'quad',
    'grid3x2',
  ],
  layouts = [],
  onPickLayout = undefined,
  onEditCustomLayout = undefined,
  onDeleteCustomLayout = undefined,
  onCreateCustomLayout = undefined,
}: HarnessProps): ReactElement => {
  const [visibleLayoutIds, setVisibleLayoutIds] = useState(
    initialVisibleLayoutIds
  )

  const [hiddenCustomLayoutIds, setHiddenCustomLayoutIds] = useState<
    readonly PaneLayoutId[]
  >([])
  const registry = new PaneLayoutRegistry(layouts)

  return (
    <>
      <LayoutDisplayMenu
        activeLayoutId={activeLayoutId}
        visibleLayoutIds={visibleLayoutIds}
        hiddenCustomLayoutIds={hiddenCustomLayoutIds}
        layouts={registry.layouts}
        onVisibleLayoutIdsChange={setVisibleLayoutIds}
        onHiddenCustomLayoutIdsChange={setHiddenCustomLayoutIds}
        onPickLayout={onPickLayout}
        onEditCustomLayout={onEditCustomLayout}
        onDeleteCustomLayout={onDeleteCustomLayout}
        onCreateCustomLayout={onCreateCustomLayout}
      />
      <output>{visibleLayoutIds.join(',')}</output>
      <output>{hiddenCustomLayoutIds.join(',')}</output>
    </>
  )
}

describe('LayoutDisplayMenu', () => {
  test('shows all layout rows with glyph labels and checkboxes', async () => {
    const user = userEvent.setup()

    render(<LayoutDisplayMenuHarness />)

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitemcheckbox')).toHaveLength(6)

    expect(
      within(menu).getByRole('menuitemcheckbox', { name: '3x2 grid' })
    ).toBeInTheDocument()
  })

  test('keeps single checked and disabled as the required baseline layout', async () => {
    const user = userEvent.setup()

    render(<LayoutDisplayMenuHarness activeLayoutId="vsplit" />)

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    const singleLayout = await screen.findByRole('menuitemcheckbox', {
      name: 'Single',
    })

    expect(singleLayout).toHaveAttribute('aria-disabled', 'true')
    expect(singleLayout).toHaveAttribute('aria-checked', 'true')

    await user.click(singleLayout)

    expect(
      screen.getByText('single,vsplit,hsplit,threeRight,quad,grid3x2')
    ).toBeInTheDocument()
  })

  test('lets grid3x2 be hidden even though it starts visible by default', async () => {
    const user = userEvent.setup()

    render(<LayoutDisplayMenuHarness />)

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    const gridLayout = await screen.findByRole('menuitemcheckbox', {
      name: '3x2 grid',
    })

    expect(gridLayout).not.toHaveAttribute('aria-disabled', 'true')
    expect(gridLayout).toHaveAttribute('aria-checked', 'true')

    await user.click(gridLayout)

    expect(
      screen.getByText('single,vsplit,hsplit,threeRight,quad')
    ).toBeInTheDocument()
  })

  test('toggling a non-active layout updates the visible layout list', async () => {
    const user = userEvent.setup()

    render(<LayoutDisplayMenuHarness />)

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Quad' })
    )

    expect(
      screen.getByText('single,vsplit,hsplit,threeRight,grid3x2')
    ).toBeInTheDocument()
  })

  test('normalizes the required single layout back into the visible list when callers omitted it', async () => {
    const user = userEvent.setup()

    render(
      <LayoutDisplayMenuHarness
        initialVisibleLayoutIds={['vsplit', 'hsplit', 'threeRight']}
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    await waitFor(() => {
      expect(
        screen.getByText('single,vsplit,hsplit,threeRight')
      ).toBeInTheDocument()
    })
  })

  test('shows custom layout actions and persists hidden custom ids', async () => {
    const user = userEvent.setup()
    const onPickLayout = vi.fn()
    const onEditCustomLayout = vi.fn()
    const onDeleteCustomLayout = vi.fn()
    const onCreateCustomLayout = vi.fn()

    render(
      <LayoutDisplayMenuHarness
        layouts={[customMainBottomLayout]}
        onPickLayout={onPickLayout}
        onEditCustomLayout={onEditCustomLayout}
        onDeleteCustomLayout={onDeleteCustomLayout}
        onCreateCustomLayout={onCreateCustomLayout}
      />
    )

    const openMenu = async (): Promise<void> => {
      await user.click(
        screen.getByRole('button', { name: 'Configure displayed layouts' })
      )
    }

    await openMenu()
    await user.click(screen.getByRole('button', { name: 'Main + bottom' }))

    await openMenu()
    await user.click(screen.getByRole('button', { name: 'Edit Main + bottom' }))

    await openMenu()
    await user.click(
      screen.getByRole('button', { name: 'Delete Main + bottom' })
    )

    await openMenu()
    await user.click(
      screen.getByRole('button', {
        name: 'Hide Main + bottom from switcher',
      })
    )

    expect(onPickLayout).toHaveBeenCalledWith('custom:main-bottom')
    expect(onEditCustomLayout).toHaveBeenCalledWith('custom:main-bottom')
    expect(onDeleteCustomLayout).toHaveBeenCalledWith('custom:main-bottom')
    expect(screen.getByText('custom:main-bottom')).toBeInTheDocument()

    await user.click(
      screen.getByRole('menuitem', { name: 'Create custom layout' })
    )

    expect(onCreateCustomLayout).toHaveBeenCalledOnce()
  })
})
