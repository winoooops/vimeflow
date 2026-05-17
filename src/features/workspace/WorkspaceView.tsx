import type { CSSProperties, ReactElement } from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { IconRail } from './components/IconRail'
import { Tabs } from '../sessions/components/Tabs'
import { Sidebar } from '../../components/sidebar/Sidebar'
import {
  SidebarTabs,
  type SidebarTabItem,
} from '../../components/sidebar/SidebarTabs'
import { SidebarStatusHeader } from './components/SidebarStatusHeader'
import { FilesView } from './components/FilesView'
import { SessionsView } from './components/SessionsView'
import { StatusBar } from './components/StatusBar'
import { TerminalZone } from './components/TerminalZone'
import { DockPeekButton } from './components/DockPeekButton'
import DockPanel from './components/DockPanel'
import type { DockPosition } from './components/DockSwitcher'
import { AgentStatusPanel } from '../agent-status/components/AgentStatusPanel'
import { UnsavedChangesDialog } from '../editor/components/UnsavedChangesDialog'
import { InfoBanner } from './components/InfoBanner'
import { CommandPalette } from '../command-palette/CommandPalette'
import { mockNavigationItems, mockSettingsItem } from './data/mockNavigation'
import { useSessionManager } from '../sessions/hooks/useSessionManager'
import { clampSize, useResizable } from '../../hooks/useResizable'
import { useSidebarTab, type SidebarTab } from '../../hooks/useSidebarTab'
import { useNotifyInfo } from './hooks/useNotifyInfo'
import { createFileSystemService } from '../files/services/fileSystemService'
import { createTerminalService } from '../terminal/services/terminalService'
import {
  usePaneShortcuts,
  type PaneShortcutModifier,
} from '../terminal/hooks/usePaneShortcuts'
import { useEditorBuffer } from '../editor/hooks/useEditorBuffer'
import { useAgentStatus } from '../agent-status/hooks/useAgentStatus'
import { useGitStatus } from '../diff/hooks/useGitStatus'
import { findActivePane } from '../sessions/utils/activeSessionPane'
import {
  buildWorkspaceCommands,
  WORKSPACE_TAB_KEYS,
} from './commands/buildWorkspaceCommands'
import type { ChangedFile, SelectedDiffFile } from '../diff/types'

const SIDEBAR_MIN = 240
const SIDEBAR_MAX = 560
const SIDEBAR_DEFAULT = 272

const SIDEBAR_INITIAL = clampSize(SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX)

const SIDEBAR_TAB_ITEMS: readonly SidebarTabItem<SidebarTab>[] = [
  { id: 'sessions', label: 'SESSIONS' },
  { id: 'files', label: 'FILES' },
]

type DockTab = 'editor' | 'diff'

