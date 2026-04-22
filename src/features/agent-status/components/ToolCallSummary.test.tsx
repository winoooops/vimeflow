import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToolCallSummary } from './ToolCallSummary'

describe('ToolCallSummary', () => {
  test('renders header with total count', () => {
    render(<ToolCallSummary total={42} byType={{}} active={null} />)

    expect(screen.getByText('Tool Calls')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  test('renders chips sorted by count descending', () => {
    render(
      <ToolCallSummary
        total={30}
        byType={{ Read: 18, Edit: 7, Bash: 5 }}
        active={null}
      />
    )

    const chips = screen.getAllByText(/^(Read|Edit|Bash)$/)
    expect(chips[0]).toHaveTextContent('Read')
    expect(chips[1]).toHaveTextContent('Edit')
    expect(chips[2]).toHaveTextContent('Bash')
  })

  test('renders chip counts', () => {
    render(
      <ToolCallSummary
        total={25}
        byType={{ Read: 18, Edit: 7 }}
        active={null}
      />
    )

    expect(screen.getByText('18')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  test('shows active tool indicator when active is not null', () => {
    render(
      <ToolCallSummary
        total={5}
        byType={{}}
        active={{
          tool: 'Read',
          args: 'src/index.ts',
          startedAt: '2026-04-22T10:00:00Z',
          toolUseId: 'toolu_readA',
        }}
      />
    )

    expect(screen.getByTestId('active-tool-indicator')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
  })

  test('hides active tool indicator when active is null', () => {
    render(<ToolCallSummary total={5} byType={{}} active={null} />)

    expect(
      screen.queryByTestId('active-tool-indicator')
    ).not.toBeInTheDocument()
  })
})
