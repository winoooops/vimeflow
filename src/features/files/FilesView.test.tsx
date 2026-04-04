import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { FilesView } from './FilesView'

describe('FilesView', () => {
  test('renders files view container', () => {
    render(<FilesView />)

    const container = screen.getByTestId('files-view')
    expect(container).toBeInTheDocument()
  })

  test('renders main content area', () => {
    render(<FilesView />)

    const mainContent = screen.getByTestId('main-content')
    expect(mainContent).toBeInTheDocument()
  })

  test('renders files area', () => {
    render(<FilesView />)

    const filesArea = screen.getByTestId('files-area')
    expect(filesArea).toBeInTheDocument()
  })

  test('renders TopTabBar with Files tab active', () => {
    render(<FilesView />)

    const filesTab = screen.getByRole('button', { name: 'Files' })
    expect(filesTab).toHaveAttribute('aria-current', 'page')
    expect(filesTab).toHaveClass('text-[#e2c7ff]')
  })

  test('renders Breadcrumbs', () => {
    render(<FilesView />)

    const breadcrumbs = screen.getByRole('navigation', { name: /breadcrumb/i })
    expect(breadcrumbs).toBeInTheDocument()
  })

  test('renders FileTree', () => {
    render(<FilesView />)

    const tree = screen.getByRole('tree', { name: /file tree/i })
    expect(tree).toBeInTheDocument()
  })

  test('renders DropZone', () => {
    render(<FilesView />)

    const dropZone = screen.getByRole('region', { name: /file drop zone/i })
    expect(dropZone).toBeInTheDocument()
  })

  test('renders FileStatusBar', () => {
    render(<FilesView />)

    const statusBar = screen.getByRole('status', { name: /file status bar/i })
    expect(statusBar).toBeInTheDocument()
  })

  test('renders IconRail', () => {
    render(<FilesView />)

    // IconRail has data-testid
    const iconRail = screen.getByTestId('icon-rail')
    expect(iconRail).toBeInTheDocument()
  })

  test('renders Sidebar', () => {
    render(<FilesView />)

    // Sidebar has data-testid
    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar).toBeInTheDocument()
  })

  test('renders ContextPanel', () => {
    render(<FilesView />)

    // ContextPanel has data-testid
    const contextPanel = screen.getByTestId('context-panel')
    expect(contextPanel).toBeInTheDocument()
  })

  test('has correct layout classes', () => {
    render(<FilesView />)

    const container = screen.getByTestId('files-view')
    expect(container).toHaveClass(
      'h-screen',
      'overflow-hidden',
      'flex',
      'bg-background'
    )
  })

  test('main content has correct margins for sidebars', () => {
    render(<FilesView />)

    const mainContent = screen.getByTestId('main-content')
    expect(mainContent).toHaveClass('ml-[308px]', 'mr-[280px]')
  })

  test('files area has correct styling', () => {
    render(<FilesView />)

    const filesArea = screen.getByTestId('files-area')
    expect(filesArea).toHaveClass(
      'flex-1',
      'flex',
      'flex-col',
      'overflow-y-auto',
      'p-6'
    )
  })

  test('renders mock file tree nodes', () => {
    render(<FilesView />)

    // Check for root nodes from mockFileTree (src appears in both breadcrumbs and tree)
    expect(screen.getAllByText('src').length).toBeGreaterThan(0)
    expect(screen.getByText('package.json')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  test('renders breadcrumb segments', () => {
    render(<FilesView />)

    expect(screen.getByText('vibm-project')).toBeInTheDocument()
    // src and components appear in both breadcrumbs and file tree
    expect(screen.getAllByText('src').length).toBeGreaterThan(0)
    expect(screen.getAllByText('components').length).toBeGreaterThan(0)
  })

  test('renders file status bar data', () => {
    render(<FilesView />)

    expect(screen.getByText('142 files')).toBeInTheDocument()
    expect(screen.getByText('12.4 MB')).toBeInTheDocument()
    expect(screen.getByText('UTF-8')).toBeInTheDocument()
    expect(screen.getByText('main*')).toBeInTheDocument()
  })
})
