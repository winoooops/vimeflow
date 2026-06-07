/* eslint-disable react/require-default-props -- forwardRef components: ESLint cannot see through forwardRef to find destructuring defaults */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from 'react'
import {
  CodeEditor,
  type CodeEditorHandle,
} from '../../editor/components/CodeEditor'
import { MarkdownReadingView } from '../../editor/components/MarkdownReadingView'
import { ReadingStyleMenu } from '../../editor/components/ReadingStyleMenu'
import {
  DiffPanelContent,
  type FeedbackRepoRootRef,
} from '../../diff/components/DiffPanelContent'
import { DockSwitcher, type DockPosition } from './DockSwitcher'
import { DockTab } from './DockTab'
import { ViewModeToggle, type ViewMode } from './ViewModeToggle'
import type { SelectedDiffFile } from '../../diff/types'
import type { UseGitStatusReturn } from '../../diff/hooks/useGitStatus'
import type { UseFeedbackBatchReturn } from '../../diff/hooks/useFeedbackBatch'
import type { FeedbackDispatchTarget } from '../../diff/services/activePanePicker'
import { DOCK_CONTAINER_ID } from '../containerIds'
import {
  DOCK_INLINE_ACTIONS_MIN_WIDTH_PX,
  KEYBOARD_STEP_PX,
  KEYBOARD_STEP_SHIFT_PX,
} from '../panelConfig'
import { ResizeHandle } from '../../../components/ResizeHandle'

type TabType = 'editor' | 'diff'

const MARKDOWN_FILE_PATTERN = /\.(md|markdown)$/i

type SelectedDiffControl =
  | { selectedDiffFile?: undefined; onSelectedDiffFileChange?: undefined }
  | {
      selectedDiffFile: SelectedDiffFile | null
      onSelectedDiffFileChange: (file: SelectedDiffFile | null) => void
    }

interface DockPanelBaseProps {
  /** Which edge of the main canvas the panel docks to. */
  position: DockPosition
  /** Active tab (controlled). */
  tab: TabType
  onTabChange: (next: TabType) => void
  /** Layout-switcher pick callback. Caller updates dock position. */
  onPositionChange: (next: DockPosition) => void
  /** Caller closes the dock; DockPanel unmounts on close. */
  onClose: () => void
  /** Controlled height for top/bottom docks. */
  verticalSize: number
  onVerticalResizeMouseDown: (event: MouseEvent) => void
  isVerticalResizing: boolean
  onVerticalSizeAdjust: (delta: number) => void
  /** Live pixel bounds from useElasticContainer for ARIA and Home/End. */
  verticalPixelMin: number
  verticalPixelMax: number
  /** Controlled width for left/right docks. */
  horizontalSize: number
  onHorizontalResizeMouseDown: (event: MouseEvent) => void
  isHorizontalResizing: boolean
  onHorizontalSizeAdjust: (delta: number) => void
  horizontalPixelMin: number
  horizontalPixelMax: number

  selectedFilePath: string | null
  /** Current buffer content, owned by the parent `useEditorBuffer`. */
  content: string
  onContentChange?: (content: string) => void
  onSave?: () => void
  isDirty?: boolean
  /** True while an async file read is in flight. */
  isLoading?: boolean
  /** Working directory for git commands (diff viewer). */
  cwd?: string
  /** Optional shared git status from WorkspaceView. */
  gitStatus?: UseGitStatusReturn
  /** Optional workspace-owned inline review feedback batch. */
  feedbackBatch?: UseFeedbackBatchReturn
  /** Optional workspace-owned repo root cache for feedback dispatch. */
  feedbackRepoRootRef?: FeedbackRepoRootRef
  /** Optional feedback dispatch target for inline review comments. */
  feedbackDispatch?: FeedbackDispatchTarget
  isFocused?: boolean
  onContainerFocus?: () => void
}

type DockPanelProps = DockPanelBaseProps & SelectedDiffControl

export interface DockPanelHandle {
  focusEditor(): boolean
  focusDiff(): void
}

