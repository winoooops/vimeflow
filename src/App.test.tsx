import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import App from './App'

describe('App', () => {
  test('renders without crashing', () => {
    render(<App />)
    expect(document.body).toBeTruthy()
  })

  test('renders ChatView component', () => {
    render(<App />)
    // ChatView contains IconRail, Sidebar, TopTabBar, ContextPanel, MessageThread, MessageInput
    expect(screen.getByTestId('icon-rail')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('top-tab-bar')).toBeInTheDocument()
    expect(screen.getByTestId('context-panel')).toBeInTheDocument()
  })

  test('renders message thread', () => {
    render(<App />)
    expect(screen.getByTestId('message-thread')).toBeInTheDocument()
  })

  test('renders message input', () => {
    render(<App />)
    expect(screen.getByTestId('message-input')).toBeInTheDocument()
  })

  test('does not render placeholder content', () => {
    render(<App />)
    expect(
      screen.queryByText('Vite + React + TypeScript initialized successfully!')
    ).not.toBeInTheDocument()
  })

  test('is an arrow-function component', () => {
    expect(typeof App).toBe('function')
    expect(App.prototype).toBeUndefined() // Arrow functions have no prototype
  })
})
