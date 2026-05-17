import type { MouseEvent, ReactElement } from 'react'
import { CodeEditor } from '../../editor/components/CodeEditor'
import { DiffPanelContent } from '../../diff/components/DiffPanelContent'
import { DockSwitcher, type DockPosition } from './DockSwitcher'
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

const tabButtonClass = (active: boolean): string =>
  `flex items-center gap-1.5 font-mono text-[10.5px] h-[26px] px-[11px] rounded-md border transition-colors ${
    active
      ? 'bg-[rgba(226,199,255,0.08)] border-[rgba(203,166,247,0.3)] text-[#e2c7ff]'
      : 'bg-transparent border-transparent text-[#8a8299] hover:text-[#e2c7ff]'
  }`

const tabIconClass = (active: boolean): string =>
  `material-symbols-outlined text-[12px] ${
    active ? 'text-[#cba6f7]' : 'text-[#6c7086]'
  }`

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

  const closeIcon =
    position === 'top'
      ? 'expand_less'
      : position === 'bottom'
        ? 'expand_more'
        : position === 'left'
          ? 'chevron_left'
          : 'chevron_right'

  const resizeHandleEdgeClass = position === 'top' ? 'bottom-0' : 'top-0'

  return (
    <section
      data-testid="dock-panel"
      data-position={position}
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

      {/* Tab Bar - 34 px (prototype handoff). */}
      <div className="flex h-[34px] items-center gap-1 border-b border-[rgba(74,68,79,0.25)] bg-[#0d0d1c] px-2">
        <div className="flex gap-1">
          <button
            type="button"
            aria-pressed={tab === 'editor'}
            onClick={() => onTabChange('editor')}
            className={tabButtonClass(tab === 'editor')}
            aria-label="Editor"
          >
            <span className={tabIconClass(tab === 'editor')} aria-hidden="true">
              code
            </span>
            <span>Editor</span>
          </button>

          <button
            type="button"
            aria-pressed={tab === 'diff'}
            onClick={() => onTabChange('diff')}
            className={tabButtonClass(tab === 'diff')}
            aria-label="Diff Viewer"
          >
            <span className={tabIconClass(tab === 'diff')} aria-hidden="true">
              difference
            </span>
            <span>Diff Viewer</span>
          </button>
        </div>

        <div className="flex-1" />

        <DockSwitcher position={position} onPick={onPositionChange} />

        <div className="ml-2 flex items-center gap-3">
          <span
            className="font-mono text-[10px] text-outline"
            title={selectedFilePath ?? ''}
          >
            {selectedFilePath
              ? selectedFilePath.replace(/^~\//, '')
              : 'No file'}
          </span>
          <button
            type="button"
            aria-label="Collapse panel"
            onClick={onClose}
            className="grid h-6 w-6 cursor-pointer place-items-center rounded-[5px] bg-transparent text-[#8a8299] transition-colors hover:bg-white/5 hover:text-[#e2c7ff]"
          >
            <span
              className="material-symbols-outlined text-[14px]"
              aria-hidden="true"
            >
              {closeIcon}
            </span>
          </button>
        </div>
      </div>

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
