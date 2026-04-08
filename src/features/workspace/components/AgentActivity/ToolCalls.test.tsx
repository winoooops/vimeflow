import { render, screen, within } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import ToolCalls from './ToolCalls'
import type { ToolCall } from '../../types'

const mockToolCalls: ToolCall[] = [
  {
    id: 'tc-1',
    tool: 'Read',
    args: 'src/auth/types.ts',
    status: 'done',
    timestamp: '2026-04-07T03:45:32Z',
    duration: 120,
  },
  {
    id: 'tc-2',
    tool: 'Write',
    args: 'src/auth/middleware.ts (48 lines)',
    status: 'done',
    timestamp: '2026-04-07T03:46:15Z',
    duration: 1500,
  },
  {
    id: 'tc-3',
    tool: 'Bash',
    args: 'npm test src/auth',
    status: 'running',
    timestamp: '2026-04-07T03:47:30Z',
  },
  {
    id: 'tc-4',
    tool: 'Edit',
    args: 'src/routes/auth.ts (+5 -1)',
    status: 'failed',
    timestamp: '2026-04-07T03:48:00Z',
    duration: 200,
  },
]

describe('ToolCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    test('renders CollapsibleSection with "Tool Calls" title', () => {
      render(<ToolCalls toolCalls={mockToolCalls} />)

      expect(screen.getByText('Tool Calls')).toBeInTheDocument()
    })

    test('shows count of tool calls in section header', () => {
      render(<ToolCalls toolCalls={mockToolCalls} />)

      expect(screen.getByText('(4)')).toBeInTheDocument()
    })

    test('is collapsed by default', () => {
      render(<ToolCalls toolCalls={mockToolCalls} />)

      expect(screen.getByText('▸')).toBeInTheDocument()
      expect(screen.queryByText('▾')).not.toBeInTheDocument()
    })

    test('does not render tool call items when collapsed', () => {
      render(<ToolCalls toolCalls={mockToolCalls} />)

      expect(screen.queryByText('Read')).not.toBeInTheDocument()
      expect(screen.queryByText('Write')).not.toBeInTheDocument()
    })

    test('renders empty state with count of 0', () => {
      render(<ToolCalls toolCalls={[]} />)

      expect(screen.getByText('Tool Calls')).toBeInTheDocument()
      expect(screen.queryByText(/\(\d+\)/)).not.toBeInTheDocument()
    })
  })

  describe('Status Icons', () => {
    test('renders "✓" icon for done status with green color', async () => {
      const user = userEvent.setup()

      render(<ToolCalls toolCalls={mockToolCalls} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tool Calls/i,
      })

      await user.click(sectionHeader)

      const toolCallEntries = screen.getAllByTestId('tool-call-entry')
      const doneEntry = toolCallEntries[0]
      const icon = within(doneEntry).getByTestId('status-icon')

      expect(icon).toHaveTextContent('✓')
      expect(icon).toHaveClass('text-success')
    })

    test('renders "⟳" icon for running status with blue color', async () => {
      const user = userEvent.setup()

      render(<ToolCalls toolCalls={mockToolCalls} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tool Calls/i,
      })

      await user.click(sectionHeader)

      const toolCallEntries = screen.getAllByTestId('tool-call-entry')
      const runningEntry = toolCallEntries[2]
      const icon = within(runningEntry).getByTestId('status-icon')

      expect(icon).toHaveTextContent('⟳')
      expect(icon).toHaveClass('text-secondary')
    })

    test('renders "✗" icon for failed status with red color', async () => {
      const user = userEvent.setup()

      render(<ToolCalls toolCalls={mockToolCalls} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tool Calls/i,
      })

      await user.click(sectionHeader)

      const toolCallEntries = screen.getAllByTestId('tool-call-entry')
      const failedEntry = toolCallEntries[3]
      const icon = within(failedEntry).getByTestId('status-icon')

      expect(icon).toHaveTextContent('✗')
      expect(icon).toHaveClass('text-error')
    })
  })

  describe('Tool Call Content', () => {
    test('displays tool name and args for each call', async () => {
      const user = userEvent.setup()

      render(<ToolCalls toolCalls={mockToolCalls} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tool Calls/i,
      })

      await user.click(sectionHeader)

      expect(screen.getByText('Read')).toBeInTheDocument()
      expect(screen.getByText('src/auth/types.ts')).toBeInTheDocument()
      expect(screen.getByText('Write')).toBeInTheDocument()
      expect(
        screen.getByText('src/auth/middleware.ts (48 lines)')
      ).toBeInTheDocument()
      expect(screen.getByText('Bash')).toBeInTheDocument()
      expect(screen.getByText('npm test src/auth')).toBeInTheDocument()
    })

    test('applies proper text colors to tool names and args', async () => {
      const user = userEvent.setup()

      render(<ToolCalls toolCalls={mockToolCalls} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tool Calls/i,
      })

      await user.click(sectionHeader)

      const toolName = screen.getByText('Read')
      const toolArgs = screen.getByText('src/auth/types.ts')

      expect(toolName).toHaveClass('text-on-surface')
      expect(toolArgs).toHaveClass('text-on-surface/60')
    })
  })

  describe('Interaction', () => {
    test('expands when header clicked', async () => {
      const user = userEvent.setup()

      render(<ToolCalls toolCalls={mockToolCalls} />)

      expect(screen.getByText('▸')).toBeInTheDocument()
      expect(screen.queryByText('Read')).not.toBeInTheDocument()

      const sectionHeader = screen.getByRole('button', {
        name: /Tool Calls/i,
      })

      await user.click(sectionHeader)

      expect(screen.getByText('▾')).toBeInTheDocument()
      expect(screen.getByText('Read')).toBeInTheDocument()
    })

    test('collapses when clicking expanded section', async () => {
      const user = userEvent.setup()

      render(<ToolCalls toolCalls={mockToolCalls} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tool Calls/i,
      })

      await user.click(sectionHeader)
      expect(screen.getByText('▾')).toBeInTheDocument()
      expect(screen.getByText('Read')).toBeInTheDocument()

      await user.click(sectionHeader)
      expect(screen.getByText('▸')).toBeInTheDocument()
      expect(screen.queryByText('Read')).not.toBeInTheDocument()
    })
  })

  describe('Layout and Styling', () => {
    test('applies proper spacing between tool call entries', async () => {
      const user = userEvent.setup()

      render(<ToolCalls toolCalls={mockToolCalls} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tool Calls/i,
      })

      await user.click(sectionHeader)

      const toolCallsList = screen.getByTestId('tool-calls-list')

      expect(toolCallsList).toHaveClass('gap-1')
    })

    test('applies flex layout to tool call entries', async () => {
      const user = userEvent.setup()

      render(<ToolCalls toolCalls={mockToolCalls} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tool Calls/i,
      })

      await user.click(sectionHeader)

      const toolCallsList = screen.getByTestId('tool-calls-list')

      expect(toolCallsList).toHaveClass('flex')
      expect(toolCallsList).toHaveClass('flex-col')
    })

    test('uses font-label for text', async () => {
      const user = userEvent.setup()

      render(<ToolCalls toolCalls={mockToolCalls} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tool Calls/i,
      })

      await user.click(sectionHeader)

      const toolCallEntry = screen.getAllByTestId('tool-call-entry')[0]

      expect(toolCallEntry).toHaveClass('font-label')
    })
  })

  describe('Edge Cases', () => {
    test('handles single tool call', () => {
      const singleCall: ToolCall[] = [mockToolCalls[0]]

      render(<ToolCalls toolCalls={singleCall} />)

      expect(screen.getByText('(1)')).toBeInTheDocument()
    })

    test('handles tool call without duration', async () => {
      const user = userEvent.setup()

      const callWithoutDuration: ToolCall[] = [
        {
          id: 'tc-no-duration',
          tool: 'Grep',
          args: 'pattern in files',
          status: 'running',
          timestamp: '2026-04-07T03:50:00Z',
        },
      ]

      render(<ToolCalls toolCalls={callWithoutDuration} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tool Calls/i,
      })

      await user.click(sectionHeader)

      expect(screen.getByText('Grep')).toBeInTheDocument()
      expect(screen.getByText('pattern in files')).toBeInTheDocument()
    })
  })
})
