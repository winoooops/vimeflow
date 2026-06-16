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
import { LayoutSwitcher } from '../terminal/components/LayoutSwitcher'
import { SidebarTopBar } from './components/SidebarTopBar'
import { SidebarSettingsFooter } from './components/SidebarSettingsFooter'
import { Sidebar } from '@/components/sidebar/Sidebar'
import {
  SidebarTabs,
  type SidebarTabItem,
} from '@/components/sidebar/SidebarTabs'
import { StatusBar, type StatusBarSession } from '@/components/StatusBar'
import { Tooltip } from '@/components/Tooltip'
import { AgentStatusCard } from './components/AgentStatusCard'
import { FilesView } from './components/FilesView'
import { NewSessionButton } from './components/NewSessionButton'
import { SessionsView } from './components/SessionsView'
import {
  TerminalZone,
  type TerminalZoneHandle,
} from './components/TerminalZone'
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
import { cacheHitPercentage } from '../agent-status/utils/cacheRate'
import { useCacheHistoryCollector } from '../agent-status/hooks/useCacheHistoryCollector'
import type { RateLimitsState } from '../agent-status/types'
import { UnsavedChangesDialog } from '../editor/components/UnsavedChangesDialog'
import { InfoBanner } from './components/InfoBanner'
import { CommandPalette } from '../command-palette/CommandPalette'
import { useCommandPalette } from '../command-palette/hooks/useCommandPalette'
import { SettingsDialog, useSettingsDialog } from '../settings'
import { useSettings } from '../settings/hooks/useSettings'
import {
  usePaneRenameChord,
  type FocusedPaneRef,
} from '../command-palette/hooks/usePaneRenameChord'
import { renameAgentSession } from '../../lib/backend'
import { useSessionManager } from '../sessions/hooks/useSessionManager'
import { cycleSession } from '../sessions/utils/cycleSession'
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
import { useBurnerTerminals } from '../terminal/hooks/useBurnerTerminals'
import {
  usePaneShortcuts,
  type PaneShortcutModifier,
} from '../terminal/hooks/usePaneShortcuts'
import { useDockShortcuts } from './hooks/useDockShortcuts'
import { useDockToggleShortcut } from './hooks/useDockToggleShortcut'
import { useKeybindings } from '../keymap/useKeybindings'
import { useSidebarShortcut } from './hooks/useSidebarShortcut'
import { useNewSessionShortcut } from './hooks/useNewSessionShortcut'
import { useSidebarTabShortcut } from './hooks/useSidebarTabShortcut'
import { useSessionNavShortcut } from './hooks/useSessionNavShortcut'
import { useBurnerToggleShortcut } from './hooks/useBurnerToggleShortcut'
import { useSidebarCollapsed } from './hooks/useSidebarCollapsed'
import { useEditorBuffer } from '../editor/hooks/useEditorBuffer'
import { useAgentStatus } from '../agent-status/hooks/useAgentStatus'
import { useGitStatus } from '../diff/hooks/useGitStatus'
import { useFeedbackBatch } from '../diff/hooks/useFeedbackBatch'
import type { PaneCandidate } from '../diff/services/activePanePicker'
import { sumLines } from '../diff/utils/sumLines'
import { findActivePane } from '../sessions/utils/activeSessionPane'
import { isShellPane } from '../sessions/utils/paneKind'
import { lineDelta } from '../sessions/utils/lineDelta'
import { hasLivePane, isLiveStatus } from '../sessions/utils/sessionStatus'
import { pickNextVisibleSessionId } from '../sessions/utils/pickNextVisibleSessionId'
import { AGENTS, agentTypeToRegistryKey } from '../../agents/registry'
import type {
  LayoutId,
  SessionCloseResult,
  SessionStatus,
} from '../sessions/types'
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
import { canClosePane } from '../terminal/components/SplitView'

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

const SIDEBAR_DEFAULT = 272
const SIDEBAR_MIN = SIDEBAR_DEFAULT
// Cap the sidebar at the width where the agent-status card and the
// tabs + new-session row both hit their own maximums and sit with even 12px
// padding: 360px content cap (202 SidebarTabs + 8 gap + 150 NewSessionButton
// max-width, matching AgentStatusCard's CARD_MAX_W) + 24px (px-3 left/right) =
// 384. Past this the card/button stop growing, so extra width is dead space.
const SIDEBAR_MAX = 384
const MAIN_AUTO_COLLAPSE_MIN = 360
const MAIN_AUTO_COLLAPSE_MAX = 500
const MAIN_AUTO_COLLAPSE_RATIO = 0.36
const SIDEBAR_MOTION_MS = 220
const SIDEBAR_MOTION_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'
const SIDEBAR_TOP_BAR_HEIGHT = 42
const SIDEBAR_TOGGLE_SIZE = 28
const SIDEBAR_TOGGLE_TOP = 7
const SIDEBAR_TOGGLE_SURFACE_PADDING_END = 12
const MACOS_WINDOW_CONTROL_SAFE_AREA_PX = 82

