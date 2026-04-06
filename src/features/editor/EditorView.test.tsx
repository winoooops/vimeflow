import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorView } from './EditorView'

describe('EditorView', () => {
  test('renders the editor view container', () => {
    render(<EditorView />)

    const container = screen.getByTestId('editor-view')
    expect(container).toBeInTheDocument()
  })

  test('renders IconRail component', () => {
    render(<EditorView />)

    const iconRail = screen.getByTestId('icon-rail')
    expect(iconRail).toBeInTheDocument()
  })

  test('renders Sidebar component', () => {
    render(<EditorView />)

    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar).toBeInTheDocument()
  })

  test('renders TopTabBar with Editor active', () => {
    render(<EditorView />)

    const editorTab = screen.getByRole('button', { name: /editor/i })
    expect(editorTab).toBeInTheDocument()
    expect(editorTab).toHaveAttribute('aria-current', 'page')
  })

  test('renders main content area with correct margins', () => {
    render(<EditorView />)

    const mainContent = screen.getByTestId('editor-main-content')
    expect(mainContent).toHaveClass('ml-[308px]')
    expect(mainContent).toHaveClass('flex-1')
    expect(mainContent).toHaveClass('flex')
    expect(mainContent).toHaveClass('flex-col')
  })

  test('renders ExplorerPane component', () => {
    render(<EditorView />)

    const explorerPane = screen.getByRole('navigation', {
      name: /file explorer/i,
    })
    expect(explorerPane).toBeInTheDocument()
  })

  test('ExplorerPane is open by default', () => {
    render(<EditorView />)

    const explorerPane = screen.getByRole('navigation', {
      name: /file explorer/i,
    })
    expect(explorerPane).not.toHaveClass('w-0')
    expect(explorerPane).toHaveClass('w-64')
  })

  test('renders code area container', () => {
    render(<EditorView />)

    const codeArea = screen.getByTestId('code-area')
    expect(codeArea).toBeInTheDocument()
    expect(codeArea).toHaveClass('flex-1')
    expect(codeArea).toHaveClass('flex')
    expect(codeArea).toHaveClass('flex-col')
  })

  test('renders EditorTabs component', () => {
    render(<EditorView />)

    const tablist = screen.getByRole('tablist')
    expect(tablist).toBeInTheDocument()
  })

  test('renders at least one editor tab', () => {
    render(<EditorView />)

    // Check for the tablist which contains the editor tabs
    const tablist = screen.getByRole('tablist')
    expect(tablist).toBeInTheDocument()

    // Check that at least one tab exists (tabs don't have role="tab", they're divs)
    const firstTab = screen.getByTestId('editor-tab-tab-1')
    expect(firstTab).toBeInTheDocument()
  })

  test('renders CodeEditor component', () => {
    render(<EditorView />)

    const codeEditor = screen.getByTestId('code-editor')
    expect(codeEditor).toBeInTheDocument()
  })

  test('renders EditorStatusBar component', () => {
    render(<EditorView />)

    // Multiple status elements exist (ContextPanel + EditorStatusBar)
    // EditorStatusBar is the one with vim mode
    const vimMode = screen.getByText(/normal/i)
    expect(vimMode).toBeInTheDocument()
  })

  test('EditorStatusBar shows vim mode', () => {
    render(<EditorView />)

    const vimMode = screen.getByText(/normal/i)
    expect(vimMode).toBeInTheDocument()
  })

  test('EditorStatusBar shows git branch', () => {
    render(<EditorView />)

    // Should show a git branch name
    const gitBranch = screen.getByText(/feat\/editor-view/i)
    expect(gitBranch).toBeInTheDocument()
  })

  test('renders ContextPanel component', () => {
    render(<EditorView />)

    const contextPanel = screen.getByRole('complementary', {
      name: /agent status panel/i,
    })
    expect(contextPanel).toBeInTheDocument()
  })

  test('applies dynamic right margin when ContextPanel is open', () => {
    render(<EditorView />)

    const mainContent = screen.getByTestId('editor-main-content')
    expect(mainContent).toHaveClass('mr-[280px]')
  })

  test('applies transition classes for smooth animations', () => {
    render(<EditorView />)

    const mainContent = screen.getByTestId('editor-main-content')
    expect(mainContent).toHaveClass('transition-all')
    expect(mainContent).toHaveClass('duration-300')
  })

  test('accepts onTabChange callback prop', () => {
    const mockTabChange = vi.fn()

    // Component should render without errors when onTabChange is provided
    render(<EditorView onTabChange={mockTabChange} />)

    const container = screen.getByTestId('editor-view')
    expect(container).toBeInTheDocument()
  })

  test('has correct root container styling', () => {
    render(<EditorView />)

    const container = screen.getByTestId('editor-view')
    expect(container).toHaveClass('h-screen')
    expect(container).toHaveClass('overflow-hidden')
    expect(container).toHaveClass('flex')
    expect(container).toHaveClass('bg-background')
    expect(container).toHaveClass('text-on-surface')
    expect(container).toHaveClass('font-body')
  })
})
