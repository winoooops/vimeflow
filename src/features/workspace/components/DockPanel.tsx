import type { MouseEvent, ReactElement } from 'react'
import { CodeEditor } from '../../editor/components/CodeEditor'
import { DiffPanelContent } from '../../diff/components/DiffPanelContent'
import { DockSwitcher, type DockPosition } from './DockSwitcher'
import { DockTab } from './DockTab'
import type { SelectedDiffFile } from '../../diff/types'
import type { UseGitStatusReturn } from '../../diff/hooks/useGitStatus'

type TabType = 'editor' | 'diff'

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
  /** Controlled top/bottom dock size from WorkspaceView's lifted useResizable. */
  verticalSize: number
  /** Mouse handler from the lifted vertical resize hook. Ignored for side docks. */
  onVerticalResizeMouseDown: (event: MouseEvent) => void
  /** Drag state from the lifted vertical resize hook. Ignored for side docks. */
  isVerticalResizing: boolean
  /** Keyboard adjuster from WorkspaceView's lifted useResizable. */
  onVerticalSizeAdjust: (delta: number) => void

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
}

type DockPanelProps = DockPanelBaseProps & SelectedDiffControl

const DRAWER_MIN = 150
const DRAWER_MAX = 640
const SIDE_DOCK_BASIS = '40%'

/**
 * DockPanel - Editor and Diff Viewer panel docked to the workspace edge.
 */
const DockPanel = ({
  position,
  tab,
  onTabChange,
  onPositionChange,
  onClose,
  verticalSize,
  onVerticalResizeMouseDown,
  isVerticalResizing,
  onVerticalSizeAdjust,
  selectedFilePath,
  content,
  onContentChange = undefined,
  onSave = undefined,
  isDirty = false,
  isLoading = false,
  cwd = '.',
  gitStatus = undefined,
  selectedDiffFile,
  onSelectedDiffFileChange,
}: DockPanelProps): ReactElement => {
  const isVerticalDock = position === 'top' || position === 'bottom'

  const containerStyle = isVerticalDock
    ? { height: `${verticalSize}px` }
    : { flex: `0 0 ${SIDE_DOCK_BASIS}` as const }

  const borderClass =
    position === 'top'
      ? 'border-b border-[rgba(74,68,79,0.3)]'
      : position === 'bottom'
        ? 'border-t border-[rgba(74,68,79,0.3)]'
        : position === 'left'
          ? 'border-r border-[rgba(74,68,79,0.3)]'
          : 'border-l border-[rgba(74,68,79,0.3)]'

  const collapseIconName =
    position === 'top'
      ? 'expand_less'
      : position === 'bottom'
        ? 'expand_more'
        : position === 'left'
          ? 'chevron_left'
          : 'chevron_right'

  const resizeHandleEdgeClass = position === 'top' ? 'bottom-0' : 'top-0'
  const sectionAriaLabel = tab === 'editor' ? 'Code editor' : 'Diff viewer'

  return (
    <section
      data-testid="dock-panel"
      data-position={position}
      aria-label={sectionAriaLabel}
      style={containerStyle}
      className={`relative z-30 flex shrink-0 flex-col bg-[#121221] ${borderClass}`}
    >
      {isVerticalDock && (
        <div
          data-testid="resize-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize panel"
          aria-valuenow={verticalSize}
          aria-valuemin={DRAWER_MIN}
          aria-valuemax={DRAWER_MAX}
          tabIndex={0}
          onMouseDown={onVerticalResizeMouseDown}
          onKeyDown={(e): void => {
            const step = e.shiftKey ? 100 : 20
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
              onVerticalSizeAdjust(DRAWER_MIN - verticalSize)
            } else if (e.key === 'End') {
              e.preventDefault()
              onVerticalSizeAdjust(DRAWER_MAX - verticalSize)
            }
          }}
          className={`absolute ${resizeHandleEdgeClass} left-0 right-0 h-1 cursor-ns-resize transition-colors hover:bg-primary/20 focus:bg-primary/40 focus:outline-none ${
            isVerticalResizing ? 'bg-primary/30' : ''
          }`}
        />
      )}

      <DockTab
        tab={tab}
        onTabChange={onTabChange}
        selectedFilePath={selectedFilePath}
        collapseIconName={collapseIconName}
        onClose={onClose}
      >
        <DockSwitcher position={position} onPick={onPositionChange} />
      </DockTab>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {tab === 'editor' && (
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
        )}

        {tab === 'diff' && (
          <div
            data-testid="diff-panel"
            className="flex min-h-0 flex-1 overflow-hidden"
          >
            {selectedDiffFile !== undefined ? (
              <DiffPanelContent
                cwd={cwd}
                gitStatus={gitStatus}
                selectedFile={selectedDiffFile}
                onSelectedFileChange={onSelectedDiffFileChange}
              />
            ) : (
              <DiffPanelContent cwd={cwd} gitStatus={gitStatus} />
            )}
          </div>
        )}
      </div>
    </section>
  )
}

export default DockPanel
