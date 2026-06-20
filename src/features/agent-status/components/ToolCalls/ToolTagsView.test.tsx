import { describe, expect, test } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ToolTagsView } from './ToolTagsView'

describe('ToolTagsView', () => {
  test('renders a pill per tool', () => {
    render(
      <ToolTagsView
        tools={[
          { name: 'Read', count: 5 },
          { name: 'Bash', count: 2 },
        ]}
        max={5}
      />
    )

    expect(screen.getByTestId('tool-tag-Read')).toHaveTextContent('Read')
    expect(screen.getByTestId('tool-tag-Bash')).toBeInTheDocument()
  })

  test('renders the others pill and reveals its breakdown on hover', () => {
    render(
      <ToolTagsView
        tools={[
          { name: 'Read', count: 5 },
          {
            name: 'others',
            count: 6,
            others: [
              { name: 'a', count: 3 },
              { name: 'b', count: 3 },
            ],
          },
        ]}
        max={5}
      />
    )
    const others = screen.getByTestId('tool-tag-others')

    expect(others).toHaveTextContent('others +2')
    expect(others.style.cursor).toBe('help')

    fireEvent.mouseEnter(others)
    expect(screen.getByTestId('tool-jar-breakdown')).toHaveTextContent(
      'Others · 2 tools'
    )
  })

  test('packs rows from the top with a minimal gap', () => {
    render(<ToolTagsView tools={[{ name: 'Read', count: 5 }]} max={5} />)
    const row = screen.getByTestId('tool-tags-view')

    expect(row.style.alignContent).toBe('flex-start')
    expect(row.style.minHeight).toBe('100%')
  })
})
