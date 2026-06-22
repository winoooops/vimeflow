import { describe, expect, test } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ToolTagsView } from './ToolTagsView'

describe('ToolTagsView', () => {
  test('renders a pill per tool', () => {
    render(
      <ToolTagsView
        height={180}
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

  test('clamps long names with a truncate ellipsis', () => {
    render(
      <ToolTagsView
        height={180}
        tools={[{ name: 'mcp__claude-in-chrome__computer', count: 5 }]}
        max={5}
      />
    )
    const name = screen.getByText('mcp__claude-in-chrome__computer')

    expect(name.className).toContain('truncate')
    expect(name.style.maxWidth).toBe('150px')
  })

  test('renders the others pill and reveals its breakdown on hover', () => {
    render(
      <ToolTagsView
        height={180}
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
    expect(others.style.cursor).toBe('default')

    fireEvent.mouseEnter(others)
    expect(screen.getByTestId('tool-jar-breakdown')).toHaveTextContent(
      'Others · 2 tools'
    )
  })

  test('packs rows from the top and scrolls within the fixed body', () => {
    render(
      <ToolTagsView height={180} tools={[{ name: 'Read', count: 5 }]} max={5} />
    )
    const body = screen.getByTestId('tool-tags-view')

    expect(body.style.alignContent).toBe('flex-start')
    expect(body.className).toContain('overflow-y-auto')
  })

  test('renders top and bottom scroll hints', () => {
    render(
      <ToolTagsView height={180} tools={[{ name: 'Read', count: 5 }]} max={5} />
    )

    expect(screen.getByTestId('tool-tags-scroll-hint-top')).toBeInTheDocument()
    expect(
      screen.getByTestId('tool-tags-scroll-hint-bottom')
    ).toBeInTheDocument()
  })

  test('orders pills high → low by count, with "others" last', () => {
    render(
      <ToolTagsView
        height={180}
        tools={[
          { name: 'low', count: 2 },
          { name: 'high', count: 50 },
          { name: 'others', count: 99, others: [{ name: 'x', count: 99 }] },
          { name: 'mid', count: 20 },
        ]}
        max={50}
      />
    )

    const pills = screen.getAllByTestId(/^tool-tag-/)

    expect(pills).toHaveLength(4)
    expect(pills[0]).toHaveAttribute('data-testid', 'tool-tag-high')
    expect(pills[1]).toHaveAttribute('data-testid', 'tool-tag-mid')
    expect(pills[2]).toHaveAttribute('data-testid', 'tool-tag-low')
    expect(pills[3]).toHaveAttribute('data-testid', 'tool-tag-others')
  })
})
