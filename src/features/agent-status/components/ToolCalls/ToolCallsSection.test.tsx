import { afterEach, describe, expect, test } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { setToolCallsView } from '../../hooks/useToolCallsView'
import { ToolCallsSection } from './ToolCallsSection'

const byType = { exec_command: 542, write_stdin: 32, apply_patch: 28 }

afterEach(() => {
  act(() => {
    setToolCallsView('jar')
  })
  localStorage.clear()
})

describe('ToolCallsSection', () => {
  test('renders the label, total odometer, and view switch', () => {
    render(<ToolCallsSection total={602} byType={byType} />)

    expect(screen.getByText('Tool calls')).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Tool calls view' })
    ).toBeInTheDocument()
    // total 602 → 3 odometer digit columns (no tiles render at width 0 in jsdom)
    expect(screen.getAllByTestId('odometer-roll')).toHaveLength(3)
  })

  test('defaults to the packed (jar) view', () => {
    render(<ToolCallsSection total={602} byType={byType} />)

    expect(screen.getByTestId('tool-jar-vessel')).toBeInTheDocument()
    expect(screen.queryByTestId('tool-tag-exec_command')).toBeNull()
  })

  test('switches to the tags view via the header control', () => {
    render(<ToolCallsSection total={602} byType={byType} />)

    fireEvent.click(screen.getByRole('button', { name: 'Tag view' }))

    expect(screen.getByTestId('tool-tag-exec_command')).toBeInTheDocument()
    expect(screen.queryByTestId('tool-jar-vessel')).toBeNull()
  })

  test('renders as a non-editable widget surface', () => {
    render(<ToolCallsSection total={1} byType={{ Read: 1 }} />)
    const section = screen.getByTestId('tool-calls-section')

    expect(section.className).toContain('cursor-default')
    expect(section.className).toContain('select-none')
  })
})
