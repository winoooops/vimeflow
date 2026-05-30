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
  /**
   * Render a loading overlay while an async file read is in flight. Mirrors
   * `<CodeEditor>`'s overlay so switching to a slow-loading markdown file shows
   * the same feedback instead of leaving the previous document on screen.
   */
  isLoading?: boolean
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
 *
 * The `markdown-reading-view` class stays on the (relative) root so the scoped
 * `.hljs-*` CSS still matches descendants, and the loading overlay can position
 * against it.
 */
export const MarkdownReadingView = ({
  content,
  isLoading = false,
}: MarkdownReadingViewProps): ReactElement => (
  <div
    data-testid="markdown-reading-view"
    className="markdown-reading-view relative flex min-h-0 flex-1 flex-col overflow-hidden"
  >
    <div className="thin-scrollbar min-h-0 flex-1 overflow-auto px-8 py-6">
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

    {isLoading && (
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading file"
        data-testid="markdown-reading-loading"
        className="absolute inset-0 z-10 flex items-center justify-center bg-surface-container-lowest/70 backdrop-blur-sm"
      >
        <div className="flex items-center gap-2 font-body text-sm text-on-surface-variant">
          <span className="material-symbols-outlined animate-spin text-base">
            progress_activity
          </span>
          <span>Loading…</span>
        </div>
      </div>
    )}
  </div>
)
