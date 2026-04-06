import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChatView from './ChatView'

describe('ChatView', () => {
  test('renders ChatView component', () => {
    render(<ChatView />)
    expect(screen.getByTestId('chat-view')).toBeInTheDocument()
  })

  test('renders IconRail component', () => {
    render(<ChatView />)
    expect(screen.getByTestId('icon-rail')).toBeInTheDocument()
  })

  test('renders Sidebar component', () => {
    render(<ChatView />)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  test('renders TopTabBar component', () => {
    render(<ChatView />)
    expect(screen.getByTestId('top-tab-bar')).toBeInTheDocument()
  })

  test('renders ContextPanel component', () => {
    render(<ChatView />)
    expect(screen.getByTestId('context-panel')).toBeInTheDocument()
  })

  test('renders MessageThread component', () => {
    render(<ChatView />)
    expect(screen.getByTestId('message-thread')).toBeInTheDocument()
  })

  test('renders MessageInput component', () => {
    render(<ChatView />)
    expect(screen.getByTestId('message-input')).toBeInTheDocument()
  })

  test('applies correct layout classes', () => {
    render(<ChatView />)
    const chatView = screen.getByTestId('chat-view')
    expect(chatView).toHaveClass('h-screen')
    expect(chatView).toHaveClass('overflow-hidden')
    expect(chatView).toHaveClass('flex')
    expect(chatView).toHaveClass('bg-background')
  })

  test('main content area applies correct margin classes', () => {
    render(<ChatView />)
    const mainContent = screen.getByTestId('main-content')
    expect(mainContent).toHaveClass('ml-[308px]')
    expect(mainContent).toHaveClass('mr-[280px]')
    expect(mainContent).toHaveClass('flex-1')
    expect(mainContent).toHaveClass('flex')
    expect(mainContent).toHaveClass('flex-col')
  })

  test('message area contains both MessageThread and MessageInput', () => {
    render(<ChatView />)
    const messageArea = screen.getByTestId('message-area')
    expect(messageArea).toBeInTheDocument()
    expect(messageArea).toHaveClass('flex-1')
    expect(messageArea).toHaveClass('flex')
    expect(messageArea).toHaveClass('flex-col')
  })

  test('applies dynamic right margin when ContextPanel is open', () => {
    render(<ChatView isContextPanelOpen />)
    const mainContent = screen.getByTestId('main-content')
    expect(mainContent).toHaveClass('mr-[280px]')
  })

  test('applies no right margin when ContextPanel is closed', () => {
    // eslint-disable-next-line react/jsx-boolean-value
    render(<ChatView isContextPanelOpen={false} />)
    const mainContent = screen.getByTestId('main-content')
    expect(mainContent).toHaveClass('mr-0')
  })

  test('applies transition classes for smooth margin animations', () => {
    render(<ChatView />)
    const mainContent = screen.getByTestId('main-content')
    expect(mainContent).toHaveClass('transition-all')
    expect(mainContent).toHaveClass('duration-300')
  })

  test('accepts onToggleContextPanel callback prop', () => {
    const handleToggle = (): void => {
      // Mock toggle handler
    }
    render(<ChatView onToggleContextPanel={handleToggle} />)
    expect(screen.getByTestId('chat-view')).toBeInTheDocument()
  })

  test('passes isContextPanelOpen prop to ContextPanel when open', () => {
    render(<ChatView isContextPanelOpen />)
    const contextPanel = screen.getByTestId('context-panel')
    // When open, panel should NOT have translate-x-full class
    expect(contextPanel).not.toHaveClass('translate-x-full')
  })

  test('passes isContextPanelOpen prop to ContextPanel when closed', () => {
    // eslint-disable-next-line react/jsx-boolean-value
    render(<ChatView isContextPanelOpen={false} />)
    const contextPanel = screen.getByTestId('context-panel')
    // When closed, panel should have translate-x-full class
    expect(contextPanel).toHaveClass('translate-x-full')
  })

  test('ContextPanel reopen button is visible when panel is closed', () => {
    // eslint-disable-next-line react/jsx-boolean-value
    render(<ChatView isContextPanelOpen={false} />)

    const reopenButton = screen.getByRole('button', {
      name: /open context panel/i,
    })
    expect(reopenButton).toBeInTheDocument()
    expect(reopenButton).toHaveClass('opacity-100')
  })

  test('ContextPanel reopen button is hidden when panel is open', () => {
    render(<ChatView isContextPanelOpen />)

    const reopenButton = screen.getByRole('button', {
      name: /open context panel/i,
    })
    expect(reopenButton).toBeInTheDocument()
    expect(reopenButton).toHaveClass('opacity-0')
    expect(reopenButton).toHaveClass('pointer-events-none')
  })
})
