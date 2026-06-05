import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from 'react'
import type { Pane, Session } from '../../sessions/types'
import { isShellPane } from '../../sessions/utils/paneKind'
import { isMacPlatform } from '../../../lib/formatShortcut'
import {
  activateBrowserPaneTab,
  closeBrowserPaneTab,
  createBrowserPane,
  focusBrowserPane,
  getBrowserCdpInfo,
  navActionBrowserPane,
  navigateBrowserPane,
  newBrowserPaneTab,
  onBrowserPaneFocus,
  onBrowserPaneFocusAddress,
  onBrowserPaneNavStateChange,
  onBrowserPaneTabsChange,
  onBrowserPaneUrlChange,
  openExternalBrowserPane,
  setBrowserPaneBounds,
} from '../browserBridge'
import { BROWSER_IDENTITY } from '../browserIdentity'
import type {
  BrowserCdpInfo,
  BrowserPaneNavState,
  BrowserPaneTab,
} from '../types'
import { DEFAULT_BROWSER_URL } from '../types'
import { BrowserTabBar } from './BrowserTabBar'
import { BrowserToolbar } from './BrowserToolbar'

const LOCAL_DEV_HOST_PATTERN =
  /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/i

export interface BrowserPaneProps {
  session: Session
  pane: Pane
  isActive: boolean
  isOccluded?: boolean
  onClose?: (sessionId: string, paneId: string) => void
  onRequestActive?: (sessionId: string, paneId: string) => void
  onRequestFocus?: () => void
  onUrlChange?: (sessionId: string, paneId: string, url: string) => void
  showFocusHighlight?: boolean
}

const normalizeUrl = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return DEFAULT_BROWSER_URL
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  if (LOCAL_DEV_HOST_PATTERN.test(trimmed)) {
    return `http://${trimmed}`
  }

  return `https://${trimmed}`
}

const browserSessionIdForSession = (session: Session): string =>
  session.browserSessionId ??
  session.panes.find(isShellPane)?.ptyId ??
  session.id

