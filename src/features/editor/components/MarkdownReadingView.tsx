import type { ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize from 'rehype-sanitize'
import { markdownComponents } from './markdownComponents'
import './MarkdownReadingView.css'

interface MarkdownReadingViewProps {
  /**
   * The raw markdown source — the same `content` string the dock already
   * passes to `<CodeEditor>`. No new data flow; this is read-only.
   */
  content: string
}

/**
 * Read-only reading view for markdown files in the dock editor.
 *
 * Renders the buffer's markdown via `react-markdown` as a real React element
 * tree (no `dangerouslySetInnerHTML`), themed to the Obsidian Lens through the
 * `markdownComponents` per-tag map + the scoped `MarkdownReadingView.css`.
 *
 * CRITICAL plugin order: `rehypePlugins={[rehypeSanitize, rehypeHighlight]}` —
 * sanitize FIRST, highlight SECOND. `rehype-sanitize` runs an allow-list over
 * the hast; running it before `rehype-highlight` lets highlight.js add its
 * `.hljs-*` classes to the already-sanitized tree so they survive to the DOM.
 * The reverse order would strip the just-added classes, leaving fences
 * unstyled. `MarkdownReadingView.test.tsx` asserts the surviving `.hljs` class
 * as the regression net for this ordering.
 */
export const MarkdownReadingView = ({
  content,
}: MarkdownReadingViewProps): ReactElement => (
  <div
    data-testid="markdown-reading-view"
    className="markdown-reading-view thin-scrollbar min-h-0 flex-1 overflow-auto px-8 py-6"
  >
    <div className="mx-auto max-w-[80ch]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize, rehypeHighlight]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  </div>
)
