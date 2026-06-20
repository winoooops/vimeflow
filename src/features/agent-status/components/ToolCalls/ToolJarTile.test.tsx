import { describe, expect, test } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { obsidianLens } from '@/theme/themes/obsidian-lens'
import { toolJarPalette } from '../../utils/toolJarTone'
import { ToolJarTile } from './ToolJarTile'

const palette = toolJarPalette(obsidianLens)
const base = { x: 0, y: 0, w: 100, h: 80, max: 542, palette }

const others = {
  name: 'others',
  count: 9,
  others: [
    { name: 'a', count: 3 },
    { name: 'b', count: 3 },
    { name: 'c', count: 3 },
  ],
}

describe('ToolJarTile', () => {
  test('renders a tool tile with its name and an entrance animation', () => {
    render(
      <ToolJarTile {...base} data={{ name: 'exec_command', count: 542 }} />
    )
    const tile = screen.getByTestId('tool-jar-tile-exec_command')

    expect(tile).toHaveTextContent('exec_command')
    expect(tile.className).toContain('tj-enter')
    expect(tile.style.cursor).toBe('default')
  })

  test('renders the neutral others tile with a tool-count caption', () => {
    render(<ToolJarTile {...base} data={others} />)
    const tile = screen.getByTestId('tool-jar-tile-others')

    expect(tile).toHaveTextContent('others')
    expect(tile).toHaveTextContent('3 tools')
    expect(tile.style.cursor).toBe('help')
  })

  test('reveals the breakdown card when the others tile is hovered', () => {
    render(<ToolJarTile {...base} data={others} />)

    expect(screen.queryByTestId('tool-jar-breakdown')).toBeNull()
    fireEvent.mouseEnter(screen.getByTestId('tool-jar-tile-others'))
    expect(screen.getByTestId('tool-jar-breakdown')).toHaveTextContent(
      'Others · 3 tools'
    )
  })

  test('does not wire hover handlers on a normal tile', () => {
    render(<ToolJarTile {...base} data={{ name: 'Read', count: 5 }} />)

    fireEvent.mouseEnter(screen.getByTestId('tool-jar-tile-Read'))
    expect(screen.queryByTestId('tool-jar-breakdown')).toBeNull()
  })
})
