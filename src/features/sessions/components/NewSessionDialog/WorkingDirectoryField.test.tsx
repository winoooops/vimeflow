import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { pickDirectory } from './pickDirectory'
import { WorkingDirectoryField } from './WorkingDirectoryField'

vi.mock('./pickDirectory', () => ({ pickDirectory: vi.fn() }))

describe('WorkingDirectoryField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  test('a rejected pick shows an error and does not call onChange', async () => {
    vi.mocked(pickDirectory).mockRejectedValue(new Error('IPC unavailable'))
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<WorkingDirectoryField path="~/code/vf" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /browse/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not open the folder picker.'
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  test('disabled Browse does not open the directory picker', async () => {
    vi.mocked(pickDirectory).mockResolvedValue('/Users/x/picked')
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <WorkingDirectoryField
        path="~/code/vf"
        onChange={onChange}
        browseDisabled
      />
    )
    await user.click(screen.getByRole('button', { name: /browse/i }))
    expect(pickDirectory).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })
})