const SIDEBAR_INITIAL = clampSize(SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX)
const COMPACT_WORKSPACE_QUERY = '(max-width: 899px)'

const readCompactViewport = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(COMPACT_WORKSPACE_QUERY).matches

const SIDEBAR_TAB_ITEMS: readonly SidebarTabItem<SidebarTab>[] = [
  {
    id: 'sessions',
    label: 'SESSIONS',
    icon: 'view_agenda',
    tooltip: 'Sessions',
    shortcut: ['Mod', 'Shift', 'S'],
  },
  {
    id: 'files',
    label: 'FILES',
    icon: 'folder_open',
    tooltip: 'Files',
    shortcut: ['Mod', 'Shift', 'F'],
  },
]

const normalizePathForComparison = (path: string): string =>
  path.replace(/\\/g, '/').replace(/\/+$/u, '')

const relativePathFromCwd = (path: string, cwd: string): string | null => {
  const normalizedPath = normalizePathForComparison(path)
  const normalizedCwd = normalizePathForComparison(cwd)

  if (normalizedCwd === '') {
    return null
  }

  if (normalizedPath === normalizedCwd) {
    return ''
  }

  if (normalizedCwd === '/') {
    return normalizedPath.startsWith('/')
      ? normalizedPath.replace(/^\/+/u, '')
      : null
  }

  const cwdPrefix = `${normalizedCwd}/`

  if (!normalizedPath.startsWith(cwdPrefix)) {
    return null
  }

  return normalizedPath.slice(cwdPrefix.length)
}

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
    createBrowserSession,
    removeSession,
    restartSession,
    renameSession,
    setPaneUserLabel,
    reorderSessions,
    updatePaneCwd,
    appendPaneCacheReading,
    updatePaneAgentType,
    updateBrowserPaneUrl,
    setSessionActivityPanelCollapsed,
    setSessionActivePane,
    setSessionLayout,
    addPane,
    removePane,
    loading,
    notifyPaneReady,
    registerPending,
    dropAllForPty,
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
  const reserveWindowControls = preferModifier === 'meta'

  const windowControlsInset = reserveWindowControls
    ? MACOS_WINDOW_CONTROL_SAFE_AREA_PX
    : 0

  const sidebarToggleLeft = Math.max(12, windowControlsInset)

  const sidebarToggleSlideSurfaceWidth =
    sidebarToggleLeft + SIDEBAR_TOGGLE_SIZE + SIDEBAR_TOGGLE_SURFACE_PADDING_END

  const { message: infoMessage, notifyInfo, dismiss } = useNotifyInfo()
  const { settings } = useSettings()
  const { activeTab, setActiveTab } = useSidebarTab()

  // VIM-66 / VIM-76: workspace-global sidebar collapse flag. The collapse toggle
  // is a persistent shell control; only the sidebar panel and its background
  // slide. That keeps the control seated at the same coordinate in every state.
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

  // Imperative ref to the persistent SidebarToggle so keyboard/scrim closes can
  // restore focus without relying on data-testid selectors.
  const sidebarToggleRef = useRef<HTMLButtonElement>(null)
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

    const isToggleButtonFocused = activeElement === sidebarToggleRef.current

    if (isCompactViewport) {
      // User-triggered compact toggles (toggle button or keyboard shortcut)
      // always restore focus so the focus guard moves focus to the visible
      // toggle. This prevents focus from being lost to document.body when
      // closing the drawer from inside its content.
      shouldRestoreSidebarToggleFocusRef.current = true
      setCompactSidebarOpen((open) => !open)

      return
    }

    shouldRestoreSidebarToggleFocusRef.current = isToggleButtonFocused
    toggleSidebar()
  }, [isCompactViewport, toggleSidebar])

  // Post-toggle focus guard: compact drawer closes and some browser inert
  // transitions can drop focus to <body>. Refocus the persistent toggle only
  // when the user action asked for restoration.
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
        sidebarToggleRef.current?.focus()
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

  // Imperative refs for stable command-palette callbacks that still read the
  // latest focused session/pane without rebuilding the command list memo.
  const activeSessionRef = useRef(activeSession)
  activeSessionRef.current = activeSession
  const activePaneRef = useRef(activePane)
  activePaneRef.current = activePane

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

  useCacheHistoryCollector({
    ptyId: activePtyBackedPanePtyId ?? null,
    sessionId: activeSessionId,
    paneId: activePtyBackedPaneId ?? null,
    usage:
      agentStatus.sessionId === activePtyBackedPanePtyId
        ? (agentStatus.contextWindow?.currentUsage ?? null)
        : null,
    onReading: appendPaneCacheReading,
  })

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
  const [dockTab, setDockTab] = useState<DockTab>('diff')

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

  // Burner terminal popup (VIM-53) — reap reload-orphaned ephemeral PTYs before the first spawn.
  const [burnerReapDone, setBurnerReapDone] = useState(false)
  useEffect(() => {
    let cancelled = false

    const reap = async (): Promise<void> => {
      try {
        await terminalService.killEphemeralPtys()
      } catch (err) {
        // Best-effort: a failed sweep still enables burner; any orphan is
        // reaped on shutdown or the next boot.
        // eslint-disable-next-line no-console
        console.warn('burner reap failed', err)
      } finally {
        if (!cancelled) {
          setBurnerReapDone(true)
        }
      }
    }
    void reap()

    return (): void => {
      cancelled = true
    }
  }, [terminalService])

  // Live pane keys across all sessions — drives the burner lazy reconciliation
  // (a burner whose host pane/session is gone gets killed + dropped).
  const topologyKey = useMemo(
    () =>
      sessions
        .flatMap((s) => s.panes.map((p) => `${s.id}:${p.id}`))
        .sort()
        .join(','),
    [sessions]
  )

  const livePaneKeys = useMemo(
    () => new Set(topologyKey === '' ? [] : topologyKey.split(',')),
    [topologyKey]
  )

  // Live pane cwds keyed the same way — feeds the burner align-to-pane button
  // (VIM-81), which snaps a burner to its host pane's current directory.
  const livePaneCwds = useMemo(
    () =>
      new Map(
        sessions.flatMap((s) =>
          s.panes.map((p) => [`${s.id}:${p.id}`, p.cwd] as const)
        )
      ),
    [sessions]
  )

  // Preferred burner sync targets from the active agent's structured cwd.
  // This captures agent-driven worktree moves that may not be reflected in the
  // host shell's pwd yet; `useBurnerTerminals` falls back to `livePaneCwds`.
  const agentPaneCwds = useMemo(() => {
    if (
      !activeSessionId ||
      !activePtyBackedPaneId ||
      !activePtyBackedPanePtyId ||
      !agentCwd ||
      agentStatus.sessionId !== activePtyBackedPanePtyId ||
      !agentIsActive ||
      agentHasExited ||
      !isActivePaneLive
    ) {
      return new Map<string, string>()
    }

    return new Map([[`${activeSessionId}:${activePtyBackedPaneId}`, agentCwd]])
  }, [
    activeSessionId,
    activePtyBackedPaneId,
    activePtyBackedPanePtyId,
    agentCwd,
    agentHasExited,
    agentIsActive,
    agentStatus.sessionId,
    isActivePaneLive,
  ])

  const {
    renderNode: burnerTerminalNode,
    toggle: toggleBurner,
    runningByPane: runningBurnerByPane,
    activeByPane: activeBurnerByPane,
    hasVisibleBurner,
  } = useBurnerTerminals({
    service: terminalService,
    resolveFocusedPane,
    ready: burnerReapDone,
    registerPending,
    notifyPaneReady,
    livePaneKeys,
    dropAllForPty,
    livePaneCwds,
    agentPaneCwds,
  })

  // Stable wrapper for the `:burner` palette command so the command-list memo
  // stays put while still invoking the latest toggle, whose identity changes as
  // the popup opens/closes.
  const toggleBurnerRef = useRef(toggleBurner)
  toggleBurnerRef.current = toggleBurner

  const toggleBurnerCommand = useCallback((): void => {
    void toggleBurnerRef.current()
  }, [])

  // Pane-keys with a live burner shell — drives the status-bar count.
  const runningBurnerPaneKeys = useMemo(
    () =>
      new Set(
        [...runningBurnerByPane]
          .filter(([, status]) => status === 'running')
          .map(([key]) => key)
      ),
    [runningBurnerByPane]
  )

  // Pane-keys with a foreground command running — drives the amber button tint (VIM-71).
  const activeBurnerPaneKeys = useMemo(
    () =>
      new Set(
        [...activeBurnerByPane]
          .filter(([, active]) => active)
          .map(([key]) => key)
      ),
    [activeBurnerByPane]
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

  // Main-stage handoff J3/J6: the top chrome owns the layout pills; picks
  // forward to the same setSessionLayout the TerminalZone toolbar used, so
  // pane add/remove, active-pane, and layout semantics are untouched.
  const handlePickLayout = useCallback(
    (layoutId: LayoutId): void => {
      if (!activeSessionId) {
        return
      }
      setSessionLayout(activeSessionId, layoutId)
    },
    [activeSessionId, setSessionLayout]
  )

  // Main-stage handoff J8: one bottom-bar affordance for both directions.
  // Closing focuses the terminal (closeDock → claimTerminal); reopening
  // restores the previous dock tab/position and focuses the dock (openDock).
  const handleToggleDock = useCallback((): void => {
    if (isDockOpen) {
      closeDock()

      return
    }
    openDock()
  }, [closeDock, isDockOpen, openDock])

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

  // Open a file directly (no unsaved-changes guard). Errors were previously
  // swallowed via `void editorBuffer.openFile(...)`, leaving the user with
  // stale content and no feedback on Tauri IPC failures.
  const openFileSafely = useCallback(
    async (filePath: string): Promise<void> => {
      // Opening a file shows it in the editor. The dock now defaults to the
      // Diff tab, so surface the editor (and open the dock if collapsed) when
      // a file is opened — otherwise the file would load behind the diff view.
      setDockTab('editor')
      setIsDockOpen(true)
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

  // Guarded file-open request shared by click handlers and `:edit <path>`.
  // Shows the unsaved-changes dialog when the current buffer is dirty so a
  // pending open can be resumed after save/discard/cancel.
  const requestOpenFile = useCallback(
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

  // Stable bound callbacks for vim-flavored ex-command aliases (VIM-104 B1).
  // These intentionally have stable identities so the workspace command memo
  // does not churn while still invoking the latest handlers. Refs keep the
  // callbacks current without making the memo depend on rapidly-changing
  // values such as `editorBuffer` identity.
  const handleVimSaveRef = useRef(handleVimSave)
  handleVimSaveRef.current = handleVimSave

  const requestOpenFileRef = useRef(requestOpenFile)
  requestOpenFileRef.current = requestOpenFile

  const activeCwdRef = useRef(activeCwd)
  activeCwdRef.current = activeCwd

  const saveActiveFileCommand = useCallback((): void => {
    void handleVimSaveRef.current()
  }, [])

  const openFileInEditorCommand = useCallback((path: string): void => {
    // Resolve relative `:edit <path>` inputs against the active pane's cwd so
    // the backend does not canonicalize them relative to the Electron/sidecar
    // process cwd. Leave Unix absolute (`/`), home (`~`), Windows drive-letter
    // (`C:\`), and UNC (`\\server\share`) paths untouched.
    const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/

    const isAbsolute =
      path.startsWith('/') ||
      path.startsWith('~') ||
      WINDOWS_DRIVE_PATH.test(path) ||
      path.startsWith('\\\\')
    let resolvedPath = path

    if (
      path.length > 0 &&
      !isAbsolute &&
      activeCwdRef.current !== '.' &&
      activeCwdRef.current.length > 0
    ) {
      resolvedPath = `${activeCwdRef.current.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
    }

    requestOpenFileRef.current(resolvedPath)
  }, [])

  const closeActivePaneCommand = useCallback((): void => {
    const session = activeSessionRef.current
    const pane = activePaneRef.current

    if (session === undefined || pane === undefined) {
      notifyInfo('No pane to close')

      return
    }

    if (!canClosePane(session)) {
      notifyInfo('Cannot close the last pane')

      return
    }

    removePane(session.id, pane.id)
  }, [notifyInfo, removePane])

  const setActiveSessionLayoutCommand = useCallback(
    (layoutId: LayoutId): void => {
      const session = activeSessionRef.current

      if (session !== undefined) {
        setSessionLayout(session.id, layoutId)
      }
    },
    [setSessionLayout]
  )

  const workspaceCommands = useMemo(
    () =>
      buildWorkspaceCommands({
        sessions,
        activeSessionId,
        activePanePtyId: activePanePtyIdForCommands,
        activePaneAgentType: activePaneAgentTypeForCommands,
        createSession,
        createBrowserSession,
        removeSession: handleRemoveSession,
        renameSession,
        setPaneUserLabel,
        renameAgentSession,
        nextPaneRenameRequestId,
        isCurrentPaneRenameRequest,
        setActiveSessionId,
        notifyInfo,
        toggleSidebar: handleToggleSidebar,
        toggleBurner: toggleBurnerCommand,
        keymapPreset: settings.keymapPreset,
        saveActiveFile: saveActiveFileCommand,
        openFileInEditor: openFileInEditorCommand,
        closeActivePane: closeActivePaneCommand,
        setActiveSessionLayout: setActiveSessionLayoutCommand,
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
      createBrowserSession,
      handleRemoveSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      nextPaneRenameRequestId,
      isCurrentPaneRenameRequest,
      setActiveSessionId,
      notifyInfo,
      handleToggleSidebar,
      toggleBurnerCommand,
      settings.keymapPreset,
      saveActiveFileCommand,
      openFileInEditorCommand,
      closeActivePaneCommand,
      setActiveSessionLayoutCommand,
    ]
  )

  const settingsDialog = useSettingsDialog()

  const commandPalette = useCommandPalette(workspaceCommands, {
    enabled: !showUnsavedDialog && !settingsDialog.isOpen,
  })

  // Keybinding registry matcher — threaded into the migrated shortcut hooks so a
  // persisted override changes the live shortcut (VIM-136 SP1).
  const { matches } = useKeybindings()

  usePaneShortcuts({
    sessions,
    activeSessionId,
    setSessionActivePane,
    setSessionLayout,
    matches,
    onTerminalZoneFocus: claimTerminal,
    isTerminalContainerActive: activeContainerId === TERMINAL_CONTAINER_ID,
  })

  useDockShortcuts({
    activeContainerId,
    openDock,
    claimTerminal,
    modKey: preferModifier === 'meta' ? '⌘' : 'Ctrl',
  })

  useDockToggleShortcut({
    onToggle: handleToggleDock,
    matches,
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

  // VIM-104: ⌘⇧S / ⌘⇧F switch the left sidebar between Sessions and Files,
  // revealing the sidebar first if it is collapsed (or opening the compact
  // drawer on narrow viewports) so the chosen view is always visible.
  const revealSidebar = useCallback((): void => {
    if (isCompactViewport) {
      setCompactSidebarOpen(true)

      return
    }

    setSidebarCollapsed(false)
  }, [isCompactViewport, setCompactSidebarOpen, setSidebarCollapsed])

  const handleShowSessions = useCallback((): void => {
    setActiveTab('sessions')
    revealSidebar()
  }, [setActiveTab, revealSidebar])

  const handleShowFiles = useCallback((): void => {
    setActiveTab('files')
    revealSidebar()
  }, [setActiveTab, revealSidebar])

  useSidebarTabShortcut({
    onShowSessions: handleShowSessions,
    onShowFiles: handleShowFiles,
    modKey: preferModifier === 'meta' ? '⌘' : 'Ctrl',
  })

  // VIM-104: ⌘[ / ⌘] cycle to the previous / next session (Ctrl+⇧[ / Ctrl+⇧]
  // on Linux). Mirrors the previous/next-session palette commands.
  const switchRelativeSession = useCallback(
    (delta: number): void => {
      const nextSession = cycleSession(sessions, activeSessionId, delta)
      if (nextSession === null) {
        notifyInfo('No open sessions')

        return
      }

      setActiveSessionId(nextSession.id)
      claimTerminal()
    },
    [sessions, activeSessionId, setActiveSessionId, notifyInfo, claimTerminal]
  )

  const handlePrevSession = useCallback((): void => {
    switchRelativeSession(-1)
  }, [switchRelativeSession])

  const handleNextSession = useCallback((): void => {
    switchRelativeSession(1)
  }, [switchRelativeSession])

  useSessionNavShortcut({
    onPrevSession: handlePrevSession,
    onNextSession: handleNextSession,
    modKey: preferModifier === 'meta' ? '⌘' : 'Ctrl',
  })

  // VIM-104: Ctrl+` toggles the burner terminal popup for the focused pane.
  useBurnerToggleShortcut({ onToggle: toggleBurnerCommand })

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

  const feedbackBatch = useFeedbackBatch()
  const feedbackRepoRootRef = useRef('')
  const { clearBatch: clearFeedbackBatch } = feedbackBatch
  const previousFeedbackCwdRef = useRef(activeCwd)

  useEffect(() => {
    if (previousFeedbackCwdRef.current !== activeCwd) {
      previousFeedbackCwdRef.current = activeCwd
      feedbackRepoRootRef.current = ''
      clearFeedbackBatch()
    }
  }, [activeCwd, clearFeedbackBatch])

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

      requestOpenFile(node.id)
    },
    [requestOpenFile]
  )

  const handleFileViewDiff = useCallback(
    (node: { id: string; type: 'file' | 'folder' }): void => {
      if (node.type !== 'file') {
        return
      }

      if (activeCwd === '.' || activeCwd === '~' || activeCwd.length === 0) {
        setFileError('Cannot view diff without an active workspace directory')

        return
      }

      // The backend normalizes git status/diff to the repository toplevel, so
      // derive repo-root-relative paths when we know the toplevel. Fall back
      // to cwd-relative for directories that are not inside a git repo.
      const repoRoot =
        gitStatus.filesCwd === activeCwd ? gitStatus.repoRoot : null

      const relativePath =
        repoRoot && repoRoot.length > 0
          ? relativePathFromCwd(node.id, repoRoot)
          : relativePathFromCwd(node.id, activeCwd)

      if (!relativePath) {
        setFileError(`Cannot view diff outside ${activeCwd}: ${node.id}`)

        return
      }

      const statusFile =
        gitStatus.filesCwd === activeCwd
          ? gitStatus.files.find((file) => file.path === relativePath)
          : undefined

      if (gitStatus.filesCwd === activeCwd && !statusFile) {
        setFileError(`No uncommitted changes found for ${relativePath}`)

        return
      }

      setFileError(null)
      setSelectedDiffFile({
        path: relativePath,
        staged: statusFile?.staged ?? false,
        cwd: activeCwd,
      })
      openDock('diff')
    },
    [
      activeCwd,
      gitStatus.files,
      gitStatus.filesCwd,
      gitStatus.repoRoot,
      openDock,
    ]
  )

  // Open a test file from the activity panel. Delegates to requestOpenFile so
  // clicking a test result row uses the same dirty-state guard as file clicks
  // and `:edit <path>` — the same unsaved-dialog flow (handleSave /
  // handleDiscard / handleCancel) resumes the pending open against
  // pendingFilePathRef once the user picks an action.
  const handleOpenTestFile = useCallback(
    (filePath: string): void => {
      requestOpenFile(filePath)
    },
    [requestOpenFile]
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
    settingsDialog.isOpen ||
    hasVisibleBurner ||
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

  const dockPanel = isDockOpen ? (
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
      feedbackBatch={feedbackBatch}
      feedbackRepoRootRef={feedbackRepoRootRef}
      feedbackDispatch={feedbackDispatch}
    />
  ) : // Closed dock renders nothing — the bottom action bar's dock toggle is
  // the single reopen affordance (the old "show panel" peek bar is gone).
  null

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
      className="relative grid h-screen grid-rows-1 overflow-hidden bg-surface-container-low"
      style={
        {
          // `--workspace-sidebar-width` is owned by previewSidebarWidth so
          // React rerenders cannot overwrite an in-progress drag preview.
          // VIM-76: icon rail removed — layout is [sidebar | main | activity].
          // Desktop collapse animates the sidebar shell width; compact viewports
          // switch to a single-column workspace with the sidebar as an overlay.
          '--workspace-window-controls-inset': `${windowControlsInset}px`,
          '--workspace-sidebar-toggle-left': `${sidebarToggleLeft}px`,
          '--workspace-sidebar-toggle-size': `${SIDEBAR_TOGGLE_SIZE}px`,
          '--workspace-sidebar-toggle-top': `${SIDEBAR_TOGGLE_TOP}px`,
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
          className="fixed inset-0 z-20 cursor-default bg-surface/55 backdrop-blur-[2px]"
        />
      )}

      {/* Persistent sidebar toggle — anchored to the workspace root, which
          never moves, so the control sits at one fixed coordinate in every
          state. Parenting it to the sliding sidebar shell (open) or the main
          column (collapsed) made it ride along as those containers animated,
          so it visibly jumped on collapse/expand. A single root child with
          absolute left/top stays put; ⌘B just flips its glyph. Placed before
          the sidebar and main surfaces so focus order matches its visual
          position; z-40 keeps it on top. */}
      <div
        data-testid="sidebar-toggle-fixed-shell"
        className="vf-app-no-drag absolute z-40"
        style={{ left: sidebarToggleLeft, top: SIDEBAR_TOGGLE_TOP }}
      >
        <SidebarToggle
          ref={sidebarToggleRef}
          collapsed={isSidebarClosed}
          onClick={handleToggleSidebar}
          size={SIDEBAR_TOGGLE_SIZE}
          variant="inset"
          data-testid="sidebar-toggle-fixed"
          shortcutHint={sidebarShortcutHint}
        />
      </div>

      {/* Sidebar — the shell's panel clips during animated desktop collapse;
          the toggle that controls it is a root-level child (above), so it does
          not slide with the shell. Compact viewports lift the shell above main
          content. */}
      <div
        data-testid="workspace-sidebar-shell"
        role={isCompactViewport && !isSidebarClosed ? 'dialog' : undefined}
        aria-modal={isCompactViewport && !isSidebarClosed ? true : undefined}
        aria-label={
          isCompactViewport && !isSidebarClosed ? 'Sidebar' : undefined
        }
        className={`relative h-full overflow-visible will-change-[width] ${
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
          aria-hidden="true"
          data-testid="sidebar-toggle-slide-surface"
          className={`pointer-events-none absolute left-0 top-0 z-20 bg-transparent ${
            isDragging ? '' : 'transition-[width] duration-[220ms] ease-pane'
          }`}
          style={{
            height: SIDEBAR_TOP_BAR_HEIGHT,
            width: isSidebarClosed ? 0 : sidebarToggleSlideSurfaceWidth,
          }}
        />
        <div
          aria-hidden={isSidebarClosed || undefined}
          inert={isSidebarClosed || undefined}
          data-testid="workspace-sidebar-panel"
          className="h-full overflow-hidden"
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
              // cannot escape the inert, clipped sidebar panel.
              topBar={
                isSidebarClosed ? (
                  <div
                    aria-hidden="true"
                    data-testid="sidebar-top-bar-placeholder"
                    className="bg-transparent"
                    style={{ height: SIDEBAR_TOP_BAR_HEIGHT, flexShrink: 0 }}
                  />
                ) : (
                  <SidebarTopBar
                    reserveWindowControls={reserveWindowControls}
                  />
                )
              }
              header={
                <AgentStatusCard
                  title={sidebarCardTitle}
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
                    onViewDiff={handleFileViewDiff}
                  />
                </div>
              }
              footer={
                isSidebarClosed ? undefined : (
                  <SidebarSettingsFooter onSettings={settingsDialog.open} />
                )
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
      </div>

      {/* Main workspace area - TerminalZone + DockPanel.
          `relative` establishes a containing block so the fileError
          banner's `absolute` positioning is scoped to this column
          rather than climbing to the viewport. */}
      <main
        ref={mainWorkspaceRef}
        data-testid="workspace-main"
        aria-label="Main workspace"
        className="relative flex flex-col overflow-hidden bg-surface"
        inert={isCompactViewport && !isSidebarClosed ? true : undefined}
        aria-hidden={isCompactViewport && !isSidebarClosed ? true : undefined}
        style={{
          borderTopLeftRadius: sidebarCollapsed || isCompactViewport ? 0 : 16,
          borderBottomLeftRadius:
            sidebarCollapsed || isCompactViewport ? 0 : 16,
          // Tonal step + rounded left corners carry the left separation; no float shadow.
          transition: isDragging
            ? 'none'
            : `border-radius ${SIDEBAR_MOTION_MS}ms ${SIDEBAR_MOTION_EASING}`,
          willChange: 'border-radius',
        }}
      >
        {/* Top chrome — an always-visible 44px in-flow bar (panes sit BELOW it,
            so the root-anchored sidebar toggle, which floats over this bar's
            left edge when collapsed, never overlaps pane content the way main's
            session-tab strip behaved). Sits on the sheet surface + hairline
            bottom rule. The old auto-hide/pin behavior was removed; its reusable
            frosted-glass treatment now lives in <GlassSurface>. */}
        <div
          data-testid="top-chrome"
          className={`relative flex h-[44px] shrink-0 items-center gap-[12px] border-b border-outline-variant/25 bg-surface pl-[14px] pr-[14px] ${
            reserveWindowControls ? 'vf-app-drag-region' : ''
          }`}
        >
          {reserveWindowControls && isSidebarClosed && (
            <span
              aria-hidden="true"
              data-testid="top-chrome-sidebar-toggle-clearance"
              className="vf-app-no-drag pointer-events-none absolute"
              style={{
                left: sidebarToggleLeft,
                top: SIDEBAR_TOGGLE_TOP,
                width: SIDEBAR_TOGGLE_SIZE,
                height: SIDEBAR_TOGGLE_SIZE,
              }}
            />
          )}
          <span className="min-w-[10px] flex-1" />

          {/* Pills render in every layout, with the layout-display config
              button docked in the same pillar after a divider. */}
          {activeSession && (
            <LayoutSwitcher
              activeLayoutId={activeSession.layout}
              onPick={handlePickLayout}
              trailing={
                // Disabled controls swallow pointer events in Chromium, so the
                // hover target is a wrapper span rather than the button itself.
                <Tooltip
                  content="Configure displayed layouts"
                  placement="bottom"
                >
                  <span className="inline-flex">
                    <button
                      type="button"
                      aria-label="Configure displayed layouts"
                      disabled
                      aria-disabled="true"
                      tabIndex={-1}
                      className="inline-flex h-5 w-6 items-center justify-center rounded text-on-surface-muted opacity-50 transition-colors enabled:hover:bg-primary/[0.08] enabled:hover:text-primary"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M3 4.5H6.2M9.8 4.5H13M3 8H9.2M12.2 8H13M3 11.5H4.8M8.2 11.5H13"
                          stroke="currentColor"
                          strokeWidth="1.35"
                          strokeLinecap="round"
                        />
                        <circle
                          cx="8"
                          cy="4.5"
                          r="1.6"
                          stroke="currentColor"
                          strokeWidth="1.25"
                        />
                        <circle
                          cx="10.7"
                          cy="8"
                          r="1.45"
                          stroke="currentColor"
                          strokeWidth="1.25"
                        />
                        <circle
                          cx="6.5"
                          cy="11.5"
                          r="1.55"
                          stroke="currentColor"
                          strokeWidth="1.25"
                        />
                      </svg>
                    </button>
                  </span>
                </Tooltip>
              }
            />
          )}
        </div>

        <div
          ref={dockCanvasRef}
          data-testid="dock-canvas-wrapper"
          className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
          style={{ flexDirection: dockCanvasFlexDirection }}
        >
          {dockBeforeTerminal ? dockPanel : null}
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
              addPane={addPane}
              removePane={removePane}
              areBrowserPanesOccluded={areBrowserPanesOccluded}
              isZoneFocused={activeContainerId === TERMINAL_CONTAINER_ID}
              onContainerFocus={() => {
                setActiveContainerId(TERMINAL_CONTAINER_ID)
              }}
              onBurner={(target): void => void toggleBurner(target)}
              activeBurnerPaneKeys={activeBurnerPaneKeys}
              runningBurnerPaneKeys={runningBurnerPaneKeys}
            />
          </div>
          {!dockBeforeTerminal ? dockPanel : null}
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
          onOpenPalette={commandPalette.open}
          dockOpen={isDockOpen}
          onToggleDock={handleToggleDock}
          burnerCount={runningBurnerPaneKeys.size}
        />
      </main>

      {!isCompactViewport && (
        <div
          data-testid="activity-panel-shell"
          className="h-full shrink-0 overflow-hidden border-l border-outline-variant/25 transition-[width] duration-[220ms] ease-pane"
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
              reserveWindowControls={reserveWindowControls}
            />
          ) : (
            <AgentStatusPanel
              agentStatus={agentStatus}
              cacheHistory={activePtyBackedPane?.cacheHistory ?? []}
              cwd={activeCwd}
              gitStatus={gitStatus}
              onOpenDiff={handleOpenDiff}
              onOpenFile={handleOpenTestFile}
              agent={activityPanelAgent}
              status={activityPanelStatus}
              onCollapse={() => {
                handleActivityPanelCollapsed(true)
              }}
              reserveWindowControls={reserveWindowControls}
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
      {burnerTerminalNode}

      {/* Command Palette — workspace-scoped command dispatcher */}
      <CommandPalette
        state={commandPalette.state}
        filteredResults={commandPalette.filteredResults}
        clampedSelectedIndex={commandPalette.clampedSelectedIndex}
        close={commandPalette.close}
        setQuery={commandPalette.setQuery}
        selectIndex={commandPalette.selectIndex}
      />

      <SettingsDialog
        open={settingsDialog.isOpen}
        onClose={settingsDialog.close}
      />
    </div>
  )
}

export default WorkspaceView
