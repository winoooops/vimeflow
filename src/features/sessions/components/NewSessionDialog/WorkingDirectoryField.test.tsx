import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { WorkingDirectoryField } from './WorkingDirectoryField'

vi.mock('./pickDirectory', () => ({ pickDirectory: vi.fn() }))
import { pickDirectory } from './pickDirectory'

describe('WorkingDirectoryField', () => {
  test('Browse… picks a directory and reports it', async () => {
    vi.mocked(pickDirectory).mockResolvedValue('/Users/x/picked')
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<WorkingDirectoryField path="~/code/vf" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /browse/i }))
    expect(onChange).toHaveBeenCalledWith('/Users/x/picked')
  })

  test('a canceled pick does not call onChange', async () => {
    vi.mocked(pickDirectory).mockResolvedValue(null)
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<WorkingDirectoryField path="~/code/vf" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /browse/i }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