export const BrowserPane = ({
  session,
  pane,
  isActive,
  isOccluded = false,
  onClose = undefined,
  onRequestActive = undefined,
  onRequestFocus = undefined,
  onUrlChange = undefined,
  showFocusHighlight = true,
}: BrowserPaneProps): ReactElement => {
  const contentRef = useRef<HTMLDivElement>(null)
  const url = pane.browserUrl ?? DEFAULT_BROWSER_URL
  const initialUrlRef = useRef(url)
  const isActiveRef = useRef(isActive)
  const isOccludedRef = useRef(isOccluded)
  const nativePaneReadyRef = useRef(false)
  const wasPaneActiveRef = useRef<boolean | undefined>(undefined)
  const wasOccludedRef = useRef(isOccluded)
  const suppressNextNativeFocusRef = useRef(false)
  const lastBoundsKeyRef = useRef<string | null>(null)
  const onUrlChangeRef = useRef(onUrlChange)
  // Address bar = `committedUrl` (the active tab's real URL, synced from native
  // events) projected into a single editable `draft` that the input always
  // displays. While the user is editing, the draft is their input and native
  // url events (SPA page-title-updated re-emits url/tabs-changed constantly)
  // never overwrite it. While idle, an effect keeps the draft equal to
  // committedUrl, so what is submitted is always exactly what is displayed —
  // there is no hidden draft and no blur-timing edge for any submit path.
  const [committedUrl, setCommittedUrl] = useState(url)
  const [draft, setDraft] = useState(url)
  const [isEditing, setIsEditing] = useState(false)
  const [cdpInfo, setCdpInfo] = useState<BrowserCdpInfo | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)

  const [navState, setNavState] = useState<BrowserPaneNavState>({
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
  })
  const receivedLiveNavRef = useRef(false)

  const [tabs, setTabs] = useState<BrowserPaneTab[]>([
    { id: 'tab-0', url, title: null, active: true, favicon: null },
  ])
  const browserSessionId = browserSessionIdForSession(session)

  const paneIds = useMemo(
    () => session.panes.map((sessionPane) => sessionPane.id),
    [session.panes]
  )

  // Mirror the active tab URL into the draft whenever the bar is idle (not
  // being edited). Guarded by the editing ref so a focused, half-typed draft
  // survives the stream of native url/tabs-changed events.
  useEffect(() => {
    if (!isEditing) {
      setDraft(committedUrl)
    }
  }, [committedUrl, isEditing])

  const activePaneId =
    session.panes.find((sessionPane) => sessionPane.active)?.id ?? null

  const shortcutContext = useMemo(
    () => ({ paneIds, activePaneId }),
    [activePaneId, paneIds]
  )
  const shortcutContextRef = useRef(shortcutContext)

  const syncBounds = useCallback((): void => {
    // Before the native pane exists, main silently drops bounds IPC — skip it.
    // The explicit syncBounds() after createBrowserPane applies the first bounds.
    if (!nativePaneReadyRef.current) {
      return
    }

    const node = contentRef.current
    if (!node) {
      return
    }

    const rect = node.getBoundingClientRect()

    const bounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    }

    const visible =
      isActiveRef.current &&
      !isOccludedRef.current &&
      rect.width > 0 &&
      rect.height > 0

    const currentShortcutContext = shortcutContextRef.current

    const boundsKey = [
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      visible ? '1' : '0',
      currentShortcutContext.activePaneId ?? '',
      ...currentShortcutContext.paneIds,
    ].join(':')

    // Past the readiness guard above, the native pane always exists — skip
    // unchanged bounds and record the latest key.
    if (lastBoundsKeyRef.current === boundsKey) {
      return
    }
    lastBoundsKeyRef.current = boundsKey

    void setBrowserPaneBounds({
      sessionId: browserSessionId,
      paneId: pane.id,
      bounds,
      visible,
      shortcutContext: currentShortcutContext,
    })
  }, [browserSessionId, pane.id])

  useLayoutEffect(() => {
    onUrlChangeRef.current = onUrlChange
  })

  useLayoutEffect(() => {
    isActiveRef.current = isActive
    isOccludedRef.current = isOccluded
    shortcutContextRef.current = shortcutContext
    // ResizeObserver does not fire for pure position changes. Ancestor layout
    // changes such as moving the dock still re-render this component, so sync
    // after every render and let syncBounds de-dupe unchanged rectangles.
    syncBounds()
  })

  useEffect(() => {
    const lifecycle = { cancelled: false }
    receivedLiveNavRef.current = false

    const offNavState = onBrowserPaneNavStateChange((event) => {
      if (event.sessionId !== browserSessionId || event.paneId !== pane.id) {
        return
      }

      setNavState({
        canGoBack: event.canGoBack,
        canGoForward: event.canGoForward,
        isLoading: event.isLoading,
      })
      receivedLiveNavRef.current = true
    })

    void (async (): Promise<void> => {
      try {
        const result = await createBrowserPane({
          sessionId: browserSessionId,
          paneId: pane.id,
          workspaceId: session.projectId,
          initialUrl: initialUrlRef.current,
          shortcutContext: shortcutContextRef.current,
        })
        if (lifecycle.cancelled) {
          return
        }

        nativePaneReadyRef.current = true
        setCommittedUrl(result.url)
        setTabs(result.tabs)
        if (!receivedLiveNavRef.current) {
          setNavState(result.navState)
        }
        onUrlChangeRef.current?.(session.id, pane.id, result.url)

        const info = await getBrowserCdpInfo({
          sessionId: browserSessionId,
          paneId: pane.id,
        })
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Cleanup can flip this while the awaited IPC is in flight.
        if (lifecycle.cancelled) {
          return
        }

        setCreateError(null)
        setCdpInfo(info)
        lastBoundsKeyRef.current = null
        syncBounds()
      } catch {
        if (!lifecycle.cancelled) {
          setCreateError('Failed to start browser pane')
          setCdpInfo(null)
        }
      }
    })()

    return (): void => {
      lifecycle.cancelled = true
      nativePaneReadyRef.current = false
      offNavState()
    }
  }, [browserSessionId, pane.id, session.id, session.projectId, syncBounds])

  useLayoutEffect(() => {
    const node = contentRef.current
    if (!node) {
      return
    }

    syncBounds()
    const observer = new ResizeObserver(syncBounds)
    observer.observe(node)
    window.addEventListener('resize', syncBounds)

    return (): void => {
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
      void setBrowserPaneBounds({
        sessionId: browserSessionId,
        paneId: pane.id,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        visible: false,
        shortcutContext: shortcutContextRef.current,
      })
    }
  }, [browserSessionId, pane.id, syncBounds])

  useEffect(() => {
    const becameVisibleAgain = wasOccludedRef.current && !isOccluded
    isActiveRef.current = isActive
    isOccludedRef.current = isOccluded

    const shouldFocusNative =
      showFocusHighlight &&
      isActive &&
      pane.active &&
      !isOccluded &&
      (wasPaneActiveRef.current !== true || becameVisibleAgain) &&
      !suppressNextNativeFocusRef.current

    if (shouldFocusNative) {
      void focusBrowserPane({ sessionId: browserSessionId, paneId: pane.id })
    }
    suppressNextNativeFocusRef.current = false
    wasPaneActiveRef.current = pane.active
    wasOccludedRef.current = isOccluded

    syncBounds()
  }, [
    browserSessionId,
    isActive,
    isOccluded,
    pane.active,
    pane.id,
    showFocusHighlight,
    syncBounds,
  ])

  useEffect(
    () =>
      onBrowserPaneFocus((event) => {
        if (event.sessionId !== browserSessionId || event.paneId !== pane.id) {
          return
        }

        onRequestFocus?.()

        if (!pane.active) {
          onRequestActive?.(session.id, pane.id)
        }
      }),
    [
      browserSessionId,
      onRequestActive,
      onRequestFocus,
      pane.active,
      pane.id,
      session.id,
    ]
  )

  useEffect(
    () =>
      onBrowserPaneUrlChange((event) => {
        if (event.sessionId !== browserSessionId || event.paneId !== pane.id) {
          return
        }

        setTabs(event.tabs)
        setCommittedUrl(event.url)
        onUrlChangeRef.current?.(session.id, pane.id, event.url)
      }),
    [browserSessionId, pane.id, session.id]
  )

  useEffect(
    () =>
      onBrowserPaneTabsChange((event) => {
        if (event.sessionId !== browserSessionId || event.paneId !== pane.id) {
          return
        }

        if (event.tabs.length === 0) {
          return
        }

        setTabs(event.tabs)

        // event.tabs is non-empty here (the length === 0 early-return above),
        // so the first tab is always a valid fallback.
        const nextActiveTab =
          event.tabs.find((tab) => tab.active) ?? event.tabs[0]
        setCommittedUrl(nextActiveTab.url)
        onUrlChangeRef.current?.(session.id, pane.id, nextActiveTab.url)
      }),
    [browserSessionId, pane.id, session.id]
  )

  useEffect(
    () =>
      onBrowserPaneFocusAddress((event) => {
        if (event.sessionId !== browserSessionId || event.paneId !== pane.id) {
          return
        }

        setIsEditing(true)
      }),
    [browserSessionId, pane.id]
  )

  const handleAddressSubmit = useCallback(
    (value: string): void => {
      // Editing ends at submit so post-navigation / redirect url events flow
      // back into the idle draft.
      setIsEditing(false)
      const nextUrl = normalizeUrl(value)
      setCommittedUrl(nextUrl)
      setDraft(nextUrl)
      void navigateBrowserPane({
        sessionId: browserSessionId,
        paneId: pane.id,
        url: nextUrl,
      })
    },
    [browserSessionId, pane.id]
  )

  const handleActivateTab = useCallback(
    (tabId: string): void => {
      void activateBrowserPaneTab({
        sessionId: browserSessionId,
        paneId: pane.id,
        tabId,
      })
    },
    [browserSessionId, pane.id]
  )

  const handleCloseTab = useCallback(
    (tabId: string): void => {
      void closeBrowserPaneTab({
        sessionId: browserSessionId,
        paneId: pane.id,
        tabId,
      })
    },
    [browserSessionId, pane.id]
  )

  const handleNewTab = useCallback((): void => {
    void newBrowserPaneTab({
      sessionId: browserSessionId,
      paneId: pane.id,
      url: DEFAULT_BROWSER_URL,
    })
  }, [browserSessionId, pane.id])

  const handleChromePointerDownCapture = useCallback(
    (event: PointerEvent<HTMLDivElement>): void => {
      if (pane.active || !onRequestActive) {
        return
      }

      suppressNextNativeFocusRef.current = true
      onRequestFocus?.()
      onRequestActive(session.id, pane.id)
      event.stopPropagation()
    },
    [onRequestActive, onRequestFocus, pane.active, pane.id, session.id]
  )

  const handleChromeClick = useCallback(
    (event: MouseEvent<HTMLDivElement>): void => {
      event.stopPropagation()
    },
    []
  )

  const handleBeginEdit = useCallback((): void => {
    setIsEditing(true)
  }, [])

  const handleDraftChange = useCallback((value: string): void => {
    setDraft(value)
  }, [])

  const handleCancelEdit = useCallback((): void => {
    setIsEditing(false)
    setDraft(committedUrl)
  }, [committedUrl])

  const handleOpenExternal = useCallback((): void => {
    void openExternalBrowserPane({
      sessionId: browserSessionId,
      paneId: pane.id,
    })
  }, [browserSessionId, pane.id])

  const handleBack = useCallback((): void => {
    void navActionBrowserPane({
      sessionId: browserSessionId,
      paneId: pane.id,
      action: 'back',
    })
  }, [browserSessionId, pane.id])

  const handleForward = useCallback((): void => {
    void navActionBrowserPane({
      sessionId: browserSessionId,
      paneId: pane.id,
      action: 'forward',
    })
  }, [browserSessionId, pane.id])

  const handleReloadOrStop = useCallback((): void => {
    void navActionBrowserPane({
      sessionId: browserSessionId,
      paneId: pane.id,
      action: navState.isLoading ? 'stop' : 'reload',
    })
  }, [browserSessionId, pane.id, navState.isLoading])

  const handleChromeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      const withModifier = isMacPlatform()
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey
      if (
        withModifier &&
        !event.altKey &&
        !event.shiftKey &&
        !event.repeat &&
        event.code === 'KeyL'
      ) {
        event.preventDefault()
        setIsEditing(true)
      }
    },
    []
  )

  const isFocusVisible = showFocusHighlight && pane.active

  return (
    <div
      data-testid="browser-pane"
      data-browser-pane-id={pane.id}
      onPointerDownCapture={handleChromePointerDownCapture}
      onClick={handleChromeClick}
      onKeyDown={handleChromeKeyDown}
      className="flex h-full w-full flex-col overflow-hidden rounded-[10px] bg-surface"
      style={{
        border: `2px solid ${
          isFocusVisible ? BROWSER_IDENTITY.accent : 'rgba(74,68,79,0.22)'
        }`,
        boxShadow: isFocusVisible
          ? `0 0 0 6px ${BROWSER_IDENTITY.accentDim}, 0 8px 32px rgba(0,0,0,0.35)`
          : 'none',
        transition: 'border-color 180ms ease, box-shadow 220ms ease',
      }}
    >
      <BrowserTabBar
        tabs={tabs}
        onActivate={handleActivateTab}
        onClose={handleCloseTab}
        onNewTab={handleNewTab}
        onClosePane={
          onClose ? (): void => onClose(session.id, pane.id) : undefined
        }
      />
      <BrowserToolbar
        committedUrl={committedUrl}
        draft={draft}
        isEditing={isEditing}
        onBeginEdit={handleBeginEdit}
        onDraftChange={handleDraftChange}
        onSubmit={handleAddressSubmit}
        onCancel={handleCancelEdit}
        onOpenExternal={handleOpenExternal}
        canOpenExternal={tabs.length > 0}
        canGoBack={navState.canGoBack}
        canGoForward={navState.canGoForward}
        isLoading={navState.isLoading}
        onBack={handleBack}
        onForward={handleForward}
        onReloadOrStop={handleReloadOrStop}
      />
      <div
        ref={contentRef}
        className="relative min-h-0 flex-1 bg-surface-container/60"
        data-testid="browser-pane-content"
      >
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-surface-container/60 text-center font-mono text-[11px] text-on-surface-muted">
          <div>
            {createError ? (
              <p className="text-error">{createError}</p>
            ) : (
              <p>Electron WebContentsView browser surface</p>
            )}
            {cdpInfo ? (
              <p className="mt-2 max-w-[520px] break-all text-primary/80">
                CDP {cdpInfo.url} token hidden
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
