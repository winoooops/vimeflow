# Vimeflow — Agent Status Card Handoff

> **Paste-to-agent prompt (copy this whole block to your coding agent):**
>
> Replace the sidebar's project-switcher banner with an **Agent Status Card**: a single elevated card at the very top of the left sidebar that surfaces the _active session's_ live agent state — session name, status (Running / Awaiting you / Completed / Errored / Idle) with the animated status dot, the current action line, and a compact metric row (elapsed · turns · context %). Dock the existing sidebar collapse toggle in the card's **top-left corner** using its `inset` variant. The card must NOT have a hard 1px border or a colored gradient header stripe — those read as a generic template. Instead use a borderless elevated surface (soft shadow + inset top highlight) with a faint state-tinted radial wash in the top-left corner. The card is fully data-driven off the active session object; do not hardcode "session 1"/"Running". Follow the per-decision reasoning in §3 — each choice has a stated reason; do not re-add the border, the stripe, or a repo/branch footer.

---

## 0. Task

Build `AgentStatusCard` and render it as the first child of the left `Sidebar`, replacing the old project-switcher header (the `VF / vimeflow-core / feat/jose-auth` row). It reflects whichever session is currently active.

**File touched:** `src/shell.jsx` (component lives next to `Sidebar`; `Sidebar` already computes `activeSession` and passes it in). No new deps.

---

## 1. Inputs

`AgentStatusCard({ session, onToggleSidebar })`

- `session` — the active session object. Fields used: `title`, `state`, `subtitle`, `startedAgo`, `turns`, `tokens: { used, max }`.
- `onToggleSidebar` — the same collapse handler used everywhere (`() => updateTweaks({ sidebarCollapsed: !... })`).

`Sidebar` derives it once and passes it down:

```js
const activeSession = sessions.find((s) => s.id === activeId) || sessions[0]
// ...
;<AgentStatusCard session={activeSession} onToggleSidebar={onToggleSidebar} />
```

---

## 2. State → presentation map

One lookup drives dot, label, and the ambient wash. `state` is one of `running | awaiting | completed | errored | idle`.

| state     | label          | tone    | label color | wash (top-left glow)     |
| --------- | -------------- | ------- | ----------- | ------------------------ |
| running   | `Running`      | success | `#7defa1`   | `rgba(80,250,123,0.08)`  |
| awaiting  | `Awaiting you` | warn    | `#ff94a5`   | `rgba(255,148,165,0.09)` |
| completed | `Completed`    | primary | `#e2c7ff`   | `rgba(203,166,247,0.09)` |
| errored   | `Errored`      | error   | `#ffb4ab`   | `rgba(255,180,171,0.09)` |
| idle      | `Idle`         | neutral | `#8a8299`   | `rgba(138,130,153,0.05)` |

The animated `StatusDot` (from `primitives.jsx`) already handles per-state color + pulse — pass it `state` directly; don't re-style the dot here.

---

## 3. Structure & the reason for each decision

### 3.1 The card surface — no border, no gradient stripe

```js
// outer (gives the card its gutter + the divider under it)
<div style={{ padding: '12px 12px 10px', borderBottom: '1px solid rgba(74,68,79,0.18)' }}>
  // the card itself
  <div style={{
    position: 'relative', borderRadius: 13, padding: '13px 14px 14px',
    background: `radial-gradient(120% 90% at 0% 0%, ${wash} 0%, rgba(34,34,52,0) 55%), rgba(33,33,51,0.55)`,
    boxShadow: '0 5px 20px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.045)',
    overflow: 'hidden',
  }}>
```

> **Why no `border` and no top color stripe:** a hard 1px outline plus a bright gradient header bar is the universal "AI template card" look — it was an explicit review reject. Depth now comes from elevation (drop shadow) + a 1px inset top highlight, the way a real raised surface catches light. State is communicated by the dot + colored label + a _barely-there_ radial wash that fades out by 55% — ambient, not a banner. Keep `overflow:hidden` so the wash and the inset toggle stay clipped to the radius.

### 3.2 Header row — toggle docked in the corner

```js
<div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
  <SidebarToggle
    collapsed={false}
    onClick={onToggleSidebar}
    size={28}
    variant="inset"
  />
  <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
    <div /* title: Instrument Sans 14/600 #e9e6fb, single-line ellipsis */>
      {s.title || 'No session'}
    </div>
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}
    >
      <StatusDot state={s.state} size={7} />
      <span /* JetBrains Mono 11/600, color = label color from §2 */>
        {m.label}
      </span>
    </div>
  </div>
</div>
```

