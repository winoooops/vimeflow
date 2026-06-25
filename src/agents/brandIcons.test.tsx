import { test, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ClaudeCode, Codex, Kimi, OpenCode, type AgentIcon } from './brandIcons'

const BRAND_ICONS: readonly (readonly [string, AgentIcon])[] = [
  ['ClaudeCode', ClaudeCode],
  ['Codex', Codex],
  ['Kimi', Kimi],
  ['OpenCode', OpenCode],
]

const SQUARE_BRAND_ICONS: readonly (readonly [string, AgentIcon])[] = [
  ['Codex', Codex],
  ['Kimi', Kimi],
  ['OpenCode', OpenCode],
]

test.each(BRAND_ICONS)('%s renders a mono currentColor svg', (_name, Icon) => {
  const { container } = render(<Icon size={16} />)
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- verifying vendored SVG shape
  const svg = container.querySelector('svg')

  expect(svg).toBeInTheDocument()
  expect(svg?.getAttribute('fill')).toBe('currentColor')
})

test.each(SQUARE_BRAND_ICONS)(
  '%s renders a mono currentColor svg with height sized by the size prop',
  (_name, Icon) => {
    const { container } = render(<Icon size={16} />)
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- verifying vendored SVG shape
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg?.getAttribute('height')).toBe('16')
  }
)

test('ClaudeCode squishes the original mark into a custom box via non-uniform scale', () => {
  const { container } = render(<ClaudeCode size={16} />)
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- verifying vendored SVG shape
  const svg = container.querySelector('svg')
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- verifying vendored SVG shape
  const path = container.querySelector('path')

  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- verifying no avatar background is rendered
  expect(container.querySelector('circle')).toBeNull()
  // viewBox cropped to the path content bbox; non-uniform scale fills the tuned box.
  // Exact width/height ratio is intentionally not pinned — it's a visual dial.
  expect(svg?.getAttribute('viewBox')).toBe('0 5 24 15')
  expect(svg?.getAttribute('preserveAspectRatio')).toBe('none')
  expect(Number(svg?.getAttribute('width'))).toBeGreaterThan(16)
  expect(Number(svg?.getAttribute('height'))).toBeLessThan(16)
  expect(path?.getAttribute('clip-rule')).toBe('evenodd')
})
