import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorTabs } from './EditorTabs'
import type { EditorTab } from '../types'

const mockTabs: EditorTab[] = [
  {
    id: 'tab-1',
    fileName: 'App.tsx',
    filePath: 'src/App.tsx',
    icon: 'description',
    isActive: true,
    isDirty: false,
  },
  {
    id: 'tab-2',
    fileName: 'utils.ts',
    filePath: 'src/utils.ts',
    icon: 'description',
    isActive: false,
    isDirty: true,
  },
  {
    id: 'tab-3',
    fileName: 'types.ts',
    filePath: 'src/types.ts',
    icon: 'description',
    isActive: false,
    isDirty: false,
  },
]

describe('EditorTabs', () => {
  test('renders all tabs', () => {
    render(
      <EditorTabs tabs={mockTabs} onTabClick={vi.fn()} onTabClose={vi.fn()} />
    )

    expect(screen.getByText('App.tsx')).toBeInTheDocument()
    expect(screen.getByText('utils.ts')).toBeInTheDocument()
    expect(screen.getByText('types.ts')).toBeInTheDocument()
  })

  test('applies active styling to active tab', () => {
    render(
      <EditorTabs tabs={mockTabs} onTabClick={vi.fn()} onTabClose={vi.fn()} />
    )

    const activeTab = screen.getByTestId('editor-tab-tab-1')
    expect(activeTab).toHaveClass('border-primary')
    expect(activeTab).toHaveClass('bg-surface')
    expect(activeTab).toHaveClass('text-on-surface')
  })

  test('applies inactive styling to inactive tabs', () => {
    render(
      <EditorTabs tabs={mockTabs} onTabClick={vi.fn()} onTabClose={vi.fn()} />
    )

    const inactiveTab = screen.getByTestId('editor-tab-tab-2')
    expect(inactiveTab).toHaveClass('text-on-surface-variant/60')
  })

  test('calls onTabClick when tab is clicked', async () => {
    const user = userEvent.setup()
    const handleTabClick = vi.fn()

    render(
      <EditorTabs
        tabs={mockTabs}
        onTabClick={handleTabClick}
        onTabClose={vi.fn()}
      />
    )

    const utilsTab = screen.getByTestId('editor-tab-tab-2')
    await user.click(utilsTab)

    expect(handleTabClick).toHaveBeenCalledWith('tab-2')
  })

  test('calls onTabClose when close button is clicked', async () => {
    const user = userEvent.setup()
    const handleTabClose = vi.fn()

    render(
      <EditorTabs
        tabs={mockTabs}
        onTabClick={vi.fn()}
        onTabClose={handleTabClose}
      />
    )

    const closeButtons = screen.getAllByLabelText(/close/i)
    await user.click(closeButtons[0])

    expect(handleTabClose).toHaveBeenCalledWith('tab-1')
  })

  test('prevents onTabClick when close button is clicked', async () => {
    const user = userEvent.setup()
    const handleTabClick = vi.fn()
    const handleTabClose = vi.fn()

    render(
      <EditorTabs
        tabs={mockTabs}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
      />
    )

    const closeButton = screen.getAllByLabelText(/close/i)[0]
    await user.click(closeButton)

    expect(handleTabClose).toHaveBeenCalledWith('tab-1')
    expect(handleTabClick).not.toHaveBeenCalled()
  })

  test('shows dirty indicator for modified tabs', () => {
    render(
      <EditorTabs tabs={mockTabs} onTabClick={vi.fn()} onTabClose={vi.fn()} />
    )

    const dirtyTab = screen.getByTestId('editor-tab-tab-2')
    expect(dirtyTab.textContent).toContain('●')
  })

  test('does not show dirty indicator for clean tabs', () => {
    render(
      <EditorTabs tabs={mockTabs} onTabClick={vi.fn()} onTabClose={vi.fn()} />
    )

    const cleanTab = screen.getByTestId('editor-tab-tab-1')
    expect(cleanTab.textContent).not.toContain('●')
  })

  test('tab is keyboard accessible', async () => {
    const user = userEvent.setup()
    const handleTabClick = vi.fn()

    render(
      <EditorTabs
        tabs={mockTabs}
        onTabClick={handleTabClick}
        onTabClose={vi.fn()}
      />
    )

    const tab = screen.getByTestId('editor-tab-tab-2')
    tab.focus()
    await user.keyboard('{Enter}')

    expect(handleTabClick).toHaveBeenCalledWith('tab-2')
  })

  test('renders custom icon for each tab', () => {
    const customTabs: EditorTab[] = [
      {
        id: 'tab-1',
        fileName: 'config.json',
        filePath: 'config.json',
        icon: 'settings',
        isActive: true,
        isDirty: false,
      },
    ]

    render(
      <EditorTabs tabs={customTabs} onTabClick={vi.fn()} onTabClose={vi.fn()} />
    )

    const tab = screen.getByRole('tab', { name: /config\.json/i })
    expect(tab).toHaveTextContent('settings')
  })

  test('handles empty tabs array', () => {
    render(<EditorTabs tabs={[]} onTabClick={vi.fn()} onTabClose={vi.fn()} />)

    const tablist = screen.getByRole('tablist')
    expect(tablist).toBeInTheDocument()
  })
})
