# Vimeflow — Main View Chrome Migration

> **Paste-to-agent prompt (copy this whole block to your coding agent):**
>
> Update the **main view** (`src/app.jsx`) — three connected changes that ship as one cohesive treatment. **(1) Floating stage:** wrap `<main>` _and_ the right `<ActivityPanel>` together in a new floating-stage `<div>` so the whole right side lifts above the left sidebar as one rounded, shadowed surface (sidebar stays flush). **(2) Top banner:** the slim **44px top chrome bar** at the top of `<main>` — flat `#0d0d1c`, hairline bottom rule, a **left gutter that opens to 50px only when the sidebar is collapsed** (so the floating collapse toggle never overlaps), holding the layout pills (split mode) or the active-session identity + a "split" button (single mode). **(3) Bottom action bar:** the **24px status bar** at the bottom of `<main>` — flat `#0d0d1c`, hairline top rule, two icon **action buttons on the left** (command palette + show/hide dock) and live session readouts pushed to the right (duration · context · cache % · turns · diff counts). All three share the same surface (`#0d0d1c`), the same hairline color family (`rgba(74,68,79,…)`), and the same JetBrains Mono micro-labels. The radius + shadow on the stage and the 50px gutter on the top banner are **conditional on `tweaks.sidebarCollapsed`**. Follow the per-decision reasoning in each section; don't re-flatten the columns, don't make the radius/shadow/gutter unconditional, and don't move the action buttons off the bottom bar's left edge.

---

## 0. Scope

`main`'s shell only — the floating-stage wrapper around it, its top banner, and its bottom action bar. **File touched:** `src/app.jsx`. No new components, no new deps. The contents _inside_ the banner/bar (LayoutSwitcher, the session readouts, the icon buttons) already exist; this migration is about the **three chrome containers** and how they layer.

Shared tokens used across all three:

```
surface          #0d0d1c          (stage children, both bars)
hairline         rgba(74,68,79,0.25)  top-banner bottom rule
hairline-soft    rgba(74,68,79,0.20)  bottom-bar top rule
mono             'JetBrains Mono'      all chrome micro-labels
accent           #e2c7ff / #cba6f7     lavender (hover, active session glyph)
success          #7defa1               running dot, dock-open, +added
coral            #ff94a5               −removed
muted            #8a8299  variant #cdc3d1
```

---

## Part 1 · Floating stage

The root render is `<div className="vf-root …" style={{ display:'flex' }}>`. Today it's a flat 3-column flex `[ Sidebar | main | ActivityPanel ]`. Wrap `<main>` **and** `<ActivityPanel>` together in one floating-stage `<div>`, placed right after the `Sidebar` block:

```jsx
{!tweaks.sidebarCollapsed && <Sidebar … />}

{/* Floating stage — the whole right side (top banner, content, bottom
    banner + activity panel) lifts above the sidebar as one surface:
    rounded left corners, overlaps the rail, soft shadow. Only the left
    sidebar stays flush. */}
<div style={{
  flex: 1, minWidth: 0, display: 'flex', position: 'relative',
  zIndex: 2,
  borderTopLeftRadius: tweaks.sidebarCollapsed ? 0 : 14,
  borderBottomLeftRadius: tweaks.sidebarCollapsed ? 0 : 14,
  overflow: 'hidden',
  boxShadow: tweaks.sidebarCollapsed
    ? 'none'
    : '-16px 0 34px -14px rgba(0,0,0,0.55), inset 1px 0 0 rgba(255,255,255,0.035)',
}}>

  {/* existing <main> … </main> — unchanged — goes here */}

  {/* existing <ActivityPanel … /> — unchanged — goes here */}

</div>
```

**Reasoning**

- **Wrap main + activity together (not main alone):** the stage reads as the _workspace_ lifting off the sidebar as one plane. Wrapping only `<main>` stops the rounded corner + shadow halfway across the right side.
- **`overflow:hidden`** is what makes the corner radius actually clip the `#0d0d1c` banner and the activity panel — without it the children paint square corners over the rounded box.
- **`zIndex:2` + leftward shadow** (`-16px 0 34px -14px rgba(0,0,0,0.55)`) casts onto the sidebar, so the stage must stack above it. The `inset 1px 0 0 rgba(255,255,255,0.035)` is a 1px top catch-light — the "raised panel" read without a hard border.
- **Conditional on `!sidebarCollapsed`:** collapsed, there's nothing to the left to float over, so radius → `0` and shadow → `none` and the stage fills edge-to-edge. No transition — the sidebar mounts/unmounts rather than animating width, so the stage reflows instantly.

---

## Part 2 · Top banner (44px top chrome bar)

First child of `<main>`. Session switching lives in the left sidebar now, so there is **no** horizontal session-tab strip — this slim bar carries layout controls instead.

