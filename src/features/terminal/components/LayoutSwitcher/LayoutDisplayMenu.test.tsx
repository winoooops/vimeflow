import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { useState, type ReactElement } from 'react'
import type { LayoutId } from '../../../sessions/types'
import { LayoutDisplayMenu } from './LayoutDisplayMenu'

interface HarnessProps {
  activeLayoutId?: LayoutId
  initialVisibleLayoutIds?: readonly LayoutId[]
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
}: HarnessProps): ReactElement => {
  const [visibleLayoutIds, setVisibleLayoutIds] = useState(
    initialVisibleLayoutIds
  )

  return (
    <>
      <LayoutDisplayMenu
        activeLayoutId={activeLayoutId}
        visibleLayoutIds={visibleLayoutIds}
        onVisibleLayoutIdsChange={setVisibleLayoutIds}
      />
      <output>{visibleLayoutIds.join(',')}</output>
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

  test('toggling a non-active layout updates the visible layout list', async () => {
    const user = userEvent.setup()

    render(<LayoutDisplayMenuHarness />)

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: '3x2 grid' })
    )

    expect(
      screen.getByText('single,vsplit,hsplit,threeRight,quad')
    ).toBeInTheDocument()
  })

  test('normalizes single back into the visible list when callers omitted it', async () => {
    const user = userEvent.setup()

    render(
      <LayoutDisplayMenuHarness
        initialVisibleLayoutIds={['vsplit', 'hsplit', 'threeRight']}
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    const singleLayout = await screen.findByRole('menuitemcheckbox', {
      name: 'Single',
    })

    expect(singleLayout).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => {
      expect(
        screen.getByText('single,vsplit,hsplit,threeRight')
      ).toBeInTheDocument()
    })
  })
})
