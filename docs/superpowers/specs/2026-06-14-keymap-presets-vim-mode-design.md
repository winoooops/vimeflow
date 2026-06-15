# Keymap Presets & Vim Mode — Design (VIM-104)

**Status:** Approved (model + scope + decisions locked with the user 2026-06-14). Pending
spec review, then implementation via the kimi→codex loop in worktree `feat/vim-104-keymap`
(off `feat/settings`).

**Linear:** VIM-104 (Keymap pane — the last Settings pane). Part of the Settings epic
(VIM-29 dialog, VIM-100 persistence, VIM-101 General, VIM-103 Coding Agents all merged into
`feat/settings`).

---

## 1. Context & Problem

The Settings dialog's **Keymap** pane is currently a non-functional prototype: a local
`useState('vimeflow')` (not wired to settings), five fake preset options
(`vimeflow/vim/vscode/jetbrains/custom`), and dead per-row "edit" + "Reset/Import/Export"
buttons. The bindings it lists come from placeholder `KEYMAPS` data, not the real keymap.

The goal of VIM-104 is to make the pane **functional**: an authoritative, read-only list of
the real keymap, grouped by zone, plus a **preset switcher that actually changes behavior**,
persisted across restarts.

The deeper question the user raised — and the reason this needs a design doc rather than a
quick wiring task — is: **what does a "Vim preset" even mean in a terminal multiplexer**,
where every pane is a live TUI that owns its own keystrokes?

## 2. The Core Principle — `⌘;` is the escape-safe `:` + `Ctrl-W`

This principle is the foundation for all current and future keymap work, so it is recorded
here explicitly (confirmed by reading the keybinding code, not assumed):

- App shortcuts are registered as **capture-phase** `document` keydown listeners (e.g.
  `useCommandPalette`, `usePaneShortcuts`, `useDockShortcuts`). They run *before* xterm's
  textarea listener.
- They **deliberately intercept only modified combos and let bare keys fall straight through
  to the focused pane's PTY.** A bare `:`, `j`, or `gt` typed over a focused vim/TUI goes to
  that TUI — as it must. There is no way to bind a bare `:` at the app level without breaking
  `:` inside every terminal program.
- `⌘`-prefixed combos are the reliable escape hatch because **`metaKey` is never part of a
  terminal's PTY input stream** — no TUI binds `⌘`. `isCommandPaletteToggle` requires
  `metaKey` and then fully swallows the event (`preventDefault` +
  `stopImmediatePropagation`), so xterm never sees it. Mechanically, **`⌘;` is Vimeflow's
  `:`**.
- `⌘;` already opens a **500ms leader window**; the next key is a *chord* dispatched via
  `chordRegistry` (today `⌘;` then `r` renames the focused pane via `usePaneRenameChord`).
  This is structurally identical to Vim's `Ctrl-W <key>` window-command prefix and to `:`
  command entry. **The bones of a Vim leader already exist.**
- `⌥`/Option is *not* a safe app modifier: the OS delivers `⌥`+key to the PTY as a Meta/ESC
  sequence (readline `Alt-b`/`Alt-f`, etc.), and `usePaneShortcuts` documents that it avoids
  stealing such keys. (This is why the earlier `⌥H/J/K/L` directional-nav idea is dropped —
  see D3.)

**Consequence:** a literal "Vim preset" that rebinds bare `gt`/`Ctrl-W`/`:w` is a category
error. "Vim mode" instead means **deepening the `⌘;` leader into Vimeflow's unified `:` +
`Ctrl-W`** — adding ex-command aliases to the palette and window-nav chords to the leader
window. Neither steals a key from the TUI.

## 3. Decisions (locked with the user)

