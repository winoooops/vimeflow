import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect } from 'vitest'
import App from './App'

describe('App', () => {
  test('renders without crashing', () => {
    render(<App />)
    expect(document.body).toBeTruthy()
  })

  test('renders ChatView by default', () => {
    render(<App />)
    expect(screen.getByTestId('chat-view')).toBeInTheDocument()
    expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    expect(screen.getByTestId('message-input')).toBeInTheDocument()
  })

  test('renders shared layout components', () => {
    render(<App />)
    expect(screen.getByTestId('icon-rail')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('top-tab-bar')).toBeInTheDocument()
    expect(screen.getByTestId('context-panel')).toBeInTheDocument()
  })

  test('switches back to ChatView when Chat tab is clicked from Diff', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Go to Diff
    await user.click(screen.getByRole('button', { name: 'Diff' }))
    expect(screen.getByTestId('diff-view')).toBeInTheDocument()

    // Go back to Chat
    await user.click(screen.getByRole('button', { name: 'Chat' }))
    expect(screen.getByTestId('chat-view')).toBeInTheDocument()
    expect(screen.queryByTestId('diff-view')).not.toBeInTheDocument()
  })

  test('Chat tab is active by default', () => {
    render(<App />)
    const chatTab = screen.getByRole('button', { name: 'Chat' })
    expect(chatTab).toHaveAttribute('aria-current', 'page')
  })

  test('is an arrow-function component', () => {
    expect(typeof App).toBe('function')
    expect(App.prototype).toBeUndefined()
  })

  test('switches to DiffView when Diff tab is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)

    const diffTab = screen.getByRole('button', { name: 'Diff' })
    await user.click(diffTab)

    expect(screen.getByTestId('diff-view')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-view')).not.toBeInTheDocument()
  })

  test('Diff tab becomes active after clicking it', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Diff' }))
    const diffTab = screen.getByRole('button', { name: 'Diff' })
    expect(diffTab).toHaveAttribute('aria-current', 'page')
  })
})
