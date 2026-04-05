import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ChangedFile } from '../types'
import { ChangedFilesList } from './ChangedFilesList'

describe('ChangedFilesList', () => {
  const mockFiles: ChangedFile[] = [
    {
      path: 'src/components/NavBar.tsx',
      status: 'M',
      insertions: 12,
      deletions: 3,
      staged: false,
    },
    {
      path: 'src/utils/api-helper.rs',
      status: 'A',
      insertions: 45,
      deletions: 0,
      staged: true,
    },
    {
      path: 'tsconfig.json',
      status: 'D',
      insertions: 0,
      deletions: 18,
      staged: false,
    },
  ]

  test('renders CHANGED FILES header', () => {
    render(
      <ChangedFilesList
        files={mockFiles}
        selectedPath={null}
        onSelectFile={vi.fn()}
      />
    )

    const header = screen.getByText(/Changed Files/i)

    expect(header).toBeInTheDocument()
    expect(header).toHaveClass('text-primary-container')
  })

  test('renders file list with icons and names', () => {
    render(
      <ChangedFilesList
        files={mockFiles}
        selectedPath={null}
        onSelectFile={vi.fn()}
      />
    )

    expect(screen.getByText(/NavBar\.tsx/)).toBeInTheDocument()
    expect(screen.getByText(/api-helper\.rs/)).toBeInTheDocument()
    expect(screen.getByText(/tsconfig\.json/)).toBeInTheDocument()

    // Check file icons are rendered (Material Symbols)
    const icons = screen.getAllByRole('img', { hidden: true })

    expect(icons.length).toBeGreaterThan(0)
  })

  test('displays insertion and deletion counts', () => {
    render(
      <ChangedFilesList
        files={mockFiles}
        selectedPath={null}
        onSelectFile={vi.fn()}
      />
    )

    // NavBar: +12 -3
    expect(screen.getByText('+12')).toBeInTheDocument()
    expect(screen.getByText('-3')).toBeInTheDocument()

    // api-helper: +45 -0
    expect(screen.getByText('+45')).toBeInTheDocument()

    // tsconfig: +0 -18
    expect(screen.getByText('-18')).toBeInTheDocument()
  })

  test('applies active file highlighting when selected', () => {
    const { container } = render(
      <ChangedFilesList
        files={mockFiles}
        selectedPath="src/components/NavBar.tsx"
        onSelectFile={vi.fn()}
      />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const activeFile = container.querySelector(
      '.bg-surface-container-highest\\/40'
    )

    expect(activeFile).toBeInTheDocument()
    expect(activeFile).toHaveTextContent('NavBar.tsx')
  })

  test('calls onSelectFile when file is clicked', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ChangedFilesList
        files={mockFiles}
        selectedPath={null}
        onSelectFile={handleSelect}
      />
    )

    const navBarFile = screen.getByText(/NavBar\.tsx/)

    await user.click(navBarFile)

    expect(handleSelect).toHaveBeenCalledWith('src/components/NavBar.tsx')
  })

  test('sorts files by status: M, A, D', () => {
    const unsortedFiles: ChangedFile[] = [
      {
        path: 'deleted.txt',
        status: 'D',
        insertions: 0,
        deletions: 5,
        staged: false,
      },
      {
        path: 'modified.ts',
        status: 'M',
        insertions: 10,
        deletions: 2,
        staged: false,
      },
      {
        path: 'added.rs',
        status: 'A',
        insertions: 20,
        deletions: 0,
        staged: false,
      },
    ]

    render(
      <ChangedFilesList
        files={unsortedFiles}
        selectedPath={null}
        onSelectFile={vi.fn()}
      />
    )

    const fileNames = screen
      .getAllByRole('button')
      .map((btn) => btn.textContent)

    // Expected order: M, A, D
    expect(fileNames[0]).toContain('modified.ts')
    expect(fileNames[1]).toContain('added.rs')
    expect(fileNames[2]).toContain('deleted.txt')
  })

  test('applies hover state styling', () => {
    const { container } = render(
      <ChangedFilesList
        files={mockFiles}
        selectedPath={null}
        onSelectFile={vi.fn()}
      />
    )

    // Check that hover classes exist
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const fileButton = container.querySelector('button')

    expect(fileButton).toHaveClass('hover:bg-surface-container-highest/20')
  })

  test('truncates long file paths', () => {
    const longPathFile: ChangedFile[] = [
      {
        path: 'src/features/diff/components/very/deep/nested/path/SomeComponent.tsx',
        status: 'M',
        insertions: 5,
        deletions: 2,
        staged: false,
      },
    ]

    render(
      <ChangedFilesList
        files={longPathFile}
        selectedPath={null}
        onSelectFile={vi.fn()}
      />
    )

    const fileName = screen.getByText(/SomeComponent\.tsx/)

    // Check truncate class is applied
    expect(fileName).toHaveClass('truncate')
  })

  test('renders empty state when no files', () => {
    render(
      <ChangedFilesList files={[]} selectedPath={null} onSelectFile={vi.fn()} />
    )

    const header = screen.getByText(/Changed Files/i)

    expect(header).toBeInTheDocument()

    // No file buttons should be rendered
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  test('uses correct color for insertions (green) and deletions (red)', () => {
    const { container } = render(
      <ChangedFilesList
        files={mockFiles}
        selectedPath={null}
        onSelectFile={vi.fn()}
      />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const insertionText = container.querySelector('.text-\\[\\#a6e3a1\\]')

    expect(insertionText).toBeInTheDocument()

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const deletionText = container.querySelector('.text-\\[\\#f38ba8\\]')

    expect(deletionText).toBeInTheDocument()
  })
})
