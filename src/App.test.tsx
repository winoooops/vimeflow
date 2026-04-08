import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import App from './App'

// Mock WorkspaceView to avoid rendering the full workspace in App tests
vi.mock('./features/workspace/WorkspaceView', () => {
  const MockedWorkspaceView = (): ReactElement => (
    <div data-testid="workspace-view">Mocked WorkspaceView</div>
  )

  return {
    WorkspaceView: MockedWorkspaceView,
    default: MockedWorkspaceView,
  }
})

// Mock CommandPalette to keep tests focused on App composition
vi.mock('./features/command-palette/CommandPalette', () => ({
  CommandPalette: (): ReactElement => (
    <div data-testid="command-palette">Mocked CommandPalette</div>
  ),
}))

describe('App', () => {
  test('renders without crashing', () => {
    render(<App />)
    expect(document.body).toBeTruthy()
  })

  test('renders WorkspaceView as primary component', () => {
    render(<App />)
    expect(screen.getByTestId('workspace-view')).toBeInTheDocument()
  })

  test('renders CommandPalette as overlay', () => {
    render(<App />)
    expect(screen.getByTestId('command-palette')).toBeInTheDocument()
  })

  test('is an arrow-function component', () => {
    expect(typeof App).toBe('function')
    expect(App.prototype).toBeUndefined()
  })

  test('does not render placeholder content', () => {
    render(<App />)
    expect(
      screen.queryByText('Vimeflow Workspace (Phase 2)')
    ).not.toBeInTheDocument()

    expect(
      screen.queryByText('Workspace layout components will be added next')
    ).not.toBeInTheDocument()
  })
})
