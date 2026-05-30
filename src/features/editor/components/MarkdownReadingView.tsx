/* eslint-disable react/require-default-props -- forwardRef component; optional props use default args (matches CodeEditor) */
import {
  forwardRef,
  useMemo,
  type CSSProperties,
  type ReactElement,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize from 'rehype-sanitize'
import { useReadingStyle } from '../hooks/useReadingStyle'
import { markdownComponents } from './markdownComponents'
import './MarkdownReadingView.css'

// Module-level stable references so re-renders never hand react-markdown new
// plugin arrays. ORDER IS LOAD-BEARING: rehype-sanitize FIRST, rehype-highlight
// SECOND — see the component doc below.
const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeSanitize, rehypeHighlight]

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
 * CRITICAL plugin order: `REHYPE_PLUGINS = [rehypeSanitize, rehypeHighlight]` —
 * sanitize FIRST, highlight SECOND. `rehype-sanitize` runs an allow-list over
 * the hast; running it before `rehype-highlight` lets highlight.js add its
 * `.hljs-*` classes to the already-sanitized tree so they survive to the DOM.
 * The reverse order would strip the just-added classes, leaving fences
 * unstyled. `MarkdownReadingView.test.tsx` asserts the surviving `.hljs` class
 * as the regression net for this ordering.
 *
 * Typography is driven by the shared reading-style preference
 * (`useReadingStyle`, picked via the dock ⚙ menu): the active preset's base
 * font / line-height / measure / inline-padding are published as CSS custom
 * properties on the root, and `markdownComponents` sizes everything in `em` so
 * the whole document scales from that one base. The scroller is a
 * `container-type: inline-size` container so the `cqi`-based padding tracks the
 * dock pane width, not the window.
 *
 * The render is memoized by `content` (parse + sanitize + highlight is
 * expensive; the dock re-renders often). The forwarded ref points at the
 * focusable scroll region so `DockPanel.focusEditor()` can place keyboard focus
 * there for PageDown/arrow scrolling.
 */
export const MarkdownReadingView = forwardRef<
  HTMLDivElement,
  MarkdownReadingViewProps
>(function MarkdownReadingView(
  { content, isLoading = false }: MarkdownReadingViewProps,
  ref
): ReactElement {
  const { style } = useReadingStyle()

  const styleVars = {
    '--rv-font-size': `${style.fontPx}px`,
    '--rv-line-height': `${style.lineHeight}`,
    '--rv-measure': `${style.measureCh}ch`,
    '--rv-pad-inline': style.paddingInline,
  } as CSSProperties

  const rendered = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    ),
    [content]
  )

  return (
    <div
      data-testid="markdown-reading-view"
      style={styleVars}
      className="markdown-reading-view relative flex min-h-0 flex-1 flex-col overflow-hidden [container-type:inline-size]"
    >
      <div
        ref={ref}
        role="region"
        aria-label="Markdown reading view"
        tabIndex={0}
        className="thin-scrollbar min-h-0 flex-1 overflow-auto py-8 [padding-inline:var(--rv-pad-inline)] focus:outline-none"
      >
        <div className="mx-auto [font-size:var(--rv-font-size)] [line-height:var(--rv-line-height)] [max-width:var(--rv-measure)]">
          {rendered}
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
})
