import { type ReactElement, useState } from 'react'
import type { IFileSystemService } from '../../files/services/fileSystemService'
import { CodeEditor } from '../../editor/components/CodeEditor'
import { useResizable } from '../hooks/useResizable'

type TabType = 'editor' | 'diff'

interface BottomDrawerProps {
  selectedFilePath: string | null
  fileSystemService: IFileSystemService
  onContentChange?: (content: string) => void
  onSave?: () => void
  isDirty?: boolean
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
  fileSystemService,
  onContentChange = undefined,
  onSave = undefined,
  isDirty = false,
}: BottomDrawerProps): ReactElement => {
  const [activeTab, setActiveTab] = useState<TabType>('editor')

  // Resizable hook - default 400px (50% of 800px), min 150px, max 640px (80% of 800px)
  const {
    size: height,
    isDragging,
    handleMouseDown,
  } = useResizable({
    initial: 400,
    min: 150,
    max: 640,
    direction: 'vertical',
    // BottomDrawer is bottom-anchored with its drag handle on the TOP edge,
    // so dragging UP (clientY decreases) should GROW the panel, not shrink
    // it. `invert: true` flips the delta sign so the behavior matches every
    // IDE: up = expand, down = shrink.
    invert: true,
  })

  return (
    <section
      data-testid="bottom-drawer"
      style={{ height: `${height}px` }}
      className="shrink-0 bg-slate-900/95 backdrop-blur-2xl border-t border-white/5 flex flex-col z-30 relative"
    >
      {/* Resize Handle - Top Edge */}
      <div
        data-testid="resize-handle"
        onMouseDown={handleMouseDown}
        className={`absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-primary/20 transition-colors ${
          isDragging ? 'bg-primary/30' : ''
        }`}
        aria-label="Resize drawer"
      />

      {/* Tab Bar */}
      <div className="flex items-center px-8 h-12 bg-surface-container justify-between">
        {/* Left: Tab Buttons */}
        <div className="flex space-x-6">
          {/* Editor Tab */}
          <button
            onClick={() => {
              setActiveTab('editor')
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
            onClick={() => {
              setActiveTab('diff')
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
            aria-label="Collapse drawer"
            className="material-symbols-outlined text-sm text-outline hover:text-on-surface cursor-pointer transition-colors"
          >
            keyboard_arrow_down
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'editor' ? (
          <div data-testid="editor-panel" className="flex flex-1">
            <CodeEditor
              filePath={selectedFilePath}
              fileSystemService={fileSystemService}
              onContentChange={onContentChange}
              onSave={onSave}
              isDirty={isDirty}
            />
          </div>
        ) : (
          <div data-testid="diff-panel" className="flex-1 flex">
            <DiffContent />
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * DiffContent - Placeholder for diff viewer
 */
const DiffContent = (): ReactElement => (
  <div className="flex items-center justify-center h-full text-on-surface-variant">
    <div className="text-center space-y-2">
      <p className="text-sm">No changes to review</p>
      <p className="text-xs opacity-60">Modified files will appear here</p>
    </div>
  </div>
)

export default BottomDrawer
