/* eslint-disable react/require-default-props -- forwardRef component; optional props use default args (matches CodeEditor) */
import {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import type { PluggableList } from 'unified'
import { useReadingStyle } from '../hooks/useReadingStyle'
import { writeClipboardText } from '../utils/clipboard'
import type { ContextMenuAction } from '../types'
import { ContextMenu } from './ContextMenu'
import { markdownComponents } from './markdownComponents'
import './MarkdownReadingView.css'

// Module-level stable references so re-renders never hand react-markdown new
// plugin arrays. ORDER IS LOAD-BEARING: rehype-sanitize FIRST, then rehype-slug,
// then rehype-highlight — see the component doc below. `ignoreMissing` stops
// rehype-highlight from THROWING on a fence whose language it does not know
// (e.g. ```mermaid or a project-specific label); the block renders as plain code
// instead of blanking the reading pane — important since this view renders
// arbitrary docs.
const REMARK_PLUGINS: PluggableList = [remarkGfm]

const REHYPE_PLUGINS: PluggableList = [
  rehypeSanitize,
  rehypeSlug,
  [rehypeHighlight, { ignoreMissing: true }],
]

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
  /**
   * Whether the underlying buffer has unsaved edits. Reading mode replaces the
   * CodeEditor (which renders the vim `[+]` dirty marker), so surface an
   * equivalent unsaved indicator here — otherwise switching Source → Reading
   * with unsaved changes would hide that state.
   */
  isDirty?: boolean
}

interface ReadingViewMenuState {
  visible: boolean
  x: number
  y: number
}

const CONTEXT_MENU_WIDTH = 192
const CONTEXT_MENU_HEIGHT = 160

const selectionEndpointIsInside = (
  selection: globalThis.Selection,
  node: HTMLElement
): boolean =>
  selection.anchorNode !== null &&
  selection.focusNode !== null &&
  node.contains(selection.anchorNode) &&
  node.contains(selection.focusNode)

/**
 * Read-only reading view for markdown files in the dock editor.
 *
 * Renders the buffer's markdown via `react-markdown` as a real React element
 * tree (no `dangerouslySetInnerHTML`), themed to The Lens through the
 * `markdownComponents` per-tag map + the scoped `MarkdownReadingView.css`.
 *
 * CRITICAL plugin order: `[rehypeSanitize, rehypeSlug, rehypeHighlight]`.
 * `rehype-sanitize` runs an allow-list over the hast and must go FIRST so the
 * later plugins decorate an already-clean tree. `rehype-slug` adds heading
 * `id`s (for working `#hash` table-of-contents links) AFTER sanitize on
 * purpose: sanitize's default schema rewrites author-supplied `id`s with its
 * `user-content-` clobber prefix, which would break `#section` anchors — slugs
 * minted post-sanitize keep their bare `id="section"`. `rehype-highlight` goes
 * LAST so highlight.js's `.hljs-*` classes are added to the sanitized tree and
 * survive to the DOM (running it before sanitize would strip them, leaving
 * fences unstyled). `MarkdownReadingView.test.tsx` asserts both the surviving
 * `.hljs` class and the bare heading `id` as the regression net for this order.
 *
 * Typography is driven by the shared reading-style preference
 * (`useReadingStyle`, picked via the dock ⚙ menu): the active preset's base
 * font / line-height / measure / inline-padding are published as CSS custom
 * properties on the root, and `markdownComponents` sizes everything in `em` so
 * the whole document scales from that one base. The root is a
 * `container-type: inline-size` container so the `cqi`-based scroller padding
 * tracks the dock pane width, not the window.
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
  { content, isLoading = false, isDirty = false }: MarkdownReadingViewProps,
  ref
): ReactElement {
  const { style } = useReadingStyle()
  const contentRef = useRef<HTMLDivElement>(null)
  const regionRef = useRef<HTMLDivElement>(null)
  const selectedTextRef = useRef('')

  const [contextMenu, setContextMenu] = useState<ReadingViewMenuState>({
    visible: false,
    x: 0,
    y: 0,
  })

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

  const setRegionRefs = useCallback(
    (node: HTMLDivElement | null): void => {
      regionRef.current = node

      if (typeof ref === 'function') {
        ref(node)

        return
      }

      if (ref !== null) {
        ref.current = node
      }
    },
    [ref]
  )

  const getSelectedRenderedText = useCallback((): string => {
    const selection = window.getSelection()
    const contentElement = contentRef.current
    const selectedText = selection?.toString() ?? ''

    if (
      selection === null ||
      contentElement === null ||
      selectedText === '' ||
      selection.isCollapsed ||
      !selectionEndpointIsInside(selection, contentElement)
    ) {
      return ''
    }

    return selectedText
  }, [])

  const closeContextMenu = useCallback((): void => {
    selectedTextRef.current = ''
    setContextMenu({ visible: false, x: 0, y: 0 })
  }, [])

  const copySelection = useCallback((): void => {
    const selectedText = selectedTextRef.current || getSelectedRenderedText()

    if (selectedText === '') {
      return
    }

    void writeClipboardText(selectedText)
  }, [getSelectedRenderedText])

  const selectAll = useCallback((): void => {
    const contentElement = contentRef.current
    const selection = window.getSelection()

    if (contentElement === null || selection === null) {
      return
    }

    const range = document.createRange()
    range.selectNodeContents(contentElement)
    selection.removeAllRanges()
    selection.addRange(range)
    regionRef.current?.focus()
  }, [])

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>): void => {
      event.preventDefault()
      event.stopPropagation()
      selectedTextRef.current = getSelectedRenderedText()
      event.currentTarget.focus()

      const x = Math.max(
        0,
        Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH)
      )

      const y = Math.max(
        0,
        Math.min(event.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT)
      )

      setContextMenu({
        visible: true,
        x,
        y,
      })
    },
    [getSelectedRenderedText]
  )

  const clipboardActions = useMemo<ContextMenuAction[]>(
    () => [
      {
        label: 'Copy',
        icon: 'content_copy',
        onSelect: copySelection,
      },
      {
        label: 'Select All',
        icon: 'select_all',
        onSelect: selectAll,
      },
    ],
    [copySelection, selectAll]
  )

  return (
    <div
      data-testid="markdown-reading-view"
      style={styleVars}
      className="markdown-reading-view relative flex min-h-0 flex-1 flex-col overflow-hidden [container-type:inline-size]"
    >
      <div
        ref={setRegionRefs}
        role="region"
        aria-label="Markdown reading view"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto py-8 [padding-inline:var(--rv-pad-inline)] focus:outline-none"
        onContextMenu={handleContextMenu}
      >
        <div
          ref={contentRef}
          className="mx-auto [font-size:var(--rv-font-size)] [line-height:var(--rv-line-height)] [max-width:var(--rv-measure)]"
        >
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

      {isDirty && (
        <div
          data-testid="markdown-reading-dirty"
          className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-surface-container-high/90 px-2.5 py-1 font-mono text-[0.7rem] text-on-surface-muted shadow-lg backdrop-blur-sm"
        >
          <span className="text-primary" aria-hidden="true">
            [+]
          </span>
          <span>Unsaved</span>
        </div>
      )}

      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        actions={clipboardActions}
        onClose={closeContextMenu}
      />
    </div>
  )
})