```jsx
{
  ;(() => {
    const collapsed = !!tweaks.sidebarCollapsed
    const activeAgent =
      window.VIMEFLOW_AGENTS[activeSession.agentKey] ||
      window.VIMEFLOW_AGENTS.claude
    return (
      <div
        style={{
          position: 'relative',
          height: 44,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: '#0d0d1c',
          borderBottom: '1px solid rgba(74,68,79,0.25)',
          paddingLeft: collapsed ? 50 : 14, // ← reserves the gutter for the floating toggle
          paddingRight: 14,
          transition: 'padding-left 180ms cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {/* Floating sidebar toggle — sits in the reserved gutter (collapsed only) */}
        {collapsed && (
          <div style={{ position: 'absolute', top: 8, left: 12, zIndex: 30 }}>
            <SidebarToggle
              collapsed={true}
              onClick={() => updateTweaks({ sidebarCollapsed: false })}
              size={28}
              variant="inset"
            />
          </div>
        )}

        {tweaks.splitMode ? (
          <>
            <span style={{ flex: 1 }} />
            {/* Layout pills — right-aligned, label-free */}
            <LayoutSwitcher layoutId={layoutId} onPick={setLayout} />
          </>
        ) : (
          <>
            {/* Single-pane mode: active session for orientation */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background:
                    activeAgent?.accentDim || 'rgba(203,166,247,0.12)',
                  color: activeAgent?.accent || '#cba6f7',
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {activeAgent?.glyph || '∴'}
              </span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  color: '#cdc3d1',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {activeSession.title}
              </span>
              {activeSession.state === 'running' && (
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 999,
                    background: '#7defa1',
                    boxShadow: '0 0 6px #7defa1',
                    flexShrink: 0,
                    animation: 'vfPulse 1.6s ease-in-out infinite',
                  }}
                />
              )}
            </div>
            <span style={{ flex: 1 }} />
            <button
              onClick={() => updateTweaks({ splitMode: true })}
              title="Enter split view  ⌘\"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 26,
                padding: '0 10px',
                borderRadius: 7,
                background: 'transparent',
                border: '1px solid rgba(74,68,79,0.35)',
                color: '#8a8299',
                cursor: 'pointer',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.04em',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#e2c7ff'
                e.currentTarget.style.borderColor = 'rgba(203,166,247,0.45)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#8a8299'
                e.currentTarget.style.borderColor = 'rgba(74,68,79,0.35)'
              }}
            >
              <Icon name="splitscreen" size={13} /> split
            </button>
          </>
        )}
      </div>
    )
  })()
}
```

**Reasoning**

- **Reserved gutter, not an overlay:** the collapse toggle floats at `left:12, 28px` over the bar's left edge. Padding the bar's content to `50px` (`12 + 28 + ~10 gap`) **only when collapsed** shifts the pills right to clear it, then snaps back when the sidebar reopens — the 180ms `padding-left` transition makes that motion deliberate. Toggle is vertically centered for 44px (`top:8` → `(44−28)/2`).
- **Pills right-aligned, label-free:** the layout glyphs are self-explanatory; a "Layout" label and keyboard-hint text were intentionally removed.
- **Single-pane fallback:** when `splitMode` is off, the bar shows the active agent glyph + session title (with a running pulse dot) for orientation, and a ghost "split" button as the affordance back into split view.

---

## Part 3 · Bottom action bar (24px status bar)

Last child of `<main>` (after the content row, before the palette/settings/tweaks portals). Flat surface, hairline top rule, **action buttons left / readouts right**.