const DockPanel = forwardRef<DockPanelHandle, DockPanelProps>(
  function DockPanel(
    {
      position,
      tab,
      onTabChange,
      onPositionChange,
      onClose,
      verticalSize,
      onVerticalResizeMouseDown,
      isVerticalResizing,
      onVerticalSizeAdjust,
      verticalPixelMin,
      verticalPixelMax,
      horizontalSize,
      onHorizontalResizeMouseDown,
      isHorizontalResizing,
      onHorizontalSizeAdjust,
      horizontalPixelMin,
      horizontalPixelMax,
      selectedFilePath,
      content,
      onContentChange = undefined,
      onSave = undefined,
      isDirty = false,
      isLoading = false,
      cwd = '.',
      gitStatus = undefined,
      feedbackBatch = undefined,
      feedbackRepoRootRef = undefined,
      feedbackDispatch = undefined,
      isFocused = false,
      onContainerFocus = undefined,
      selectedDiffFile,
      onSelectedDiffFileChange,
    }: DockPanelProps,
    ref
  ): ReactElement {
    const isVerticalDock = position === 'top' || position === 'bottom'
    const sectionRef = useRef<HTMLElement>(null)
    const diffWrapperRef = useRef<HTMLDivElement>(null)
    const editorHandleRef = useRef<CodeEditorHandle | null>(null)
    const markdownViewRef = useRef<HTMLDivElement>(null)

    const isMarkdown = MARKDOWN_FILE_PATTERN.test(selectedFilePath ?? '')

    // Ephemeral dock state (D5): the per-file Source/Reading mode is not
    // persisted across reload, matching the dock's existing non-persistence
    // stance. Default 'reading' (D4) so markdown docs open pretty.
    const [viewMode, setViewMode] = useState<ViewMode>('reading')

    // Reset to the default Reading mode when the selected file changes. Done
    // during render (not a post-commit effect) so a newly-opened markdown file
    // renders in Reading on its FIRST render — a previous file left in Source
    // would otherwise flash the source editor for a frame before an effect
    // could reset it. Guarded by a previous-path ref to avoid a render loop.
    const previousFilePathRef = useRef(selectedFilePath)
    if (previousFilePathRef.current !== selectedFilePath) {
      previousFilePathRef.current = selectedFilePath
      setViewMode('reading')
    }

    // Move keyboard focus into the reading region when reading mode becomes
    // active in a focused pane — the symmetric counterpart to CodeEditor's
    // `shouldAutoFocus={isFocused}`. Without it, toggling Source → Reading
    // leaves focus on the toggle button, so PageDown/arrow scrolling is dead
    // until the user clicks the document. Gated on `isFocused` so opening a
    // markdown file in a background dock never steals focus. `selectedFilePath`
    // is a dependency so switching between two markdown files re-focuses the
    // region the `key={selectedFilePath}` remount just rebuilt — otherwise none
    // of the other deps change and focus falls to document.body after unmount.
    useEffect(() => {
      if (
        tab === 'editor' &&
        isMarkdown &&
        viewMode === 'reading' &&
        isFocused
      ) {
        markdownViewRef.current?.focus()
      }
    }, [tab, isMarkdown, viewMode, isFocused, selectedFilePath])

    useImperativeHandle(ref, () => ({
      focusEditor(): boolean {
        // Reading mode renders MarkdownReadingView, not CodeEditor — focus its
        // scrollable region so keyboard PageDown/arrow scrolling works.
        if (tab === 'editor' && isMarkdown && viewMode === 'reading') {
          if (markdownViewRef.current) {
            markdownViewRef.current.focus()

            return true
          }

          sectionRef.current?.focus()

          return false
        }

        if (editorHandleRef.current) {
          const ok = editorHandleRef.current.focus()

          if (!ok) {
            sectionRef.current?.focus()
          }

          return ok
        }

        sectionRef.current?.focus()

        return false
      },
      focusDiff(): void {
        if (diffWrapperRef.current) {
          diffWrapperRef.current.focus()

          return
        }

        sectionRef.current?.focus()
      },
    }))

    const handlePointerDown = (event: PointerEvent<HTMLElement>): void => {
      // onContainerFocus is NOT called here — onFocus (bubbling) covers
      // both pointer and keyboard Tab paths, avoiding a double invocation
      // on every click (pointer → child-focus bubbles → onFocus fires too).
      const target =
        event.target instanceof Element ? event.target : event.currentTarget

      if (
        !target.closest(
          'button,input,textarea,a,select,[tabindex]:not([tabindex="-1"])'
        )
      ) {
        sectionRef.current?.focus()
      }
    }

    const containerStyle = isVerticalDock
      ? { height: `${verticalSize}px` }
      : { width: `${horizontalSize}px` }

    // Border edge varies by position; color literals are kept static so
    // Tailwind JIT can scan and emit both border-[#cba6f7] and
    // border-[rgba(74,68,79,0.3)] in the production CSS bundle.
    const borderEdge =
      position === 'top'
        ? 'border-b'
        : position === 'bottom'
          ? 'border-t'
          : position === 'left'
            ? 'border-r'
            : 'border-l'

    const borderClass = isFocused
      ? `${borderEdge} border-[#cba6f7]`
      : `${borderEdge} border-[rgba(74,68,79,0.3)]`

    const collapseIconName =
      position === 'top'
        ? 'expand_less'
        : position === 'bottom'
          ? 'expand_more'
          : position === 'left'
            ? 'chevron_left'
            : 'chevron_right'

    const sectionAriaLabel = tab === 'editor' ? 'Code editor' : 'Diff viewer'

    const compactActions =
      !isVerticalDock && horizontalSize < DOCK_INLINE_ACTIONS_MIN_WIDTH_PX

    const handleVerticalKeyDown = (e: KeyboardEvent): void => {
      const step = e.shiftKey ? KEYBOARD_STEP_SHIFT_PX : KEYBOARD_STEP_PX
      const growKey = position === 'top' ? 'ArrowDown' : 'ArrowUp'
      const shrinkKey = position === 'top' ? 'ArrowUp' : 'ArrowDown'

      if (e.key === growKey) {
        e.preventDefault()
        onVerticalSizeAdjust(step)
      } else if (e.key === shrinkKey) {
        e.preventDefault()
        onVerticalSizeAdjust(-step)
      } else if (e.key === 'Home') {
        e.preventDefault()
        onVerticalSizeAdjust(verticalPixelMin - verticalSize)
      } else if (e.key === 'End') {
        e.preventDefault()
        onVerticalSizeAdjust(verticalPixelMax - verticalSize)
      }
    }

    const handleHorizontalKeyDown = (e: KeyboardEvent): void => {
      const step = e.shiftKey ? KEYBOARD_STEP_SHIFT_PX : KEYBOARD_STEP_PX
      const growKey = position === 'left' ? 'ArrowRight' : 'ArrowLeft'
      const shrinkKey = position === 'left' ? 'ArrowLeft' : 'ArrowRight'

      if (e.key === growKey) {
        e.preventDefault()
        onHorizontalSizeAdjust(step)
      } else if (e.key === shrinkKey) {
        e.preventDefault()
        onHorizontalSizeAdjust(-step)
      } else if (e.key === 'Home') {
        e.preventDefault()
        onHorizontalSizeAdjust(horizontalPixelMin - horizontalSize)
      } else if (e.key === 'End') {
        e.preventDefault()
        onHorizontalSizeAdjust(horizontalPixelMax - horizontalSize)
      }
    }

    return (
      <section
        ref={sectionRef}
        data-testid="dock-panel"
        data-position={position}
        data-container-id={DOCK_CONTAINER_ID}
        aria-label={sectionAriaLabel}
        tabIndex={-1}
        style={{
          ...containerStyle,
          boxShadow: isFocused
            ? '0 0 0 1px #cba6f7 inset, 0 0 0 6px rgba(203,166,247,0.12)'
            : undefined,
          transition: 'box-shadow 220ms ease',
        }}
        onPointerDown={handlePointerDown}
        onFocus={onContainerFocus}
        className={`relative z-30 flex shrink-0 flex-col bg-[#121221] focus:outline-none ${borderClass}`}
      >
        {isFocused ? (
          <span
            data-testid="dock-focus-outline"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-40 border border-[#cba6f7]"
          />
        ) : null}

        {isVerticalDock ? (
          <ResizeHandle
            orientation="horizontal"
            isDragging={isVerticalResizing}
            ariaValueNow={verticalSize}
            ariaValueMin={verticalPixelMin}
            ariaValueMax={verticalPixelMax}
            onMouseDown={onVerticalResizeMouseDown}
            onKeyDown={handleVerticalKeyDown}
            // z-10 keeps the 4-px handle above the DockTab header (relative sibling)
            className={`absolute ${position === 'top' ? 'bottom-0' : 'top-0'} left-0 right-0 z-10 h-1`}
          />
        ) : (
          <ResizeHandle
            orientation="vertical"
            isDragging={isHorizontalResizing}
            ariaValueNow={horizontalSize}
            ariaValueMin={horizontalPixelMin}
            ariaValueMax={horizontalPixelMax}
            onMouseDown={onHorizontalResizeMouseDown}
            onKeyDown={handleHorizontalKeyDown}
            className={`absolute ${position === 'right' ? 'left-0' : 'right-0'} top-0 bottom-0 z-10 w-1`}
          />
        )}

        <DockTab
          tab={tab}
          onTabChange={onTabChange}
          selectedFilePath={selectedFilePath}
          collapseIconName={collapseIconName}
          onClose={onClose}
          compactActions={compactActions}
          menuAlign={position === 'left' ? 'left' : 'right'}
        >
          <div className="flex items-center gap-1">
            {isMarkdown && tab === 'editor' ? (
              <ViewModeToggle value={viewMode} onChange={setViewMode} />
            ) : null}
            {isMarkdown && tab === 'editor' && viewMode === 'reading' ? (
              <ReadingStyleMenu />
            ) : null}
            <DockSwitcher position={position} onPick={onPositionChange} />
          </div>
        </DockTab>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {tab === 'editor' && (
            <div
              data-testid="editor-panel"
              className="flex min-h-0 flex-1 overflow-hidden"
            >
              {isMarkdown && viewMode === 'reading' ? (
                <MarkdownReadingView
                  key={selectedFilePath ?? 'markdown'}
                  ref={markdownViewRef}
                  content={content}
                  isLoading={isLoading}
                  isDirty={isDirty}
                />
              ) : (
                <CodeEditor
                  ref={editorHandleRef}
                  filePath={selectedFilePath}
                  content={content}
                  onContentChange={onContentChange}
                  onSave={onSave}
                  isDirty={isDirty}
                  isLoading={isLoading}
                  shouldAutoFocus={isFocused}
                />
              )}
            </div>
          )}

          {tab === 'diff' && (
            <div
              data-testid="diff-panel"
              className="flex min-h-0 flex-1 overflow-hidden"
            >
              <div
                data-testid="diff-focus-target"
                ref={diffWrapperRef}
                tabIndex={-1}
                className="flex min-h-0 flex-1 focus:outline-none"
              >
                {selectedDiffFile !== undefined ? (
                  <DiffPanelContent
                    cwd={cwd}
                    gitStatus={gitStatus}
                    selectedFile={selectedDiffFile}
                    onSelectedFileChange={onSelectedDiffFileChange}
                    feedbackBatch={feedbackBatch}
                    feedbackRepoRootRef={feedbackRepoRootRef}
                    feedbackDispatch={feedbackDispatch}
                  />
                ) : (
                  <DiffPanelContent
                    cwd={cwd}
                    gitStatus={gitStatus}
                    feedbackBatch={feedbackBatch}
                    feedbackRepoRootRef={feedbackRepoRootRef}
                    feedbackDispatch={feedbackDispatch}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    )
  }
)

export default DockPanel
