import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { IconRail } from './components/IconRail'
import { Sidebar } from './components/Sidebar'
import { TerminalZone } from './components/TerminalZone'
import BottomDrawer from './components/BottomDrawer'
import AgentActivity from './components/AgentActivity'
import { UnsavedChangesDialog } from '../editor/components/UnsavedChangesDialog'
import { mockNavigationItems, mockSettingsItem } from './data/mockNavigation'
import { useSessionManager } from './hooks/useSessionManager'
import { useResizable } from './hooks/useResizable'
import { createFileSystemService } from '../files/services/fileSystemService'
import { useEditorBuffer } from '../editor/hooks/useEditorBuffer'

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 560
const SIDEBAR_DEFAULT = 340

export const WorkspaceView = (): ReactElement => {
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createSession,
    removeSession,
    renameSession,
    reorderSessions,
    updateSessionCwd,
  } = useSessionManager()

  const {
    size: sidebarWidth,
    isDragging,
    handleMouseDown,
  } = useResizable({
    initial: SIDEBAR_DEFAULT,
    min: SIDEBAR_MIN,
    max: SIDEBAR_MAX,
  })

  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)
    : undefined

  // File selection state.
  //
  // The service is created once per WorkspaceView instance via useMemo so it
  // has a stable reference across renders. Without this, CodeEditor's
  // file-loading effect (which depends on the service) re-fires on every
  // WorkspaceView re-render — including each keystroke in the editor — and
  // reloads the file from disk, overwriting in-progress edits.
  const fileSystemService = useMemo(() => createFileSystemService(), [])
  const editorBuffer = useEditorBuffer(fileSystemService)
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Handle file selection from FileExplorer
  const handleFileSelect = (node: {
    id: string
    type: 'file' | 'folder'
  }): void => {
    // Only handle file nodes, not folders
    if (node.type !== 'file') {
      return
    }

    const filePath = node.id

    // If current file has unsaved changes, show dialog
    if (editorBuffer.isDirty) {
      setPendingFilePath(filePath)
      setShowUnsavedDialog(true)

      return
    }

    // Otherwise, open file directly
    void editorBuffer.openFile(filePath)
  }

  // Save current file and open pending file.
  //
  // Errors from saveFile/openFile were previously swallowed via `void
  // handleSave()`, leaving the dialog stuck open with no user feedback on
  // Tauri IPC failures (disk full, permission denied, file missing). Wrap
  // the async work in try/catch, surface the error via `saveError`, and
  // keep the dialog open so the user can retry or cancel.
  const handleSave = async (): Promise<void> => {
    try {
      await editorBuffer.saveFile()

      if (pendingFilePath) {
        await editorBuffer.openFile(pendingFilePath)
      }

      setShowUnsavedDialog(false)
      setPendingFilePath(null)
      setSaveError(null)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      setSaveError(`Failed to save: ${message}`)
    }
  }

  // Discard changes and open pending file.
  //
  // Previously `void editorBuffer.openFile(...)` fired and forgot — if the
  // open failed (file deleted between selection and open), the error was
  // swallowed and the dialog closed while the editor silently showed stale
  // content. Now the dialog stays open on failure and reports the error.
  const handleDiscard = async (): Promise<void> => {
    try {
      if (pendingFilePath) {
        await editorBuffer.openFile(pendingFilePath)
      }

      setShowUnsavedDialog(false)
      setPendingFilePath(null)
      setSaveError(null)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      setSaveError(`Failed to open file: ${message}`)
    }
  }

  // Cancel and stay on current file
  const handleCancel = (): void => {
    setShowUnsavedDialog(false)
    setPendingFilePath(null)
    setSaveError(null)
  }

  return (
    <div
      data-testid="workspace-view"
      className="grid h-screen overflow-hidden"
      style={{
        gridTemplateColumns: `64px ${sidebarWidth}px 1fr 360px`,
      }}
    >
      {/* Icon Rail - 64px */}
      <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />

      {/* Sidebar - resizable */}
      <div className="relative flex h-full">
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          activeCwd={activeSession?.workingDirectory ?? '~'}
          onSessionClick={setActiveSessionId}
          onNewInstance={createSession}
          onRemoveSession={removeSession}
          onRenameSession={renameSession}
          onReorderSessions={reorderSessions}
          onFileSelect={handleFileSelect}
        />

        {/* Resize handle */}
        <div
          data-testid="sidebar-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={sidebarWidth}
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          onMouseDown={handleMouseDown}
          className={`
            absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize
            transition-colors hover:bg-primary/50
            ${isDragging ? 'bg-primary/70' : 'bg-transparent'}
          `}
        />
      </div>

      {/* Main workspace area - TerminalZone + BottomDrawer */}
      <div className="flex flex-col overflow-hidden">
        {/* Terminal Zone - takes remaining space */}
        <TerminalZone
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSessionChange={setActiveSessionId}
          onNewTab={createSession}
          onCloseTab={removeSession}
          onSessionCwdChange={updateSessionCwd}
        />

        {/* Bottom Drawer - Editor + Diff Viewer */}
        <BottomDrawer
          selectedFilePath={editorBuffer.filePath}
          fileSystemService={fileSystemService}
          onContentChange={editorBuffer.updateContent}
          onSave={() => void editorBuffer.saveFile()}
          isDirty={editorBuffer.isDirty}
        />
      </div>

      {/* Agent Activity - 360px */}
      <AgentActivity session={activeSession} />

      {/* Unsaved Changes Dialog */}
      <UnsavedChangesDialog
        isOpen={showUnsavedDialog}
        fileName={pendingFilePath ?? ''}
        errorMessage={saveError}
        onSave={() => {
          void handleSave()
        }}
        onDiscard={() => {
          void handleDiscard()
        }}
        onCancel={handleCancel}
      />

      {/* Drag overlay — prevents iframes/xterm from stealing mouse events */}
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </div>
  )
}

export default WorkspaceView