```jsx
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
  {/* LEFT — two icon action buttons */}
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    {/* Command palette ⌘K */}
    <button
      onClick={() => setPaletteOpen(true)}
      title="Command Palette  ⌘K"
      aria-label="Open command palette"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 18,
        borderRadius: 5,
        background: 'rgba(26,26,42,0.6)',
        border: 'none',
        color: '#9b93ab',
        cursor: 'pointer',
        transition: 'all 140ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = '#e2c7ff'
        e.currentTarget.style.background = 'rgba(226,199,255,0.1)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = '#9b93ab'
        e.currentTarget.style.background = 'rgba(26,26,42,0.6)'
      }}
    >
      <Icon name="terminal" size={13} />
    </button>

    {/* Show / hide editor & diff dock */}
    {(() => {
      const dockOpen =
        tweaks.bottomPanelOpen && (tweaks.dockPosition || 'bottom') !== 'hidden'
      return (
        <button
          onClick={() =>
            updateTweaks({
              bottomPanelOpen: !dockOpen,
              dockPosition:
                (tweaks.dockPosition || 'bottom') === 'hidden'
                  ? 'bottom'
                  : tweaks.dockPosition || 'bottom',
            })
          }
          title={dockOpen ? 'Hide editor & diff' : 'Show editor & diff'}
          aria-label={
            dockOpen ? 'Hide editor & diff panel' : 'Show editor & diff panel'
          }
          aria-pressed={dockOpen}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 18,
            borderRadius: 5,
            background: dockOpen
              ? 'rgba(125,239,161,0.12)'
              : 'rgba(26,26,42,0.6)',
            border: 'none',
            color: dockOpen ? '#7defa1' : '#9b93ab',
            cursor: 'pointer',
            transition: 'all 140ms ease',
          }}
          onMouseEnter={(e) => {
            if (!dockOpen) {
              e.currentTarget.style.color = '#7defa1'
              e.currentTarget.style.background = 'rgba(125,239,161,0.1)'
            }
          }}
          onMouseLeave={(e) => {
            if (!dockOpen) {
              e.currentTarget.style.color = '#9b93ab'
              e.currentTarget.style.background = 'rgba(26,26,42,0.6)'
            }
          }}
        >
          <Icon name="wysiwyg" size={13} fill={dockOpen ? 1 : 0} />
        </button>
      )
    })()}
  </span>

  {/* spacer pushes readouts to the right */}
  <span style={{ flex: 1 }} />

  {/* RIGHT — live session readouts */}
  {activeSession.startedAgo && activeSession.startedAgo !== '—' && (
    <>
      <Icon name="schedule" size={11} style={{ color: '#8a8299' }} />
      <span style={{ color: '#cdc3d1' }}>{activeSession.startedAgo}</span>
      <span>·</span>
    </>
  )}
  <ContextSmiley pct={tweaks.contextPct} />
  <span>·</span>
  {(() => {
    const c = activeSession.cache || { cached: 0, wrote: 0, fresh: 0 }
    const total = c.cached + c.wrote + c.fresh
    const rate = total > 0 ? Math.round((c.cached / total) * 100) : 0
    const tone = rate >= 70 ? '#7defa1' : rate >= 40 ? '#e2c7ff' : '#ff94a5'
    return total > 0 ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Icon name="bolt" size={11} style={{ color: tone }} />
        <span style={{ color: tone, fontWeight: 600 }}>{rate}%</span>
        <span>cached</span>
      </span>
    ) : null
  })()}
  <span>·</span>
  <span>{activeSession.turns} turns</span>
  {(activeSession.changes?.added > 0 || activeSession.changes?.removed > 0) && (
    <>
      <span>·</span>
      <span style={{ color: '#7defa1' }}>
        +{activeSession.changes.added.toLocaleString()}
      </span>
      <span style={{ color: '#ff94a5' }}>
        −{activeSession.changes.removed.toLocaleString()}
      </span>
    </>
  )}
</div>
```

**Reasoning**

- **Actions left, status right:** the two icon buttons (command palette, dock toggle) are _controls_; the readouts are _state_. Splitting them with a `flex:1` spacer keeps the controls anchored where the eye starts (left) and the metrics where it scans for status (right).
- **Dock toggle is stateful:** when the dock is open it tints success-green and fills its icon (`fill={1}`); closed, it's neutral and hollow. Toggling re-opens to `bottom` if it was `hidden`, else preserves the last dock side.
- **Session duration moved here** from the agent status panel footer so it survives when that panel is collapsed.
- **Cache % is tone-mapped:** ≥70 green, ≥40 lavender, else coral — a glanceable health read. Readout chips are conditional (no zero-state noise): duration, cache, and diff counts each render only when they have a value.

---

## Verification checklist

**Floating stage**

- [ ] Sidebar open: right side has rounded top-left & bottom-left corners + a soft shadow onto the sidebar; corners clip the banner and activity panel; faint 1px inner-left catch-light (not a hard border).
- [ ] Collapse the sidebar (⌘B): square corners, no shadow, edge-to-edge. Re-open: rounded + shadow return.

**Top banner**

- [ ] 44px, flat `#0d0d1c`, hairline bottom rule. Split mode: layout pills right-aligned, no "Layout" label.
- [ ] Collapse sidebar: floating toggle appears in the left gutter and does **not** overlap the pills; pills slide right (180ms) and snap back on expand.
- [ ] Single-pane mode: shows active agent glyph + title (+ running dot) and a ghost "split" button.

**Bottom action bar**

- [ ] 24px, flat `#0d0d1c`, hairline top rule. Two icon buttons on the **left** (command palette, dock toggle); readouts on the **right**.
- [ ] Dock toggle tints green + fills when the dock is open; opens palette / toggles dock correctly.
- [ ] Right side shows duration · context smiley · cache % (tone-mapped) · turns · +added/−removed, each only when it has a value.

---

## Live reference

`Vimeflow.html` (project root) is the runnable reference. Toggle the sidebar (⌘B), flip split mode, and open/close the dock to exercise all three chrome pieces. The shipped code lives in `src/app.jsx`: the stage wrapper right after the `Sidebar` block, the top banner as the first child of `<main>`, the bottom action bar as `<main>`'s last child before the palette/settings/tweaks portals.
