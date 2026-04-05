import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import FilesView from './FilesView'

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

  test('renders TopTabBar with default tab (FilesView is deprecated, Files tab removed)', () => {
    render(<FilesView />)

    const chatTab = screen.getByRole('button', { name: 'Chat' })
    expect(chatTab).toHaveAttribute('aria-current', 'page')
    expect(chatTab).toHaveClass('text-[#e2c7ff]')
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

  test('updates breadcrumbs when a file node is clicked', async () => {
    const user = userEvent.setup()
    render(<FilesView />)

    // Click on NavBar.tsx (inside src/components/)
    const navBarNode = screen.getByText('NavBar.tsx')
    await user.click(navBarNode)

    // Breadcrumbs should show: vibm-project / src / components / NavBar.tsx
    const breadcrumbNav = screen.getByRole('navigation', {
      name: /breadcrumb/i,
    })
    expect(breadcrumbNav).toHaveTextContent('vibm-project')
    expect(breadcrumbNav).toHaveTextContent('src')
    expect(breadcrumbNav).toHaveTextContent('components')
    expect(breadcrumbNav).toHaveTextContent('NavBar.tsx')
  })

  test('updates breadcrumbs when a folder node is clicked', async () => {
    const user = userEvent.setup()
    render(<FilesView />)

    // Click on utils folder text in the tree
    const allUtils = screen.getAllByText('utils')
    // The first "utils" in the tree (not in breadcrumbs initially since default is vibm-project/src/components)
    await user.click(allUtils[0])

    // Breadcrumbs should show: vibm-project / src / utils
    const breadcrumbNav = screen.getByRole('navigation', {
      name: /breadcrumb/i,
    })
    expect(breadcrumbNav).toHaveTextContent('vibm-project')
    expect(breadcrumbNav).toHaveTextContent('src')
    expect(breadcrumbNav).toHaveTextContent('utils')
  })

  test('updates breadcrumbs when a root-level file is clicked', async () => {
    const user = userEvent.setup()
    render(<FilesView />)

    // Click on README.md (root level)
    const readmeNode = screen.getByText('README.md')
    await user.click(readmeNode)

    // Breadcrumbs should show: vibm-project / README.md
    const breadcrumbNav = screen.getByRole('navigation', {
      name: /breadcrumb/i,
    })
    expect(breadcrumbNav).toHaveTextContent('vibm-project')
    expect(breadcrumbNav).toHaveTextContent('README.md')
  })

  test('calls onFileDiffRequest when clicking a file with git status', async () => {
    const user = userEvent.setup()
    const onFileDiffRequest = vi.fn()
    render(<FilesView onFileDiffRequest={onFileDiffRequest} />)

    // Click on NavBar.tsx (has gitStatus: 'M')
    const navBarNode = screen.getByText('NavBar.tsx')
    await user.click(navBarNode)

    // Should call onFileDiffRequest with the full file path
    expect(onFileDiffRequest).toHaveBeenCalledTimes(1)
    expect(onFileDiffRequest).toHaveBeenCalledWith('src/components/NavBar.tsx')
  })

  test('does not call onFileDiffRequest when clicking a file without git status', async () => {
    const user = userEvent.setup()
    const onFileDiffRequest = vi.fn()
    render(<FilesView onFileDiffRequest={onFileDiffRequest} />)

    // Click on FileTree.tsx (no gitStatus)
    const fileTreeNode = screen.getByText('FileTree.tsx')
    await user.click(fileTreeNode)

    // Should NOT call onFileDiffRequest
    expect(onFileDiffRequest).not.toHaveBeenCalled()
  })

  test('does not call onFileDiffRequest when clicking a folder', async () => {
    const user = userEvent.setup()
    const onFileDiffRequest = vi.fn()
    render(<FilesView onFileDiffRequest={onFileDiffRequest} />)

    // Click on utils folder text in the tree
    const allUtils = screen.getAllByText('utils')
    await user.click(allUtils[0])

    // Should NOT call onFileDiffRequest (even if folder had gitStatus)
    expect(onFileDiffRequest).not.toHaveBeenCalled()
  })

  test('calls onFileDiffRequest with correct path for nested files', async () => {
    const user = userEvent.setup()
    const onFileDiffRequest = vi.fn()
    render(<FilesView onFileDiffRequest={onFileDiffRequest} />)

    // Click on api-helper.rs (has gitStatus: 'A', nested in src/utils/)
    const apiHelperNode = screen.getByText('api-helper.rs')
    await user.click(apiHelperNode)

    // Should call onFileDiffRequest with full path
    expect(onFileDiffRequest).toHaveBeenCalledTimes(1)
    expect(onFileDiffRequest).toHaveBeenCalledWith('src/utils/api-helper.rs')
  })

  test('calls onFileDiffRequest with correct path for root-level files', async () => {
    const user = userEvent.setup()
    const onFileDiffRequest = vi.fn()
    render(<FilesView onFileDiffRequest={onFileDiffRequest} />)

    // Click on tsconfig.json (has gitStatus: 'D', root level)
    const tsconfigNode = screen.getByText('tsconfig.json')
    await user.click(tsconfigNode)

    // Should call onFileDiffRequest with file name only (no parent path)
    expect(onFileDiffRequest).toHaveBeenCalledTimes(1)
    expect(onFileDiffRequest).toHaveBeenCalledWith('tsconfig.json')
  })
})
