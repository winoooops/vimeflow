import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { MarkdownReadingView } from './MarkdownReadingView'

describe('MarkdownReadingView', () => {
  test('renders a heading from markdown input', () => {
    render(<MarkdownReadingView content="# Hello" />)

    expect(
      screen.getByRole('heading', { level: 1, name: /hello/i })
    ).toBeInTheDocument()
  })

  test('renders a GFM table (remark-gfm is active)', () => {
    render(
      <MarkdownReadingView
        content={'| Name | Role |\n| --- | --- |\n| Ada | Pioneer |'}
      />
    )

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: /name/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: /ada/i })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: /pioneer/i })).toBeInTheDocument()
  })

  test('renders a fenced code block whose code carries an .hljs class (sanitize-before-highlight survives)', () => {
    const { container } = render(
      <MarkdownReadingView content={'```ts\nconst answer: number = 42\n```'} />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- verifying highlight.js class on the rendered <code>
    const code = container.querySelector('pre code')
    expect(code).not.toBeNull()
    // The proof that rehypeSanitize BEFORE rehypeHighlight does not strip the
    // .hljs classes highlight.js adds. If the plugin order were reversed this
    // class would be gone and the fence would render unstyled.
    expect(code?.className).toMatch(/\bhljs\b/)
  })

  test('does not render an executable <script> from a malicious payload (sanitize works)', () => {
    const { container } = render(
      <MarkdownReadingView
        content={
          'Hello\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">'
        }
      />
    )

    // No executable script element survives the sanitizer boundary.
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting the sanitizer removed the <script>
    expect(container.querySelector('script')).toBeNull()
    // And the dangerous inline handler is stripped from any surviving <img>.
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting onerror was stripped
    const img = container.querySelector('img')

    if (img) {
      expect(img.getAttribute('onerror')).toBeNull()
    }
  })

  test('shows a loading overlay while isLoading is true', () => {
    render(<MarkdownReadingView content="# Doc" isLoading />)

    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument()
  })

  test('renders no loading overlay when not loading', () => {
    render(<MarkdownReadingView content="# Doc" />)

    expect(screen.queryByRole('status')).toBeNull()
  })

  test('exposes a focusable reading region for keyboard scrolling', () => {
    render(<MarkdownReadingView content="# Doc" />)

    const region = screen.getByRole('region', {
      name: /markdown reading view/i,
    })
    region.focus()

    expect(region).toHaveFocus()
  })

  test('publishes the active reading-style preset as CSS custom properties', () => {
    render(<MarkdownReadingView content="# Doc" />)

    // Defaults to the "comfortable" preset (18.5px / 75ch) via the shared store.
    const root = screen.getByTestId('markdown-reading-view')
    expect(root.style.getPropertyValue('--rv-font-size')).toBe('18.5px')
    expect(root.style.getPropertyValue('--rv-measure')).toBe('75ch')
  })

  test('surfaces an unsaved indicator when the buffer is dirty', () => {
    render(<MarkdownReadingView content="# Doc" isDirty />)

    expect(screen.getByTestId('markdown-reading-dirty')).toHaveTextContent(
      /unsaved/i
    )
  })

  test('hides the unsaved indicator when the buffer is clean', () => {
    render(<MarkdownReadingView content="# Doc" />)

    expect(screen.queryByTestId('markdown-reading-dirty')).toBeNull()
  })
})
