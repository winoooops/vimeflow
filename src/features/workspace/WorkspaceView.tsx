import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconRail } from './components/IconRail'
import { Sidebar } from './components/Sidebar'
import { TerminalZone } from './components/TerminalZone'
import BottomDrawer from './components/BottomDrawer'
import { AgentStatusPanel } from '../agent-status/components/AgentStatusPanel'
import { UnsavedChangesDialog } from '../editor/components/UnsavedChangesDialog'
import { InfoBanner } from './components/InfoBanner'
import { CommandPalette } from '../command-palette/CommandPalette'
import { mockNavigationItems, mockSettingsItem } from './data/mockNavigation'
import { useSessionManager } from './hooks/useSessionManager'
import { useResizable } from './hooks/useResizable'
import { useNotifyInfo } from './hooks/useNotifyInfo'
import { createFileSystemService } from '../files/services/fileSystemService'
import { createTerminalService } from '../terminal/services/terminalService'
import { useEditorBuffer } from '../editor/hooks/useEditorBuffer'
import { useAgentStatus } from '../agent-status/hooks/useAgentStatus'
import { useGitStatus } from '../diff/hooks/useGitStatus'
import { buildWorkspaceCommands } from './commands/buildWorkspaceCommands'
import type { ChangedFile, SelectedDiffFile } from '../diff/types'

const SIDEBAR_MIN = 240
const SIDEBAR_MAX = 560
const SIDEBAR_DEFAULT = 340

export const WorkspaceView = (): ReactElement => {
  // Round 4, Finding 1 (codex P1): one terminal service per WorkspaceView
  // instance. Both `useSessionManager` and every `TerminalPane` (via
  // `TerminalZone`) MUST receive the same instance. Under Tauri the factory
  // returns a singleton anyway (singleton-by-IPC-binding), so the only
  // observable change is in the browser/Vite/test workflow where the factory
  // returns a fresh `MockTerminalService` per call. Wrapping in `useMemo`
  // pins the instance for the component's lifetime so re-renders don't
  // produce a fresh mock and silently disconnect the manager from the panes.
  const terminalService = useMemo(() => createTerminalService(), [])

  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createSession,
    removeSession,
    restartSession,
    renameSession,
    reorderSessions,
    updateSessionCwd,
    restoreData,
    loading,
    notifyPaneReady,
  } = useSessionManager(terminalService)

  const { message: infoMessage, notifyInfo, dismiss } = useNotifyInfo()

  // Narrow signature: id+name only. Activity updates (tool calls, file
  // changes) bump `sessions` identity but no command body reads activity,
  // so rebuilding on every PTY data tick is wasted work. Use JSON.stringify
  // (not hand-joined separators) so a name containing `:` or `|` cannot
  // collide with a different session set's signature.
  const sessionsSignature = JSON.stringify(sessions.map((s) => [s.id, s.name]))

  const workspaceCommands = useMemo(
    () =>
      buildWorkspaceCommands({
        sessions,
        activeSessionId,
        createSession,
        removeSession,
        renameSession,
        setActiveSessionId,
        notifyInfo,
      }),
    // sessionsSignature captures every field the closures read; activity-only
    // changes keep the signature stable so the memo (and downstream
    // filteredResults / handler refs) do not churn during agent I/O.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      sessionsSignature,
      activeSessionId,
      createSession,
      removeSession,
      renameSession,
      setActiveSessionId,
      notifyInfo,
    ]
  )

  const agentStatus = useAgentStatus(activeSessionId)

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
  const activeCwd = activeSession?.workingDirectory ?? '.'

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

  // Bottom drawer controlled state
  const [bottomDrawerTab, setBottomDrawerTab] = useState<'editor' | 'diff'>(
    'editor'
  )

  const [selectedDiffFile, setSelectedDiffFile] =
    useState<SelectedDiffFile | null>(null)

  const [isBottomDrawerCollapsed, setIsBottomDrawerCollapsed] = useState(false)

  const gitStatus = useGitStatus(activeCwd, {
    watch: true,
    enabled: agentStatus.isActive || bottomDrawerTab === 'diff',
  })

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

  // Open a test file from the activity panel. Mirrors handleFileSelect's
  // dirty-state guard so clicking a test result row never silently
  // discards unsaved editor changes — the same unsaved-dialog flow
  // (handleSave / handleDiscard / handleCancel) resumes the pending
  // open against pendingFilePathRef once the user picks an action.
  const handleOpenTestFile = useCallback(
    (filePath: string): void => {
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

  // Handle opening a diff file from AgentStatusPanel
  const handleOpenDiff = useCallback(
    (file: ChangedFile): void => {
      setBottomDrawerTab('diff')
      setSelectedDiffFile({
        path: file.path,
        staged: file.staged,
        cwd: activeCwd,
      })
      setIsBottomDrawerCollapsed(false)
    },
    [activeCwd]
  )

  // Belt-and-suspenders: clear selection on cwd change
  useEffect(() => {
    setSelectedDiffFile(null)
  }, [activeCwd])

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
          agentStatus={agentStatus}
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
          restoreData={restoreData}
          loading={loading}
          onPaneReady={notifyPaneReady}
          onSessionRestart={restartSession}
          service={terminalService}
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
          cwd={activeCwd}
          gitStatus={gitStatus}
          activeTab={bottomDrawerTab}
          onTabChange={setBottomDrawerTab}
          isCollapsed={isBottomDrawerCollapsed}
          onCollapsedChange={setIsBottomDrawerCollapsed}
          selectedDiffFile={selectedDiffFile}
          onSelectedDiffFileChange={setSelectedDiffFile}
        />

        {(fileError !== null || infoMessage !== null) && (
          <div className="absolute top-2 left-1/2 z-40 flex w-[calc(100%-1rem)] max-w-2xl -translate-x-1/2 flex-col gap-2">
            {/* File error banner — surfaces failures from direct file open
                (openFileSafely) and vim :w saves (handleVimSave). Rendered at
                the top of the main area so the user always sees what went wrong. */}
            {fileError && (
              <div
                role="alert"
                className="flex items-center gap-3 rounded-lg bg-error/20 px-4 py-2 font-inter text-sm text-error shadow-lg backdrop-blur-sm"
              >
                <span className="flex-1">{fileError}</span>
                <button
                  type="button"
                  aria-label="Dismiss error"
                  onClick={() => {
                    setFileError(null)
                  }}
                  className="text-error transition-colors hover:text-on-surface"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Info banner — surfaces workspace command failures (no active tab,
                invalid goto args, etc.). Stacked below file errors so command
                feedback never obscures file-operation failures. */}
            {infoMessage && (
              <InfoBanner message={infoMessage} onDismiss={dismiss} />
            )}
          </div>
        )}
      </div>

      {/* Agent Status Panel — self-manages width (0↔280px) */}
      <AgentStatusPanel
        agentStatus={agentStatus}
        cwd={activeCwd}
        gitStatus={gitStatus}
        onOpenDiff={handleOpenDiff}
        onOpenFile={handleOpenTestFile}
      />

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

      {/* Command Palette — workspace-scoped command dispatcher */}
      <CommandPalette commands={workspaceCommands} />
    </div>
  )
}

export default WorkspaceView
