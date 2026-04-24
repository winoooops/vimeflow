import { type ReactElement, useState } from 'react'
import { CodeEditor } from '../../editor/components/CodeEditor'
import { DiffPanelContent } from '../../diff/components/DiffPanelContent'
import { useResizable } from '../hooks/useResizable'
import type { SelectedDiffFile } from '../../diff/types'

type TabType = 'editor' | 'diff'

interface BottomDrawerProps {
  selectedFilePath: string | null
  /** Current buffer content, owned by the parent `useEditorBuffer`. */
  content: string
  onContentChange?: (content: string) => void
  onSave?: () => void
  isDirty?: boolean
  /** True while an async file read is in flight. */
  isLoading?: boolean
  /** Working directory for git commands (diff viewer) */
  cwd?: string
  /** Controlled active tab */
  activeTab?: TabType
  /** Tab change handler (controlled mode) */
  onTabChange?: ((tab: TabType) => void) | null
  /** Controlled collapsed state */
  isCollapsed?: boolean
  /** Collapse change handler (controlled mode) */
  onCollapsedChange?: ((collapsed: boolean) => void) | null
  /** Controlled selected diff file (forwarded to DiffPanelContent) */
  selectedDiffFile?: SelectedDiffFile | null
  /** Diff file selection handler (forwarded to DiffPanelContent) */
  onSelectedDiffFileChange?: ((file: SelectedDiffFile | null) => void) | null
}

/**
 * BottomDrawer - Editor and Diff Viewer panel below terminal
 *
 * Features:
 * - Tab switching between Editor and Diff Viewer
 * - Resizable height with drag handle
 * - CodeMirror editor with vim mode
 * - File path display and collapse toggle
 */
