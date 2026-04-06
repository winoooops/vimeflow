import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileTabs } from './FileTabs'
import type { EditorFile } from '../types'

const mockFiles: EditorFile[] = [
  {
    id: 'file-1',
    path: 'src/App.tsx',
    name: 'App.tsx',
    language: 'typescript',
    modified: false,
    encoding: 'UTF-8',
    content: 'export const App = () => {}',
  },
  {
    id: 'file-2',
    path: 'src/utils.ts',
    name: 'utils.ts',
    language: 'typescript',
    modified: true,
    encoding: 'UTF-8',
    content: 'export const util = () => {}',
  },
  {
    id: 'file-3',
    path: 'src/types.ts',
    name: 'types.ts',
    language: 'typescript',
    modified: false,
    encoding: 'UTF-8',
    content: 'export type MyType = {}',
  },
]

describe('FileTabs', () => {
  test('renders all file tabs', () => {
    render(
      <FileTabs
        files={mockFiles}
        activeFileIndex={0}
        onTabClick={vi.fn()}
        onTabClose={vi.fn()}
        onNewFile={vi.fn()}
      />
    )

    expect(screen.getByText('App.tsx')).toBeInTheDocument()
    expect(screen.getByText('utils.ts')).toBeInTheDocument()
    expect(screen.getByText('types.ts')).toBeInTheDocument()
  })

  test('highlights active tab', () => {
    render(
      <FileTabs
        files={mockFiles}
        activeFileIndex={1}
        onTabClick={vi.fn()}
        onTabClose={vi.fn()}
        onNewFile={vi.fn()}
      />
    )

    const activeTab = screen.getByTestId('file-tab-file-2')

    expect(activeTab).toHaveClass('border-primary-container')
  })

  test('calls onTabClick when tab is clicked', async () => {
    const user = userEvent.setup()
    const handleTabClick = vi.fn()

    render(
      <FileTabs
        files={mockFiles}
        activeFileIndex={0}
        onTabClick={handleTabClick}
        onTabClose={vi.fn()}
        onNewFile={vi.fn()}
      />
    )

    const utilsTab = screen.getByTestId('file-tab-file-2')

    await user.click(utilsTab)

    expect(handleTabClick).toHaveBeenCalledWith(1)
  })

  test('calls onTabClose when close button is clicked', async () => {
    const user = userEvent.setup()
    const handleTabClose = vi.fn()

    render(
      <FileTabs
        files={mockFiles}
        activeFileIndex={0}
        onTabClick={vi.fn()}
        onTabClose={handleTabClose}
        onNewFile={vi.fn()}
      />
    )

    const closeButtons = screen.getAllByLabelText(/close/i)
    await user.click(closeButtons[0])

    expect(handleTabClose).toHaveBeenCalledWith(0)
  })

  test('calls onNewFile when new file button is clicked', async () => {
    const user = userEvent.setup()
    const handleNewFile = vi.fn()

    render(
      <FileTabs
        files={mockFiles}
        activeFileIndex={0}
        onTabClick={vi.fn()}
        onTabClose={vi.fn()}
        onNewFile={handleNewFile}
      />
    )

    const newFileButton = screen.getByLabelText(/new file/i)
    await user.click(newFileButton)

    expect(handleNewFile).toHaveBeenCalled()
  })

  test('renders new file button', () => {
    render(
      <FileTabs
        files={mockFiles}
        activeFileIndex={0}
        onTabClick={vi.fn()}
        onTabClose={vi.fn()}
        onNewFile={vi.fn()}
      />
    )

    expect(screen.getByLabelText(/new file/i)).toBeInTheDocument()
  })

  test('shows modified indicator for modified files', () => {
    render(
      <FileTabs
        files={mockFiles}
        activeFileIndex={1}
        onTabClick={vi.fn()}
        onTabClose={vi.fn()}
        onNewFile={vi.fn()}
      />
    )

    const modifiedTab = screen.getByTestId('file-tab-file-2')

    expect(modifiedTab).toBeInTheDocument()
    // Verify the modified indicator (●) is present
    expect(modifiedTab.textContent).toContain('●')
  })
})
