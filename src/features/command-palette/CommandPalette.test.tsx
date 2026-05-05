import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { CommandPalette } from './CommandPalette'

// Default-trigger init the palette listens for (Ctrl+: today). Defined
// once here so tests describe BEHAVIOR ("default trigger opens the palette"),
// not the specific keystroke. If the trigger ever changes, this is the
// single place to update — every test below dispatches via the helper.
const DEFAULT_TRIGGER_INIT: KeyboardEventInit = {
  key: ':',
  ctrlKey: true,
  bubbles: true,
}

const dispatchDefaultTrigger = (
  overrides: KeyboardEventInit = {}
): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    ...DEFAULT_TRIGGER_INIT,
    ...overrides,
  })

  document.dispatchEvent(event)

  return event
}

describe('CommandPalette - Integration Tests', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('does not render when closed initially', () => {
    render(<CommandPalette />)

    const dialog = screen.queryByRole('dialog')

    expect(dialog).not.toBeInTheDocument()
  })

  test('dialog has correct accessibility attributes', async () => {
    render(<CommandPalette />)

    act(() => {
      dispatchDefaultTrigger()
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
      dispatchDefaultTrigger()
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
      dispatchDefaultTrigger()
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
      dispatchDefaultTrigger()
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
      dispatchDefaultTrigger()
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })

    expect(input).toHaveValue(':')

    fireEvent.keyDown(input, { key: 'Backspace' })

    await waitFor(() => {
      const dialog = screen.queryByRole('dialog')

      expect(dialog).not.toBeInTheDocument()
    })
  })

  test('arrow keys navigate results', async () => {
    render(<CommandPalette />)

    act(() => {
      dispatchDefaultTrigger()
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    await waitFor(() => {
      const results = screen.getAllByRole('option')

      expect(results.length).toBeGreaterThan(0)
    })

    let firstResult = screen.getAllByRole('option')[0]

    expect(firstResult).toHaveAttribute('aria-selected', 'true')

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    })

    await waitFor(() => {
      const secondResult = screen.getAllByRole('option')[1]

      expect(secondResult).toHaveAttribute('aria-selected', 'true')
    })

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
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
      dispatchDefaultTrigger()
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
      dispatchDefaultTrigger()
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
      dispatchDefaultTrigger()
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
      dispatchDefaultTrigger()
    })

    await waitFor(() => {
      const listbox = screen.getByRole('listbox')

      expect(listbox).toBeInTheDocument()
    })
  })

  test('renders CommandFooter component', async () => {
    render(<CommandPalette />)

    act(() => {
      dispatchDefaultTrigger()
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
      dispatchDefaultTrigger()
    })

    await waitFor(() => {
      const dialog = screen.getByRole('dialog')

      expect(dialog).toHaveClass('z-[100]')
    })
  })

  // Trigger contract — behavior of the default keydown trigger.
  test('opens palette when default trigger is pressed', async () => {
    render(<CommandPalette />)

    act(() => {
      dispatchDefaultTrigger()
    })

    await waitFor(() => {
      const dialog = screen.getByRole('dialog')

      expect(dialog).toBeInTheDocument()
    })
  })

  test('bare : does NOT open palette', async () => {
    render(<CommandPalette />)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ':' }))
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('default trigger toggles palette closed when already open', async () => {
    render(<CommandPalette />)

    act(() => {
      dispatchDefaultTrigger()
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    act(() => {
      dispatchDefaultTrigger()
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test('default trigger calls preventDefault and stopPropagation when opening', async () => {
    render(<CommandPalette />)

    const mockPreventDefault = vi.fn()
    const mockStopPropagation = vi.fn()

    act(() => {
      const event = new KeyboardEvent('keydown', DEFAULT_TRIGGER_INIT)

      Object.defineProperty(event, 'preventDefault', {
        value: mockPreventDefault,
      })

      Object.defineProperty(event, 'stopPropagation', {
        value: mockStopPropagation,
      })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      expect(mockPreventDefault).toHaveBeenCalled()
      expect(mockStopPropagation).toHaveBeenCalled()
    })
  })

  test('default trigger calls preventDefault and stopPropagation when closing', async () => {
    render(<CommandPalette />)

    act(() => {
      dispatchDefaultTrigger()
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const mockPreventDefault = vi.fn()
    const mockStopPropagation = vi.fn()

    act(() => {
      const event = new KeyboardEvent('keydown', DEFAULT_TRIGGER_INIT)

      Object.defineProperty(event, 'preventDefault', {
        value: mockPreventDefault,
      })

      Object.defineProperty(event, 'stopPropagation', {
        value: mockStopPropagation,
      })

      document.dispatchEvent(event)
    })

    await waitFor(() => {
      expect(mockPreventDefault).toHaveBeenCalled()
      expect(mockStopPropagation).toHaveBeenCalled()
    })
  })

  test('default trigger suppresses repeat events', async () => {
    render(<CommandPalette />)

    act(() => {
      for (let i = 0; i < 5; i++) {
        dispatchDefaultTrigger({ repeat: true })
      }
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('capture-phase listener wins over child stopPropagation', async () => {
    const ChildWithStopPropagation = (): React.ReactElement => {
      const handleKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === ':' && e.ctrlKey) {
          e.stopPropagation()
        }
      }

      return <div onKeyDown={handleKeyDown} data-testid="child-div" />
    }

    render(
      <>
        <CommandPalette />
        <ChildWithStopPropagation />
      </>
    )

    act(() => {
      screen
        .getByTestId('child-div')
        .dispatchEvent(new KeyboardEvent('keydown', DEFAULT_TRIGGER_INIT))
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
