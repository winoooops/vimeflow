import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FilesView } from './FilesView'
import { FileExplorer } from './panels/FileExplorer'

vi.mock('./panels/FileExplorer', () => ({
  FileExplorer: vi.fn(() => <div data-testid="file-explorer-mock" />),
}))

const FileExplorerMock = vi.mocked(FileExplorer)

describe('FilesView', () => {
  beforeEach(() => {
    FileExplorerMock.mockClear()
  })

  test('mounts FileExplorer inside the testid root', () => {
    render(<FilesView cwd="~" onFileSelect={vi.fn()} />)

    expect(screen.getByTestId('files-view')).toBeInTheDocument()
    expect(screen.getByTestId('file-explorer-mock')).toBeInTheDocument()
  })

  test('forwards cwd to FileExplorer', () => {
    render(<FilesView cwd="/some/deep/path" onFileSelect={vi.fn()} />)

    expect(FileExplorerMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/some/deep/path' }),
      undefined
    )
  })

  test('forwards onFileSelect to FileExplorer', () => {
    const onFileSelect = vi.fn()

    render(<FilesView cwd="~" onFileSelect={onFileSelect} />)

    expect(FileExplorerMock).toHaveBeenCalledWith(
      expect.objectContaining({ onFileSelect }),
      undefined
    )
  })

  test('hidden prop applies to the testid root', () => {
    render(<FilesView cwd="~" onFileSelect={vi.fn()} hidden />)

    expect(screen.getByTestId('files-view')).toHaveAttribute('hidden')
  })

  test('hidden=false omits the hidden attribute', () => {
    const hidden = false as const

    render(<FilesView cwd="~" onFileSelect={vi.fn()} hidden={hidden} />)

    expect(screen.getByTestId('files-view')).not.toHaveAttribute('hidden')
  })

  test('hidden defaults to false', () => {
    render(<FilesView cwd="~" onFileSelect={vi.fn()} />)

    expect(screen.getByTestId('files-view')).not.toHaveAttribute('hidden')
  })
})
