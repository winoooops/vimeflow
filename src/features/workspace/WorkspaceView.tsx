// cspell:ignore worktree
import type { CSSProperties, ReactElement } from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { SidebarToggle } from './components/SidebarToggle'
import { SidebarTopBar } from './components/SidebarTopBar'
import { Tabs } from '../sessions/components/Tabs'
import { Sidebar } from '../../components/sidebar/Sidebar'
import {
  SidebarTabs,
  type SidebarTabItem,
} from '../../components/sidebar/SidebarTabs'
import { StatusBar, type StatusBarSession } from '../../components/StatusBar'
import {
  AgentStatusCard,
  type AgentCardState,
} from './components/AgentStatusCard'
import { FilesView } from './components/FilesView'
import { NewSessionButton } from './components/NewSessionButton'
import { SessionsView } from './components/SessionsView'
import {
  TerminalZone,
  type TerminalZoneHandle,
} from './components/TerminalZone'
import { DockPeekButton } from './components/DockPeekButton'
import DockPanel, { type DockPanelHandle } from './components/DockPanel'
import type { DockPosition } from './components/DockSwitcher'
import {
  AgentStatusPanel,
  PANEL_WIDTH_PX,
} from '../agent-status/components/AgentStatusPanel'
import {
  AgentStatusRail,
  RAIL_WIDTH_PX,
} from '../agent-status/components/AgentStatusRail'
import { cacheHitRate } from '../agent-status/utils/cacheRate'
import type { CurrentUsageState, RateLimitsState } from '../agent-status/types'
import { UnsavedChangesDialog } from '../editor/components/UnsavedChangesDialog'
import { InfoBanner } from './components/InfoBanner'
import { CommandPalette } from '../command-palette/CommandPalette'
import {
  COMMAND_PALETTE_SHORTCUT_KEYS,
  useCommandPalette,
} from '../command-palette/hooks/useCommandPalette'
import {
  usePaneRenameChord,
  type FocusedPaneRef,
} from '../command-palette/hooks/usePaneRenameChord'
import { formatShortcut } from '../../lib/formatShortcut'
import { renameAgentSession } from '../../lib/backend'
import { useSessionManager } from '../sessions/hooks/useSessionManager'
import {
  clampSize,
  useResizable,
  type ResizeDragEndEvent,
} from '../../hooks/useResizable'
import { useElasticContainer } from '../../hooks/useElasticContainer'
import { useSidebarTab, type SidebarTab } from '../../hooks/useSidebarTab'
import { useNotifyInfo } from './hooks/useNotifyInfo'
import { createFileSystemService } from '../files/services/fileSystemService'
import { createTerminalService } from '../terminal/services/terminalService'
import {
  usePaneShortcuts,
  type PaneShortcutModifier,
} from '../terminal/hooks/usePaneShortcuts'
import { useDockShortcuts } from './hooks/useDockShortcuts'
import { useSidebarShortcut } from './hooks/useSidebarShortcut'
import { useNewSessionShortcut } from './hooks/useNewSessionShortcut'
import { useSidebarCollapsed } from './hooks/useSidebarCollapsed'
import { useEditorBuffer } from '../editor/hooks/useEditorBuffer'
import { useAgentStatus } from '../agent-status/hooks/useAgentStatus'
import { useGitStatus } from '../diff/hooks/useGitStatus'
import type { PaneCandidate } from '../diff/services/activePanePicker'
import { sumLines } from '../diff/utils/sumLines'
import { findActivePane } from '../sessions/utils/activeSessionPane'
import { isShellPane } from '../sessions/utils/paneKind'
import { lineDelta } from '../sessions/utils/lineDelta'
import { hasLivePane, isLiveStatus } from '../sessions/utils/sessionStatus'
import { pickNextVisibleSessionId } from '../sessions/utils/pickNextVisibleSessionId'
import { AGENTS, agentTypeToRegistryKey } from '../../agents/registry'
import type { SessionCloseResult, SessionStatus } from '../sessions/types'
import {
  buildWorkspaceCommands,
  WORKSPACE_TAB_KEYS,
} from './commands/buildWorkspaceCommands'
import type { ChangedFile, SelectedDiffFile } from '../diff/types'
import {
  DOCK_CONTAINER_ID,
  TERMINAL_CONTAINER_ID,
  type FocusTarget,
} from './containerIds'
import {
  DOCK_VERTICAL_ELASTIC_CONFIG,
  DOCK_HORIZONTAL_ELASTIC_CONFIG,
} from './panelConfig'

const cacheHitPercentage = (
  usage: CurrentUsageState | null | undefined
): number | null => {
  const rate = cacheHitRate(usage)

  return rate === null ? null : Math.round(rate * 100)
}

const rateLimitPercentage = (
  limit: RateLimitsState['fiveHour'] | null | undefined
): number | null => {
  if (!limit || !Number.isFinite(limit.usedPercentage)) {
    return null
  }

  if (
    limit.usedPercentage === 0 &&
    (!Number.isFinite(limit.resetsAt) || limit.resetsAt <= 0)
  ) {
    return null
  }

  return Math.round(limit.usedPercentage)
}