const BottomDrawer = ({
  selectedFilePath,
  content,
  onContentChange = undefined,
  onSave = undefined,
  isDirty = false,
  isLoading = false,
  cwd = '.',
  activeTab: controlledActiveTab = undefined,
  onTabChange = null,
  isCollapsed: controlledIsCollapsed = undefined,
  onCollapsedChange = null,
  selectedDiffFile = undefined,
  onSelectedDiffFileChange = null,
}: BottomDrawerProps): ReactElement => {
  const [uncontrolledActiveTab, setUncontrolledActiveTab] =
    useState<TabType>('editor')
  const [uncontrolledIsCollapsed, setUncontrolledIsCollapsed] = useState(false)

  const COLLAPSED_HEIGHT = 48 // Just the tab bar

  // Determine if each prop is controlled
  const isTabControlled = controlledActiveTab !== undefined
  const isCollapseControlled = controlledIsCollapsed !== undefined

  // Use controlled value or fallback to uncontrolled
  const activeTab = isTabControlled
    ? controlledActiveTab
    : uncontrolledActiveTab

  const isCollapsed = isCollapseControlled
    ? controlledIsCollapsed
    : uncontrolledIsCollapsed

  // Drawer sizing is in pixels, not viewport-relative. The 400/150/640
  // constants were chosen to feel roughly right on an 800px workspace
  // (50% default, 19% min, 80% cap) but they are HARD-CODED — resizing
  // the window does not change the cap. Update these values directly
  // if the layout targets a different default viewport.
  const DRAWER_MIN = 150
  const DRAWER_MAX = 640

  const {
    size: height,
    isDragging,
    handleMouseDown,
    adjustBy,
  } = useResizable({
    initial: 400,
    min: DRAWER_MIN,
    max: DRAWER_MAX,
    direction: 'vertical',
    // BottomDrawer is bottom-anchored with its drag handle on the TOP edge,
    // so dragging UP (clientY decreases) should GROW the panel, not shrink
    // it. `invert: true` flips the delta sign so the behavior matches every
    // IDE: up = expand, down = shrink.
    invert: true,
  })

  const effectiveHeight = isCollapsed ? COLLAPSED_HEIGHT : height

  return (
    <section
      data-testid="bottom-drawer"
      style={{ height: `${effectiveHeight}px` }}
      className="shrink-0 bg-slate-900/95 backdrop-blur-2xl border-t border-white/5 flex flex-col z-30 relative"
    >
      {/* Resize Handle - Top Edge.
          role="separator" + aria-orientation/valuenow/valuemin/valuemax
          exposes the handle to assistive tech as a sizing widget.
          tabIndex=0 + ArrowUp/ArrowDown keyboard handlers give
          keyboard-only and switch-access users a way to adjust the
          drawer height in 20px steps (WCAG 2.5.1).

          When collapsed, the handle is disabled entirely: no
          onMouseDown, no onKeyDown, removed from tab order, and
          aria-disabled. Otherwise the handle would silently mutate
          the expanded-height state while the drawer is visually
          pinned at COLLAPSED_HEIGHT, clobbering the user's chosen
          expanded size once they expand the drawer again. */}
      <div
        data-testid="resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize drawer"
        aria-valuenow={height}
        aria-valuemin={DRAWER_MIN}
        aria-valuemax={DRAWER_MAX}
        aria-disabled={isCollapsed || undefined}
        tabIndex={isCollapsed ? -1 : 0}
        onMouseDown={isCollapsed ? undefined : handleMouseDown}
        onKeyDown={
          isCollapsed
            ? undefined
            : (e): void => {
                const step = e.shiftKey ? 100 : 20
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  adjustBy(step) // drag UP grows (matches `invert: true`)
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  adjustBy(-step)
                } else if (e.key === 'Home') {
                  e.preventDefault()
                  adjustBy(DRAWER_MIN - height)
                } else if (e.key === 'End') {
                  e.preventDefault()
                  adjustBy(DRAWER_MAX - height)
                }
              }
        }
        className={`absolute top-0 left-0 right-0 h-1 transition-colors ${
          isCollapsed
            ? 'pointer-events-none'
            : 'cursor-ns-resize hover:bg-primary/20 focus:bg-primary/40 focus:outline-none'
        } ${isDragging ? 'bg-primary/30' : ''}`}
      />

      {/* Tab Bar */}
      <div className="flex items-center px-8 h-12 bg-surface-container justify-between">
        {/* Left: Tab Buttons */}
        <div className="flex space-x-6">
          {/* Editor Tab */}
          <button
            type="button"
            onClick={() => {
              if (isTabControlled && onTabChange) {
                onTabChange('editor')
              } else if (!isTabControlled) {
                setUncontrolledActiveTab('editor')
              }
            }}
            className={`flex items-center space-x-2 font-mono text-xs h-12 px-2 transition-colors ${
              activeTab === 'editor'
                ? 'text-primary border-b-2 border-primary'
                : 'text-slate-400 hover:text-primary'
            }`}
            aria-label="Editor"
          >
            <span className="material-symbols-outlined text-sm">code</span>
            <span>Editor</span>
          </button>

          {/* Diff Viewer Tab */}
          <button
            type="button"
            onClick={() => {
              if (isTabControlled && onTabChange) {
                onTabChange('diff')
              } else if (!isTabControlled) {
                setUncontrolledActiveTab('diff')
              }
            }}
            className={`flex items-center space-x-2 font-mono text-xs h-12 px-2 transition-colors ${
              activeTab === 'diff'
                ? 'text-primary border-b-2 border-primary'
                : 'text-slate-400 hover:text-primary'
            }`}
            aria-label="Diff Viewer"
          >
            <span className="material-symbols-outlined text-sm">
              difference
            </span>
            <span>Diff Viewer</span>
          </button>
        </div>

        {/* Right: File Path + Collapse Toggle */}
        <div className="flex items-center space-x-4">
          <span
            className="text-[10px] text-outline font-mono"
            title={selectedFilePath ?? ''}
          >
            {selectedFilePath
              ? selectedFilePath.replace(/^~\//, '')
              : 'No file'}
          </span>
          <button
            type="button"
            aria-label={isCollapsed ? 'Expand drawer' : 'Collapse drawer'}
            aria-expanded={!isCollapsed}
            onClick={() => {
              if (isCollapseControlled && onCollapsedChange) {
                onCollapsedChange(!isCollapsed)
              } else if (!isCollapseControlled) {
                setUncontrolledIsCollapsed((v) => !v)
              }
            }}
            className="material-symbols-outlined text-sm text-outline hover:text-on-surface cursor-pointer transition-colors"
          >
            {isCollapsed ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {activeTab === 'editor' ? (
          // `min-h-0` + `overflow-hidden` on the editor wrapper is load-
          // bearing: without them this flex child defaults to
          // `min-height: auto`, which grows to the full CodeMirror
          // content height and defeats CodeMirror's internal
          // `.cm-scroller`. The cursor moves with h/j/k/l but the
          // editor never needs to scroll because its container is
          // always big enough to show the entire file. Bounding the
          // wrapper is what lets `h-full` on `codemirror-container`
          // resolve to a real pixel height and enables internal scroll
          // follow.
          <div
            data-testid="editor-panel"
            className="flex min-h-0 flex-1 overflow-hidden"
          >
            <CodeEditor
              filePath={selectedFilePath}
              content={content}
              onContentChange={onContentChange}
              onSave={onSave}
              isDirty={isDirty}
              isLoading={isLoading}
            />
          </div>
        ) : (
          // Same `min-h-0 overflow-hidden` treatment as the editor
          // wrapper above. `DiffContent` is currently a static two-
          // line placeholder, so nothing overflows today — but when
          // it's replaced with a real diff viewer (CodeMirror merge
          // view or similar), an unbounded `flex flex-1` wrapper
          // would immediately re-trigger the same `min-height: auto`
          // flex issue we're fixing here for the editor. Cheaper to
          // apply symmetry now than to rediscover the bug later.
          <div
            data-testid="diff-panel"
            className="flex min-h-0 flex-1 overflow-hidden"
          >
            <DiffPanelContent
              cwd={cwd}
              selectedFile={selectedDiffFile}
              onSelectedFileChange={onSelectedDiffFileChange}
            />
          </div>
        )}
      </div>
    </section>
  )
}

export default BottomDrawer
