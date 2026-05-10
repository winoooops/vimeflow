---
id: 2026-05-09-sidebar-overflow-debug-session
type: retrospective
status: shipped — fix/sidebar-overflow-double-scrollbar branch, 2 issues closed (#193, #176)
date: 2026-05-09
---

# Retrospective: Sidebar overflow + WebKitGTK double-scrollbar — three Codex rounds before the right diagnosis

## Context

Two adjacent sidebar bugs surfaced after the recent SESSIONS/FILES handoff
work landed:

1. **[#193](https://github.com/winoooops/vimeflow/issues/193)** — when ~15+
   sessions were created, the `+ new session` ghost button (intentionally
   hoisted outside the `session-scroll` motion.div in PR #191) got pushed
   below the visible viewport and the inner `overflow-y-auto` never engaged.
   The sidebar simply grew past 100vh.
2. **[#176](https://github.com/winoooops/vimeflow/issues/176)** (reopened) —
   two synchronously-scrolling vertical scrollbar tracks rendered on the
   right edge of the SESSIONS pane and the AgentStatusPanel. **Tauri/WebKitGTK
   only** — the bug did not reproduce in Vite + Chromium devtools.

Both fixes shipped in one branch. The #193 fix was clean. The #176 fix took
**three Codex consultation rounds** — two converging on a wrong-or-incomplete
hypothesis before the third nailed it.

## What worked

### #193: bisecting the chain in Chrome MCP found the root in one pass

The reporter (myself, in #193) listed candidate culprits along the
`workspace-view → sidebar wrapper → Sidebar root → content slot → SessionsView →
List motion.div → ghost-button div` chain and predicted a missing `min-h-0`.

Instead of speculating, I drove Chrome via `mcp__chrome-devtools__*`,
created 20 sessions, and walked the parent chain measuring `clientHeight`,
`scrollHeight`, and `getBoundingClientRect()` on every level. The smoking gun
appeared immediately:

- `workspace-view`: `clientH=700, scrollH=2008` ← 1.3kpx overflow
- `sidebar`: `h=2008` ← unbounded grew with content

The chain itself was fine — every level had `min-h-0` or `h-full`. The bug
was at the _top_: the grid had `h-screen` but no `grid-template-rows`, so
`grid-auto-rows: auto` let the implicit row grow to content size. Adding
`grid-rows-1` (`= grid-template-rows: repeat(1, minmax(0, 1fr))`) pinned the
row, and `h-full` propagated 100vh down the chain again.

**Lesson:** when a layout spec lists multiple "could be"s, instrument the
running app (`getBoundingClientRect` + `scrollHeight` walk) before reading
source. The numbers tell you the level where the bound breaks; reading
source from the wrong end wastes time.

## What did not work

### #176, attempt 1: `overflow-hidden` on the pane wrappers

After Image #1 came in (double scrollbar in SESSIONS), I followed the
literal "same gick as #176" hint and added `overflow-hidden` to
`SessionsView` and `FilesView` wrappers — defense-in-depth at the wrappers
that contain the actual scroll regions.

The user reported it still doubled. The wrappers were not the source.

**Lesson:** "same trick as past issue" can mean "same shape" or "same root
cause" — the original #176 fixed itself by _removing a redundant overflow
region_, not by adding `overflow-hidden`. I conflated the two.

### #176, attempt 2: `overflow-x-clip` from Codex's first hypothesis

Codex round 1 hypothesized: Tailwind's `overflow-y-auto` with
`overflow-x: visible` triggers the CSS-spec coercion of `overflow-x` to
`auto` (per [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow-x)),
so WebKitGTK reserves a phantom horizontal gutter. Add `overflow-x-clip`.

**This was correct as defense, but not the actual cause** — adding it to
`session-scroll` made no visible difference. The user pushed back: "this
is a hack, we shouldn't need to declare x-axis overflow if we only care
about y-axis."

The pushback was the right instinct. `overflow-x-clip` ended up in the
final fix as good hygiene (it is a real CSS-spec quirk worth defending
against), but it was not the WebKit double-track cause.

### #176, attempt 3: Codex round 2's `thin-scrollbar` hypothesis — fixed AgentStatusPanel only

Codex round 2 (after I gave it the user's "scrollbars scroll in sync" clue
plus Image #3 of the AgentStatusPanel doubling too) pointed at the
`thin-scrollbar` utility in `src/index.css`:

```css
@utility thin-scrollbar {
  scrollbar-width: thin;            /* CSS standard */
  scrollbar-color: #333344 transparent;
  &::-webkit-scrollbar { width: 6px; ... }   /* WebKit pseudo */
}
```

Both rule sets land at the WebKitGTK renderer simultaneously. Codex
suggested gating the standard properties behind
`@supports (-moz-appearance: none)` so only Firefox sees them; WebKit then
gets only the `::-webkit-scrollbar` rules.

I shipped that change plus the `overflow-x-clip` defense plus a `min-h-0`
on the AgentStatusPanel inner. **AgentStatusPanel went clean. SESSIONS
still doubled.**

The asymmetry was the clue: AgentStatusPanel's inner scroll has
`thin-scrollbar`, the SESSIONS `session-scroll` motion.div does **not**.
Codex's round-2 fix could only help the side that was already on the
`thin-scrollbar` path.

## What finally worked

### #176, attempt 4: add `thin-scrollbar` to `session-scroll` itself

Codex round 3 (with the explicit "AgentStatusPanel fixed, SESSIONS did
not" data) inspected framer-motion to rule out internal wrappers — `motion.div`
is just a `createElement` with no children injection, `layoutScroll`
only feeds the projection options, `Reorder.Group` adds only
`style={{ overflowAnchor: 'none' }}`. None of those create a second
scroll container.

The verified diagnosis: **WebKitGTK on Linux/Wayland paints two tracks
on any `overflow-y: auto` element that uses the default (unstyled)
scrollbar path.** Adding the `thin-scrollbar` class routes it through
the now-`@supports`-gated `::-webkit-scrollbar` rules, which suppresses
the second track.

One-line fix on `List.tsx:99`:

```diff
- className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-clip"
+ className="thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-clip"
```

Side benefit: SESSIONS scrollbar is now visually consistent with the rest
of the app (6px wide, `#333344` thumb) instead of the default 15px GTK
track.

## Lessons

### 1. Environment matters — diagnose in the failure environment

The bug never reproduced in Chromium. I burned ~30 minutes inspecting the
DOM in Chrome MCP, finding only one scroll region engaged, and second-guessing
the user's screenshots ("maybe one of those vertical lines is just a column
boundary"). It was a real WebKit-only bug.

`tauri:dev` is the failure environment for any Tauri-window-specific issue.
When the bug looks visual and platform-specific, the first thing to check is
_can I see it where the user sees it_. If `tauri:dev` won't compile in the
session (it didn't — `Failed to spawn child process WebKitNetworkProcess`),
say so and lean harder on the user's screenshots / video / DOM dumps from
their environment instead of trusting a Chromium snapshot.

### 2. "Sync-scrolling thumbs" is the diagnostic kingpin

The single most useful observation in this whole session was the user's
incidental note: _"the scrollbar position is sync between those two."_
Synced thumbs == one scroll container painting two tracks. That immediately
ruled out "two unrelated overflow regions" (which would have meant adding
`overflow-hidden` to a parent) and pointed at "one element, two paint passes"
(which is the WebKit cascade-layer / scrollbar-style-mixing problem).

Without that observation I would have stayed on the wrong-parent track much
longer. **Ask for it explicitly when a UI bug shows duplicated controls** —
"do they move together when you scroll?" is a one-question diagnostic.

### 3. Codex needs structured priors, not just symptom dumps

Round 1 had only the symptom + chain. Round 2 had symptom + chain + sync
clue. Round 3 had symptom + chain + sync clue + which pane was fixed by
which fix. Each round halved the answer space for Codex.

When asking a tool agent for a second opinion, _bring the asymmetries_ —
"this fix worked for X but not Y, what's different between X and Y?" gives
the agent something to lever against. Pure "this still doesn't work, what
else" rounds tend to produce defensive add-ons (Codex's first reaction was
to suggest yet more defensive CSS) instead of root causes.

### 4. The user's "hack" intuition was directionally right but locally wrong

The user objected to `overflow-x-clip` as a hack and asked if the
`@supports` gate alone would fix both panes. It would not (Codex round 3
verified — `session-scroll` doesn't have `thin-scrollbar`, so the gate
can't reach it), but the question forced a sharper diagnosis. Pushing back
on a fix that _feels wrong_ is a useful smell test even when the
specific replacement turns out to be incorrect; the alternative would have
been silently shipping a fix that worked only for the one pane the agent
last looked at.

`overflow-x-clip` ended up shipping anyway as a real CSS-spec hygiene fix
(per the MDN-cited `overflow-x: visible → auto` coercion), but the user
was right that it was not the bug everyone was looking at.

### 5. Thin-scrollbar mixing is now a load-bearing app-wide invariant

Several files use `thin-scrollbar` — `AgentStatusPanel`, `CommitInfoPanel`,
`ExplorerPane`, `ChangedFilesList`, `SplitDiffView`, `UnifiedDiffView`.
There is also a near-copy in `index.css:70` (the `.terminal-pane-body
.xterm-viewport` block) that has the exact same `scrollbar-width` +
`::-webkit-scrollbar` mixing. Today it is not user-reported; if a future
WebKit/GTK upgrade or a different DPI surfaces the same symptom there, the
fix is to apply the same `@supports` gate. Captured in a follow-up note —
not pre-fixed because it is not currently broken.

## Final shipped fix

| File                                                             | Change                                                                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/workspace/WorkspaceView.tsx`                       | Added `grid-rows-1` to the workspace grid (closes #193)                                                                                                          |
| `src/features/workspace/WorkspaceView.visual.test.tsx`           | Asserts `grid-rows-1` is on the workspace grid                                                                                                                   |
| `src/features/sessions/components/List.tsx`                      | Added `thin-scrollbar overflow-x-clip` to `session-scroll` (closes #176 for SESSIONS)                                                                            |
| `src/features/sessions/components/List.test.tsx`                 | Asserts `thin-scrollbar overflow-x-clip` on `session-scroll`                                                                                                     |
| `src/features/agent-status/components/AgentStatusPanel.tsx`      | Added `min-h-0 overflow-x-clip` to the inner scroll div (closes #176 for AgentStatusPanel)                                                                       |
| `src/features/agent-status/components/AgentStatusPanel.test.tsx` | Asserts `min-h-0 overflow-x-clip` on the inner scroll div                                                                                                        |
| `src/index.css`                                                  | Gated `thin-scrollbar`'s `scrollbar-width` / `scrollbar-color` behind `@supports (-moz-appearance: none)` so WebKitGTK only sees the `::-webkit-scrollbar` rules |
