import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownComponents } from './markdownComponents'

// Exercises the per-tag map directly (not just the subset MarkdownReadingView
// touches), including the inline-vs-block `code` branch and prop forwarding.
const mountMarkdown = (markdown: string): HTMLElement => {
  const { container } = render(
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {markdown}
    </ReactMarkdown>
  )

  return container
}

describe('markdownComponents', () => {
  test('headings use the headline font + on-surface color and em sizing', () => {
    mountMarkdown('# Title')

    const h1 = screen.getByRole('heading', { level: 1, name: 'Title' })
    expect(h1).toHaveClass('font-headline', 'text-on-surface', 'text-[1.875em]')
  })

  test('inline code gets pill styling and is not wrapped in a <pre>', () => {
    const container = mountMarkdown('Some `inline` code')

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- inline-vs-block distinction is structural
    const code = container.querySelector('code')
    expect(code).not.toBeNull()
    // eslint-disable-next-line testing-library/no-node-access -- confirming it is not a fenced block
    expect(code?.closest('pre')).toBeNull()
    expect(code?.className).toContain('bg-surface-container-lowest')
    expect(code?.className).toContain('text-primary')
  })

  test('a labelled fence takes the block branch (no inline pill, language class kept)', () => {
    const container = mountMarkdown('```ts\nconst x = 1\n```')

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting the pre>code block structure
    const code = container.querySelector('pre code')
    expect(code).not.toBeNull()
    expect(code?.className).toContain('language-')
    expect(code?.className).not.toContain('bg-surface-container-lowest')
  })

  test('links forward href and carry rel="noreferrer"', () => {
    mountMarkdown('[docs](https://example.com)')

    const link = screen.getByRole('link', { name: 'docs' })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  test('renders a GFM table with header + cell roles', () => {
    mountMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |')

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'A' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '1' })).toBeInTheDocument()
  })

  test('images forward src and alt', () => {
    mountMarkdown('![a cat](cat.png)')

    const img = screen.getByRole('img', { name: 'a cat' })
    expect(img).toHaveAttribute('src', 'cat.png')
  })

  test('does not forward the hast `node` prop onto the DOM element', () => {
    const container = mountMarkdown('# Title')

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting `node` was stripped before spreading
    const h1 = container.querySelector('h1')
    expect(h1?.hasAttribute('node')).toBe(false)
  })
})
