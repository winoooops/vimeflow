import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { NewSessionDialog } from './NewSessionDialog'

const setup = (
  overrides: Partial<Parameters<typeof NewSessionDialog>[0]> = {}
): {
  onCreate: ReturnType<typeof vi.fn>
  onOpenChange: ReturnType<typeof vi.fn>
} => {
  const onCreate = vi.fn()
  const onOpenChange = vi.fn()

  render(
    <NewSessionDialog
      open
      onOpenChange={onOpenChange}
      onCreate={onCreate}
      defaultCwd="~/code/vimeflow-core"
      {...overrides}
    />
  )

  return { onCreate, onOpenChange }
}

const renderWithOpen = (
  open: boolean,
  cwd: string
): ReturnType<typeof render> =>
  render(
    <NewSessionDialog
      open={open}
      onOpenChange={vi.fn()}
      onCreate={vi.fn()}
      defaultCwd={cwd}
    />
  )

describe('NewSessionDialog', () => {
  test('name prefills from the default folder basename', () => {
    setup()
    expect(screen.getByRole('textbox', { name: /session name/i })).toHaveValue(
      'vimeflow-core'
    )
  })

  test('reopening with a new defaultCwd refreshes path + name', () => {
    const closed = false
    const opened = true
    const { rerender } = renderWithOpen(closed, '~/code/alpha')

    rerender(
      <NewSessionDialog
        open={opened}
        onOpenChange={vi.fn()}
        onCreate={vi.fn()}
        defaultCwd="~/code/beta"
      />
    )

    expect(screen.getByRole('textbox', { name: /session name/i })).toHaveValue(
      'beta'
    )
  })

  test('Create emits onCreate with name, cwd, layout and panes', async () => {
    const { onCreate } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /create session/i }))
    expect(onCreate).toHaveBeenCalledWith({
      name: 'vimeflow-core',
      cwd: '~/code/vimeflow-core',
      layout: 'single',
      panes: [{ command: 'claude' }],
    })
  })

  test('Cancel closes without creating', async () => {
    const { onCreate, onOpenChange } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCreate).not.toHaveBeenCalled()
  })

  test('typing a name then reset restores the folder basename', async () => {
    setup()
    const user = userEvent.setup()
    const input = screen.getByRole('textbox', { name: /session name/i })
    await user.clear(input)
    await user.type(input, 'custom')
    await user.click(screen.getByRole('button', { name: /reset/i }))
    expect(input).toHaveValue('vimeflow-core')
  })
})
