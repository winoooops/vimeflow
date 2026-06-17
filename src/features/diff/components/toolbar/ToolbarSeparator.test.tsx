import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ToolbarSeparator, isSeparatorElement } from './ToolbarSeparator'

describe('ToolbarSeparator', () => {
  test('renders a decorative, aria-hidden hairline', () => {
    const { container } = render(<ToolbarSeparator />)
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- a decorative aria-hidden hairline has no role to query
    const sep = container.querySelector('span')

    expect(sep).not.toBeNull()
    expect(sep).toHaveAttribute('aria-hidden', 'true')
    // 1px-wide vertical hairline — the visual group divider.
    expect(sep?.className).toContain('w-px')
  })

  test('isSeparatorElement identifies only ToolbarSeparator elements', () => {
    expect(isSeparatorElement(<ToolbarSeparator />)).toBe(true)
    expect(isSeparatorElement(<span />)).toBe(false)
    expect(isSeparatorElement('text')).toBe(false)
    expect(isSeparatorElement(null)).toBe(false)
  })
})
