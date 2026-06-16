# Vimeflow — Kimi Plan-Usage Permission Gate · Handoff

> **Paste-to-agent prompt (copy this whole block to your coding agent):**
>
> Add a **Kimi-only "plan usage" permission gate** to the agent-status card's usage slot. Kimi's 5-hour + weekly limits aren't in any local file — fetching them requires POSTing the user's Kimi API key to `api.kimi.com`, so the readout is **opt-in**. Claude/Codex read their limits from local config and must NOT show this affordance — gate it on `agent.id === 'kimi'`. The slot has five states that all occupy the **same fixed height** (`SLOT_H = 84`) so the session list below the card never jumps: **OFF** (opt-in CTA), **LOADING**, **ON** (two peach RateLimit bars), **ERROR** (offline/auth), and a subtle **revoke** control once ON. The ON bars MUST reuse the existing `UsageBar` two-bar style (label row + 4px track + `%`), recolored to the Kimi peach gradient, plus a per-bar reset-time subline. Follow the per-decision reasoning in §3 — each choice has a stated reason; do not turn OFF into a toggle, do not add an alarming "we're sending your key!" banner, and do not give the ON state a different height than the others.

---

## 0. Task

Extend the agent-status card body so that when the active agent is **Kimi**, the usage slot renders a permission-gated plan-usage readout instead of the plain `5-hour / weekly` bars. State lives on the agent/session object (`usageGate: 'off' | 'loading' | 'on' | 'error'`); enabling triggers the network fetch.

**Files touched:** `src/shell.jsx` (the `AgentStatusCard` body branch) + wherever per-agent usage is fetched. No new deps. Reference implementation: `kimi-cards.jsx` in this folder.

---

## 1. Why this is Kimi-only

| Agent                   | How limits are read                                      | Shows this gate?                                    |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| Claude / Codex / Gemini | local config / on-device files                           | **No** — render the normal `UsageBar` pair directly |
| **Kimi**                | network `POST` to `api.kimi.com` with the user's API key | **Yes** — opt-in gate                               |

Because the Kimi path sends the user's key off-device, the readout cannot be on by default. Gate every state in this doc behind `agent.id === 'kimi'`.

---

## 2. The peach identity + the fixed slot

```css
--vf-kimi: #ffb38a;
--vf-kimi-rgb: 255, 179, 138; /* peach — between coral warn & shell yellow */
--vf-kimi-bright: #ffcaa8;
--vf-kimi-bright-rgb: 255, 201, 168;
```

Glyph: **☾** (U+263E). Header identity chip = `☾` in a 20×20 rounded square, `background: rgba(255,179,138,0.16)`, `color: #ffb38a`.

`SLOT_H = 84`. This is the height of the **tallest** state (ON, whose two bars each carry a reset subline). Every other state renders inside a `height: SLOT_H` flex column with `justify-content: center`, so OFF / LOADING / ERROR sit centered in the same box and nothing below the card moves between states.

The card shell, header layout, radial wash, and elevation are **unchanged** from `AGENT-STATUS-CARD-HANDOFF.md` — only the body branch is new. Wash for the Kimi card: `rgba(255,179,138,0.09)`.

---

## 3. The five states & the reason for each decision

### 3.1 OFF (default) — the opt-in affordance

A compact CTA centered in the slot:

- **Button**, full width, 34px tall: `[cloud]  Show plan usage  ☾`. Rest state is a neutral well (`rgba(var(--vf-surface-0-rgb),0.5)` + faint outline); hover tints peach (`rgba(255,179,138,0.14)` fill, peach border + text).
- One helper line under it: `🔒  Fetches limits from api.kimi.com` (mono 9.5, `--vf-text-3`, with `api.kimi.com` lifted to `--vf-text-2`).
- The button's `title` carries the full disclosure: _"Sends your Kimi API key to api.kimi.com to read your 5-hour and weekly limits."_

> **Why a button (not a toggle, not a link):** enabling fires a **deliberate, reversible network fetch that ships the user's key off-device**. A toggle implies a free, instant, local state flip — wrong mental model for a round-trip that transmits a credential. A bare link implies navigation away. A button reads as "perform an action." The **cloud glyph** + the **named host** `api.kimi.com` are how it signals "this goes over the network" — concrete and honest, but not a red warning banner. The scary detail (key transmission) lives in the tooltip for those who look, so the default surface stays calm and optional.

### 3.2 LOADING — brief, right after enabling

Two-bar **skeleton** in the exact ON layout: real labels (`5-Hour Session`, `Weekly Usage`), a peach **shimmer** sweeping each 4px track, a small spinning `progress_activity` glyph where the `%` will be, and a caption subline (`Contacting api.kimi.com…` / `checking…`).

> **Why skeleton-in-the-final-layout:** the loading state visually _is_ the ON state minus data, so the transition on success is a fill, not a layout swap. Keeps the eye anchored and reinforces "the bars are coming."

