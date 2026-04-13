import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconRail } from './components/IconRail'
import { Sidebar } from './components/Sidebar'
import { TerminalZone } from './components/TerminalZone'
import BottomDrawer from './components/BottomDrawer'
import { AgentStatusPanel } from '../agent-status/components/AgentStatusPanel'
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

  // Live mirror of `pendingFilePath`. `handleSave` reads this AFTER its
  // saveFile() await so a Cancel/backdrop click during the in-flight
  // save is honoured — handleSave bails instead of opening the pending
  // file against the user's explicit cancellation.
  //
  // CRITICAL: handlers that clear pendingFilePath MUST also write the
  // ref synchronously (via `setPendingFilePathSynced`). The useEffect
  // mirror below is a safety net for initial-value sync, but useEffect
  // runs as a PAINT-time callback — it fires *after* the microtask
  // queue drains. When handleSave's save IPC resolves as a microtask
  // and resumes, the effect hasn't run yet, so a stale ref would be
  // read and the handler would open the cancelled pending file.
  const pendingFilePathRef = useRef<string | null>(null)
  useEffect(() => {
    pendingFilePathRef.current = pendingFilePath
  }, [pendingFilePath])

  const setPendingFilePathSynced = useCallback((value: string | null): void => {
    pendingFilePathRef.current = value
    setPendingFilePath(value)
  }, [])
  // General-purpose error banner for non-dialog file ops (direct file open,
  // async load failure inside CodeEditor, vim :w save failure).
  const [fileError, setFileError] = useState<string | null>(null)

  // Open a file directly (no unsaved-changes guard). Errors were previously
  // swallowed via `void editorBuffer.openFile(...)`, leaving the user with
  // stale content and no feedback on Tauri IPC failures.
  const openFileSafely = useCallback(
    async (filePath: string): Promise<void> => {
      try {
        await editorBuffer.openFile(filePath)
        setFileError(null)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        setFileError(`Failed to open ${filePath}: ${message}`)
      }
    },
    [editorBuffer]
  )

  // Save via vim :w or any direct editor save trigger. Same rationale as
  // openFileSafely — errors were previously swallowed and the user had no
  // indication that a disk-full / permission-denied error occurred.
  const handleVimSave = useCallback(async (): Promise<void> => {
    try {
      await editorBuffer.saveFile()
      setFileError(null)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      setFileError(`Failed to save: ${message}`)
    }
  }, [editorBuffer])

  // Handle file selection from FileExplorer. Memoized so its identity
  // is stable across the 4-level prop chain (WorkspaceView → Sidebar →
  // FileExplorer → FileTree → FileTreeNode). Matches the useCallback
  // pattern used by every other handler in this file and protects any
  // future React.memo of the intermediate components from being
  // invalidated on every keystroke.
  const handleFileSelect = useCallback(
    (node: { id: string; type: 'file' | 'folder' }): void => {
      if (node.type !== 'file') {
        return
      }

      const filePath = node.id

      // If current file has unsaved changes, show dialog
      if (editorBuffer.isDirty) {
        setPendingFilePathSynced(filePath)
        setShowUnsavedDialog(true)

        return
      }

      void openFileSafely(filePath)
    },
    [editorBuffer.isDirty, openFileSafely, setPendingFilePathSynced]
  )

  // Save current file and open pending file.
  //
  // Use TWO separate try/catch blocks so save-failure and open-failure
  // emit accurate messages. Previously a single try/catch reported a
  // successful save followed by a failed pending-file open as
  // "Failed to save: ...", misleading the user into thinking their
  // edits were lost when they were actually on disk.
  //
  // Memoized with useCallback for consistency with the rest of the
  // handler family. Note: `editorBuffer` is a plain object rebuilt on
  // every `useEditorBuffer` render (which happens on every keystroke
  // since `currentContent` is state), so this callback's identity IS
  // unstable across keystrokes. That's currently harmless because the
  // dialog captures focus while open — the user can't type in the
  // editor to trigger a re-render of WorkspaceView. If `useEditorBuffer`
  // is later refactored to return stable callbacks (e.g. via useMemo
  // on the return object), destructure { saveFile, openFile } into the
  // deps here to lock the handler identity.
  const handleSave = useCallback(async (): Promise<void> => {
    try {
      await editorBuffer.saveFile()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      setSaveError(`Failed to save: ${message}`)

      // Keep the dialog open so the user can retry or cancel — the file
      // is still dirty and we haven't switched away.
      return
    }

    // Read the pending-file path FROM THE REF after the save completes.
    // If the user clicked the backdrop or pressed Escape during the
    // save IPC, `handleCancel` cleared `pendingFilePath` to null and
    // the ref reflects that. Reading the closure variable (or a
    // capture-before-await constant) would see the stale snapshot and
    // open the cancelled pending file anyway.
    const currentPendingPath = pendingFilePathRef.current

    // Current buffer is clean on disk. The dialog's job of guarding
    // the switch is done — surface any pending-open failure via the
    // workspace-level banner instead of leaving the dialog stuck
    // with a misleading "Failed to save" message.
    setShowUnsavedDialog(false)
    setPendingFilePathSynced(null)
    setSaveError(null)

    if (currentPendingPath) {
      try {
        await editorBuffer.openFile(currentPendingPath)
        setFileError(null)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        setFileError(
          `Saved current file. Could not open ${currentPendingPath}: ${message}`
        )
      }
    }
  }, [editorBuffer, setPendingFilePathSynced])

  // Discard changes and open pending file.
  //
  // Close the dialog SYNCHRONOUSLY before the async openFile call.
  // Previously we awaited openFile first and closed the dialog
  // afterward, but React 18's scheduler can flush the setState calls
  // inside openFile (setFilePath / setCurrentContent) as a separate
  // render before the dialog-close batch — briefly rendering the
  // dialog as "{newFile} has unsaved changes", which is factually
  // wrong and could trick the user into a confirmation action on
  // the wrong file. Closing the dialog up front removes the window.
  const handleDiscard = useCallback(async (): Promise<void> => {
    const target = pendingFilePathRef.current
    setShowUnsavedDialog(false)
    setPendingFilePathSynced(null)
    setSaveError(null)

    if (!target) {
      return
    }

    try {
      await editorBuffer.openFile(target)
      setFileError(null)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      setFileError(`Failed to open file: ${message}`)
    }
  }, [editorBuffer, setPendingFilePathSynced])

  // Cancel and stay on current file.
  //
  // CRITICAL: writes `pendingFilePathRef.current = null` synchronously
  // via `setPendingFilePathSynced` so a concurrently-running `handleSave`
  // awaiting saveFile() sees the cleared ref as soon as its microtask
  // resumes. Without this, the useEffect-based ref mirror would only
  // update on the next paint — after handleSave had already read the
  // stale non-null value and opened the cancelled pending file.
  const handleCancel = useCallback((): void => {
    setShowUnsavedDialog(false)
    setPendingFilePathSynced(null)
    setSaveError(null)
  }, [setPendingFilePathSynced])

  return (
    <div
      data-testid="workspace-view"
      className="grid h-screen overflow-hidden"
      style={{
        gridTemplateColumns: `64px ${sidebarWidth}px 1fr auto`,
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

      {/* Main workspace area - TerminalZone + BottomDrawer.
          `relative` establishes a containing block so the fileError
          banner's `absolute` positioning is scoped to this column
          rather than climbing to the viewport. */}
      <div className="relative flex flex-col overflow-hidden">
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
          content={editorBuffer.currentContent}
          onContentChange={editorBuffer.updateContent}
          onSave={() => {
            void handleVimSave()
          }}
          isDirty={editorBuffer.isDirty}
          isLoading={editorBuffer.isLoading}
          cwd={activeSession?.workingDirectory ?? '.'}
        />

        {/* File error banner — surfaces failures from direct file open
            (openFileSafely) and vim :w saves (handleVimSave). Rendered at
            the top of the main area so the user always sees what went wrong. */}
        {fileError && (
          <div
            role="alert"
            className="absolute top-2 left-1/2 -translate-x-1/2 z-40 max-w-2xl px-4 py-2 rounded-lg bg-error/20 border border-error/40 text-sm text-error font-inter backdrop-blur-sm flex items-center gap-3 shadow-lg"
          >
            <span className="flex-1">{fileError}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => {
                setFileError(null)
              }}
              className="text-error hover:text-on-surface transition-colors"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Agent Status Panel — self-manages width (0↔280px) */}
      <AgentStatusPanel sessionId={activeSessionId} />

      {/* Unsaved Changes Dialog — shows the CURRENTLY dirty file, not the
          destination the user is switching to. */}
      <UnsavedChangesDialog
        isOpen={showUnsavedDialog}
        fileName={editorBuffer.filePath ?? ''}
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
