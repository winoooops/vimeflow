import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import App from './App'

describe('App', () => {
  test('renders without crashing', () => {
    render(<App />)
    expect(document.body).toBeTruthy()
  })

  test('renders placeholder content during Phase 2 development', () => {
    render(<App />)
    expect(screen.getByText('Vimeflow Workspace (Phase 2)')).toBeInTheDocument()

    expect(
      screen.getByText('Workspace layout components will be added next')
    ).toBeInTheDocument()
  })

  test('is an arrow-function component', () => {
    expect(typeof App).toBe('function')
    expect(App.prototype).toBeUndefined()
  })
})