> **Why the toggle uses the `inset` variant (not the ghost one):** docked inside the card, a transparent ghost button floats and reads as unrelated chrome. The `inset` variant gives it a recessed well (`background: rgba(13,13,28,0.45)`, `border: 1px solid rgba(74,68,79,0.35)`, lavender hover) so it reads as a control _belonging to_ the card. This was the second review note ("make the toggle fit in with the card"). `align-items: flex-start` keeps the 28px toggle aligned to the title's cap height, not vertically centered against the whole two-line block.

### 3.3 Current-action line

```js
{
  s.subtitle && (
    <div
      style={{
        marginTop: 11,
        fontFamily: "'Inter', sans-serif",
        fontSize: 11.5,
        lineHeight: 1.4,
        color: '#a59fb5',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}
    >
      {s.subtitle}
    </div>
  )
}
```

> **Why clamp to 2 lines:** the subtitle is the live "what's it doing right now" line and lengths vary wildly across sessions. A 2-line clamp keeps the card height stable so the session list below it doesn't jump as the active session changes. Render nothing when there's no subtitle rather than reserving empty space.

### 3.4 Quick metrics row

```js
<div
  style={{
    display: 'flex',
    alignItems: 'center',
    marginTop: 12,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    color: '#8a8299',
  }}
>
  {s.startedAgo && s.startedAgo !== '—' && (
    <Metric icon="schedule" value={s.startedAgo} />
  )}
  {s.turns > 0 && <Metric icon="forum" value={`${s.turns}`} />}
  {s.tokens && s.tokens.max > 0 && (
    <Metric
      icon="data_usage"
      value={`${Math.round((s.tokens.used / s.tokens.max) * 100)}%`}
      last
    />
  )}
</div>
```

`Metric` = icon (`Icon` size 12, `#6c7086`) + value (`#cdc3d1`), with a `·` separator (`margin: 0 9px`, `#3a3450`) after every item except the one passed `last`.

> **Why each metric is individually guarded:** an idle/scratch session has `startedAgo: '—'`, `turns: 0`, `tokens.used: 0`. Guarding each cell means the row collapses gracefully (e.g. idle shows nothing) instead of printing `—`, `0`, `0%`. Pass `last` to the final _rendered_ metric so there's no trailing separator — note "last" is positional, so if you reorder metrics, move the `last` flag too.

### 3.5 What was deliberately removed

> A repo/branch footer chip existed in an earlier pass and was **cut on review** — the card is about agent status, not project switching, and the footer re-introduced the "busy generic card" feel. Do **not** re-add a repo/branch row or a project-switcher control to this card.

---

## A. Dependencies — icons, fonts, primitives, tokens

The card pulls in nothing exotic, but it assumes these exist in the host app. If you're porting the card into a fresh shell, bring these too.

### A.1 Icons (Material Symbols Outlined)

Three glyphs, all in the metric row: **`schedule`** (elapsed), **`forum`** (turns), **`data_usage`** (context %). All rendered via the `Icon` component below.

The sidebar **toggle is an inline SVG**, not an icon-font glyph — no Material name needed for it (see the Sidebar-toggle handoff for that markup).

Loaded once in `<head>`:

```html
<link
  href="https://fonts.googleapis.com/icon?family=Material+Symbols+Outlined"
  rel="stylesheet"
/>
```

