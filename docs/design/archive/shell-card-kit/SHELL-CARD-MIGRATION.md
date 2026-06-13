# Vimeflow — SHELL Status Card Migration Kit

> **Paste-to-agent prompt:**
>
> Add a **SHELL** state to the sidebar status card. The card has ONE fixed height in every state — when the active pane is an agent it shows model + context + metrics + that agent's two usage bars; when the active pane is a **pure shell** (no model, no usage) it shows a placeholder of the _exact same height_ (`SHELL` title + a dashed-bordered tile reading "No active agent · Idle · shell only"). The whole point is a **consistent card height**: switching the active pane must never move the session list below the card. Everything is in `SHELL Card.html` — open it, the two columns prove the heights match. Lift `AgentStatusCard` + its 4 leaf deps. Don't reintroduce a collapsing/short shell card.

---

## Why this exists (the one reason)

A shell pane has no agent, no model, and no usage limits — so the card naturally wanted to shrink to a stub, which **yanked the session list upward every time you switched to a shell**. The fix is a single rule:

> **The below-header body is a fixed-height region (`CARD_BODY_H = 92`).** Agent content fills it; the shell placeholder fills the same 92px. The card is identical height in every state, so nothing below ever reflows.

That's the whole design intent — a **consistent UI card**.

## Files

| File                      | Purpose                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SHELL Card.html`         | **Runnable.** Renders an agent column and a SHELL column side-by-side with ghost session rows beneath — visual proof the two card heights are identical. Copy components from here. |
| `SHELL-CARD-MIGRATION.md` | This doc.                                                                                                                                                                           |

## What to lift

`AgentStatusCard` plus 4 tiny leaf deps, all in the HTML:

```
AgentStatusCard            ← the card; branches on `isShell`
├─ SidebarToggle           ← inset toggle docked top-left of the card
├─ StatusDot               ← agent header dot + the shell "Idle" dot (uses `idle` state)
├─ Icon                    ← Material Symbols wrapper (terminal + metric glyphs)
├─ Metric (helper)         ← agent metrics row only
└─ UsageBar (helper)       ← agent usage bars only
```

## The SHELL branch — the only thing that's new

```jsx
const isShell = !s.model || s.agentKey === 'shell'
// header title:
{
  isShell ? 'SHELL' : s.model
}
// header status dot is agent-only (shell carries its own idle dot in the body):
{
  !isShell && <StatusDot state={s.state} size={7} />
}
// body (height === CARD_BODY_H, same as the agent body):
;<div
  style={{
    height: CARD_BODY_H,
    marginTop: 11,
    borderRadius: 9,
    border: '1px dashed rgba(74,68,79,0.5)',
    background: 'rgba(13,13,28,0.28)',
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    padding: '0 13px',
  }}
>
  <div /* 34×34 tile */>
    <Icon name="terminal" size={18} style={{ color: '#9b93ab' }} />
  </div>
  <div>
    <div>No active agent</div>
    <div>
      <StatusDot state="idle" size={6} /> Idle · shell only
    </div>
  </div>
</div>
```

### Decisions & reasons

- **`CARD_BODY_H` on BOTH branches** — the agent body (metrics + 2 bars) and the shell tile both render inside a `height: CARD_BODY_H` box. This is what guarantees equal height; don't let either branch size itself naturally. _(Measured: card is 180px in both states; the list below starts at the same Y.)_
- **Title `SHELL` (caps)** — a shell pane has no model name, so the slot that holds the model shows the pane type instead. Caps matches the terminal/mono register and reads as a label, not a session name.
- **No header status dot on shell** — it was a redundant green dot; the shell's status already lives in the body ("Idle · shell only"). Agent panes keep the header dot.
- **Dashed tile, muted wash** — signals "empty / placeholder" without inventing fake data. The shell wash is the neutral grey, never a state color.
- **Usage bars are per-agent, not shown for shell** — `limits` lives on the session; a shell has none, so the bars are simply absent and the placeholder fills their space. Do **not** show borrowed/account-level bars on a shell.

## Static assets (the only externals)

```html
<link
  href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
<link
  href="https://fonts.googleapis.com/icon?family=Material+Symbols+Outlined"
  rel="stylesheet"
/>
```

Icons used: **`terminal`** (shell tile), and `schedule` / `data_usage` / `forum` (agent metrics). `vfPulse` keyframe is needed only for the running dot:

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

## Acceptance criteria

1. SHELL card and agent card are the **same height**; ghost rows / session list below start at the identical Y in both. (The HTML demonstrates this.)
2. Shell header reads **SHELL**, no header status dot, no usage bars, no model badge.
3. Shell body shows the terminal tile + "No active agent" + idle dot + "Idle · shell only".
4. `isShell` is derived (`!s.model || s.agentKey === 'shell'`) — not a hardcoded session id.

## Anti-patterns

- ❌ A short/collapsing shell card (the original bug).
- ❌ Sizing either branch's body naturally instead of to `CARD_BODY_H`.
- ❌ Account-level / borrowed usage bars on a shell pane.
- ❌ Keeping the redundant header status dot on shell.
- ❌ New fonts, colors, or icon sets beyond the two `<link>`s.
