import { test, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ClaudeCode, Codex, Kimi, type AgentIcon } from './brandIcons'

const BRAND_ICONS: readonly (readonly [string, AgentIcon])[] = [
  ['ClaudeCode', ClaudeCode],
  ['Codex', Codex],
  ['Kimi', Kimi],
]

test.each(BRAND_ICONS)(
  '%s renders a mono currentColor svg sized by the size prop',
  (_name, Icon) => {
    const { container } = render(<Icon size={16} />)
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- verifying vendored SVG shape
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg?.getAttribute('fill')).toBe('currentColor')
    expect(svg?.getAttribute('width')).toBe('16')
  }
)