const formatStatusDuration = (durationMs: number): string | undefined => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return undefined
  }

  const totalMinutes = Math.floor(durationMs / 60_000)

  // 0 < durationMs < 60s: show "<1m" rather than hiding the segment, so a
  // freshly started agent still gets an elapsed-time indicator instead of a
  // blank bar for its first minute. (durationMs <= 0 returned undefined
  // above — that is "no data yet", semantically distinct from "<1m".)
  if (totalMinutes <= 0) {
    return '<1m'
  }

  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) {
    return `${days}d ${hours.toString().padStart(2, '0')}h`
  }

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`
  }

  return `${minutes}m`
}

// Follow-up tracked at https://github.com/winoooops/vimeflow/issues/252
// (Settings dialog — Zed-style modal with 14 categories). Remove
// this const and the gear's `aria-disabled` once the dialog lands.
const SETTINGS_FOLLOWUP_ISSUE_NUMBER = 252

const SIDEBAR_DEFAULT = 272
const SIDEBAR_MIN = SIDEBAR_DEFAULT
const SIDEBAR_MAX = 520
const MAIN_AUTO_COLLAPSE_MIN = 360
const MAIN_AUTO_COLLAPSE_MAX = 500
const MAIN_AUTO_COLLAPSE_RATIO = 0.36
const SIDEBAR_MOTION_MS = 220
const SIDEBAR_MOTION_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'

const SIDEBAR_INITIAL = clampSize(SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX)
const COMPACT_WORKSPACE_QUERY = '(max-width: 899px)'

const readCompactViewport = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(COMPACT_WORKSPACE_QUERY).matches

const SIDEBAR_TAB_ITEMS: readonly SidebarTabItem<SidebarTab>[] = [
  { id: 'sessions', label: 'SESSIONS', icon: 'view_agenda' },
  { id: 'files', label: 'FILES', icon: 'folder_open' },
]

const mainAutoCollapseThreshold = (workspaceWidth: number): number =>
  clampSize(
    Math.round(workspaceWidth * MAIN_AUTO_COLLAPSE_RATIO),
    MAIN_AUTO_COLLAPSE_MIN,
    MAIN_AUTO_COLLAPSE_MAX
  )

type DockTab = 'editor' | 'diff'

export const WorkspaceView = (): ReactElement => {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const mainWorkspaceRef = useRef<HTMLDivElement>(null)
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
    setPaneUserLabel,
    reorderSessions,
    updatePaneCwd,
    updatePaneAgentType,
    updateBrowserPaneUrl,
    setSessionActivityPanelCollapsed,
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

  const sidebarShortcutHint = preferModifier === 'meta' ? '⌘B' : 'Ctrl+⇧B'
  const newSessionShortcutHint = preferModifier === 'meta' ? '⌘N' : 'Ctrl+⇧N'

  const newSessionAriaKeyshortcuts =
    preferModifier === 'meta' ? 'Meta+N' : 'Control+Shift+N'
  // Real command-palette chord for the top-bar utility hint (Ctrl+; / ⌘;),
  // not the ⌘K placeholder in the static design mock.
  const commandShortcutHint = formatShortcut(COMMAND_PALETTE_SHORTCUT_KEYS)

  const { message: infoMessage, notifyInfo, dismiss } = useNotifyInfo()
  const { activeTab, setActiveTab } = useSidebarTab()

  // VIM-66 / VIM-76: workspace-global sidebar collapse flag. The collapse toggle
  // lives in the sidebar top bar when open and in the session-tab bar's leading
  // slot when collapsed — both in-flow at the same {12,5} box. The sidebar is
  // hidden instantly (no drawer slide), so there is no transition window where
  // the toggle floats or a tab slips under it.
  const {
    collapsed: sidebarCollapsed,
    toggle: toggleSidebar,
    setCollapsed: setSidebarCollapsed,
  } = useSidebarCollapsed()

  const [isCompactViewport, setIsCompactViewport] =
    useState(readCompactViewport)
  const [compactSidebarOpen, setCompactSidebarOpen] = useState(false)

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return
    }

    const mediaQuery = window.matchMedia(COMPACT_WORKSPACE_QUERY)

    const applyViewport = (): void => {
      setIsCompactViewport(mediaQuery.matches)
    }

    applyViewport()
    mediaQuery.addEventListener('change', applyViewport)

    return (): void => {
      mediaQuery.removeEventListener('change', applyViewport)
    }
  }, [])

  // Imperative refs to the two SidebarToggle instances so the post-toggle focus
  // guard can refocus the visible one without relying on data-testid selectors.
  const sidebarToggleTopbarRef = useRef<HTMLButtonElement>(null)
  const sidebarToggleTabsRef = useRef<HTMLButtonElement>(null)
  const shouldRestoreSidebarToggleFocusRef = useRef(false)

  useEffect(() => {
    if (!isCompactViewport) {
      setCompactSidebarOpen(false)
    }
  }, [isCompactViewport])

  useEffect(() => {
    if (!isCompactViewport || !compactSidebarOpen) {
      return
    }

    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      shouldRestoreSidebarToggleFocusRef.current = true
      setCompactSidebarOpen(false)
    }

    document.addEventListener('keydown', closeOnEscape)

    return (): void => {
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [compactSidebarOpen, isCompactViewport])

  const isSidebarClosed = isCompactViewport
    ? !compactSidebarOpen
    : sidebarCollapsed

  const handleToggleSidebar = useCallback((): void => {
    const activeElement =
      typeof document === 'undefined' ? null : document.activeElement

    const isToggleButtonFocused =
      activeElement === sidebarToggleTopbarRef.current ||
      activeElement === sidebarToggleTabsRef.current

    if (isCompactViewport) {
      // When opening the compact sidebar from a non-toggle element (e.g. via
      // keyboard shortcut from terminal/editor), force focus restoration so
      // the focus guard moves focus into the newly opened modal drawer.
      shouldRestoreSidebarToggleFocusRef.current =
        isToggleButtonFocused || !compactSidebarOpen
      setCompactSidebarOpen((open) => !open)

      return
    }

    shouldRestoreSidebarToggleFocusRef.current = isToggleButtonFocused
    toggleSidebar()
  }, [isCompactViewport, toggleSidebar, compactSidebarOpen])

  // Post-toggle focus guard: collapse/expand removes the active toggle from the
  // tab order (open toggle's shell goes inert; collapsed toggle's slot unmounts),
  // dropping focus to <body>. Refocus the now-visible toggle only when the user
  // actually toggled from one of the toggle buttons. Plain viewport changes
  // during first app launch must not programmatically focus the toggle and show
  // a sticky ring.
  const sidebarFocusGuardMountedRef = useRef(false)
  useEffect(() => {
    if (!sidebarFocusGuardMountedRef.current) {
      sidebarFocusGuardMountedRef.current = true

      return
    }
    if (!shouldRestoreSidebarToggleFocusRef.current) {
      return
    }
    if (typeof requestAnimationFrame !== 'function') {
      shouldRestoreSidebarToggleFocusRef.current = false

      return
    }

    const frame = requestAnimationFrame((): void => {
      shouldRestoreSidebarToggleFocusRef.current = false
      const active = document.activeElement
      if (!active || active === document.body) {
        const target = isSidebarClosed
          ? sidebarToggleTabsRef.current
          : sidebarToggleTopbarRef.current
        target?.focus()
      }
    })

    return (): void => {
      cancelAnimationFrame(frame)
    }
  }, [isSidebarClosed])

  const paneRenameRequestIdRef = useRef(0)

  const nextPaneRenameRequestId = useCallback((): number => {
    paneRenameRequestIdRef.current += 1

    return paneRenameRequestIdRef.current
  }, [])

  const isCurrentPaneRenameRequest = useCallback(
    (requestId: number): boolean =>
      requestId === paneRenameRequestIdRef.current,
    []
  )

  // Activity updates (tool calls, file changes) bump `sessions` identity
  // but no command body reads activity, so rebuilding on every PTY data
  // tick is wasted work. Walk the same key list that defines `WorkspaceTab`
  // — adding a key there automatically extends this signature so the memo
  // rebuilds whenever a newly-readable field actually changes. JSON
  // encoding is collision-free regardless of separator characters in names.
  const sessionsSignature = JSON.stringify(
    sessions.map((s) => WORKSPACE_TAB_KEYS.map((k) => s[k]))
  )

  // `activePane` is declared further down (after `activeSession`); resolve
  // the active pane's ptyId inline here so the command builder has it without
  // forcing a section-wide reshuffle.
  const activeSessionForCommands =
    sessions.find((s) => s.id === activeSessionId) ?? null

  const activePaneForCommandInputs = activeSessionForCommands
    ? (findActivePane(activeSessionForCommands) ?? null)
    : null

  const activePaneForCommandsIsShell =
    (activePaneForCommandInputs?.kind ?? 'shell') === 'shell'

  const activePanePtyIdForCommands = activePaneForCommandsIsShell
    ? (activePaneForCommandInputs?.ptyId ?? null)
    : null

  const activePaneAgentTypeForCommands = activePaneForCommandsIsShell
    ? (activePaneForCommandInputs?.agentType ?? null)
    : null

  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)
    : undefined
  // Non-throwing variant: render-path callers cannot crash on transient
  // invariant violations. Mutation guards still use `getActivePane`.
  const activePane = activeSession ? findActivePane(activeSession) : undefined

  const activePtyBackedPane =
    activePane === undefined
      ? undefined
      : (activePane.kind ?? 'shell') === 'shell'
        ? activePane
        : // Active pane is a browser: prefer a live shell so agent/cwd/status
          // state does not bind to an exited PTY when another shell is running.
          (activeSession?.panes.find(
            (pane) => isShellPane(pane) && isLiveStatus(pane.status)
          ) ?? activeSession?.panes.find(isShellPane))

  const activePtyBackedPaneId = activePtyBackedPane?.id
  const activePtyBackedPanePtyId = activePtyBackedPane?.ptyId

  const agentStatus = useAgentStatus(activePtyBackedPanePtyId ?? null)
  const activityPanelCollapsed = activeSession?.activityPanelCollapsed ?? false

  const activityPanelAgent = useMemo(
    () => AGENTS[agentTypeToRegistryKey(agentStatus.agentType)],
    [agentStatus.agentType]
  )

  // Source the header status from the active pane's lifecycle, not from the
  // agent's `isActive` flag. After a PTY exits, `agentStatus.isActive` flips
  // to false and the `running` → `paused` ternary would silently mislabel
  // terminal states (`completed`, `errored`) as paused, complete with a
  // pulsing dot. The pane's own `status` is the source of truth for
  // running/paused/completed/errored — agent activity stays an orthogonal
  // signal that the "live" pulse next to the agent chip already reflects.
  const activityPanelStatus: SessionStatus =
    activePtyBackedPane?.status ?? 'idle'

  const handleActivityPanelCollapsed = useCallback(
    (collapsed: boolean): void => {
      if (!activeSessionId) {
        return
      }
      setSessionActivityPanelCollapsed(activeSessionId, collapsed)
    },
    [activeSessionId, setSessionActivityPanelCollapsed]
  )

  // Bridge: keep pane chrome in sync with agent detection for the active
  // pane. Live detections stamp the agent identity; an explicit
  // agentExited signal means useAgentStatus previously detected an agent
  // and then confirmed it exited while the PTY stayed alive, so the pane
  // should return to shell chrome even if the activity panel is still in
  // its exit-hold window.
  //
  // Status guard: skip writes when the active session has already exited
  // (status completed/errored). The PTY-exit reset effect below owns that
  // path; without this guard, a delayed status update could re-stamp stale
  // agent chrome onto a completed session.
  // Pane-level, not the errored-dominant aggregate: a crashed sibling pane
  // must not short-circuit the active pane's agent/cwd bridges.
  const isActivePaneLive =
    activePtyBackedPane !== undefined &&
    isLiveStatus(activePtyBackedPane.status)

  const isStatusBarAgentActive =
    activePtyBackedPanePtyId !== undefined &&
    agentStatus.sessionId === activePtyBackedPanePtyId &&
    agentStatus.isActive &&
    !agentStatus.agentExited &&
    isActivePaneLive

  useEffect(() => {
    if (!activeSessionId) {
      return
    }
    if (!activePtyBackedPaneId || !activePtyBackedPanePtyId) {
      return
    }
    if (agentStatus.sessionId !== activePtyBackedPanePtyId) {
      return
    }
    if (!isActivePaneLive) {
      return
    }

    if (agentStatus.agentExited) {
      updatePaneAgentType(activeSessionId, activePtyBackedPaneId, 'generic')

      return
    }

    if (agentStatus.isActive) {
      if (agentStatus.agentType) {
        updatePaneAgentType(
          activeSessionId,
          activePtyBackedPaneId,
          agentStatus.agentType
        )
      }

      return
    }
  }, [
    activeSessionId,
    activePtyBackedPaneId,
    activePtyBackedPanePtyId,
    isActivePaneLive,
    agentStatus.agentExited,
    agentStatus.isActive,
    agentStatus.agentType,
    agentStatus.sessionId,
    updatePaneAgentType,
  ])

  // Mirror the agent's structured cwd into pane.cwd. Both adapters expose
  // an `agent-cwd` event on transitions; the sources differ:
  //  - Claude Code stamps `cwd` on every transcript JSONL entry, so
  //    transitions surface as soon as the next line is parsed.
  //  - Codex stamps cwd in session_meta.payload.cwd (session start) and
  //    response_item.payload.arguments.workdir for exec_command function
  //    calls (mid-session). turn_context.cwd is intentionally ignored
  //    by the backend — pinned to session-start and would cause false
  //    reverts.
  // Tool-call-driven moves like Claude's built-in `EnterWorktree` and
  // codex's "switch to worktree" navigation do NOT change the interactive
  // shell's $PWD, so neither OSC 7 nor PTY text patterns catch them —
  // this bridge is what makes the worktree chip + git branch follow
  // agent-driven worktree switches.
  //
  // Guards (Codex review on PR #239): scope to the active pane's session;
  // skip exited sessions; require the agent to be currently active so a
  // post-exit `agentStatus.cwd` (the field is retained when an agent
  // exits — only `isActive` / `agentExited` flip) cannot overwrite a
  // shell-driven `pane.cwd` change; dedupe against pane.cwd to avoid IPC
  // churn.
  const activePtyBackedPaneCwd = activePtyBackedPane?.cwd
  const agentCwd = agentStatus.cwd
  const agentIsActive = agentStatus.isActive
  const agentHasExited = agentStatus.agentExited
  useEffect(() => {
    if (
      !activeSessionId ||
      !activePtyBackedPaneId ||
      !activePtyBackedPanePtyId
    ) {
      return
    }
    if (agentStatus.sessionId !== activePtyBackedPanePtyId) {
      return
    }
    if (!isActivePaneLive) {
      return
    }
    if (!agentIsActive || agentHasExited) {
      return
    }
    if (!agentCwd || agentCwd === activePtyBackedPaneCwd) {
      return
    }

    updatePaneCwd(activeSessionId, activePtyBackedPaneId, agentCwd)
  }, [
    activeSessionId,
    activePtyBackedPaneId,
    activePtyBackedPanePtyId,
    activePtyBackedPaneCwd,
    isActivePaneLive,
    agentCwd,
    agentHasExited,
    agentIsActive,
    agentStatus.sessionId,
    updatePaneCwd,
  ])

  // Reset on PTY exit: when ANY session's status flips to completed or
  // errored, force its agentType back to 'generic'. Watches the whole
  // sessions array so inactive exited sessions also get reset; without
  // this they'd retain the last-detected agent until reactivation.
  // updatePaneAgentType bails early when value is unchanged, so the
  // effect is cheap even though it fires on every sessions array change.
  useEffect(() => {
    for (const session of sessions) {
      if (hasLivePane(session.panes)) {
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

  const handleSidebarDragEnd = useCallback(
    ({ rawSize }: ResizeDragEndEvent): void => {
      if (rawSize < SIDEBAR_MIN) {
        setSidebarCollapsed(true)
      }
    },
    [setSidebarCollapsed]
  )

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
    onDragEnd: handleSidebarDragEnd,
  })

  useLayoutEffect(() => {
    previewSidebarWidth(sidebarWidth)
  }, [previewSidebarWidth, sidebarWidth])

  useEffect(() => {
    const mainWorkspace = mainWorkspaceRef.current

    if (!mainWorkspace || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const width =
        entries[0]?.contentRect.width ??
        mainWorkspace.getBoundingClientRect().width

      const workspaceWidth =
        workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth

      if (
        !sidebarCollapsed &&
        width > 0 &&
        width < mainAutoCollapseThreshold(workspaceWidth)
      ) {
        setSidebarCollapsed(true)
      }
    })

    observer.observe(mainWorkspace)

    return (): void => {
      observer.disconnect()
    }
  }, [sidebarCollapsed, setSidebarCollapsed])

  const activeCwd = activePtyBackedPane?.cwd ?? '.'
  // Distinct fallback for the FILES-tab file explorer: when no session
  // is active, browse from `~` (home) rather than `.` (process cwd).
  // `activeCwd` defaults to `.` because git/diff/agent-status all need a
  // valid working directory in the running process; the file explorer
  // is a navigation surface where `~` is the more useful starting point.
  const fileExplorerCwd = activePtyBackedPane?.cwd ?? '~'

  // File selection state.
  //
  // The service is created once per WorkspaceView instance via useMemo so it
  // has a stable reference across renders. Without this, CodeEditor's
  // file-loading effect (which depends on the service) re-fires on every
  // WorkspaceView re-render — including each keystroke in the editor — and
  // reloads the file from disk, overwriting in-progress edits.
  const fileSystemService = useMemo(() => createFileSystemService(), [])
  const editorBuffer = useEditorBuffer(fileSystemService, activeSessionId)
  const { hasUnsavedChanges, releaseScope } = editorBuffer
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null)

  const [pendingSessionRemovalId, setPendingSessionRemovalId] = useState<
    string | null
  >(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isUnsavedDialogSaving, setIsUnsavedDialogSaving] = useState(false)

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
  const pendingSessionRemovalIdRef = useRef<string | null>(null)
  const pendingSessionRestoreIdRef = useRef<string | null>(null)
  const isUnsavedDialogSavingRef = useRef(false)

  useEffect(() => {
    pendingFilePathRef.current = pendingFilePath
  }, [pendingFilePath])

  useEffect(() => {
    pendingSessionRemovalIdRef.current = pendingSessionRemovalId
  }, [pendingSessionRemovalId])

  const setPendingFilePathSynced = useCallback((value: string | null): void => {
    pendingFilePathRef.current = value
    setPendingFilePath(value)
  }, [])

  const setPendingSessionRemovalIdSynced = useCallback(
    (value: string | null): void => {
      pendingSessionRemovalIdRef.current = value
      setPendingSessionRemovalId(value)
    },
    []
  )

  const setPendingSessionRestoreIdRef = useCallback(
    (value: string | null): void => {
      pendingSessionRestoreIdRef.current = value
    },
    []
  )

  const setUnsavedDialogSavingSynced = useCallback((value: boolean): void => {
    isUnsavedDialogSavingRef.current = value
    setIsUnsavedDialogSaving(value)
  }, [])

  // General-purpose error banner for non-dialog file ops (direct file open,
  // async load failure inside CodeEditor, vim :w save failure).
  const [fileError, setFileError] = useState<string | null>(null)

  // Dock panel controlled state.
  const dockCanvasRef = useRef<HTMLDivElement>(null)
  const [dockPosition, setDockPosition] = useState<DockPosition>('bottom')
  const [isDockOpen, setIsDockOpen] = useState(true)
  const [dockTab, setDockTab] = useState<DockTab>('editor')

  const [activeContainerId, setActiveContainerId] = useState<string>(
    TERMINAL_CONTAINER_ID
  )
  const [focusRequestSeq, setFocusRequestSeq] = useState(0)
  const pendingFocusTarget = useRef<FocusTarget | null>(null)
  const terminalZoneRef = useRef<TerminalZoneHandle>(null)
  const dockPanelRef = useRef<DockPanelHandle>(null)

  const resolveFocusedPane = useCallback((): FocusedPaneRef | null => {
    // The chord is a deliberate user gesture (palette toggle then `r`); fire
    // it whenever the workspace has an active session + active pane.
    // Don't gate on `activeContainerId === TERMINAL_CONTAINER_ID` —
    // that workspace-container focus state only flips on Ctrl+B or
    // specific shortcuts, NOT when the user clicks into a pane, so
    // requiring it surprised the user when their visibly-focused pane
    // dropped the chord into the palette instead.
    if (!activeSession || !activePane) {
      return null
    }
    if ((activePane.kind ?? 'shell') !== 'shell') {
      return null
    }

    return { pane: activePane, session: activeSession }
  }, [activePane, activeSession])

  const { renderNode: paneRenameNode } = usePaneRenameChord(
    resolveFocusedPane,
    setPaneUserLabel
  )

  const requestFocus = useCallback((target: FocusTarget): void => {
    pendingFocusTarget.current = target
    setFocusRequestSeq((value) => value + 1)
  }, [])

  useLayoutEffect(() => {
    const target = pendingFocusTarget.current
    if (!target) {
      return
    }

    pendingFocusTarget.current = null

    if (target === 'terminal') {
      terminalZoneRef.current?.focusActivePane()

      return
    }

    if (target === 'editor') {
      dockPanelRef.current?.focusEditor()

      return
    }

    dockPanelRef.current?.focusDiff()
  }, [focusRequestSeq])

  const openDock = useCallback(
    (tab?: DockTab): void => {
      const nextTab = tab ?? dockTab
      if (tab) {
        setDockTab(tab)
      }

      setIsDockOpen(true)
      setActiveContainerId(DOCK_CONTAINER_ID)
      requestFocus(nextTab)
    },
    [dockTab, requestFocus]
  )

  const claimTerminal = useCallback((): void => {
    setActiveContainerId(TERMINAL_CONTAINER_ID)
    requestFocus('terminal')
  }, [requestFocus])

  const closeDock = useCallback((): void => {
    setIsDockOpen(false)
    claimTerminal()
  }, [claimTerminal])

  const handleSetActiveSessionId = useCallback(
    (id: string): void => {
      setActiveSessionId(id)
      claimTerminal()
    },
    [claimTerminal, setActiveSessionId]
  )

  const handleCreateSession = useCallback((): void => {
    createSession()
    claimTerminal()
  }, [claimTerminal, createSession])

  const handleRemoveSession = useCallback(
    (sessionId: string): SessionCloseResult => {
      if (hasUnsavedChanges(sessionId)) {
        const restoreSessionId =
          sessionId !== activeSessionId ? activeSessionId : null

        if (sessionId !== activeSessionId) {
          setActiveSessionId(sessionId)
        }

        setPendingFilePathSynced(null)
        setPendingSessionRemovalIdSynced(sessionId)
        setPendingSessionRestoreIdRef(restoreSessionId)
        setSaveError(null)
        setShowUnsavedDialog(true)

        return false
      }

      const wasActive = sessionId === activeSessionId
      removeSession(sessionId)
      if (wasActive) {
        claimTerminal()
      }

      return undefined
    },
    [
      activeSessionId,
      claimTerminal,
      hasUnsavedChanges,
      removeSession,
      setActiveSessionId,
      setPendingFilePathSynced,
      setPendingSessionRemovalIdSynced,
      setPendingSessionRestoreIdRef,
    ]
  )

  const previousSessionIdsRef = useRef<Set<string>>(new Set())
  // Tie editor-scope cleanup to committed session removals. Layout timing
  // avoids a paint/input gap where a removed session can still look dirty.
  useLayoutEffect(() => {
    const currentSessionIds = new Set(sessions.map((session) => session.id))

    for (const previousSessionId of previousSessionIdsRef.current) {
      if (!currentSessionIds.has(previousSessionId)) {
        releaseScope(previousSessionId)
      }
    }

    previousSessionIdsRef.current = currentSessionIds
  }, [releaseScope, sessions])

  const removePendingSession = useCallback(
    (sessionId: string, restoreSessionId: string | null): void => {
      const restorableSessionId =
        restoreSessionId &&
        restoreSessionId !== sessionId &&
        sessions.some((session) => session.id === restoreSessionId)
          ? restoreSessionId
          : undefined

      const nextId =
        restorableSessionId ??
        (sessionId === activeSessionId
          ? pickNextVisibleSessionId(sessions, sessionId, activeSessionId)
          : undefined)

      if (nextId !== undefined) {
        setActiveSessionId(nextId)
      }

      removeSession(sessionId)

      if (sessionId === activeSessionId || nextId !== undefined) {
        claimTerminal()
      }
    },
    [
      activeSessionId,
      claimTerminal,
      removeSession,
      sessions,
      setActiveSessionId,
    ]
  )

  const workspaceCommands = useMemo(
    () =>
      buildWorkspaceCommands({
        sessions,
        activeSessionId,
        activePanePtyId: activePanePtyIdForCommands,
        activePaneAgentType: activePaneAgentTypeForCommands,
        createSession,
        removeSession: handleRemoveSession,
        renameSession,
        setPaneUserLabel,
        renameAgentSession,
        nextPaneRenameRequestId,
        isCurrentPaneRenameRequest,
        setActiveSessionId,
        notifyInfo,
        toggleSidebar: handleToggleSidebar,
      }),
    // sessionsSignature captures every field the closures read; activity-only
    // changes keep the signature stable so the memo (and downstream
    // filteredResults / handler refs) do not churn during agent I/O.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      sessionsSignature,
      activeSessionId,
      activePanePtyIdForCommands,
      activePaneAgentTypeForCommands,
      createSession,
      handleRemoveSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      nextPaneRenameRequestId,
      isCurrentPaneRenameRequest,
      setActiveSessionId,
      notifyInfo,
      handleToggleSidebar,
    ]
  )

  const commandPalette = useCommandPalette(workspaceCommands, {
    enabled: !showUnsavedDialog,
  })

  usePaneShortcuts({
    sessions,
    activeSessionId,
    setSessionActivePane,
    setSessionLayout,
    preferModifier,
    onTerminalZoneFocus: claimTerminal,
    isTerminalContainerActive: activeContainerId === TERMINAL_CONTAINER_ID,
  })

  useDockShortcuts({
    activeContainerId,
    openDock,
    claimTerminal,
    modKey: preferModifier === 'meta' ? '⌘' : 'Ctrl',
  })

  useSidebarShortcut({
    onToggle: handleToggleSidebar,
    modKey: preferModifier === 'meta' ? '⌘' : 'Ctrl',
    activeContainerId,
  })

  useNewSessionShortcut({
    onNewSession: handleCreateSession,
    modKey: preferModifier === 'meta' ? '⌘' : 'Ctrl',
  })

  // One elastic size per axis so values survive dock unmounts and position changes.
  const verticalDockElastic = useElasticContainer({
    containerRef: dockCanvasRef,
    axis: 'vertical',
    ...DOCK_VERTICAL_ELASTIC_CONFIG,
    invert: dockPosition === 'bottom',
  })

  const horizontalDockElastic = useElasticContainer({
    containerRef: dockCanvasRef,
    axis: 'horizontal',
    ...DOCK_HORIZONTAL_ELASTIC_CONFIG,
    invert: dockPosition === 'right',
  })

  const [selectedDiffFile, setSelectedDiffFile] =
    useState<SelectedDiffFile | null>(null)

  const gitStatus = useGitStatus(activeCwd, {
    watch: true,
    enabled: agentStatus.isActive || (isDockOpen && dockTab === 'diff'),
  })

  const statusBarSession = useMemo<StatusBarSession | null>(() => {
    if (!activeSession || !isStatusBarAgentActive) {
      return null
    }

    const usage = agentStatus.contextWindow?.currentUsage

    const cache = usage
      ? {
          cached: usage.cacheReadInputTokens,
          wrote: usage.cacheCreationInputTokens,
          fresh: usage.inputTokens,
        }
      : undefined

    const gitLineTotals =
      gitStatus.filesCwd === activeCwd ? sumLines(gitStatus.files) : null
    const changes = gitLineTotals ?? lineDelta(activeSession)

    return {
      startedAgo: formatStatusDuration(agentStatus.cost?.totalDurationMs ?? 0),
      turns: agentStatus.numTurns,
      cache,
      changes,
    }
  }, [
    activeCwd,
    activeSession,
    agentStatus.contextWindow?.currentUsage,
    agentStatus.cost?.totalDurationMs,
    agentStatus.numTurns,
    gitStatus.files,
    gitStatus.filesCwd,
    isStatusBarAgentActive,
  ])

  // null (not 0) when the agent is active but has not yet reported a context
  // window — StatusBar suppresses the segment so the user never sees a
  // misleading 😊0% that implies a healthy reading before any data arrives.
  const statusBarContextPct = isStatusBarAgentActive
    ? (agentStatus.contextWindow?.usedPercentage ?? null)
    : null

  // Fused AgentStatusCard props, derived from the same live signals the status
  // bar uses (VIM-66). The compact card keeps only the turn count in the
  // header and shows usage bars when live rate-limit data is present.
  // Completed/errored come from the pane lifecycle and must NOT be masked by
  // the agent going inactive after it finishes; `running` requires a live
  // agent; everything else (no session, paused, inactive) reads as idle.
  // (`awaiting` is supported by the card but not emitted yet — no data feed,
  // same as `subtitle`.)
  const sidebarCardState: AgentCardState = !activeSession
    ? 'idle'
    : activityPanelStatus === 'completed'
      ? 'completed'
      : activityPanelStatus === 'errored'
        ? 'errored'
        : agentStatus.isActive && activityPanelStatus === 'running'
          ? 'running'
          : 'idle'

  // A pure shell pane has no detected agent (and therefore no model / usage);
  // the card renders its fixed-height shell placeholder in that case so the
  // session list below never reflows when switching panes.
  const sidebarCardIsShell =
    !agentStatus.agentType || !agentStatus.isActive || agentStatus.agentExited

  // Card title is the active agent's model name (the old StatusCard surfaced
  // the model — the fused card now uses it as the title). Falls back to the
  // session name, then a placeholder, when no model is known (e.g. idle).
  const sidebarCardTitle =
    agentStatus.modelDisplayName ??
    agentStatus.modelId ??
    activeSession?.name ??
    'No session'
  const sidebarCardTurns = statusBarSession?.turns ?? null

  const sidebarCardFiveHourPct = rateLimitPercentage(
    agentStatus.rateLimits?.fiveHour
  )

  const sidebarCardWeekPct = rateLimitPercentage(
    agentStatus.rateLimits?.sevenDay
  )

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
        setPendingSessionRestoreIdRef(null)
        setShowUnsavedDialog(true)

        return
      }

      void openFileSafely(filePath)
    },
    [
      editorBuffer.isDirty,
      openFileSafely,
      setPendingFilePathSynced,
      setPendingSessionRestoreIdRef,
    ]
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
        setPendingSessionRestoreIdRef(null)
        setShowUnsavedDialog(true)

        return
      }

      void openFileSafely(filePath)
    },
    [
      editorBuffer.isDirty,
      openFileSafely,
      setPendingFilePathSynced,
      setPendingSessionRestoreIdRef,
    ]
  )

  // Save the guarded buffer, then continue the pending file switch or
  // session close. Session closes pass an explicit scope so a failed
  // active-session IPC switch cannot make Save write the wrong tab.
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
    if (isUnsavedDialogSavingRef.current) {
      return
    }

    const pendingSessionRemovalIdAtSave = pendingSessionRemovalIdRef.current
    setUnsavedDialogSavingSynced(true)

    try {
      if (pendingSessionRemovalIdAtSave) {
        await editorBuffer.saveFile(pendingSessionRemovalIdAtSave)
      } else {
        await editorBuffer.saveFile()
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      setSaveError(`Failed to save: ${message}`)
      setUnsavedDialogSavingSynced(false)

      // Keep the dialog open so the user can retry or cancel — the file
      // is still dirty and we haven't switched away.
      return
    }

    setUnsavedDialogSavingSynced(false)

    // Read pending targets FROM THE REFS after the save completes.
    // Cancellation is disabled while saving, but ref reads still keep
    // this continuation aligned with any synchronous pending-action
    // reset that happened before the save began.
    const currentPendingPath = pendingFilePathRef.current
    const currentPendingSessionRemovalId = pendingSessionRemovalIdRef.current
    const currentPendingSessionRestoreId = pendingSessionRestoreIdRef.current

    // Current buffer is clean on disk. The dialog's job of guarding
    // the pending action is done — surface any pending-open failure via
    // the workspace-level banner instead of leaving the dialog stuck with
    // a misleading "Failed to save" message.
    setShowUnsavedDialog(false)
    setPendingFilePathSynced(null)
    setPendingSessionRemovalIdSynced(null)
    setPendingSessionRestoreIdRef(null)
    setSaveError(null)

    if (currentPendingSessionRemovalId) {
      removePendingSession(
        currentPendingSessionRemovalId,
        currentPendingSessionRestoreId
      )
      setFileError(null)

      return
    }

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
  }, [
    editorBuffer,
    removePendingSession,
    setPendingFilePathSynced,
    setPendingSessionRemovalIdSynced,
    setPendingSessionRestoreIdRef,
    setUnsavedDialogSavingSynced,
  ])

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
    if (isUnsavedDialogSavingRef.current) {
      return
    }

    const target = pendingFilePathRef.current
    const targetSessionRemovalId = pendingSessionRemovalIdRef.current
    const targetSessionRestoreId = pendingSessionRestoreIdRef.current
    setShowUnsavedDialog(false)
    setPendingFilePathSynced(null)
    setPendingSessionRemovalIdSynced(null)
    setPendingSessionRestoreIdRef(null)
    setSaveError(null)

    if (targetSessionRemovalId) {
      removePendingSession(targetSessionRemovalId, targetSessionRestoreId)
      setFileError(null)

      return
    }

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
  }, [
    editorBuffer,
    removePendingSession,
    setPendingFilePathSynced,
    setPendingSessionRemovalIdSynced,
    setPendingSessionRestoreIdRef,
  ])

  // Cancel and stay on current file.
  //
  // CRITICAL: writes `pendingFilePathRef.current = null` synchronously
  // via `setPendingFilePathSynced` so a concurrently-running `handleSave`
  // awaiting saveFile() sees the cleared ref as soon as its microtask
  // resumes. While a save is actively in flight the dialog disables
  // cancellation so users cannot accidentally write the file but cancel
  // the guarded session close/open action with no feedback.
  const handleCancel = useCallback((): void => {
    if (isUnsavedDialogSavingRef.current) {
      return
    }

    const restoreSessionId = pendingSessionRestoreIdRef.current

    setShowUnsavedDialog(false)
    setPendingFilePathSynced(null)
    setPendingSessionRemovalIdSynced(null)
    setPendingSessionRestoreIdRef(null)
    setSaveError(null)

    if (
      restoreSessionId &&
      sessions.some((session) => session.id === restoreSessionId)
    ) {
      setActiveSessionId(restoreSessionId)
      claimTerminal()
    }
  }, [
    claimTerminal,
    sessions,
    setActiveSessionId,
    setPendingFilePathSynced,
    setPendingSessionRemovalIdSynced,
    setPendingSessionRestoreIdRef,
  ])

  // Handle opening a diff file from AgentStatusPanel
  const handleOpenDiff = useCallback(
    (file: ChangedFile): void => {
      setSelectedDiffFile({
        path: file.path,
        staged: file.staged,
        cwd: activeCwd,
      })
      openDock('diff')
    },
    [activeCwd, openDock]
  )

  // Belt-and-suspenders: clear selection on cwd change
  useEffect(() => {
    setSelectedDiffFile(null)
  }, [activeCwd])

  const dockCanvasFlexDirection: CSSProperties['flexDirection'] =
    dockPosition === 'top' || dockPosition === 'bottom' ? 'column' : 'row'

  const dockBeforeTerminal = dockPosition === 'top' || dockPosition === 'left'

  const terminalFitDeferred =
    isDragging ||
    verticalDockElastic.isDragging ||
    horizontalDockElastic.isDragging

  const areBrowserPanesOccluded =
    terminalFitDeferred ||
    showUnsavedDialog ||
    commandPalette.state.isOpen ||
    paneRenameNode !== null ||
    fileError !== null ||
    infoMessage !== null

  const feedbackDispatch = useMemo(() => {
    // Inline-review feedback dispatches to the single CONNECTED (active) pane —
    // the one whose diff is on screen. We gate the candidate on LIVE agent
    // state from `useAgentStatus` (sessionId match + isActive + !agentExited),
    // NOT the PTY-lifecycle `pane.status`: a pane whose agent exited can keep a
    // stale 'codex'/'claude-code' label while its shell PTY is still running,
    // and the live signal is the only way to avoid pasting feedback into a bare
    // shell. `agentLabel` maps agentType directly to the picker's SupportedAgent
    // literals (the registry display name diverges, e.g. AGENTS.codex.name ===
    // 'Codex CLI', which would mis-filter Codex).
    const agentLabel =
      agentStatus.agentType === 'claude-code'
        ? 'Claude Code'
        : agentStatus.agentType === 'codex'
          ? 'Codex'
          : null

    // Bind the candidate to the pty-backed pane (not the literal active pane),
    // matching the pane `agentStatus` is computed from: when a browser pane is
    // active we prefer the live shell, so feedback never targets a browser
    // pane or an exited PTY.
    const candidates: PaneCandidate[] =
      activePtyBackedPane &&
      activePtyBackedPanePtyId &&
      agentStatus.sessionId === activePtyBackedPanePtyId &&
      agentStatus.isActive &&
      !agentStatus.agentExited &&
      agentLabel !== null
        ? [
            {
              paneId: activePtyBackedPane.id,
              ptyId: activePtyBackedPanePtyId,
              tabName:
                activePtyBackedPane.userLabel ??
                activePtyBackedPane.agentTitle ??
                activeSession?.name ??
                'Terminal',
              agentLabel,
              cwd: activePtyBackedPane.cwd,
              status: 'running',
              isFocused: true,
            },
          ]
        : []

    return {
      candidates,
      writePty: async (ptyId: string, data: string): Promise<void> => {
        await terminalService.write({ sessionId: ptyId, data })
      },
    }
  }, [
    activePtyBackedPane,
    activePtyBackedPanePtyId,
    activeSession,
    agentStatus.agentType,
    agentStatus.isActive,
    agentStatus.agentExited,
    agentStatus.sessionId,
    terminalService,
  ])

  const dockOrPeek = isDockOpen ? (
    <DockPanel
      ref={dockPanelRef}
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
      onClose={closeDock}
      verticalSize={verticalDockElastic.size}
      onVerticalResizeMouseDown={verticalDockElastic.handleMouseDown}
      isVerticalResizing={verticalDockElastic.isDragging}
      onVerticalSizeAdjust={verticalDockElastic.adjustBy}
      verticalPixelMin={verticalDockElastic.pixelMin}
      verticalPixelMax={verticalDockElastic.pixelMax}
      horizontalSize={horizontalDockElastic.size}
      onHorizontalResizeMouseDown={horizontalDockElastic.handleMouseDown}
      isHorizontalResizing={horizontalDockElastic.isDragging}
      onHorizontalSizeAdjust={horizontalDockElastic.adjustBy}
      horizontalPixelMin={horizontalDockElastic.pixelMin}
      horizontalPixelMax={horizontalDockElastic.pixelMax}
      selectedDiffFile={selectedDiffFile}
      onSelectedDiffFileChange={setSelectedDiffFile}
      isFocused={activeContainerId === DOCK_CONTAINER_ID}
      onContainerFocus={() => {
        setActiveContainerId(DOCK_CONTAINER_ID)
      }}
      feedbackDispatch={feedbackDispatch}
    />
  ) : (
    <DockPeekButton position={dockPosition} onOpen={() => openDock()} />
  )

  const pendingSessionFilePath = pendingSessionRemovalId
    ? editorBuffer.getFilePathForScope(pendingSessionRemovalId)
    : null

  const unsavedDialogFileName = pendingSessionRemovalId
    ? (pendingSessionFilePath ??
      (pendingSessionRemovalId === activeSessionId
        ? (editorBuffer.filePath ?? '')
        : ''))
    : (editorBuffer.filePath ?? '')

  return (
    <div
      ref={workspaceRef}
      data-testid="workspace-view"
      // `grid-rows-1` pins the implicit row to `1fr`; without it
      // `grid-auto-rows: auto` lets the row grow to content size and
      // `h-full` stops propagating the 100vh constraint downward.
      className="relative grid h-screen grid-rows-1 overflow-hidden"
      style={
        {
          // `--workspace-sidebar-width` is owned by previewSidebarWidth so
          // React rerenders cannot overwrite an in-progress drag preview.
          // VIM-76: icon rail removed — layout is [sidebar | main | activity].
          // Desktop collapse animates the sidebar shell width; compact viewports
          // switch to a single-column workspace with the sidebar as an overlay.
          gridTemplateColumns: isCompactViewport ? '1fr' : `auto 1fr auto`,
        } as CSSProperties
      }
    >
      {isCompactViewport && !isSidebarClosed && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close sidebar"
          data-testid="sidebar-scrim"
          onClick={() => {
            shouldRestoreSidebarToggleFocusRef.current = true
            setCompactSidebarOpen(false)
          }}
          className="fixed inset-0 z-20 cursor-default bg-background/55 backdrop-blur-[2px]"
        />
      )}

      {/* Sidebar — the shell clips the inner panel during animated desktop
          collapse; compact viewports lift the same shell above main content. */}
      <div
        aria-hidden={isSidebarClosed || undefined}
        inert={isSidebarClosed || undefined}
        data-testid="workspace-sidebar-shell"
        role={isCompactViewport && !isSidebarClosed ? 'dialog' : undefined}
        aria-modal={isCompactViewport && !isSidebarClosed ? true : undefined}
        aria-label={
          isCompactViewport && !isSidebarClosed ? 'Sidebar' : undefined
        }
        className={`relative h-full overflow-hidden will-change-[width] ${
          isDragging || isCompactViewport
            ? ''
            : 'transition-[width] duration-[220ms] ease-pane'
        }`}
        style={{
          position: isCompactViewport ? 'absolute' : undefined,
          zIndex: isCompactViewport ? 30 : undefined,
          left: isCompactViewport ? 0 : undefined,
          top: isCompactViewport ? 0 : undefined,
          bottom: isCompactViewport ? 0 : undefined,
          maxWidth: isCompactViewport ? '100vw' : undefined,
          width: isSidebarClosed
            ? 0
            : isCompactViewport
              ? `min(100vw, var(--workspace-sidebar-width, ${SIDEBAR_INITIAL}px))`
              : `var(--workspace-sidebar-width, ${SIDEBAR_INITIAL}px)`,
        }}
      >
        <div
          className="relative flex h-full"
          style={{
            width: isCompactViewport
              ? `min(100vw, var(--workspace-sidebar-width, ${SIDEBAR_INITIAL}px))`
              : `var(--workspace-sidebar-width, ${SIDEBAR_INITIAL}px)`,
          }}
        >
          <Sidebar
            // Collapse keeps a same-height placeholder so the header/session
            // list do not jump vertically while the shell width animates. The
            // real top-bar controls still unmount so their portaled tooltips
            // cannot escape the inert, clipped sidebar shell.
            topBar={
              isSidebarClosed ? (
                <div
                  aria-hidden="true"
                  data-testid="sidebar-top-bar-placeholder"
                  className="bg-surface-container-low"
                  style={{ height: 38, flexShrink: 0 }}
                />
              ) : (
                <SidebarTopBar
                  onToggleSidebar={handleToggleSidebar}
                  onCommand={commandPalette.open}
                  commandShortcutHint={commandShortcutHint}
                  sidebarShortcutHint={sidebarShortcutHint}
                  settingsIssueNumber={SETTINGS_FOLLOWUP_ISSUE_NUMBER}
                  toggleRef={sidebarToggleTopbarRef}
                />
              )
            }
            header={
              <AgentStatusCard
                title={sidebarCardTitle}
                state={sidebarCardState}
                isShell={sidebarCardIsShell}
                turns={sidebarCardTurns}
                fiveHourPct={sidebarCardFiveHourPct}
                weekPct={sidebarCardWeekPct}
                shellName={activePtyBackedPane?.shell ?? null}
              />
            }
            content={
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex items-stretch gap-2 px-3 pb-3 pt-2.5">
                  <SidebarTabs<SidebarTab>
                    tabs={SIDEBAR_TAB_ITEMS}
                    activeId={activeTab}
                    onChange={setActiveTab}
                  />
                  <NewSessionButton
                    onClick={handleCreateSession}
                    shortcutHint={newSessionShortcutHint}
                    ariaKeyshortcuts={newSessionAriaKeyshortcuts}
                  />
                </div>
                <SessionsView
                  hidden={activeTab !== 'sessions'}
                  sessions={sessions}
                  activeSessionId={activeSessionId}
                  onSessionClick={handleSetActiveSessionId}
                  onRemoveSession={handleRemoveSession}
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

          {/* Resize handle (hidden while collapsed) */}
          {!isSidebarClosed && !isCompactViewport && (
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
          )}
        </div>
      </div>

      {/* Main workspace area - TerminalZone + DockPanel.
          `relative` establishes a containing block so the fileError
          banner's `absolute` positioning is scoped to this column
          rather than climbing to the viewport. */}
      <div
        ref={mainWorkspaceRef}
        data-testid="workspace-main"
        className="relative flex flex-col overflow-hidden bg-background"
        inert={isCompactViewport && !isSidebarClosed ? true : undefined}
        aria-hidden={isCompactViewport && !isSidebarClosed ? true : undefined}
        style={{
          borderTopLeftRadius: sidebarCollapsed || isCompactViewport ? 0 : 16,
          borderBottomLeftRadius:
            sidebarCollapsed || isCompactViewport ? 0 : 16,
          boxShadow:
            sidebarCollapsed || isCompactViewport
              ? 'none'
              : '-18px 0 36px rgba(0,0,0,0.22)',
          transition: isDragging
            ? 'none'
            : `border-radius ${SIDEBAR_MOTION_MS}ms ${SIDEBAR_MOTION_EASING}, box-shadow ${SIDEBAR_MOTION_MS}ms ${SIDEBAR_MOTION_EASING}`,
          willChange: 'border-radius, box-shadow',
        }}
      >
        <Tabs
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={handleSetActiveSessionId}
          onClose={handleRemoveSession}
          onNew={handleCreateSession}
          leading={
            isSidebarClosed ? (
              <SidebarToggle
                ref={sidebarToggleTabsRef}
                collapsed
                onClick={handleToggleSidebar}
                size={28}
                variant="inset"
                data-testid="sidebar-toggle-tabs"
                shortcutHint={sidebarShortcutHint}
              />
            ) : undefined
          }
        />

        <div
          ref={dockCanvasRef}
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
              ref={terminalZoneRef}
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSessionCwdChange={updatePaneCwd}
              deferTerminalFit={terminalFitDeferred}
              loading={loading}
              onPaneReady={notifyPaneReady}
              onSessionRestart={restartSession}
              service={terminalService}
              setSessionActivePane={setSessionActivePane}
              updateBrowserPaneUrl={updateBrowserPaneUrl}
              setSessionLayout={setSessionLayout}
              addPane={addPane}
              removePane={removePane}
              areBrowserPanesOccluded={areBrowserPanesOccluded}
              isZoneFocused={activeContainerId === TERMINAL_CONTAINER_ID}
              onContainerFocus={() => {
                setActiveContainerId(TERMINAL_CONTAINER_ID)
              }}
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

        <StatusBar
          session={statusBarSession}
          contextPct={statusBarContextPct}
          paletteShortcut={COMMAND_PALETTE_SHORTCUT_KEYS}
          onOpenPalette={commandPalette.open}
        />
      </div>

      {!isCompactViewport && (
        <div
          data-testid="activity-panel-shell"
          className="h-full shrink-0 overflow-hidden transition-[width] duration-[220ms] ease-pane"
          style={{
            width: activityPanelCollapsed ? RAIL_WIDTH_PX : PANEL_WIDTH_PX,
          }}
        >
          {activityPanelCollapsed ? (
            <AgentStatusRail
              agent={activityPanelAgent}
              contextUsedPercentage={
                agentStatus.contextWindow?.usedPercentage ?? null
              }
              cacheHitPercentage={cacheHitPercentage(
                agentStatus.contextWindow?.currentUsage
              )}
              isRunning={agentStatus.isActive}
              onExpand={() => {
                handleActivityPanelCollapsed(false)
              }}
            />
          ) : (
            <AgentStatusPanel
              agentStatus={agentStatus}
              cwd={activeCwd}
              gitStatus={gitStatus}
              onOpenDiff={handleOpenDiff}
              onOpenFile={handleOpenTestFile}
              agent={activityPanelAgent}
              status={activityPanelStatus}
              onCollapse={() => {
                handleActivityPanelCollapsed(true)
              }}
            />
          )}
        </div>
      )}

      {/* Unsaved Changes Dialog — shows the CURRENTLY dirty file, not the
          destination the user is switching to. */}
      <UnsavedChangesDialog
        isOpen={showUnsavedDialog}
        fileName={unsavedDialogFileName}
        errorMessage={saveError}
        isSaving={isUnsavedDialogSaving}
        actionDescription={
          pendingSessionRemovalId ? 'closing this session' : 'switching files'
        }
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

      {paneRenameNode}

      {/* Command Palette — workspace-scoped command dispatcher */}
      <CommandPalette
        state={commandPalette.state}
        filteredResults={commandPalette.filteredResults}
        clampedSelectedIndex={commandPalette.clampedSelectedIndex}
        close={commandPalette.close}
        setQuery={commandPalette.setQuery}
        selectIndex={commandPalette.selectIndex}
      />
    </div>
  )
}

export default WorkspaceView