- **D1 — Presets shipped in v1: `Vimeflow` (default) + `Vim` (opt-in, default OFF).**
  Emacs is deferred (user is not an Emacs user; its bindings are all `Ctrl-`/`Meta-`, owned
  by the terminal even more thoroughly). VS Code is deferred — it requires *remapping the
  `⌘` keys themselves* (e.g. palette `⌘;` → `⇧⌘P`, quick-open `⌘P`, split `⌘\`), which is
  the same engine as per-key custom rebinding. JetBrains/Custom dropped from the prototype.
- **D2 — Vim mode is an *additive layer*, not a key-swap.** The Vimeflow `⌘` keymap always
  applies. Turning Vim ON *adds* ex-command aliases + leader chords on top; it removes
  nothing. Rationale (user's words): "having the option to switch it on and off is better —
  some might not like the vim-like thing." Default OFF keeps the base experience clean.
- **D3 — Directional pane navigation.** Default (both presets): **`⌘+Shift` + arrow keys**,
  applied globally (no focus-deferral branch). This deliberately leaves the editor's plain
  `⌘+arrow` cursor-move (line/doc start/end — the keys editors use most) untouched, and
  overrides only the rarer `⌘+Shift+arrow` *select-to-edge* in CodeMirror/inputs — an
  accepted minor cost for a much simpler, conflict-free binding. Vim ON *additionally* binds
  **`⌘;` then `h/j/k/l`**. The earlier bare-`⌘+arrow` and `⌥H/J/K/L` ideas are both dropped
  (`⌥` → PTY Meta; bare `⌘+arrow` collided with the editor's most-used keys).
- **D4 — Out of scope (follow-up issues):** per-key custom rebinding (the old "Option B"),
  import/export bindings, Reset-to-preset, Emacs preset, VS Code preset, JetBrains preset.

## 4. Data Model

`keymapPreset` already exists in `AppSettings` (durable settings store, VIM-100) typed as a
plain `string`, default `'vimeflow'`. v1 uses the values `'vimeflow' | 'vim'`.

- **No Rust change required** — the field is a free-form string; the frontend constrains the
  values.
- Read: `useSettings().settings.keymapPreset`.
- Write: `useSettings().update({ keymapPreset })` (the provider's serial save-queue persists
  it; `saveError` surfaces failures — same contract used by General/Coding-Agents panes).

A small frontend union + guard keeps usage type-safe:
`export type KeymapPreset = 'vimeflow' | 'vim'` with an `isVimPreset(s: string): boolean`
helper, so a future unknown stored value degrades to non-vim rather than throwing.

## 5. Design

### 5.1 Directional pane adjacency — shared engine

Both `⌘`+arrows (default) and `⌘;`+`hjkl` (vim) need the same answer: *given the active pane,
the layout, and a direction, which pane is the neighbor?* This is a single pure module,
unit-tested in isolation.

- **Module:** `src/features/terminal/utils/resolveDirectionalPane.ts`
- **Signature:**
  `resolveDirectionalPane(layout: LayoutShape, activePaneIndex: number, paneCount: number, direction: 'left' | 'right' | 'up' | 'down'): number | null`
- **Algorithm (generic over `LayoutShape.areas`):**
  1. The active pane is slot `p{activePaneIndex}`. Collect every `(row, col)` cell in
     `layout.areas` whose value equals that slot (a pane may span multiple cells, e.g. `p0`
     in `threeRight`).
  2. From each such cell, step one cell at a time in `direction` until a cell with a
     *different* `pN` slot is found (or the grid edge is hit).
  3. Among the neighbor slots found, return the nearest in reading order (top-to-bottom,
     left-to-right) whose index `< paneCount`. Return `null` if none.
- **Why generic:** it derives adjacency from the canonical `areas` grid that already defines
  each layout, so it is correct for all five shapes today and any future layout without a
  hand-maintained table:
  - `single` `[[p0]]` → all directions `null`
  - `vsplit` `[[p0,p1]]` → `p0`→right=`p1`, `p1`→left=`p0`; up/down `null`
  - `hsplit` `[[p0],[p1]]` → `p0`→down=`p1`, `p1`→up=`p0`; left/right `null`
  - `threeRight` `[[p0,p1],[p0,p2]]` → `p0`→right=`p1` (reading-order tiebreak over `p2`);
    `p1`→left=`p0`, `p1`→down=`p2`; `p2`→left=`p0`, `p2`→up=`p1`
  - `quad` `[[p0,p1],[p2,p3]]` → standard 2×2 adjacency
- **Guard:** if `activePaneIndex` is not present in `areas` (e.g. index ≥ capacity), return
  `null`.

### 5.2 Default keymap behavior (always on, both presets)

Add `⌘+Shift`+arrow directional focus to **`usePaneShortcuts`** (which already owns `⌘1-4`
and `⌘\`):

- Match `event.code` ∈ `ArrowLeft/ArrowRight/ArrowUp/ArrowDown` with `event.shiftKey` AND the
  hook's existing platform modifier (`preferModifier` meta/ctrl), reusing its modifier-match
  and `DIALOG_SELECTOR` guard.
- Map arrow → direction, call `resolveDirectionalPane(...)`, and if a target exists call
  `setSessionActivePane(activeSession.id, targetPane.id)`; `preventDefault`/`stopPropagation`
  only when a move actually happens (so no-op directions still propagate).
- **Applied globally — no editor/text-input deferral branch.** Choosing the `Shift` variant
  is what makes this safe: the editor's most-used `⌘+arrow` cursor-move is left untouched;
  only the rarer `⌘+Shift+arrow` *select-to-edge* in CodeMirror/inputs is overridden (the
  accepted cost). The `⌘`-prefix already means the keys never reach a terminal's PTY, so
  terminals are unaffected. The existing `DIALOG_SELECTOR` guard still suppresses it while a
  modal is open.

No other default-keymap changes. The rest of the locked Vimeflow inventory either already
exists (`⌘;`, `⌘1-4`, `⌘\`, `⌘E`, `⌘G`, `⌘B`, `⌘0`, `⌘N`, copy/paste, diff keys) or is
tracked by sibling issues.

### 5.3 Vim preset behavior (gated by `keymapPreset === 'vim'`)

**(a) Ex-command aliases in the palette** — extend `buildWorkspaceCommands`:

- Thread `keymapPreset` (or a `vimAliases: boolean`) into `WorkspaceCommandDeps`. When vim,
  append additive `Command` entries (distinct IDs, e.g. `vim-tabnew`, so they coexist with
  the base `:new`/`:close`/`:next` in the registry):

  | Ex-command | Action (existing dep) |
  | --- | --- |
  | `:w` / `:write` | save the active editor buffer (or `notifyInfo` if no editor open) |
  | `:q` | `removePane(activeSessionId, activePaneId)` — guard with `canClosePane`; else notify |
  | `:qa` | `removeSession(activeSessionId)` |
  | `:tabnew` / `:tabe` | `createSession()` |
  | `:tabclose` / `:tabc` | `removeSession(activeSessionId)` |
  | `:tabn` / `:tabnext` | next session; `:tabp` / `:tabprev` → previous |
  | `:vsplit` / `:vs` | `setSessionLayout(id, 'vsplit')` |
  | `:split` / `:sp` | `setSessionLayout(id, 'hsplit')` |
  | `:only` / `:on` | `setSessionLayout(id, 'single')` |
  | `:e` / `:edit <path>` | `editorBuffer.openFile(path)` |

- Base commands (`:new`, `:close`, `:next`, `:previous`, `:goto`, `:rename-*`,
  `:toggle-sidebar`, `:burner`, `:theme`, `:new-browser`) remain in both presets unchanged.
- `:vsplit`/`:split`/`:only` map to **`setSessionLayout`** only (switch layout, matching the
  user's "切到布局" framing and existing `⌘\` behavior). True pane-spawning split via
  `addPane` is a deferred refinement (§9).

**(b) Leader chords** — register on the `⌘;` leader window via `chordRegistry`, gated by
preset, mirroring `usePaneRenameChord`:

- New hook `src/features/command-palette/hooks/useVimLeaderChords.ts`. When
  `keymapPreset === 'vim'`, `registerChord` for each of:

  | Chord (`⌘;` then …) | Action | Vim analogue |
  | --- | --- | --- |
  | `h` / `j` / `k` / `l` | directional pane focus (§5.1 + `setSessionActivePane`) | `Ctrl-W h/j/k/l` |
  | `w` | cycle to next pane | `Ctrl-W w` |
  | `c` | `removePane` (close focused pane) | `Ctrl-W c` |
  | `s` | `setSessionLayout('hsplit')` | `Ctrl-W s` |
  | `v` | `setSessionLayout('vsplit')` | `Ctrl-W v` |
  | `o` | `setSessionLayout('single')` | `Ctrl-W o` |

- `r` (rename) is already registered by `usePaneRenameChord` in both presets — leave as-is.
- When the preset flips back to `vimeflow`, the registrations are torn down via the cleanup
  function `registerChord` returns (the `useEffect` re-runs on `keymapPreset` change). Each
  chord handler returns `true` (consumed) when it acts, so the leader window closes cleanly.

### 5.4 Keymap pane UI

- Wire the existing `Preset` `<Select>` to settings: `value={settings.keymapPreset}`,
  `onChange={(v) => update({ keymapPreset: v })}`. Reduce options to
  `Vimeflow (default)` + `Vim`. (Drop `vscode`/`jetbrains`/`custom` for v1.)
- Replace the placeholder `KEYMAPS` list with a corrected, zone-grouped data source
  (`src/features/settings/sections.ts`) that reflects the **real** inventory (Global /
  Sessions / Panes & Layout / Dock & Terminal / Editor / Diff). When `keymapPreset === 'vim'`,
  also render the ex-command + leader-chord rows (additive section).
- Remove the non-functional per-row Edit button and the Reset/Import/Export ghost buttons
  (Option B / deferred). The pane is **read-only** in v1.

## 6. Conflict & precedence handling (summary)

- Capture-phase listeners; bare keys always reach the focused TUI's PTY; `⌘`-combos never
  reach the PTY so they are safe to intercept.
- `DIALOG_SELECTOR` guard suppresses workspace shortcuts while any modal is open (already in
  place; the Settings dialog itself is a modal, so keymap shortcuts are inert while editing
  the keymap).
- `⌘+Shift`+arrows is global (§5.2 — the `Shift` variant dodges the editor's most-used keys)
  and still honors the already-active/out-of-range deferral + dialog guard already in
  `usePaneShortcuts`.
- Vim leader chords only fire *inside* the `⌘;` leader window, so they never touch a focused
  TUI's keystrokes.

## 7. Implementation stages (kimi→codex)

- **Stage A** — §5.1 `resolveDirectionalPane` (pure + table tests) and §5.2 `⌘+Shift`+arrows
  in `usePaneShortcuts` (global) + tests.
- **Stage B** — §5.3(a) vim ex-commands (`buildWorkspaceCommands` + preset dep) and
  §5.3(b) `useVimLeaderChords` + gating + tests.
- **Stage C** — §5.4 `KeymapPane` wiring + `sections.ts` correction + tests.

Each stage: `npm run type-check` + scoped ESLint (settings/terminal/command-palette/workspace)
+ `vitest run` on touched suites; codex review per stage; one PR to `feat/settings` (labeled
`auto-review` + `auto-approve`, plain-text `Closes VIM-104`). Split into multiple PRs only if
a single diff proves too large to review well.

## 8. Testing

- **Adjacency:** table-driven tests — every (layout, activeIndex, direction) → expected
  neighbor or `null`, across all five layouts; the multi-cell `threeRight`/`quad` cases
  explicitly.
- **`usePaneShortcuts`:** `⌘+Shift`+arrow focuses the correct neighbor; no-op directions
  propagate; suppressed while a dialog is open and for already-active/out-of-range panes;
  plain `⌘`+arrow (no Shift) is **not** intercepted (editor cursor-move preserved).
- **`buildWorkspaceCommands`:** vim aliases present **only** when preset is `vim`; each alias
  invokes the correct dep with the right arguments (`toHaveBeenCalledWith`).
- **`useVimLeaderChords`:** chords registered only when `vim`; `h/j/k/l/w/c/s/v/o` invoke the
  right actions; registrations removed when preset flips to `vimeflow`.
- **`KeymapPane`:** the Preset select reads `settings.keymapPreset` and writes via `update`;
  the bindings list reflects the selected preset (vim rows appear iff vim).

## 9. Scope / explicitly deferred

- Emacs preset; VS Code preset (`⌘`-key remap engine); JetBrains preset.
- Per-key custom rebinding (old "Option B"); import/export; reset-to-preset.
- True pane-spawning split for `:vsplit`/`:split` via `addPane` — v1 switches layout only.
- Fuzzy file picker for `:e` — v1 requires an explicit `<path>` argument.

## 10. Risks / open questions

- **Command registry coexistence:** vim aliases need distinct IDs and should surface in the
  palette's fuzzy search alongside base commands; verify the registry does not dedupe by
  label and that two commands sharing an action are acceptable.
- **`:w` in the palette vs editor focus:** the editor already binds vim `:w` (CodeMirror vim
  ex-command). The palette `:w` is a convenience that saves the active buffer; confirm there
  is a save entry point reachable from `WorkspaceCommandDeps` (else thread one in).
- **Switching to `vsplit` with one pane** shows a single pane in a two-column grid — same as
  `⌘\` today; acceptable for v1.
