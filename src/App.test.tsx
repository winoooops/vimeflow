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

  test('switches to FilesView when Files tab is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)

    const filesTab = screen.getByRole('button', { name: 'Files' })
    await user.click(filesTab)

    expect(screen.getByTestId('files-view')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-view')).not.toBeInTheDocument()
  })

  test('switches back to ChatView when Chat tab is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Go to Files
    await user.click(screen.getByRole('button', { name: 'Files' }))
    expect(screen.getByTestId('files-view')).toBeInTheDocument()

    // Go back to Chat
    await user.click(screen.getByRole('button', { name: 'Chat' }))
    expect(screen.getByTestId('chat-view')).toBeInTheDocument()
    expect(screen.queryByTestId('files-view')).not.toBeInTheDocument()
  })

  test('Chat tab is active by default', () => {
    render(<App />)
    const chatTab = screen.getByRole('button', { name: 'Chat' })
    expect(chatTab).toHaveAttribute('aria-current', 'page')
  })

  test('Files tab becomes active after clicking it', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Files' }))
    const filesTab = screen.getByRole('button', { name: 'Files' })
    expect(filesTab).toHaveAttribute('aria-current', 'page')
  })

  test('is an arrow-function component', () => {
    expect(typeof App).toBe('function')
    expect(App.prototype).toBeUndefined()
  })
})
