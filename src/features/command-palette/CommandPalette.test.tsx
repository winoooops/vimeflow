import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { CommandPalette } from './CommandPalette'

describe('CommandPalette - Integration Tests', () => {
  afterEach(() => {
    // Clean up any lingering event listeners
    vi.restoreAllMocks()
  })

  test('does not render when closed initially', () => {
    render(<CommandPalette />)

    const dialog = screen.queryByRole('dialog')

    expect(dialog).not.toBeInTheDocument()
  })

  test('opens palette when : key is pressed', async () => {
    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      const dialog = screen.getByRole('dialog')

      expect(dialog).toBeInTheDocument()
    })
  })

  test('dialog has correct accessibility attributes', async () => {
    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', 'Command palette')
  })

  test('opens with : pre-filled in input', async () => {
    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      const input = screen.getByRole('combobox', {
        name: 'Command palette search',
      })

      expect(input).toHaveValue(':')
    })
  })

  test('typing query filters results', async () => {
    const user = userEvent.setup()

    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })

    await user.clear(input)
    await user.type(input, ':open')

    await waitFor(() => {
      const openCommand = screen.getByText(':open')

      expect(openCommand).toBeInTheDocument()
    })
  })

  test('closes palette when Escape is pressed', async () => {
    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Escape' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      const dialog = screen.queryByRole('dialog')

      expect(dialog).not.toBeInTheDocument()
    })
  })

  test('closes palette when Backspace is pressed on empty : query', async () => {
    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })

    // Input starts with ':'
    expect(input).toHaveValue(':')

    // Fire Backspace event directly on input
    fireEvent.keyDown(input, { key: 'Backspace' })

    await waitFor(() => {
      const dialog = screen.queryByRole('dialog')

      expect(dialog).not.toBeInTheDocument()
    })
  })

  test('arrow keys navigate results', async () => {
    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    await waitFor(() => {
      const results = screen.getAllByRole('option')

      expect(results.length).toBeGreaterThan(0)
    })

    // First item should be selected initially
    let firstResult = screen.getAllByRole('option')[0]

    expect(firstResult).toHaveAttribute('aria-selected', 'true')

    // Press ArrowDown
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      const secondResult = screen.getAllByRole('option')[1]

      expect(secondResult).toHaveAttribute('aria-selected', 'true')
    })

    // Press ArrowUp to go back
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      firstResult = screen.getAllByRole('option')[0]

      expect(firstResult).toHaveAttribute('aria-selected', 'true')
    })
  })

  test('Enter executes leaf command and closes palette', async () => {
    const user = userEvent.setup()

    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {
      // Mock implementation
    })

    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })

    await user.clear(input)
    await user.type(input, ':help')

    await waitFor(() => {
      const helpCommand = screen.getByText(':help')

      expect(helpCommand).toBeInTheDocument()
    })

    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Enter' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      expect(consoleInfoSpy).toHaveBeenCalledWith('Showing command reference')
    })

    await waitFor(() => {
      const dialog = screen.queryByRole('dialog')

      expect(dialog).not.toBeInTheDocument()
    })

    consoleInfoSpy.mockRestore()
  })

  test('Enter drills into namespace command without closing palette', async () => {
    const user = userEvent.setup()

    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })

    await user.clear(input)
    await user.type(input, ':open')

    await waitFor(() => {
      const openCommand = screen.getByText(':open')

      expect(openCommand).toBeInTheDocument()
    })

    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Enter' })

      document.dispatchEvent(event)
    })

    // Palette should still be open (namespace commands don't close)
    await waitFor(() => {
      const dialog = screen.getByRole('dialog')

      expect(dialog).toBeInTheDocument()
    })
  })

  test('renders CommandInput component', async () => {
    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      const input = screen.getByRole('combobox', {
        name: 'Command palette search',
      })

      expect(input).toBeInTheDocument()
    })
  })

  test('renders CommandResults component', async () => {
    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      const listbox = screen.getByRole('listbox')

      expect(listbox).toBeInTheDocument()
    })
  })

  test('renders CommandFooter component', async () => {
    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      const navigateText = screen.getByText('Navigate')
      const selectText = screen.getByText('Select')
      const helpText = screen.getByText("Type '?' for help")

      expect(navigateText).toBeInTheDocument()
      expect(selectText).toBeInTheDocument()
      expect(helpText).toBeInTheDocument()
    })
  })

  test('has correct z-index for overlay', async () => {
    render(<CommandPalette />)

    act(() => {
      const event = new KeyboardEvent('keydown', { key: ':' })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      const dialog = screen.getByRole('dialog')

      expect(dialog).toHaveClass('z-[100]')
    })
  })
})
