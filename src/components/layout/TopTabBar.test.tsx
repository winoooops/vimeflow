import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TopTabBar } from './TopTabBar'

describe('TopTabBar', () => {
  test('renders header element with correct role', () => {
    render(<TopTabBar />)
    const header = screen.getByRole('banner')
    expect(header).toBeInTheDocument()
    expect(header.tagName).toBe('HEADER')
  })

  test('applies correct layout classes', () => {
    render(<TopTabBar />)
    const header = screen.getByRole('banner')
    expect(header).toHaveClass('h-14')
    expect(header).toHaveClass('flex')
    expect(header).toHaveClass('items-center')
    expect(header).toHaveClass('justify-between')
    expect(header).toHaveClass('px-6')
  })

  test('applies glassmorphism styling', () => {
    render(<TopTabBar />)
    const header = screen.getByRole('banner')
    expect(header).toHaveClass('bg-[#121221]/90')
    expect(header).toHaveClass('backdrop-blur-md')
  })

  test('applies ghost border at bottom', () => {
    render(<TopTabBar />)
    const header = screen.getByRole('banner')
    expect(header).toHaveClass('border-b')
    expect(header).toHaveClass('border-[#4a444f]/15')
  })

  test('applies correct z-index', () => {
    render(<TopTabBar />)
    const header = screen.getByRole('banner')
    expect(header).toHaveClass('z-30')
  })

  test('renders navigation element', () => {
    render(<TopTabBar />)
    const nav = screen.getByRole('navigation')
    expect(nav).toBeInTheDocument()
  })

  test('renders Chat tab as active with primary styling', () => {
    render(<TopTabBar />)
    const chatTab = screen.getByRole('button', { name: 'Chat' })
    expect(chatTab).toBeInTheDocument()
    expect(chatTab).toHaveClass('text-[#e2c7ff]') // text-primary
    expect(chatTab).toHaveClass('border-b-2')
    expect(chatTab).toHaveClass('border-[#cba6f7]') // border-primary-container
    expect(chatTab).toHaveClass('h-full')
    expect(chatTab).toHaveClass('font-headline')
    expect(chatTab).toHaveClass('text-sm')
    expect(chatTab).toHaveClass('font-semibold')
  })

  test('renders Files tab as inactive with hover state', () => {
    render(<TopTabBar />)
    const filesTab = screen.getByRole('button', { name: 'Files' })
    expect(filesTab).toBeInTheDocument()
    expect(filesTab).toHaveClass('text-on-surface-variant')
    expect(filesTab).toHaveClass('hover:text-on-surface')
    expect(filesTab).toHaveClass('hover:bg-[#1e1e2e]')
    expect(filesTab).toHaveClass('h-[calc(100%-16px)]')
    expect(filesTab).toHaveClass('my-2')
    expect(filesTab).toHaveClass('rounded-lg')
  })

  test('renders Editor tab as inactive', () => {
    render(<TopTabBar />)
    const editorTab = screen.getByRole('button', { name: 'Editor' })
    expect(editorTab).toBeInTheDocument()
    expect(editorTab).toHaveClass('text-on-surface-variant')
  })

  test('renders Diff tab as inactive', () => {
    render(<TopTabBar />)
    const diffTab = screen.getByRole('button', { name: 'Diff' })
    expect(diffTab).toBeInTheDocument()
    expect(diffTab).toHaveClass('text-on-surface-variant')
  })

  test('renders notification bell icon', () => {
    render(<TopTabBar />)
    const bellButton = screen.getByRole('button', { name: /notification/i })
    expect(bellButton).toBeInTheDocument()
    expect(bellButton).toHaveClass('text-on-surface-variant')
    expect(bellButton).toHaveClass('hover:text-primary')
    // eslint-disable-next-line testing-library/no-node-access -- verifying icon CSS class
    const bellIcon = bellButton.querySelector('.material-symbols-outlined')
    expect(bellIcon).toBeInTheDocument()
  })

  test('renders more menu icon', () => {
    render(<TopTabBar />)
    const moreButton = screen.getByRole('button', { name: /more/i })
    expect(moreButton).toBeInTheDocument()
    expect(moreButton).toHaveClass('text-on-surface-variant')
    expect(moreButton).toHaveClass('hover:text-on-surface')
    // eslint-disable-next-line testing-library/no-node-access -- verifying icon CSS class
    const moreIcon = moreButton.querySelector('.material-symbols-outlined')
    expect(moreIcon).toBeInTheDocument()
  })

  test('right action buttons are present', () => {
    render(<TopTabBar />)
    const bellButton = screen.getByRole('button', { name: /notification/i })
    const moreButton = screen.getByRole('button', { name: /more/i })
    expect(bellButton).toBeInTheDocument()
    expect(moreButton).toBeInTheDocument()
  })

  test('defaults to Chat tab when activeTab prop is not provided', () => {
    render(<TopTabBar />)
    const chatTab = screen.getByRole('button', { name: 'Chat' })
    expect(chatTab).toHaveClass(
      'text-[#e2c7ff]',
      'border-b-2',
      'border-[#cba6f7]'
    )
    expect(chatTab).toHaveAttribute('aria-current', 'page')
  })

  test('renders Files tab as active when activeTab="Files"', () => {
    render(<TopTabBar activeTab="Files" />)
    const filesTab = screen.getByRole('button', { name: 'Files' })
    expect(filesTab).toHaveClass(
      'text-[#e2c7ff]',
      'border-b-2',
      'border-[#cba6f7]'
    )
    expect(filesTab).toHaveAttribute('aria-current', 'page')
  })

  test('renders Chat tab as inactive when activeTab="Files"', () => {
    render(<TopTabBar activeTab="Files" />)
    const chatTab = screen.getByRole('button', { name: 'Chat' })
    expect(chatTab).toHaveClass('text-on-surface-variant')
    expect(chatTab).not.toHaveClass('text-[#e2c7ff]')
    expect(chatTab).not.toHaveAttribute('aria-current')
  })

  test('renders Editor tab as active when activeTab="Editor"', () => {
    render(<TopTabBar activeTab="Editor" />)
    const editorTab = screen.getByRole('button', { name: 'Editor' })
    expect(editorTab).toHaveClass('text-[#e2c7ff]', 'border-b-2')
    expect(editorTab).toHaveAttribute('aria-current', 'page')
  })

  test('renders Diff tab as active when activeTab="Diff"', () => {
    render(<TopTabBar activeTab="Diff" />)
    const diffTab = screen.getByRole('button', { name: 'Diff' })
    expect(diffTab).toHaveClass('text-[#e2c7ff]', 'border-b-2')
    expect(diffTab).toHaveAttribute('aria-current', 'page')
  })

  test('calls onTabChange when a tab is clicked', async () => {
    const handleTabChange = vi.fn()
    const user = userEvent.setup()
    render(<TopTabBar onTabChange={handleTabChange} />)

    await user.click(screen.getByRole('button', { name: 'Files' }))
    expect(handleTabChange).toHaveBeenCalledWith('Files')
  })

  test('calls onTabChange with correct tab name for each tab', async () => {
    const handleTabChange = vi.fn()
    const user = userEvent.setup()
    render(<TopTabBar onTabChange={handleTabChange} />)

    await user.click(screen.getByRole('button', { name: 'Editor' }))
    expect(handleTabChange).toHaveBeenCalledWith('Editor')

    await user.click(screen.getByRole('button', { name: 'Diff' }))
    expect(handleTabChange).toHaveBeenCalledWith('Diff')
  })

  test('does not crash when onTabChange is not provided', async () => {
    const user = userEvent.setup()
    render(<TopTabBar />)

    await user.click(screen.getByRole('button', { name: 'Files' }))
    // No error thrown
    expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument()
  })
})
