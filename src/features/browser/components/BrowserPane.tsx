import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from 'react'
import type { Pane, Session } from '../../sessions/types'
import { isShellPane } from '../../sessions/utils/paneKind'
import {
  activateBrowserPaneTab,
  closeBrowserPaneTab,
  createBrowserPane,
  focusBrowserPane,
  getBrowserCdpInfo,
  navigateBrowserPane,
  newBrowserPaneTab,
  onBrowserPaneFocus,
  onBrowserPaneTabsChange,
  onBrowserPaneUrlChange,
  setBrowserPaneBounds,
} from '../browserBridge'
import type { BrowserCdpInfo, BrowserPaneTab } from '../types'
import { DEFAULT_BROWSER_URL } from '../types'

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
  const goButtonRef = useRef<HTMLButtonElement>(null)
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
  const isAddressEditingRef = useRef(false)
  const [cdpInfo, setCdpInfo] = useState<BrowserCdpInfo | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)

  const [tabs, setTabs] = useState<BrowserPaneTab[]>([
    { id: 'tab-0', url, title: null, active: true },
  ])
  const browserSessionId = browserSessionIdForSession(session)

  const activeTab =
    tabs.find((tab) => tab.active) ?? (tabs.length > 0 ? tabs[0] : undefined)

  const paneIds = useMemo(
    () => session.panes.map((sessionPane) => sessionPane.id),
    [session.panes]
  )

  // Mirror the active tab URL into the draft whenever the bar is idle (not
  // being edited). Guarded by the editing ref so a focused, half-typed draft
  // survives the stream of native url/tabs-changed events.
  useEffect(() => {
    if (!isAddressEditingRef.current) {
      setDraft(committedUrl)
    }
  }, [committedUrl])

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

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    // Editing ends at submit even if the input keeps focus (Enter), so the
    // post-navigation / redirect url events flow back into the draft. A
    // subsequent keystroke re-arms editing via onChange.
    isAddressEditingRef.current = false
    const nextUrl = normalizeUrl(draft)
    setCommittedUrl(nextUrl)
    setDraft(nextUrl)
    void navigateBrowserPane({
      sessionId: browserSessionId,
      paneId: pane.id,
      url: nextUrl,
    })
  }

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
    (event: MouseEvent<HTMLButtonElement>, tabId: string): void => {
      event.stopPropagation()
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

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-lg bg-surface shadow-[inset_0_0_0_1px_rgba(108,112,134,0.22)] ${
        showFocusHighlight && pane.active ? 'ring-1 ring-primary/35' : ''
      }`}
      data-testid="browser-pane"
      data-browser-pane-id={pane.id}
    >
      <div
        className="flex shrink-0 items-center gap-2 bg-surface-container/95 px-2 py-2"
        onPointerDownCapture={handleChromePointerDownCapture}
        onClick={handleChromeClick}
      >
        {tabs.length > 0 ? (
          <div
            className="flex max-w-[42%] shrink-0 items-center gap-1 overflow-x-auto"
            role="tablist"
            aria-label="browser tabs"
          >
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`flex max-w-[190px] items-center overflow-hidden rounded-md transition ${
                  tab.active
                    ? 'bg-primary/15 text-primary'
                    : 'bg-white/[0.04] text-on-surface-muted hover:bg-white/[0.08] hover:text-on-surface'
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.active}
                  aria-label={`browser tab ${tab.title ?? tab.url}`}
                  onClick={(): void => handleActivateTab(tab.id)}
                  className="min-w-0 flex-1 truncate px-2 py-1.5 text-left font-mono text-[10.5px] focus:outline-none focus:ring-2 focus:ring-primary/45"
                >
                  {tab.title ?? tab.url}
                </button>
                {tabs.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`close browser tab ${tab.title ?? tab.url}`}
                    onClick={(event): void => handleCloseTab(event, tab.id)}
                    className="px-1.5 py-1 font-mono text-[10px] opacity-70 hover:bg-white/[0.08] hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary/45"
                  >
                    x
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              aria-label="new browser tab"
              onClick={handleNewTab}
              className="rounded-md bg-white/[0.04] px-2 py-1.5 font-mono text-[12px] text-on-surface-muted transition hover:bg-white/[0.08] hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/45"
            >
              +
            </button>
          </div>
        ) : null}
        <form className="flex min-w-0 flex-1 gap-2" onSubmit={handleSubmit}>
          <input
            aria-label="browser address"
            value={draft}
            onFocus={(): void => {
              // Mark the bar as being edited so idle url-syncs pause.
              isAddressEditingRef.current = true
            }}
            onChange={(event): void => {
              // Any keystroke (re-)arms editing — covers typing again after an
              // Enter submit cleared the flag while the input kept focus.
              isAddressEditingRef.current = true
              setDraft(event.currentTarget.value)
            }}
            onBlur={(event): void => {
              isAddressEditingRef.current = false

              // Tab-to-Go: focus moving to THIS pane's Go button means a
              // navigation is imminent, so keep the typed draft for the pending
              // submit. Match the button instance (not a generic type=submit
              // attribute) so focus moving to any other submit button in the
              // tree doesn't accidentally preserve a stale draft. Any other blur
              // is a cancel — revert the draft to the live committed URL so the
              // bar and an idle Go aren't left showing an abandoned value (a url
              // event may have changed committedUrl while editing, when the idle
              // effect was paused).
              if (event.relatedTarget !== goButtonRef.current) {
                setDraft(committedUrl)
              }
            }}
            className="min-w-0 flex-1 rounded-md bg-surface-container px-3 py-1.5 font-mono text-[12px] text-on-surface outline-none ring-1 ring-outline-variant/20 transition focus:ring-primary/45"
          />
          <button
            ref={goButtonRef}
            type="submit"
            onMouseDown={(event): void => {
              // Keep the input focused through a mouse click so the draft
              // survives to submit — the blur-cancel resync would otherwise
              // revert it before the click reaches handleSubmit.
              event.preventDefault()
            }}
            className="rounded-md bg-primary/15 px-3 py-1.5 font-mono text-[11px] text-primary transition hover:bg-primary/25 focus:outline-none focus:ring-2 focus:ring-primary/45"
          >
            Go
          </button>
        </form>
        <span className="hidden max-w-[160px] truncate font-mono text-[10px] text-on-surface-muted lg:inline">
          {/* A user-set pane label (`:rename-pane`) wins over the live tab
              title, mirroring the shell Header's `userLabel ?? agentTitle ??
              session.name` precedence — so renaming a browser pane is visible. */}
          {pane.userLabel ??
            (activeTab ? (activeTab.title ?? activeTab.url) : null)}
        </span>
        {onClose ? (
          <button
            type="button"
            aria-label="close browser pane"
            onClick={(): void => onClose(session.id, pane.id)}
            className="rounded-md px-2 py-1 font-mono text-[11px] text-on-surface-muted transition hover:bg-white/[0.06] hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/45"
          >
            Close
          </button>
        ) : null}
      </div>
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
