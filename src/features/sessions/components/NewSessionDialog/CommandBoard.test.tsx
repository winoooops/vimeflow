import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { LAYOUTS } from '../../../terminal/layout-registry'
import { CommandBoard } from './CommandBoard'

describe('CommandBoard', () => {
  test('renders one pane button per layout slot', () => {
    render(
      <CommandBoard
        layout={LAYOUTS.vsplit}
        assign={['claude', 'shell']}
        onAssign={vi.fn()}
      />
    )

    expect(
      screen.getAllByRole('button', { name: /choose command for pane/i })
    ).toHaveLength(2)
  })

  test('selecting a command assigns it to the pane index', async () => {
    const onAssign = vi.fn()
    const user = userEvent.setup()
    render(
      <CommandBoard
        layout={LAYOUTS.vsplit}
        assign={['claude', 'shell']}
        onAssign={onAssign}
      />
    )

    const paneButtons = screen.getAllByRole('button', {
      name: /choose command for pane/i,
    })
    await user.click(paneButtons[1])
    await user.click(screen.getByRole('menuitem', { name: /codex cli/i }))
    expect(onAssign).toHaveBeenCalledWith(1, 'codex')
  })
})
