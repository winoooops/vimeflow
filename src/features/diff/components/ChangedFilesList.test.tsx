import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ChangedFile } from '../types'
import { ChangedFilesList } from './ChangedFilesList'

describe('ChangedFilesList', () => {
  const mockFiles: ChangedFile[] = [
    {
      path: 'src/components/NavBar.tsx',
      status: 'modified',
      insertions: 12,
      deletions: 3,
      staged: false,
    },
    {
      path: 'src/utils/api-helper.rs',
      status: 'added',
      insertions: 45,
      deletions: 0,
      staged: true,
    },
    {
      path: 'tsconfig.json',
      status: 'deleted',
      insertions: 0,
      deletions: 18,
      staged: false,
    },
  ]

  test('renders CHANGED FILES header', () => {
    render(
      <ChangedFilesList
        files={mockFiles}
        selectedFile={null}
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
        selectedFile={null}
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
        selectedFile={null}
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
        selectedFile={{ path: 'src/components/NavBar.tsx', staged: false }}
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
        selectedFile={null}
        onSelectFile={handleSelect}
      />
    )

    const navBarFile = screen.getByText(/NavBar\.tsx/)

    await user.click(navBarFile)

    expect(handleSelect).toHaveBeenCalledWith(mockFiles[0])
  })

  test('renders files in the order provided (sorting done by parent)', () => {
    const orderedFiles: ChangedFile[] = [
      {
        path: 'modified.ts',
        status: 'modified',
        insertions: 10,
        deletions: 2,
        staged: false,
      },
      {
        path: 'added.rs',
        status: 'added',
        insertions: 20,
        deletions: 0,
        staged: false,
      },
      {
        path: 'deleted.txt',
        status: 'deleted',
        insertions: 0,
        deletions: 5,
        staged: false,
      },
    ]

    render(
      <ChangedFilesList
        files={orderedFiles}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    )

    const fileNames = screen
      .getAllByRole('button')
      .map((btn) => btn.textContent)

    // Renders in the order given
    expect(fileNames[0]).toContain('modified.ts')
    expect(fileNames[1]).toContain('added.rs')
    expect(fileNames[2]).toContain('deleted.txt')
  })

  test('applies hover state styling', () => {
    const { container } = render(
      <ChangedFilesList
        files={mockFiles}
        selectedFile={null}
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
        status: 'modified',
        insertions: 5,
        deletions: 2,
        staged: false,
      },
    ]

    render(
      <ChangedFilesList
        files={longPathFile}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    )

    const fileName = screen.getByText(/SomeComponent\.tsx/)

    // Check truncate class is applied
    expect(fileName).toHaveClass('truncate')
  })

  test('renders empty state when no files', () => {
    render(
      <ChangedFilesList files={[]} selectedFile={null} onSelectFile={vi.fn()} />
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
        selectedFile={null}
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

  test('MM/AM disambiguation: renders two rows for files with same path but different staged flags', async () => {
    const mmFiles: ChangedFile[] = [
      {
        path: 'src/both.ts',
        status: 'modified',
        insertions: 10,
        deletions: 5,
        staged: true,
      },
      {
        path: 'src/both.ts',
        status: 'modified',
        insertions: 3,
        deletions: 1,
        staged: false,
      },
    ]

    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ChangedFilesList
        files={mmFiles}
        selectedFile={null}
        onSelectFile={onSelect}
      />
    )

    // Two rows with the same filename
    const fileButtons = screen.getAllByText('both.ts')

    expect(fileButtons).toHaveLength(2)

    // Clicking each row calls onSelect with the correct file
    await user.click(fileButtons[0])
    expect(onSelect).toHaveBeenCalledWith(mmFiles[0])

    await user.click(fileButtons[1])
    expect(onSelect).toHaveBeenCalledWith(mmFiles[1])
  })

  test('uses unique row keys for MM/AM files (no key collision)', () => {
    const mmFiles: ChangedFile[] = [
      {
        path: 'src/both.ts',
        status: 'modified',
        insertions: 10,
        deletions: 5,
        staged: true,
      },
      {
        path: 'src/both.ts',
        status: 'modified',
        insertions: 3,
        deletions: 1,
        staged: false,
      },
    ]

    render(
      <ChangedFilesList
        files={mmFiles}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    )

    // Both rows should render (no key collision causes React to drop one)
    const fileButtons = screen.getAllByText('both.ts')

    expect(fileButtons).toHaveLength(2)
  })
})