export const WorkspaceView = (): ReactElement => {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const sidebarResizeHandleRef = useRef<HTMLDivElement | null>(null)
  // Imperative resize previews keep this ref, the CSS variable, and
  // aria-valuenow in sync without per-frame React commits.
  const sidebarResizeValueRef = useRef<number | null>(null)

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
    updatePaneCwd,
    updatePaneAgentType,
    setSessionActivePane,
    setSessionLayout,
    addPane,
    removePane,
    loading,
    notifyPaneReady,
  } = useSessionManager(terminalService)

  // Detect which modifier the toolbar advertises on this platform so
  // the keyboard shortcut reserves EXACTLY that combo (and no other).
  // macOS shows ⌘ → reserve meta; everything else shows Ctrl →
  // reserve ctrl. Computed once per mount (navigator values are stable
  // for the session) and forwarded to the hook so the visible modifier
  // and the intercepted modifier stay in lockstep.
  const preferModifier = useMemo<PaneShortcutModifier>(() => {
    if (typeof navigator === 'undefined') {
      return 'ctrl'
    }

    const uad = (
      navigator as Navigator & { userAgentData?: { platform?: string } }
    ).userAgentData
    // `navigator.platform` is deprecated per MDN (TS 6385 warning at
    // the read site) but still populated on every shipping target
    // Vimeflow runs on: Tauri's WebKitGTK on Linux, the Tauri WebKit
    // bundle on macOS, and the Chromium-based shells where
    // `userAgentData.platform` exists. `tsc -b` does NOT promote 6385
    // to an error, so the chained read compiles cleanly. If a future
    // Chromium release drops `navigator.platform` entirely, this
    // computation throws — defer the future-proofing until that's a
    // real signal, not a hypothetical (round-20 review chose this
    // trade-off over an eslint-suppression dance).
    const detected = (uad?.platform ?? navigator.platform).toLowerCase()

    return detected.startsWith('mac') ? 'meta' : 'ctrl'
  }, [])

  usePaneShortcuts({
    sessions,
    activeSessionId,
    setSessionActivePane,
    setSessionLayout,
    preferModifier,
  })

  const { message: infoMessage, notifyInfo, dismiss } = useNotifyInfo()
  const { activeTab, setActiveTab } = useSidebarTab()

  // Activity updates (tool calls, file changes) bump `sessions` identity
  // but no command body reads activity, so rebuilding on every PTY data
  // tick is wasted work. Walk the same key list that defines `WorkspaceTab`
  // — adding a key there automatically extends this signature so the memo
  // rebuilds whenever a newly-readable field actually changes. JSON
  // encoding is collision-free regardless of separator characters in names.
  const sessionsSignature = JSON.stringify(
    sessions.map((s) => WORKSPACE_TAB_KEYS.map((k) => s[k]))
  )

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

  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)
    : undefined
  // Non-throwing variant: render-path callers cannot crash on transient
  // invariant violations. Mutation guards still use `getActivePane`.
  const activePane = activeSession ? findActivePane(activeSession) : undefined
  const activePaneId = activePane?.id
  const activePanePtyId = activePane?.ptyId

  const agentStatus = useAgentStatus(activePanePtyId ?? null)

  // Bridge: when the detector resolves a live agent for the active
  // session, write it into Session.agentType. This is the single source
  // of truth — chrome consumers (Tab strip, Header chip, Footer
  // prompt-marker, RestartAffordance) all read agentForSession(session)
  // and follow naturally. AgentStatusPanel is NOT in this set; it reads
  // useAgentStatus directly.
  //
  // Only writes on isActive=true with non-null agentType. isActive=false
  // is ambiguous (tab just activated / EXIT_HOLD window / agent gone but
  // shell alive — detector returns None) so we leave Session.agentType
  // untouched. Once detected, it sticks until PTY exit.
  //
  // Status guard: skip the write when the active session has already
  // exited (status completed/errored). useAgentStatus keeps isActive
  // true for EXIT_HOLD_MS (5s) after the agent process disappears; if
  // the PTY also exits during that window, the reset effect below sets
  // agentType='generic' on the completed session — without this guard
  // a re-render that re-fires the bridge would write the stale agent
  // back, ping-ponging against the reset.
  const activeSessionStatus = activeSession?.status
  useEffect(() => {
    if (!activeSessionId) {
      return
    }
    if (!activePaneId || !activePanePtyId) {
      return
    }
    if (agentStatus.sessionId !== activePanePtyId) {
      return
    }
    if (!agentStatus.isActive || !agentStatus.agentType) {
      return
    }
    if (activeSessionStatus !== 'running' && activeSessionStatus !== 'paused') {
      return
    }
    updatePaneAgentType(activeSessionId, activePaneId, agentStatus.agentType)
  }, [
    activeSessionId,
    activePaneId,
    activePanePtyId,
    activeSessionStatus,
    agentStatus.isActive,
    agentStatus.agentType,
    agentStatus.sessionId,
    updatePaneAgentType,
  ])

  // Reset on PTY exit: when ANY session's status flips to completed or
  // errored, force its agentType back to 'generic'. Watches the whole
  // sessions array so inactive exited sessions also get reset; without
  // this they'd retain the last-detected agent until reactivation.
  // updatePaneAgentType bails early when value is unchanged, so the
  // effect is cheap even though it fires on every sessions array change.
  useEffect(() => {
    for (const session of sessions) {
      if (session.status !== 'completed' && session.status !== 'errored') {
        continue
      }
      // Effect-path: skip silently on transient invariant violations
      // rather than crashing React's reconciliation. Mutation guards still
      // catch real bugs via `getActivePane`.
      const pane = findActivePane(session)
      if (!pane || pane.agentType === 'generic') {
        continue
      }
      updatePaneAgentType(session.id, pane.id, 'generic')
    }
  }, [sessions, updatePaneAgentType])

  const setSidebarResizeHandle = useCallback(
    (element: HTMLDivElement | null): void => {
      sidebarResizeHandleRef.current = element
      element?.setAttribute(
        'aria-valuenow',
        String(sidebarResizeValueRef.current ?? SIDEBAR_INITIAL)
      )
    },
    []
  )

  const previewSidebarWidth = useCallback((nextWidth: number): void => {
    const workspaceElement = workspaceRef.current
    if (!workspaceElement) {
      return
    }

    const nextCssWidth = `${nextWidth}px`
    if (sidebarResizeValueRef.current === nextWidth) {
      return
    }

    workspaceElement.style.setProperty(
      '--workspace-sidebar-width',
      nextCssWidth
    )
    sidebarResizeValueRef.current = nextWidth

    const resizeHandle = sidebarResizeHandleRef.current

    if (!resizeHandle) {
      return
    }

    resizeHandle.setAttribute('aria-valuenow', String(nextWidth))
  }, [])

  const {
    size: sidebarWidth,
    isDragging,
    handleMouseDown,
  } = useResizable({
    initial: SIDEBAR_DEFAULT,
    min: SIDEBAR_MIN,
    max: SIDEBAR_MAX,
    updateMode: 'commit-on-end',
    onDragPreview: previewSidebarWidth,
  })

  useLayoutEffect(() => {
    previewSidebarWidth(sidebarWidth)
  }, [previewSidebarWidth, sidebarWidth])

  const activeCwd = activePane?.cwd ?? '.'
  // Distinct fallback for the FILES-tab file explorer: when no session
  // is active, browse from `~` (home) rather than `.` (process cwd).
  // `activeCwd` defaults to `.` because git/diff/agent-status all need a
  // valid working directory in the running process; the file explorer
  // is a navigation surface where `~` is the more useful starting point.
  const fileExplorerCwd = activePane?.cwd ?? '~'

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

  // Dock panel controlled state.
  const [dockPosition, setDockPosition] = useState<DockPosition>('bottom')
  const [isDockOpen, setIsDockOpen] = useState(true)
  const [dockTab, setDockTab] = useState<DockTab>('editor')

  // Vertical dock height is lifted so the value survives DockPanel unmounts.
  const verticalDockResize = useResizable({
    initial: 400,
    min: 150,
    max: 640,
    direction: 'vertical',
    // Bottom dock grows when dragging up from its top edge; top dock grows
    // when dragging down from its bottom edge.
    invert: dockPosition === 'bottom',
  })

  const [selectedDiffFile, setSelectedDiffFile] =
    useState<SelectedDiffFile | null>(null)

  const gitStatus = useGitStatus(activeCwd, {
    watch: true,
    enabled: agentStatus.isActive || (isDockOpen && dockTab === 'diff'),
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
      setDockTab('diff')
      setSelectedDiffFile({
        path: file.path,
        staged: file.staged,
        cwd: activeCwd,
      })
      setIsDockOpen(true)
    },
    [activeCwd]
  )

  // Belt-and-suspenders: clear selection on cwd change
  useEffect(() => {
    setSelectedDiffFile(null)
  }, [activeCwd])

  const dockCanvasFlexDirection: CSSProperties['flexDirection'] =
    dockPosition === 'top' || dockPosition === 'bottom' ? 'column' : 'row'

  const dockBeforeTerminal = dockPosition === 'top' || dockPosition === 'left'
  const terminalFitDeferred = isDragging || verticalDockResize.isDragging

  const dockOrPeek = isDockOpen ? (
    <DockPanel
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
      tab={dockTab}
      onTabChange={setDockTab}
      position={dockPosition}
      onPositionChange={setDockPosition}
      onClose={() => setIsDockOpen(false)}
      verticalSize={verticalDockResize.size}
      onVerticalResizeMouseDown={verticalDockResize.handleMouseDown}
      isVerticalResizing={verticalDockResize.isDragging}
      onVerticalSizeAdjust={verticalDockResize.adjustBy}
      selectedDiffFile={selectedDiffFile}
      onSelectedDiffFileChange={setSelectedDiffFile}
    />
  ) : (
    <DockPeekButton
      position={dockPosition}
      onOpen={() => {
        setIsDockOpen(true)
      }}
    />
  )

  return (
    <div
      ref={workspaceRef}
      data-testid="workspace-view"
      // `grid-rows-1` pins the implicit row to `1fr`; without it
      // `grid-auto-rows: auto` lets the row grow to content size and
      // `h-full` stops propagating the 100vh constraint downward.
      className="grid h-screen grid-rows-1 overflow-hidden"
      style={
        {
          // `--workspace-sidebar-width` is owned by previewSidebarWidth so
          // React rerenders cannot overwrite an in-progress drag preview.
          gridTemplateColumns: `48px var(--workspace-sidebar-width, ${SIDEBAR_INITIAL}px) 1fr auto`,
        } as CSSProperties
      }
    >
      <IconRail items={mockNavigationItems} settingsItem={mockSettingsItem} />

      {/* Sidebar - resizable */}
      <div className="relative flex h-full">
        <Sidebar
          header={
            <SidebarStatusHeader
              status={agentStatus}
              activeSessionName={activeSession?.name ?? null}
            />
          }
          content={
            <div className="flex h-full min-h-0 flex-col">
              <SidebarTabs<SidebarTab>
                tabs={SIDEBAR_TAB_ITEMS}
                activeId={activeTab}
                onChange={setActiveTab}
              />
              <SessionsView
                hidden={activeTab !== 'sessions'}
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSessionClick={setActiveSessionId}
                onCreateSession={createSession}
                onRemoveSession={removeSession}
                onRenameSession={renameSession}
                onReorderSessions={reorderSessions}
              />
              <FilesView
                hidden={activeTab !== 'files'}
                cwd={fileExplorerCwd}
                onFileSelect={handleFileSelect}
              />
            </div>
          }
        />

        {/* Resize handle */}
        <div
          ref={setSidebarResizeHandle}
          data-testid="sidebar-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          // aria-valuenow is set by the layout effect and drag preview path
          // so previews do not need per-frame React state commits.
          onMouseDown={handleMouseDown}
          className={`
            absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize
            transition-colors hover:bg-primary/50
            ${isDragging ? 'bg-primary/70' : 'bg-transparent'}
          `}
        />
      </div>

      {/* Main workspace area - TerminalZone + DockPanel.
          `relative` establishes a containing block so the fileError
          banner's `absolute` positioning is scoped to this column
          rather than climbing to the viewport. */}
      <div className="relative flex flex-col overflow-hidden">
        <Tabs
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={setActiveSessionId}
          onClose={removeSession}
          onNew={createSession}
        />

        <div
          data-testid="dock-canvas-wrapper"
          className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
          style={{ flexDirection: dockCanvasFlexDirection }}
        >
          {dockBeforeTerminal ? dockOrPeek : null}
          <div
            data-testid="terminal-zone-wrapper"
            className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            <TerminalZone
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSessionCwdChange={updatePaneCwd}
              deferTerminalFit={terminalFitDeferred}
              loading={loading}
              onPaneReady={notifyPaneReady}
              onSessionRestart={restartSession}
              service={terminalService}
              setSessionActivePane={setSessionActivePane}
              setSessionLayout={setSessionLayout}
              addPane={addPane}
              removePane={removePane}
              modKey={preferModifier === 'meta' ? '⌘' : 'Ctrl'}
            />
          </div>
          {!dockBeforeTerminal ? dockOrPeek : null}
        </div>

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

        <StatusBar />
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