### 3.3 ON — the two peach bars

Reuse the live `UsageBar` (label row + `%` + 4px gradient track) with the fill swapped to `linear-gradient(90deg, #ffb38a, #ffcaa8)`. Add **one subline per bar**: `🕒 resets in 4h 12m` (5-hour) and `🕒 resets Mon · 3d 6h` (weekly), mono 9px, `--vf-text-3`.

> **Why reset sublines belong here and nowhere else:** the whole point of querying Kimi is the _windowed_ limit — "41% used" is only actionable next to "resets in 4h 12m." The subline is what justifies the network call's existence. It's also why ON is the tallest state and therefore sets `SLOT_H`.

### 3.4 ERROR — offline / auth failure, quiet

`cloud_off` in a soft coral well + `Couldn't reach Kimi` / `Offline, or key was rejected.` Then a row with a **Retry** pill (peach on hover) and a muted **Turn off** text button.

> **Why muted, not red-alert:** a failed _optional_ readout is a minor event — the agent itself is fine. Use `--vf-warn` (the soft coral) at low intensity (10% well, small icon), never a full-bleed error card. Offer the two reasonable exits (retry / turn it back off) and nothing else.

### 3.5 REVOKE — the subtle turn-off, once ON

A small ghost `power_settings_new` button absolutely positioned in the slot's **bottom-right corner** (clear of the bars' `%` values at top-right and the reset sublines at bottom-left). Faint at rest (`opacity 0.55`, `--vf-text-3`); on hover it tints peach and grows a `Turn off` label that flows **left** so it stays inside the card. Clicking returns to OFF and stops the network calls.

> **Why bottom-right, hover-revealed:** revoking is rare and shouldn't compete with the data. Tucking it in the one empty corner keeps it discoverable-on-approach without adding a row (which would break the fixed height) or sitting in the header (which OFF/ERROR don't have). `title`: _"Turn off plan usage — stops network calls to Kimi."_

---

## 4. Drop-in components

The reference file `kimi-cards.jsx` (this folder) contains all of them, framed for a design canvas. To port into `src/shell.jsx`, lift these and delete the canvas scaffolding:

- `KimiUsageBar({ label, pct, reset })` — the peach bar + reset subline (your existing `UsageBar` + 3 lines).
- `SlotOff({ onEnable })`, `SlotLoading()`, `SlotOn({ onRevoke })`, `SlotError({ onRetry, onOff })` — the five bodies (REVOKE is `SlotOn` with the control hover-active).
- `RevokeControl({ onClick })`, `SkeletonBar`, `KimiHeader` — supporting pieces.

Wire the body branch:

```jsx
// inside AgentStatusCard, for the Kimi agent:
const slot = {
  off: <SlotOff onEnable={enablePlanUsage} />,
  loading: <SlotLoading />,
  on: <SlotOn onRevoke={disablePlanUsage} />,
  error: <SlotError onRetry={enablePlanUsage} onOff={disablePlanUsage} />,
}[session.usageGate || 'off']
```

`enablePlanUsage()` sets `usageGate:'loading'`, fires the `api.kimi.com` fetch, then resolves to `'on'` (or `'error'`). `disablePlanUsage()` sets `'off'` and cancels/clears.

### Required CSS (shimmer + spinner)

```css
@keyframes kimiSpin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes kimiShimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(220%);
  }
}
.kimi-shimmer {
  position: absolute;
  inset: 0;
  width: 55%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 179, 138, 0.6),
    transparent
  );
  animation: kimiShimmer 1.15s ease-in-out infinite;
}
```

Icons used (Material Symbols Outlined): `cloud`, `lock`, `progress_activity`, `schedule`, `cloud_off`, `refresh`, `power_settings_new`, `forum`.

---

## 5. Acceptance criteria

1. The gate renders **only** for the Kimi agent; Claude/Codex/Gemini keep the plain `UsageBar` pair.
2. OFF / LOADING / ON / ERROR all occupy **exactly `SLOT_H`**; switching states does not move the session list below the card.
3. OFF is a **button** with a cloud glyph + the host `api.kimi.com` visible; the key-transmission detail is in the tooltip, not a banner.
4. ON uses the **peach** two-bar `UsageBar` style with a **reset subline** under each bar.
5. ERROR is **quiet** (soft coral, small icon) and offers **Retry** + **Turn off**.
6. A **subtle** turn-off control is reachable once ON and returns to OFF.

## 6. Anti-patterns — do not add

- ❌ OFF as a toggle switch or a bare text link (§3.1).
- ❌ An alarming "⚠ This sends your API key!" banner on the default surface (§3.1).
- ❌ Giving ON a taller slot than the other states / letting the list jump (§2).
- ❌ A bespoke ON bar style instead of the existing `UsageBar` recolored peach (§3.3).
- ❌ Showing this gate for non-Kimi agents (§1).
- ❌ A full-bleed red error card (§3.4).
