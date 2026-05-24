# Handoff delta — Git ref chip in the pane header

Replace the bare `session.branch` text in the terminal pane header with a
**purpose-built chip** that shows worktree + branch with distinct icons,
so neither label can be mistaken for a file path.

## What changes

```
BEFORE:                       AFTER:
                              ┌────────────────────────────────────────┐
session 1 · feat/jose-auth    │ session 1 · ⛂ feat-jose › ⑂ feat/jose-auth │
                              └────────────────────────────────────────┘
                                          ↑ worktree (mauve)   ↑ branch (lavender)
```

The whole chip is one inline-flex pill, lavender-tinted, sitting between the
session title and the +/− change counts in the pane header.

## Visual contract

```
┌─────────────────────────────────────────────────────────────────┐
│ [CLAUDE] ● session 1  · [ ⛂ feat-jose › ⑂ feat/jose-auth ] · +48 −12 · now │
└─────────────────────────────────────────────────────────────────┘
                            ↑ THIS CHIP
```

Chip composition (left → right):

| Element           | Icon (Material Symbols) | Color tokens                              |
| ----------------- | ----------------------- | ----------------------------------------- |
| Worktree icon     | `account_tree` 13 px    | `#c39eee` (mauve)                         |
| Worktree label    | (text)                  | `#c39eee` (mauve), JetBrains Mono 10.5 px |
| Chevron separator | `›` text                | `#4a444f`                                 |
| Branch icon       | `fork_right` 13 px      | `#cba6f7` (lavender)                      |
| Branch label      | (text)                  | `#e3e0f7` cream, weight 500, ellipsizes   |

Chip frame: `background: rgba(203,166,247,0.06)`,
`border: 1px solid rgba(203,166,247,0.20)`, `border-radius: 6px`,
height 22 px, padding `0 8px 0 6px`, gap 6 px, `max-width: 340px`,
`overflow: hidden`. The branch label ellipsizes when long; the icons +
worktree never collapse.

### Why two icons?

In most IDEs, the slot between the session title and the diff counts is
used for file paths — so a plain text label there reads as a directory.
Giving each segment a distinct Material Symbols icon disambiguates:

- `account_tree` reads as a **branching structure** (multiple nodes, tree
  shape) → worktree
- `fork_right` reads as a **single line forking** (one ref) → branch

Both icons are native to the `material-symbols-outlined` font already
loaded in the app.

### Edge cases

| State             | Chip behaviour                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No worktree**   | `worktree` segment + chevron are omitted; chip becomes `⑂ main`.                                                                                          |
| **Long branch**   | Branch label ellipsizes; chip caps at 340 px wide.                                                                                                        |
| **Detached HEAD** | `session.detached = true` flips the chip to coral: background `rgba(255,148,165,0.06)`, border `rgba(255,148,165,0.25)`, both icons + branch label coral. |

## Data shape

Session objects gain one new optional field:

```ts
interface SessionState {
  branch: string // 'feat/jose-auth' — required
  worktree?: string // 'feat-jose'      — optional
  detached?: boolean // true if HEAD is detached
  // ...existing fields
}
```

Mock data in `src/data.js` updated for `sess_auth` (`worktree: 'feat-jose'`),
`sess_tests` (`worktree: 'tests'`), `sess_ui` (`worktree: 'ui'`).
`sess_deploy` and `sess_scratch` are left without a worktree to exercise
the no-worktree code path.

## Files in this delta

```
prototype/src/splitview.jsx   ← new <GitRefChip> + updated TerminalPane header
prototype/src/data.js         ← added `worktree` field on three sessions
GitRefChip.html               ← visual reference: 4 layout options + Material
                                Symbols comparison + 3 edge-case states
```

Drop the two `src/` files over the matching paths in your handoff bundle.
`GitRefChip.html` is the reference page agents can open to see the chip in
context — keep it next to the bundle, no need to merge it anywhere.

---

## Prompt to send your coding agent

> **Replace the bare branch text in the terminal pane header with a Git
> ref chip.**
>
> Currently each terminal pane's header shows:
>
> ```
> [AGENT] ● session-title · feat/jose-auth · +48 −12 · 27m ago
> ```
>
> Replace the `feat/jose-auth` span with a dedicated
> `<GitRefChip worktree branch detached>` component. The chip is a single
> inline-flex pill with the following composition (left → right):
>
> 1. **Worktree icon** — `account_tree` from Material Symbols Outlined,
>    13 px, color `#c39eee` (mauve). Followed immediately by the worktree
>    name in `#c39eee`, JetBrains Mono 10.5 px.
> 2. **Chevron separator** — single `›` glyph in `#4a444f`, 12 px.
> 3. **Branch icon** — `fork_right` from Material Symbols Outlined, 13 px,
>    color `#cba6f7` (lavender).
> 4. **Branch label** — branch name in `#e3e0f7` cream, weight 500,
>    JetBrains Mono 10.5 px. **Ellipsizes** when long.
>
> Chip frame: `display: inline-flex`, `align-items: center`, `gap: 6px`,
> `height: 22px`, `padding: 0 8px 0 6px`, `background:
rgba(203,166,247,0.06)`, `border: 1px solid rgba(203,166,247,0.20)`,
> `border-radius: 6px`, `max-width: 340px`, `overflow: hidden`. Icons +
> worktree segment must `flex-shrink: 0` so they never collapse; only the
> branch label ellipsizes.
>
> Edge cases:
>
> - **No worktree** (`session.worktree` is falsy): omit the worktree
>   segment + chevron entirely. The chip becomes just the branch icon +
>   branch name.
> - **Detached HEAD** (`session.detached === true`): flip the chip to
>   coral — background `rgba(255,148,165,0.06)`, border
>   `rgba(255,148,165,0.25)`, worktree icon + label `#ffb4ab`, branch
>   icon + label `#ff94a5`.
>
> Why two distinct icons? In most IDEs, the slot between the session
> title and diff counts is used for file paths, so a plain branch label
> there reads as a directory. `account_tree` (branching tree shape) +
> `fork_right` (single-line fork) disambiguate worktree vs. branch at a
> glance.
>
> Add an optional `worktree?: string` and `detached?: boolean` to the
> session state shape. Both icons are native to
> `material-symbols-outlined`, already loaded in the project.
>
> Reference files:
>
> - `docs/design/handoff-gitref/prototype/src/splitview.jsx` — the
>   `<GitRefChip>` component in full plus its placement inside
>   `<TerminalPane>`'s header.
> - `docs/design/handoff-gitref/prototype/src/data.js` — example
>   session data with `worktree` populated.
> - `docs/design/handoff-gitref/GitRefChip.html` — visual reference
>   showing all four layout options (the one to ship is Option C with
>   the `account_tree` + `fork_right` icons) and three edge-case states
>   (no-worktree, long branch, detached HEAD).