> **Why it matters:** if this stylesheet is missing, `<Icon name="schedule">` renders the literal word "schedule". (That's also why screenshot tools that don't load the icon font show words instead of glyphs — it's a capture artifact, not a bug.)

### A.2 Fonts

Three families are referenced by name in the card: **Instrument Sans** (title), **JetBrains Mono** (status label + metrics), **Inter** (subtitle / app default). Load once in `<head>`:

```html
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

### A.3 Primitives (from `src/primitives.jsx`)

Copy these two verbatim if not already present — the card calls both.

```jsx
// Material Symbols icon wrapper
function Icon({ name, size = 18, fill = 0, style, ...rest }) {
  return (
    <span
      {...rest}
      className="material-symbols-outlined"
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill}, 'wght' 400, 'GRAD' 0, 'opsz' ${size}`,
        lineHeight: 1,
        userSelect: 'none',
        ...style,
      }}
    >
      {name}
    </span>
  )
}

// Animated status dot — running: mint pulse+glow; awaiting: coral pulse;
// completed: hollow mint; errored: coral solid; idle: dim hollow.
function StatusDot({ state, size = 8, glow = true }) {
  const styles = {
    running: {
      bg: '#50fa7b',
      ring: 'rgba(80,250,123,0.45)',
      anim: 'vfPulse 2s ease-in-out infinite',
    },
    awaiting: {
      bg: '#ff94a5',
      ring: 'rgba(255,148,165,0.45)',
      anim: 'vfPulse 1.4s ease-in-out infinite',
    },
    completed: {
      bg: 'transparent',
      border: '1.5px solid #7defa1',
      ring: 'transparent',
      anim: 'none',
    },
    errored: { bg: '#ffb4ab', ring: 'rgba(255,180,171,0.4)', anim: 'none' },
    idle: {
      bg: 'transparent',
      border: '1.5px solid #4a444f',
      ring: 'transparent',
      anim: 'none',
    },
  }[state] || { bg: '#8a8299' }
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: 999,
        background: styles.bg,
        border: styles.border,
        boxShadow:
          glow && styles.ring !== 'transparent'
            ? `0 0 0 3px ${styles.ring}, 0 0 10px ${styles.bg}`
            : 'none',
        animation: styles.anim,
        flexShrink: 0,
      }}
    />
  )
}
```

`StatusDot`'s pulse needs this keyframe in a global stylesheet (it already exists in the app's `<style>`):

```css
@keyframes vfPulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
```

### A.4 Color tokens

No design-token system — these are the literal hex/rgba values the card uses. Reuse them; don't invent new ones.

| Role                              | Value                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Card fill                         | `rgba(33,33,51,0.55)`                                                                                                |
| Card inset top highlight          | `rgba(255,255,255,0.045)`                                                                                            |
| Card drop shadow                  | `rgba(0,0,0,0.22)`                                                                                                   |
| Outer divider (under card)        | `rgba(74,68,79,0.18)`                                                                                                |
| Title text                        | `#e9e6fb`                                                                                                            |
| Subtitle text                     | `#a59fb5`                                                                                                            |
| Metric value                      | `#cdc3d1` · icon `#6c7086` · separator `#3a3450`                                                                     |
| State colors (label + dot + wash) | success `#7defa1` / warn `#ff94a5` / primary `#e2c7ff` / error `#ffb4ab` / neutral `#8a8299` — wash opacities per §2 |
| Inset toggle well                 | bg `rgba(13,13,28,0.45)` · border `rgba(74,68,79,0.35)` · hover border `rgba(203,166,247,0.4)`                       |

---

## 4. Acceptance criteria

1. Card is the **first** element in the sidebar; the old `VF / vimeflow-core / feat/jose-auth` banner is gone.
2. **No** visible 1px border and **no** colored top stripe; depth is shadow + inset highlight only; a faint state-colored glow sits in the top-left corner.
3. Toggle renders **inside the card's top-left**, recessed (inset well), and still collapses/expands the sidebar (and stays in sync with ⌘B and the rail toggle).
4. Title, status label+dot, subtitle, and metrics all reflect the **active session** and update when the active session changes (try switching sessions / changing `agentState`).
5. An **idle** session (`startedAgo:'—'`, `turns:0`, `tokens.used:0`) shows the title + `Idle` + dot, an empty/short metric row, and no crash.
6. Long titles single-line-ellipsis; long subtitles clamp to 2 lines; card height stays stable across sessions.

---

## 5. Anti-patterns — do not add

- ❌ A 1px border around the card, or a colored gradient header stripe (§3.1 — explicit reject).
- ❌ The ghost-variant toggle inside the card; it must be `variant="inset"` (§3.2).
- ❌ A repo/branch footer or any project-switcher control on this card (§3.5).
- ❌ Hardcoded `session 1` / `Running` — everything is driven off `session` (§1).
- ❌ Printing `—` / `0` / `0%` for empty metrics instead of guarding each cell (§3.4).
- ❌ Re-styling `StatusDot` locally instead of passing it `state` (§2).
- ❌ New tokens, colors, or dependencies — reuse the palette already in the table.
