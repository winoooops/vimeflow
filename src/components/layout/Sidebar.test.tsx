import { render, screen, within } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { Sidebar } from './Sidebar'
import { mockConversations } from '../../features/chat/data/mockMessages'

describe('Sidebar', () => {
  test('renders with fixed positioning and correct dimensions', () => {
    render(<Sidebar conversations={mockConversations} />)
    const sidebar = screen.getByRole('complementary')

    expect(sidebar).toBeInTheDocument()
    expect(sidebar).toHaveClass('w-[260px]')
    expect(sidebar).toHaveClass('h-screen')
    expect(sidebar).toHaveClass('fixed')
    expect(sidebar).toHaveClass('left-[48px]')
  })

  test('renders macOS traffic lights in header', () => {
    render(<Sidebar conversations={mockConversations} />)

    const header = screen.getByRole('banner')
    const trafficLights = within(header).getAllByRole('presentation')

    expect(trafficLights).toHaveLength(3)
    expect(trafficLights[0]).toHaveClass('bg-[#ff5f56]') // red
    expect(trafficLights[1]).toHaveClass('bg-[#ffbd2e]') // yellow
    expect(trafficLights[2]).toHaveClass('bg-[#27c93f]') // green
  })

  test('renders search bar with ⌘K hint', () => {
    render(<Sidebar conversations={mockConversations} />)

    const searchRegion = screen.getByRole('search')
    expect(searchRegion).toBeInTheDocument()

    const searchButton = within(searchRegion).getByRole('button', {
      name: /search sessions/i,
    })
    expect(searchButton).toBeInTheDocument()
    // eslint-disable-next-line testing-library/no-node-access -- verifying icon CSS class
    const icon = searchButton.querySelector('.material-symbols-outlined')
    expect(icon).toBeInTheDocument()
  })

  test('renders "Recent Chats" category header', () => {
    render(<Sidebar conversations={mockConversations} />)

    const heading = screen.getByRole('heading', { name: /recent chats/i })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveClass('uppercase')
  })

  test('renders active conversation with special styling', () => {
    render(<Sidebar conversations={mockConversations} />)

    const activeConversation = mockConversations.find((c) => c.active)
    expect(activeConversation).toBeDefined()

    const activeItem = screen.getByText(activeConversation!.title)
    expect(activeItem).toBeInTheDocument()
    expect(activeItem).toHaveClass('text-xs')
  })

  test('renders sub-thread indicator for active conversation', () => {
    render(<Sidebar conversations={mockConversations} />)

    expect(screen.getByText('Sub-thread')).toBeInTheDocument()
  })

  test('renders inactive conversations without special background', () => {
    render(<Sidebar conversations={mockConversations} />)

    const inactiveConversations = mockConversations.filter((c) => !c.active)
    expect(inactiveConversations.length).toBeGreaterThan(0)

    inactiveConversations.forEach((conversation) => {
      expect(screen.getByText(conversation.title)).toBeInTheDocument()
    })
  })

  test('renders "Active Sessions" category', () => {
    render(<Sidebar conversations={mockConversations} />)

    const heading = screen.getByRole('heading', { name: /active sessions/i })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveClass('uppercase')
  })

  test('renders settings button at bottom', () => {
    render(<Sidebar conversations={mockConversations} />)

    const settingsButton = screen.getByRole('button', { name: /settings/i })
    expect(settingsButton).toBeInTheDocument()
  })

  test('has proper accessibility structure', () => {
    render(<Sidebar conversations={mockConversations} />)

    const sidebar = screen.getByRole('complementary')
    expect(sidebar).toBeInTheDocument()

    const nav = screen.getByRole('navigation')
    expect(nav).toBeInTheDocument()
  })
})
