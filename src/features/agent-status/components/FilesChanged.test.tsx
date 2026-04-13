import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilesChanged } from './FilesChanged'
import type { FileChangeItem } from './FilesChanged'

const mockFiles: FileChangeItem[] = [
  { path: 'src/components/App.tsx', type: 'new' },
  { path: 'src/utils/helpers.ts', type: 'modified' },
  { path: 'src/old/legacy.ts', type: 'deleted' },
]

describe('FilesChanged', () => {
  test('renders correct prefix symbols for each type', async () => {
    const user = userEvent.setup()
    render(<FilesChanged files={mockFiles} />)

    await user.click(screen.getByRole('button', { name: /files changed/i }))

    expect(screen.getByText('+')).toBeInTheDocument()
    expect(screen.getByText('~')).toBeInTheDocument()
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  test('renders correct badges for each type', async () => {
    const user = userEvent.setup()
    render(<FilesChanged files={mockFiles} />)

    await user.click(screen.getByRole('button', { name: /files changed/i }))

    expect(screen.getByText('NEW')).toBeInTheDocument()
    expect(screen.getByText('EDIT')).toBeInTheDocument()
    expect(screen.getByText('DEL')).toBeInTheDocument()
  })

  test('renders file paths', async () => {
    const user = userEvent.setup()
    render(<FilesChanged files={mockFiles} />)

    await user.click(screen.getByRole('button', { name: /files changed/i }))

    expect(screen.getByText('src/components/App.tsx')).toBeInTheDocument()
    expect(screen.getByText('src/utils/helpers.ts')).toBeInTheDocument()
    expect(screen.getByText('src/old/legacy.ts')).toBeInTheDocument()
  })

  test('shows file count in section header', () => {
    render(<FilesChanged files={mockFiles} />)

    expect(screen.getByText('3')).toBeInTheDocument()
  })

  test('applies green color to new file prefix', async () => {
    const user = userEvent.setup()
    render(<FilesChanged files={[{ path: 'new.ts', type: 'new' }]} />)

    await user.click(screen.getByRole('button', { name: /files changed/i }))

    const prefix = screen.getByText('+')
    expect(prefix).toHaveClass('text-success')
  })

  test('applies blue color to modified file prefix', async () => {
    const user = userEvent.setup()
    render(<FilesChanged files={[{ path: 'mod.ts', type: 'modified' }]} />)

    await user.click(screen.getByRole('button', { name: /files changed/i }))

    const prefix = screen.getByText('~')
    expect(prefix).toHaveClass('text-secondary')
  })

  test('applies red color to deleted file prefix', async () => {
    const user = userEvent.setup()
    render(<FilesChanged files={[{ path: 'del.ts', type: 'deleted' }]} />)

    await user.click(screen.getByRole('button', { name: /files changed/i }))

    const prefix = screen.getByText('-')
    expect(prefix).toHaveClass('text-error')
  })
})
