import { describe, expect, test } from 'vitest'
import type { RefObject } from 'react'
import { render, screen } from '@testing-library/react'
import { ToolJarBreakdown } from './ToolJarBreakdown'

describe('ToolJarBreakdown', () => {
  test('lists every bundled tool with its count', () => {
    const anchor = document.createElement('div')
    document.body.appendChild(anchor)
    const ref: RefObject<HTMLElement | null> = { current: anchor }

    render(
      <ToolJarBreakdown
        anchorRef={ref}
        items={[
          { name: 'list_dir', count: 3 },
          { name: 'save_comment', count: 1 },
        ]}
      />
    )

    const card = screen.getByTestId('tool-jar-breakdown')
    expect(card).toHaveTextContent('Others · 2 tools')
    expect(card).toHaveTextContent('list_dir')
    expect(card).toHaveTextContent('save_comment')
    expect(
      screen.getByRole('dialog', { name: 'Other tool calls' })
    ).toHaveStyle({ pointerEvents: 'none' })

    document.body.removeChild(anchor)
  })

  test('renders nothing without an anchor element', () => {
    const ref: RefObject<HTMLElement | null> = { current: null }

    const { container } = render(
      <ToolJarBreakdown anchorRef={ref} items={[]} />
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('tool-jar-breakdown')).toBeNull()
  })
})
