import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, test, expect, vi } from 'vitest'
import { MarkdownReadingView } from './MarkdownReadingView'

interface ClipboardMockControls {
  restore: () => void
  writeTextMock: ReturnType<typeof vi.fn>
}

const installClipboardMock = (): ClipboardMockControls => {
  const original = window.navigator.clipboard
  const writeTextMock = vi.fn((): Promise<void> => Promise.resolve())

  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    configurable: true,
    writable: true,
  })

  return {
    writeTextMock,
    restore: (): void => {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: original,
        configurable: true,
        writable: true,
      })
    },
  }
}

const selectNodeContents = (node: Node): void => {
  const selection = window.getSelection()

  if (selection === null) {
    return
  }

  const range = document.createRange()
  range.selectNodeContents(node)
  selection.removeAllRanges()
  selection.addRange(range)
}

describe('MarkdownReadingView', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges()
  })

  test('renders a heading from markdown input', () => {
    render(<MarkdownReadingView content="# Hello" />)

    expect(
      screen.getByRole('heading', { level: 1, name: /hello/i })
    ).toBeInTheDocument()
  })

  test('adds bare heading ids so #hash anchor links resolve (rehype-slug)', () => {
    render(<MarkdownReadingView content="## Setup Guide" />)

    const heading = screen.getByRole('heading', {
      level: 2,
      name: /setup guide/i,
    })
    // rehype-slug runs AFTER rehype-sanitize, so the id is the bare github slug
    // — NOT sanitize's `user-content-`-prefixed form — which is what an
    // in-document `[link](#setup-guide)` table-of-contents anchor must match.
    expect(heading).toHaveAttribute('id', 'setup-guide')
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

  test('renders a fence with an unknown language without crashing (ignoreMissing)', () => {
    // rehype-highlight throws on an unregistered language unless ignoreMissing
    // is set; an arbitrary doc with ```mermaid must not blank the reading pane.
    const { container } = render(
      <MarkdownReadingView content={'```mermaid\ngraph TD; A-->B\n```'} />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting the unknown-language fence still renders as a code block
    const code = container.querySelector('pre code')
    expect(code).not.toBeNull()
    expect(code?.textContent).toContain('graph TD')
  })

  test('shows only reading-safe clipboard actions in the right-click menu', () => {
    render(<MarkdownReadingView content="Copy **rendered** text" />)

    const region = screen.getByRole('region', {
      name: /markdown reading view/i,
    })

    fireEvent.contextMenu(region, { clientX: 40, clientY: 80 })

    const menu = screen.getByRole('menu', { name: /context menu/i })
    expect(
      within(menu).getByRole('menuitem', { name: /^copy$/i })
    ).toBeInTheDocument()

    expect(
      within(menu).getByRole('menuitem', { name: /select all/i })
    ).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: /cut/i })).toBeNull()
    expect(within(menu).queryByRole('menuitem', { name: /paste/i })).toBeNull()
  })

  test('copies the selected rendered text to the system clipboard', () => {
    const clipboard = installClipboardMock()

    try {
      render(<MarkdownReadingView content="Copy **rendered** text" />)

      const paragraph = screen.getByText(
        (_text, element) =>
          element?.tagName.toLowerCase() === 'p' &&
          element.textContent === 'Copy rendered text'
      )
      selectNodeContents(paragraph)

      const region = screen.getByRole('region', {
        name: /markdown reading view/i,
      })
      fireEvent.contextMenu(region, { clientX: 40, clientY: 80 })
      fireEvent.click(screen.getByRole('menuitem', { name: /^copy$/i }))

      expect(clipboard.writeTextMock).toHaveBeenCalledWith('Copy rendered text')
    } finally {
      clipboard.restore()
    }
  })

  test('falls back to execCommand copy when navigator.clipboard.writeText is unavailable', () => {
    const originalClipboard = window.navigator.clipboard
    const originalExecCommand = document.execCommand
    const execCommandMock = vi.fn().mockReturnValue(true)

    Object.defineProperty(window.navigator, 'clipboard', {
      value: {},
      configurable: true,
      writable: true,
    })

    Object.defineProperty(document, 'execCommand', {
      value: execCommandMock,
      configurable: true,
      writable: true,
    })

    try {
      render(<MarkdownReadingView content="Copy **rendered** text" />)

      const paragraph = screen.getByText(
        (_text, element) =>
          element?.tagName.toLowerCase() === 'p' &&
          element.textContent === 'Copy rendered text'
      )
      selectNodeContents(paragraph)

      const region = screen.getByRole('region', {
        name: /markdown reading view/i,
      })
      fireEvent.contextMenu(region, { clientX: 40, clientY: 80 })
      fireEvent.click(screen.getByRole('menuitem', { name: /^copy$/i }))

      expect(execCommandMock).toHaveBeenCalledWith('copy')
    } finally {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      })
      Object.defineProperty(document, 'execCommand', {
        value: originalExecCommand,
        configurable: true,
        writable: true,
      })
    }
  })

  test('selects all rendered markdown content from the context menu', () => {
    render(
      <MarkdownReadingView content={'# Doc Title\n\nCopy **rendered** text'} />
    )

    const region = screen.getByRole('region', {
      name: /markdown reading view/i,
    })
    fireEvent.contextMenu(region, { clientX: 40, clientY: 80 })
    fireEvent.click(screen.getByRole('menuitem', { name: /select all/i }))

    const selectedText = window.getSelection()?.toString() ?? ''
    expect(selectedText).toContain('Doc Title')
    expect(selectedText).toContain('Copy rendered text')
    expect(region).toHaveFocus()
  })
})
