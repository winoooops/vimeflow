// Vimeflow — main app. Wires shell + views + overlays, manages state, handles Tweaks protocol.

function App() {
  // --- Tweakable defaults --------------------------------------------------
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
    aesthetic: 'obsidian',
    density: 'comfortable',
    contextPct: 74,
    accentHue: 285,
    agentState: 'running',
    activeSessionId: 'sess_auth',
    view: 'terminal',
    splitMode: true,
    layout: 'vsplit',
    focusedPaneId: 'p1',
    activityCollapsed: false,
    bottomPanelOpen: true,
    bottomPanelTab: 'diff',
    dockPosition: 'bottom',
    dockSize: 40,
    openSessionIds: ['sess_auth', 'sess_tests'],
    panes: [
      {
        id: 'p1',
        agentId: 'claude',
        sessionId: 'sess_auth',
        title: 'auth refactor',
      },
      {
        id: 'p2',
        agentId: 'codex',
        sessionId: 'sess_tests',
        title: 'test review',
      },
    ],
  } /*EDITMODE-END*/

  const persisted =
    JSON.parse(localStorage.getItem('vimeflow_state') || 'null') || {}
  const [tweaks, setTweaks] = useState({ ...TWEAK_DEFAULTS, ...persisted })
  const updateTweaks = useCallback((delta) => {
    setTweaks((prev) => {
      const next = { ...prev, ...delta }
      localStorage.setItem('vimeflow_state', JSON.stringify(next))
      try {
        window.parent.postMessage(
          { type: '__edit_mode_set_keys', edits: delta },
          '*'
        )
      } catch (e) {}
      return next
    })
  }, [])

  // --- Edit-mode protocol (Tweaks toolbar toggle) -------------------------
  const [tweaksOpen, setTweaksOpen] = useState(false)
  useEffect(() => {
    const onMsg = (e) => {
      if (!e.data) return
      if (e.data.type === '__activate_edit_mode') setTweaksOpen(true)
      else if (e.data.type === '__deactivate_edit_mode') setTweaksOpen(false)
    }
    window.addEventListener('message', onMsg)
    try {
      window.parent.postMessage({ type: '__edit_mode_available' }, '*')
    } catch (e) {}
    return () => window.removeEventListener('message', onMsg)
  }, [])

  // --- Sessions / active --------------------------------------------------
  // Sync session state to selected agentState tweak
  const sessions = useMemo(() => {
    return window.VIMEFLOW_SESSIONS.map((s) => {
      if (s.id === tweaks.activeSessionId)
        return { ...s, state: tweaks.agentState }
      return s
    })
  }, [tweaks.agentState, tweaks.activeSessionId])
  const activeSession =
    sessions.find((s) => s.id === tweaks.activeSessionId) || sessions[0]

  // Open session tabs (browser-like). The first time, derive from default panes.
  const openSessionIds =
    tweaks.openSessionIds && tweaks.openSessionIds.length > 0
      ? tweaks.openSessionIds
      : ['sess_auth', 'sess_tests']
  const openSessions = openSessionIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter(Boolean)

  const closeSessionTab = useCallback(
    (id) => {
      const next = openSessionIds.filter((x) => x !== id)
      if (next.length === 0) return
      const nextActive =
        id === tweaks.activeSessionId ? next[0] : tweaks.activeSessionId
      updateTweaks({ openSessionIds: next, activeSessionId: nextActive })
    },
    [openSessionIds, tweaks.activeSessionId, updateTweaks]
  )

  const newSessionTab = useCallback(() => {
    // Open the first non-open session, or fall back to scratchpad
    const candidate =
      sessions.find((s) => !openSessionIds.includes(s.id)) ||
      sessions[sessions.length - 1]
    if (!candidate) return
    const next = openSessionIds.includes(candidate.id)
      ? openSessionIds
      : [...openSessionIds, candidate.id]
    updateTweaks({ openSessionIds: next, activeSessionId: candidate.id })
  }, [sessions, openSessionIds, updateTweaks])

  // Build a session lookup for the split-view panes.
  const sessionsById = useMemo(() => {
    const m = {}
    sessions.forEach((s) => {
      m[s.id] = s
    })
    return m
  }, [sessions])

  // --- Split-view state ---------------------------------------------------
  const panes = tweaks.panes || window.VIMEFLOW_DEFAULT_PANES
  const layoutId = tweaks.layout || 'vsplit'
  const focusedPaneId = tweaks.focusedPaneId || panes[0]?.id

  const setLayout = useCallback(
    (id) => {
      const cap = window.VIMEFLOW_LAYOUTS[id]?.capacity || 1
      let nextPanes = panes.slice(0, cap)
      // Grow panes to capacity by reusing default templates.
      while (nextPanes.length < cap) {
        const idx = nextPanes.length
        const tmpl =
          window.VIMEFLOW_DEFAULT_PANES[
            idx % window.VIMEFLOW_DEFAULT_PANES.length
          ]
        nextPanes = [
          ...nextPanes,
          {
            id: `p${Date.now()}_${idx}`,
            agentId:
              idx === 0
                ? 'claude'
                : idx === 1
                  ? 'codex'
                  : idx === 2
                    ? 'gemini'
                    : 'shell',
            sessionId: tmpl.sessionId,
            title: tmpl.title,
          },
        ]
      }
      const focusedStillExists = nextPanes.some((p) => p.id === focusedPaneId)
      updateTweaks({
        layout: id,
        panes: nextPanes,
        focusedPaneId: focusedStillExists ? focusedPaneId : nextPanes[0].id,
      })
    },
    [panes, focusedPaneId, updateTweaks]
  )

  const focusPane = useCallback(
    (id) => {
      updateTweaks({ focusedPaneId: id })
    },
    [updateTweaks]
  )

  // Resolve the focused pane → session + agent for the activity panel.
  const focusedPane = panes.find((p) => p.id === focusedPaneId) || panes[0]
  const focusedSession = focusedPane
    ? sessions.find((s) => s.id === focusedPane.sessionId) || activeSession
    : activeSession
  const focusedAgent = focusedPane
    ? window.VIMEFLOW_AGENTS[focusedPane.agentId] ||
      window.VIMEFLOW_AGENTS.claude
    : window.VIMEFLOW_AGENTS[activeSession.agentKey] ||
      window.VIMEFLOW_AGENTS.claude

  const closePane = useCallback(
    (id) => {
      const next = panes.filter((p) => p.id !== id)
      if (next.length === 0) return
      // Auto-shrink layout to fit
      const fitLayout =
        next.length === 1
          ? 'single'
          : next.length === 2
            ? layoutId === 'hsplit'
              ? 'hsplit'
              : 'vsplit'
            : next.length === 3
              ? 'threeRight'
              : 'quad'
      updateTweaks({
        panes: next,
        layout: fitLayout,
        focusedPaneId: next[0].id,
      })
    },
    [panes, layoutId, updateTweaks]
  )

  // Keyboard shortcuts: ⌘1-4 to focus pane N, ⌘\ to vsplit, ⌘- to close
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return
      // ⌘1-4 → focus pane index
      if (e.key >= '1' && e.key <= '4') {
        const idx = parseInt(e.key, 10) - 1
        if (panes[idx]) {
          e.preventDefault()
          focusPane(panes[idx].id)
        }
      }
      // ⌘\ → toggle vsplit/single
      if (e.key === '\\') {
        e.preventDefault()
        setLayout(layoutId === 'single' ? 'vsplit' : 'single')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panes, layoutId, focusPane, setLayout])

  // --- View state ---------------------------------------------------------
  const [view, setView] = useState(tweaks.view)
  useEffect(() => {
    setView(tweaks.view)
  }, [tweaks.view])
  const setViewAndPersist = (v) => {
    setView(v)
    updateTweaks({ view: v })
  }

  // --- Area (icon rail) - treated as view shortcuts ----------------------
  const [activeArea, setActiveArea] = useState('agent')
  const onArea = (id) => {
    setActiveArea(id)
    if (id === 'agent') setViewAndPersist('terminal')
    if (id === 'files') setViewAndPersist('files')
    if (id === 'editor') setViewAndPersist('editor')
    if (id === 'diff') setViewAndPersist('diff')
    if (id === 'ctx') {
      /* stay on current view, sidebar switches tab */
    }
  }

  // --- Command palette ---------------------------------------------------
  const [paletteOpen, setPaletteOpen] = useState(false)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const runCommand = (c) => {
    if (c.cmd === ':open') setViewAndPersist('editor')
    else if (c.cmd === ':diff') setViewAndPersist('diff')
    else if (c.cmd === ':pause') updateTweaks({ agentState: 'idle' })
    else if (c.cmd === ':context') {
      /* just close */
    }
  }

  // --- Apply aesthetic hue at document level ------------------------------
  const aesthetic = window.VIMEFLOW_AESTHETICS[tweaks.aesthetic]
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--vf-accent-hue',
      String(tweaks.accentHue)
    )
    document.documentElement.style.setProperty(
      '--vf-display-font',
      aesthetic.displayFont
    )
  }, [tweaks.accentHue, aesthetic.displayFont])

  const ctx = {
    aesthetic: tweaks.aesthetic,
    density: tweaks.density,
    contextPct: tweaks.contextPct,
    accentHue: tweaks.accentHue,
    agentState: tweaks.agentState,
  }

  const script = window.VIMEFLOW_TERMINAL_SCRIPT

  return (
    <window.VFContext.Provider value={ctx}>
      <div
        className={`vf-root vf-aesthetic-${tweaks.aesthetic} vf-density-${tweaks.density}`}
        style={{
          position: 'fixed',
          inset: 0,
          background: '#0d0d1c',
          color: '#e3e0f7',
          fontFamily: "'Inter', sans-serif",
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        <IconRail
          activeArea={activeArea}
          onArea={onArea}
          onCommand={() => setPaletteOpen(true)}
        />

        <Sidebar
          sessions={sessions}
          activeId={activeSession.id}
          onPick={(id) => updateTweaks({ activeSessionId: id })}
          tree={window.VIMEFLOW_TREE}
          density={tweaks.density}
        />

        {/* Main + activity */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
          }}
        >
          <SessionTabs
            sessions={openSessions}
            activeId={activeSession.id}
            onPick={(id) => updateTweaks({ activeSessionId: id })}
            onClose={closeSessionTab}
            onNew={newSessionTab}
          />

          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            {(() => {
              const pos = tweaks.dockPosition || 'bottom'
              const open = tweaks.bottomPanelOpen && pos !== 'hidden'
              const dockPct = Math.max(20, Math.min(70, tweaks.dockSize || 40))
              // Flex direction + order maps the dock around the terminal area.
              const isVertical = pos === 'bottom' || pos === 'top'
              const flexDir = isVertical ? 'column' : 'row'
              const dockBefore = pos === 'top' || pos === 'left'
              const terminalFlex = open ? `1 1 ${100 - dockPct}%` : '1 1 100%'
              const dockFlex = `1 1 ${dockPct}%`

              const TerminalArea = (
                <div
                  style={{
                    flex: terminalFlex,
                    minHeight: 0,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {tweaks.splitMode ? (
                    <>
                      <div
                        style={{
                          flexShrink: 0,
                          padding: '8px 14px',
                          background: '#121221',
                          borderBottom: '1px solid rgba(74,68,79,0.18)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          flexWrap: 'wrap',
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 10,
                            color: '#8a8299',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                          }}
                        >
                          Layout
                        </span>
                        <LayoutSwitcher
                          layoutId={layoutId}
                          onPick={setLayout}
                        />
                        <span style={{ flex: 1 }} />
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 10,
                            color: '#6c7086',
                          }}
                        >
                          <Kbd>⌘</Kbd>+<Kbd>1-4</Kbd> focus pane · <Kbd>⌘</Kbd>+
                          <Kbd>\</Kbd> toggle split
                        </span>
                      </div>
                      <SplitView
                        panes={panes}
                        layoutId={layoutId}
                        focusedPaneId={focusedPaneId}
                        onFocus={focusPane}
                        onClosePane={closePane}
                        agentsBySession={sessionsById}
                        paused={activeSession.state !== 'running'}
                      />
                    </>
                  ) : (
                    <TerminalView
                      session={activeSession}
                      paused={activeSession.state !== 'running'}
                      script={script}
                    />
                  )}
                </div>
              )

              const DockArea = open ? (
                <DockPanel
                  position={pos}
                  flex={dockFlex}
                  tab={tweaks.bottomPanelTab || 'diff'}
                  onTab={(t) => updateTweaks({ bottomPanelTab: t })}
                  onClose={() => updateTweaks({ bottomPanelOpen: false })}
                  onMovePosition={(p) =>
                    updateTweaks({
                      dockPosition: p,
                      bottomPanelOpen: p !== 'hidden',
                    })
                  }
                  file={window.VIMEFLOW_EDITOR_FILE}
                  hunk={window.VIMEFLOW_DIFF_HUNK}
                  diffFiles={window.VIMEFLOW_DIFF_FILES}
                  tree={window.VIMEFLOW_TREE}
                />
              ) : (
                <button
                  onClick={() =>
                    updateTweaks({
                      bottomPanelOpen: true,
                      dockPosition: pos === 'hidden' ? 'bottom' : pos,
                    })
                  }
                  style={{
                    flexShrink: 0,
                    ...(isVertical
                      ? {
                          height: 26,
                          width: '100%',
                          borderTop: '1px solid rgba(74,68,79,0.25)',
                        }
                      : {
                          width: 26,
                          height: '100%',
                          borderLeft: '1px solid rgba(74,68,79,0.25)',
                          flexDirection: 'column',
                        }),
                    background: '#0d0d1c',
                    border: 'none',
                    color: '#8a8299',
                    cursor: 'pointer',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    writingMode: isVertical ? 'horizontal-tb' : 'vertical-rl',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#e2c7ff'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#8a8299'
                  }}
                >
                  <Icon
                    name={isVertical ? 'expand_less' : 'chevron_left'}
                    size={14}
                  />{' '}
                  show editor & diff
                </button>
              )

              return (
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: flexDir,
                  }}
                >
                  {dockBefore ? (
                    <>
                      {DockArea}
                      {TerminalArea}
                    </>
                  ) : (
                    <>
                      {TerminalArea}
                      {DockArea}
                    </>
                  )}
                </div>
              )
            })()}

            <ActivityPanel
              session={focusedSession || activeSession}
              running={(focusedSession || activeSession).state === 'running'}
              agent={focusedAgent}
              collapsed={!!tweaks.activityCollapsed}
              onToggleCollapsed={() =>
                updateTweaks({ activityCollapsed: !tweaks.activityCollapsed })
              }
            />
          </div>

          {/* Global status bar */}
          <div
            style={{
              height: 24,
              flexShrink: 0,
              background: '#0d0d1c',
              borderTop: '1px solid rgba(74,68,79,0.2)',
              display: 'flex',
              alignItems: 'center',
              padding: '0 12px',
              gap: 14,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              color: '#8a8299',
            }}
          >
            <span style={{ color: '#cba6f7' }}>obsidian-cli</span>
            <span>·</span>
            <span>v0.9.4</span>
            <span style={{ flex: 1 }} />
            <ContextSmiley pct={tweaks.contextPct} />
            <span>·</span>
            {(() => {
              const c = activeSession.cache || { cached: 0, wrote: 0, fresh: 0 }
              const total = c.cached + c.wrote + c.fresh
              const rate = total > 0 ? Math.round((c.cached / total) * 100) : 0
              const tone =
                rate >= 70 ? '#7defa1' : rate >= 40 ? '#e2c7ff' : '#ff94a5'
              return total > 0 ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Icon name="bolt" size={11} style={{ color: tone }} />
                  <span style={{ color: tone, fontWeight: 600 }}>{rate}%</span>
                  <span>cached</span>
                </span>
              ) : null
            })()}
            <span>·</span>
            <span>{activeSession.turns} turns</span>
            <span>·</span>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </div>

          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            commands={window.VIMEFLOW_COMMANDS}
            onRun={runCommand}
          />

          {!tweaksOpen && <TweaksTrigger onClick={() => setTweaksOpen(true)} />}
          <TweaksPanel
            open={tweaksOpen}
            onClose={() => setTweaksOpen(false)}
            tweaks={tweaks}
            onChange={updateTweaks}
          />
        </main>
      </div>
    </window.VFContext.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
