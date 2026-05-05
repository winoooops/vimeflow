# Command Palette — Trigger Swap & Functional Tab Actions

**Date:** 2026-05-04
**Status:** Draft (in progress).
**Scope:** Replace the bare `:` global trigger with `Ctrl+:` and wire the existing palette UI to real workspace actions for terminal-tab management. Stub the split-pane verbs without implementing the underlying pane infrastructure.

---

## Context

The command palette feature (`src/features/command-palette/`) already ships the modal UI shell, fuzzy filter, namespace traversal, and a stubbed default command list (`:open`, `:set`, `:help`, `:new`) whose `execute` handlers all `console.info` instead of producing real effects. The palette is mounted in `src/App.tsx` as a sibling of `<WorkspaceView />`, which means it has no path to the live `useSessionManager` instance that owns the only meaningful action surface in the workspace today: terminal-tab lifecycle.

The two user requests this spec addresses:

1. Change the trigger from bare `:` to `Ctrl+:`.
2. Replace the stubbed verbs with functional commands that drive real tab operations: create / close / rename / next / previous / goto. Add stub commands for vertical and horizontal split, surfacing a "not yet implemented" message until split-pane infrastructure lands in a future spec.

---

## Section 1 — Goals & Non-Goals

### Goals

1. **Trigger swap.** Replace the bare-`:` global keyboard listener in `useCommandPalette.ts:210` with a `Ctrl+:` listener. Bare `:` no longer opens the palette; it falls through to whatever element has focus. The new `Ctrl+:` listener intentionally does NOT skip focused inputs (the existing `isInputElement` guard is dropped for this trigger) — the modifier-key shortcut must work inside text inputs, `contenteditable` regions, and the xterm textarea, since the primary use case is opening the palette while the user is interacting with a terminal. The handler must call `event.preventDefault()` so the colon character does not leak through to the focused element after the palette opens.
2. **Functional tab verbs.** The palette dispatches these commands against the workspace's session manager, not its own stubs:
   - `:new` — create a new terminal tab.
   - `:close` — close the active tab.
   - `:rename <name>` — rename the active tab in-place.
   - `:next` — switch to the next tab; wraps from the last tab to the first.
   - `:previous` — switch to the previous tab; wraps from the first tab to the last.
   - `:goto <N | name>` — jump to a tab. Numeric input is treated as a 1-indexed position into the live tab order; non-numeric input is fuzzy-matched against tab names.
3. **Stub split verbs.** The palette exposes:
   - `:split-horizontal`
   - `:split-vertical`

   Both surface a non-blocking message ("Split-pane support is coming in a future release") and otherwise no-op. They exist now so the verb list is forward-looking and the split-pane spec can later swap the stubs for real handlers without changing the palette's public surface.

4. **Responsibility split.** Palette is a dumb dispatcher: it renders, filters, and hands selected commands a `string` argument. The workspace owns the action surface: it builds the verb-keyed command list inside a `useMemo` over `sessions / activeSessionId / sessionManager` and passes the list down as a prop on `<CommandPalette commands={…} />`. Commands are plain data; their `execute` closures hold references to the live session-manager methods at the time the workspace re-renders.

### Non-Goals

- **No split-pane infrastructure.** This spec does not design the pane-tree data model, the focus model for split panes, the layout/resize behavior, or any IPC contract for split panes. A separate spec will own that work and replace the stubs introduced here.
- **No changes to the existing `:open`, `:set`, `:help` stubs.** They remain stubbed and out of scope; the only existing stub this spec replaces wholesale is `:new`, whose previous semantics (`Create new conversation`) are obsolete in the terminal-first workspace.
- **No new command-registry / context / event-bus infrastructure.** Approaches B (context-based registrar) and C (imperative event bus) from the design discussion are explicitly rejected for this iteration. The current eight-verb scope (six functional tab verbs plus two split-pane stubs) does not justify the boilerplate, and the existing `Command` interface in `registry/types.ts` already accommodates a future migration if more features want to register their own commands.
- **No keybinding-customization UI.** `Ctrl+:` is hardcoded in this iteration. A future spec may introduce user-configurable shortcuts; until then, the trigger is a single hardcoded check inside `useCommandPalette`.
- **No semantic preservation for the existing `:new` stub.** Its `console.info('Creating new conversation')` body is replaced by a real `createSession()` call; the verb is reused, the meaning changes.

---

## Section 2 — Architecture & Responsibilities

### Palette responsibilities (`src/features/command-palette/`)

The palette owns **rendering, filtering, and dispatch** — never action logic.

- **Render** the modal shell, input, results list, and footer (existing `CommandPalette.tsx` and child components — unchanged).
- **Filter** the supplied command list by the user's query, using the existing fuzzy match / per-command `match` override (existing `useCommandPalette.filterCommands` — unchanged).
- **Detect the `Ctrl+:` keystroke** and toggle visibility (replaces the bare-`:` handler in `useCommandPalette.ts`).
- **Dispatch** the user's selection by invoking the chosen command's `execute(args)` function. The palette has no knowledge of what `execute` does; commands are opaque effect closures.

The palette no longer owns a hardcoded default command list at runtime. The current `defaultCommands` constant survives only as a **fallback** for the no-prop case (kept for storybook-style standalone rendering and the existing test suite, both of which mount `<CommandPalette />` without a parent workspace). The exact merge / replace semantics between the workspace-supplied list and any surviving fallback are defined in Section 4.

### Workspace responsibilities (`src/features/workspace/WorkspaceView.tsx`)

The workspace owns the **action surface**.

- Builds the verb-keyed command list on each render via `useMemo`, with closures over the live `useSessionManager` API (`createSession`, `removeSession`, `renameSession`, `setActiveSessionId`, `sessions`, `activeSessionId`).
- Passes the list to `<CommandPalette commands={commands} />` as a prop. The palette is rendered inside `<WorkspaceView />` (currently it is a sibling in `App.tsx`; this relocation is part of Section 4).
- Presents user-facing notifications for stub commands and failure cases (the exact toast / banner mechanism is defined in Section 5).

### Why `useMemo`, and what stability matters

The `useSessionManager` hook returns fresh callback references on most renders. Each callback is wrapped in `useCallback`, but its dependency list includes `service` and the request-id-tagged `setActiveSessionId`, which themselves rebind across renders. This means the workspace's `commands` list will rebuild on most renders. **That is fine.** Source-list churn between renders is essentially free; this spec does not optimize the closed-palette idle path.

The one correctness requirement: the palette must derive its filtered result set from the **latest** `commands` array on every render. To make that mechanical rather than discipline, the existing `useState`-cached `filteredResults` field is replaced by a `useMemo` over `(query, currentNamespace, commands)`:

```typescript
// inside useCommandPalette
const filteredResults = useMemo(
  () => filterCommands(query, currentNamespace, commands),
  [query, currentNamespace, commands]
)
```

Three consequences worth calling out:

1. The `commands` prop becomes a real dependency of the filter step. Whenever the workspace rebuilds its command list (any session change, active-tab change, rename, etc.), `filteredResults` re-derives on the same render — the user never sees a stale tab list, and the `execute` closures invoked by Enter are always the just-built ones with up-to-date references to `useSessionManager`'s methods and state snapshots.
2. The previous `filteredResults` field is removed from `CommandPaletteState` (it was redundant with the inputs that produce it). The shape shrinks to `{ isOpen, query, currentNamespace, selectedIndex }`. Derived values move out of state and onto the hook's return object as siblings (see "Hook return shape" below).
3. A `clampedSelectedIndex` derived value is the **single source of truth** for highlight, dispatch, AND keyboard navigation. The user can type a query that reduces a 5-result list to 2, leaving `state.selectedIndex = 3` pointing past the end of `filteredResults`. Consumers read `clampedSelectedIndex` everywhere; the navigation handlers (`navigateUp` / `navigateDown`) compute their next position from `clampedSelectedIndex`, not from raw `state.selectedIndex`. Without this rule, ArrowUp after a shrink would decrement the raw `3 → 2`, but the highlight (already clamped to `1`) would not move — the palette would feel frozen. By driving navigation from the clamped value, every keypress moves the highlight to a visibly different row.

   `state.selectedIndex` is still the raw cursor that arrow-key handlers `setState` into, but no consumer (display or dispatch) ever reads the raw value directly — it only exists as the storage backing the next render's `clampedSelectedIndex` derivation.

   **Empty-list behavior.** When `filteredResults.length === 0`, `clampedSelectedIndex` is `-1` (no valid index exists). Consumers must guard reads accordingly:
   - Highlight: no row rendered as selected; the listbox `aria-activedescendant` attribute is omitted entirely (not set to an empty string).
   - Arrow Up / Arrow Down: no-op (the existing wrap-around math in `useCommandPalette` already early-returns when results are empty; this contract makes that explicit).
   - Enter: no-op (`executeSelected` early-returns when `clampedSelectedIndex < 0`).

   The earlier draft of this section claimed reads of `filteredResults[clampedSelectedIndex]` would never produce `undefined`. That guarantee is dropped — the empty-list case can produce `filteredResults[-1] === undefined`, and consumers must check before dereferencing rather than relying on the index alone.

### Hook return shape

`useCommandPalette` returns derived values as top-level fields, distinct from the `useState`-backed `state` object. The intent: the type signature itself should make "what is real state" vs "what is recomputed on every render" unambiguous, so future maintainers cannot mistakenly try to mutate a derived value through a setter.

```typescript
export interface CommandPaletteState {
  isOpen: boolean
  query: string
  currentNamespace: Command | null
  selectedIndex: number
}

export interface UseCommandPaletteReturn {
  state: CommandPaletteState

  // Derived values (recomputed via useMemo on every render).
  filteredResults: Command[]
  clampedSelectedIndex: number

  // Actions.
  open: () => void
  close: () => void
  setQuery: (query: string) => void
  selectIndex: (index: number) => void
  executeSelected: () => void
  navigateUp: () => void
  navigateDown: () => void
}
```

Consumer migration is mechanical and small (four read sites in current code):

| Before                                                     | After                                                                                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.filteredResults[state.selectedIndex]`               | `filteredResults[clampedSelectedIndex]`                                                                                                                           |
| `state.filteredResults` (passed to `<CommandResults>`)     | `filteredResults`                                                                                                                                                 |
| `state.selectedIndex` (when used for highlight / dispatch) | `clampedSelectedIndex`                                                                                                                                            |
| `state.selectedIndex` (inside arrow-key navigation math)   | `clampedSelectedIndex` (navigation is derived from the clamped value to avoid frozen-feel after a shrink). The setter still writes back to `state.selectedIndex`. |

Tests verify both behaviors in Section 6 (in particular: opening the palette, changing `commands` while the palette is open, then pressing Enter must invoke the latest closure and apply against the current session list; and shrinking `filteredResults` past `state.selectedIndex` never produces a `filteredResults[clampedSelectedIndex] === undefined` read).

### Single-instance assumption

Exactly one `<CommandPalette />` mounts per workspace, paired with exactly one `useSessionManager`. Multi-window / multi-workspace UI is not part of this spec; if it is added later, each window mounts its own palette + workspace pair.

---

## Section 3 — Trigger contract

### Key detection

The palette toggles on `Ctrl+:`. In `KeyboardEvent` terms:

```typescript
const isPaletteToggle = (e: KeyboardEvent): boolean =>
  e.ctrlKey && !e.metaKey && !e.altKey && e.key === ':'
```

Notes:

- `event.key === ':'` reads the **layout-aware character**, so this works on US QWERTY (where `:` requires `Shift+;`), AZERTY, Dvorak, and similar layouts without per-layout branching.
- The `!e.metaKey && !e.altKey` exclusions prevent `Ctrl+Alt+:` and `Ctrl+Cmd+:` from triggering the toggle — those compound shortcuts may belong to the operating system or future feature work.
- On macOS, where the platform convention is the Command key (`event.metaKey`), this iteration deliberately uses `Ctrl` everywhere for consistency across platforms. A follow-up keybinding-customization spec may swap macOS to Cmd; that work is out of scope here (Non-Goal of Section 1).

### Focus behavior

The new listener does **not** invoke the existing `isInputElement` guard. `Ctrl+:` opens the palette regardless of which element has focus — `<input>`, `<textarea>`, `contenteditable`, or the xterm.js textarea inside an active terminal. This is the entire reason for switching from a bare-key trigger to a modifier-key shortcut: the palette must be reachable while the user is typing inside the terminal.

The handler **must** call `event.preventDefault()` and `event.stopPropagation()` immediately after matching `Ctrl+:`, before branching on toggle direction (see "Toggle, not open-only" below for why both directions need the same suppression).

### Toggle, not open-only

Pressing `Ctrl+:` while the palette is already open **closes** it. This matches Escape's role and gives the user a single muscle-memory shortcut for both directions. The keydown handler branches on the current `isOpen` state and calls `open()` or `close()` accordingly.

Both `event.preventDefault()` and `event.stopPropagation()` run **unconditionally** whenever the handler consumes `Ctrl+:`, regardless of toggle direction. On the close path, the focused element is the palette's own input (or, in the milliseconds after close, whatever the user re-focuses); without the suppression, the colon character would leak into that input or back into the terminal. The single source of truth is "if we matched `Ctrl+:`, we own the event" — direction is a separate concern that runs after suppression.

### Bare-`:` listener is removed

The bare-`:` branch in the existing `useEffect` keydown handler (`useCommandPalette.ts:210`) is deleted outright. After this spec lands, typing `:` outside the palette is exactly equivalent to typing any other character: it reaches the focused element, or nothing if nothing has focus.

### Pre-filled query

When the palette opens, the input is pre-filled with `:`, exactly as it is today (`useCommandPalette.ts:97`). This is preserved deliberately:

1. Every command in the workspace command list begins with `:` (`:new`, `:close`, `:rename`, …), so the pre-fill places the user one keystroke closer to typing a verb.
2. The existing Backspace-on-empty-`:` close behavior (`useCommandPalette.ts:241`) continues to work without changes.

### Listener lifetime

The keydown listener is registered inside the existing `useEffect` hook in `useCommandPalette` and re-binds whenever its dependency list changes (currently `state.isOpen`, `state.query`, and the action callbacks `open` / `close` / `navigateUp` / `navigateDown` / `executeSelected`). This **rebind-on-change** pattern is preserved as-is — the handler closure captures the current state directly, so each render sees a fresh handler reading the latest values.

Reasoning for not converting to attach-once-with-refs: the rebind cost is a few `addEventListener` / `removeEventListener` pairs per user interaction, which is negligible. The capture-phase change above is the only listener-shape change this spec introduces.

### Held-key auto-repeat guard

Because the trigger toggles the palette, holding `Ctrl+:` would otherwise oscillate the palette open and closed at the OS auto-repeat rate, producing a visible flash. The handler suppresses the toggle on auto-repeat keydowns using the `KeyboardEvent.repeat` flag — but the repeat guard runs **after** match-and-suppress, never before it, so held repeats are still consumed by the palette and never leak to xterm or any focused input:

```typescript
const handleKeyDown = (event: KeyboardEvent): void => {
  if (isPaletteToggle(event)) {
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return // suppressed; do not toggle
    if (state.isOpen) close()
    else open()
    return
  }
  // …other navigation handling (ArrowUp / ArrowDown / Escape / Enter / Backspace) when state.isOpen
}
```

`event.repeat` is `true` when the OS dispatches an auto-repeat keydown for a held key and `false` for a fresh press, so the guard preserves single-press toggle semantics. The critical ordering invariant: **suppression precedes the repeat check.** If we matched `Ctrl+:`, we own the event regardless of toggle outcome — letting the colon character leak through to the focused element on auto-repeats would defeat the entire purpose of the modifier-key trigger.

### Listener attachment phase: capture, not bubble

The keydown listener attaches in **DOM capture phase**, not the default bubble phase. The cleanup MUST pass the same `capture: true` value (object identity does not matter; `removeEventListener` matches by the resolved `capture` boolean alone), because `removeEventListener` matches a listener by the `{ type, listener, capture }` triple — a mismatched cleanup is silently a no-op and the original listener stays attached.

```typescript
useEffect(
  () => {
    const handler = (event: KeyboardEvent): void => {
      /* …handler body… */
    }
    document.addEventListener('keydown', handler, { capture: true })
    return () =>
      document.removeEventListener('keydown', handler, { capture: true })
  },
  [
    /* deps */
  ]
)
```

This is load-bearing for the terminal-focus case. A bubble-phase listener at the document level runs _after_ every target handler in the path — xterm.js binds its keydown handler on the textarea inside its container, sees `Ctrl+:` first, can call `event.stopPropagation()` (or simply forward the byte to the PTY and let the bubbling event pass), and the document-level listener never gets the chance to open the palette.

Capture phase reverses the order: the document handler fires _before_ any descendant handler. The palette sees `Ctrl+:` first, calls `event.preventDefault()` and `event.stopPropagation()` to suppress the colon character from reaching xterm or any other focused element, and then opens the palette. xterm's own keydown handler never runs for this keystroke.

Both `preventDefault()` and `stopPropagation()` are required:

- `preventDefault()` cancels the default browser action (which would otherwise let the colon character flow to a focused input).
- `stopPropagation()` cancels both remaining capture-phase handlers below us and the entire bubble pass, so neither xterm nor any other listener observes the keystroke.

### Conflict surface

No `Ctrl+:` conflicts are known at the time of writing. The shortcut is not bound by Tauri's WebKitGTK shell, the React application code, the xterm.js terminal, or any browser default we are aware of. Because the listener is registered in capture phase at the document level, the palette intercepts the keystroke before any other in-app handler can claim it. Future override needs (if any) are not designed here and would be evaluated as a separate scope.

---

## Section 4 — Command set, grammar, and wiring contract

### Command list (workspace-supplied)

Inside `WorkspaceView`, the `commands` array passed to `<CommandPalette commands={…} />` contains exactly these eight entries, in this order:

| id                 | label               | args          | summary (authoritative behavior in Section 5)                                                                                                                                   |
| ------------------ | ------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tab-new`          | `:new`              | none          | Create a new terminal tab via `createSession()`.                                                                                                                                |
| `tab-close`        | `:close`            | none          | Close the active tab. Resolves the active session by `findIndex` and emits `notifyInfo` on stale / null active id; never bypasses the failure-aware path.                       |
| `tab-rename`       | `:rename`           | `<name>`      | Rename the active tab in-place. `findIndex`-resolved active; empty / whitespace args are a silent no-op; null / stale active id emits `notifyInfo`.                             |
| `tab-next`         | `:next`             | none          | Switch to the next tab. Stale / null active id recovers to `sessions[0]`. Modulo wrap only when active id is valid.                                                             |
| `tab-previous`     | `:previous`         | none          | Switch to the previous tab. Stale / null active id recovers to `sessions[len - 1]`. Modulo wrap only when active id is valid.                                                   |
| `tab-goto`         | `:goto`             | `<N \| name>` | Numeric form (`isNumericForm` regex) → 1-indexed lookup with bounds and validity checks. Otherwise fuzzy name match against `sessions[*].name` with first-occurrence tie-break. |
| `split-horizontal` | `:split-horizontal` | none          | `notifyInfo('Split-pane support is coming in a future release')`.                                                                                                               |
| `split-vertical`   | `:split-vertical`   | none          | Same `notifyInfo` as `:split-horizontal`.                                                                                                                                       |

The summaries above are intentionally non-executable. Implementers MUST follow the per-command behavior in Section 5 (`Resolving the active session`, `:close failure modes`, `:rename failure modes`, `:next / :previous failure modes`, `:goto failure modes`) — Section 5 is authoritative for every command on this list. The table is a high-level index, not a copy-pasteable sketch.

### Verb / argument grammar

The palette adds a single helper used by both the filter step and the dispatch step:

```typescript
// src/features/command-palette/registry/parseQuery.ts
export interface ParsedQuery {
  commandVerb: string // includes the leading ':' if present
  args: string // trimmed remainder, '' when no args
}

export const parseQuery = (query: string): ParsedQuery => {
  const trimmed = query.trim()
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx === -1) {
    return { commandVerb: trimmed, args: '' }
  }
  return {
    commandVerb: trimmed.slice(0, spaceIdx),
    args: trimmed.slice(spaceIdx + 1).trim(),
  }
}
```

Filter step uses `commandVerb` only:

```typescript
const { commandVerb } = parseQuery(query)
const filteredResults = useMemo(
  () => filterCommands(commandVerb, currentNamespace, commands),
  [commandVerb, currentNamespace, commands]
)
```

Effects:

- Typing `:rename foo` produces `commandVerb = ':rename'` and `args = 'foo'`. The filter uses `:rename`, so the `:rename` command stays selected while the user types its argument.
- Pressing Enter passes `args` (here, `'foo'`) to the selected command's `execute`. The command body never re-parses the verb.
- For zero-arg commands, `args === ''`. Typing `:close foo` is therefore tolerated and the trailing token is ignored: `filterCommands(':close', …)` selects `tab-close`, and `tab-close.execute('foo')` discards the argument string. This matches vim ex-command tolerance and removes a class of "extra-args" error paths the user never asked for.

### `Command` interface — unchanged

The existing `Command` interface in `registry/types.ts` already declares `execute?: (args: string) => void` (optional — namespace commands have `children` and no executable body). No type-shape change is required. All eight new commands in this spec are leaves and supply `execute`; the only mechanical change is that every command's `execute` now receives the trimmed `args` substring rather than the entire query.

### `defaultCommands` — replace, not augment

The palette's `commands` prop becomes the single source of truth at runtime when supplied. Behaviorally:

- **Workspace-rendered palette** (the production path): `<CommandPalette commands={workspaceCommands} />` — palette uses `workspaceCommands` exclusively. The previously-stubbed `:open`, `:set`, and `:help` are not included in `workspaceCommands`, so they no longer appear to the user. They were never reachable as functional commands (their `execute` was `console.info`), so removing them from the production view is a cleanup, not a regression.
- **Fallback path** (no-prop test renders, storybook): `<CommandPalette />` with no prop — palette falls back to `defaultCommands` exactly as today, including the existing stubs. This preserves the _test scaffolding_ of the existing suite (the same render-without-workspace pattern still mounts a usable palette), but specific assertions are not preserved verbatim: tests that read `state.filteredResults`, dispatch a bare `:` keystroke, or mount `<CommandPalette />` from `App.tsx` need updates to match the new shape (top-level `filteredResults`, `Ctrl+:` trigger, workspace-mounted palette). The detailed list of test updates is captured in Section 6.

The `data/defaultCommands.ts` file is left untouched. The `useCommandPalette` hook signature gains an optional `commands?: Command[]` parameter:

```typescript
export const useCommandPalette = (
  commands: Command[] = defaultCommands
): UseCommandPaletteReturn => {
  /* … */
}
```

and `<CommandPalette />` accepts a matching prop and passes it down.

### `<CommandPalette />` relocation

`App.tsx` no longer renders `<CommandPalette />`. Instead, `WorkspaceView` builds the command list and renders the palette inline:

```typescript
// WorkspaceView.tsx (sketch)
const workspaceCommands = useMemo(
  () => buildWorkspaceCommands({
    sessions,
    activeSessionId,
    createSession,
    removeSession,
    renameSession,
    setActiveSessionId,
    notifyInfo,
  }),
  [
    sessions,
    activeSessionId,
    createSession,
    removeSession,
    renameSession,
    setActiveSessionId,
    notifyInfo,
  ]
)

return (
  <div data-testid="workspace-view" /* … */>
    {/* …icon rail / sidebar / terminal / drawer / etc… */}
    <CommandPalette commands={workspaceCommands} />
  </div>
)
```

`buildWorkspaceCommands(deps)` is a pure helper exported from a new file `src/features/workspace/commands/buildWorkspaceCommands.ts`. It returns the eight-command array described above. Pulling it out keeps `WorkspaceView` readable and gives unit tests a small, dependency-injected target.

The `notifyInfo: (message: string) => void` callback that the stub split commands invoke is part of the workspace's failure- / info-notification mechanism, fully defined in Section 5. For the purposes of Section 4, it is a contract: a workspace-supplied callback that surfaces a non-blocking message to the user.

---

## Section 5 — Failure modes & `notifyInfo`

### `notifyInfo` mechanism

The workspace exposes a single notification surface for non-blocking, palette-originated messages: a banner styled as info (primary tint), positioned at the top of the workspace's main column, auto-dismissing after **5 seconds** and dismissable on click. State and rendering live in `WorkspaceView`:

```typescript
// WorkspaceView.tsx (sketch)
const [commandMessage, setCommandMessage] = useState<string | null>(null)
const messageTimerRef = useRef<number | null>(null)

const notifyInfo = useCallback((message: string): void => {
  if (messageTimerRef.current !== null) {
    window.clearTimeout(messageTimerRef.current)
  }
  setCommandMessage(message)
  messageTimerRef.current = window.setTimeout(() => {
    setCommandMessage(null)
    messageTimerRef.current = null
  }, 5000)
}, [])

useEffect(
  () => () => {
    if (messageTimerRef.current !== null) {
      window.clearTimeout(messageTimerRef.current)
    }
  },
  []
)
```

Visual treatment mirrors the existing `fileError` banner at `WorkspaceView.tsx:402-418` but uses `bg-primary/20`, `border-primary/40`, `text-primary` instead of the error palette. A single `<InfoBanner />` component is extracted later if a third banner type appears; for now the inline pattern is preserved for parity with `fileError`.

Why a banner and not a toast: the workspace has no toast container, no toast queueing logic, and no animation infrastructure. Adding any of those is out of scope. The banner mirrors an existing pattern, costs ~20 lines, and covers every Section-5 caller below.

Why 5 seconds: long enough to read a one-sentence message, short enough not to obscure the workspace. No empirical study; a reasonable default. The dismiss-on-click escape hatch makes the duration non-load-bearing.

### Resolving the active session

All four commands below (`:close`, `:rename`, `:next`, `:previous`) resolve the active session by _index lookup_, not by reading `activeSessionId` directly:

```typescript
const idx = activeSessionId
  ? sessions.findIndex((s) => s.id === activeSessionId)
  : -1
```

This collapses two failure cases into one branch — `idx === -1` whenever `activeSessionId` is `null` **or** when it holds a stale id no longer present in `sessions` (which can happen during async session-kill / set-active rollback races inside `useSessionManager`). Without this collapse, a stale id would cause `removeSession(activeSessionId)` to silently no-op (the manager filters unknown ids), the user would get no feedback, and the wrap formula in `:previous` would compute the wrong tab.

### `:close` failure modes

| State (after `idx` resolution)         | Behavior                                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idx === -1` (no valid active session) | `notifyInfo('No active tab to close')`; do not call `removeSession`.                                                                                                                              |
| `idx >= 0`                             | `removeSession(sessions[idx].id)`; do nothing on the call's IPC failure (the existing `useSessionManager` already logs a `console.warn` — surfacing IPC errors to the user is not in scope here). |

### `:rename` failure modes

| State (after `idx` resolution)                                    | Behavior                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `idx === -1`                                                      | `notifyInfo('No active tab to rename')`; do not call `renameSession`. |
| `idx >= 0`, args empty or whitespace-only after `parseQuery` trim | `notifyInfo('Usage: :rename <name>')`; do not call `renameSession`.   |
| `idx >= 0`, args present                                          | `renameSession(sessions[idx].id, args)`.                              |

The empty-args case emits `notifyInfo` for parity with `:goto`'s empty-args branch and because `executeSelected` always invokes `close()` after `execute()` returns — meaning by the time this branch fires, the user has pressed Enter and the palette is dismissed, so they are no longer mid-typing. A silent close would leave them with no signal that the args were missing; the usage banner gives them an explicit hint to retry.

### `:next` / `:previous` failure modes

The `delta` is `+1` for `:next` and `-1` for `:previous`. `len = sessions.length`.

The branch order matters: stale / null active id (`idx === -1`) takes precedence over the single-session wrap-to-self rule, because the user with a stale active id has no valid current tab — selecting _some_ tab is a recovery, not a wrap.

| State (after `idx` resolution) | Behavior                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `len === 0`                    | `notifyInfo('No open sessions')`; do not call `setActiveSessionId`. (Aligns with `:goto` against zero sessions and matches every other failure path in the builder — silent no-op left the user with no signal that the palette closed for a reason.)                                                                                             |
| `idx === -1`, `len >= 1`       | `:next` selects `sessions[0]`; `:previous` selects `sessions[len - 1]`. This is the recovery branch — it fires even when `len === 1`, since the user's active id is invalid and we need to land them on a real tab. Applying the modulo formula with `idx = -1` would yield the wrong tab for `:previous`, which is why this branch is separated. |
| `idx >= 0`, `len === 1`        | No-op (wrapping to self with a valid active id). No `notifyInfo` — the user explicitly has the only tab they own selected.                                                                                                                                                                                                                        |
| `idx >= 0`, `len >= 2`         | `setActiveSessionId(sessions[(idx + delta + len) % len].id)`. The `+ len` term keeps the modulo positive on the previous wrap.                                                                                                                                                                                                                    |

### `:goto` failure modes

Argument parsing distinguishes "input is an unambiguous positive-integer position" from "input is a tab name":

```typescript
const trimmed = args.trim()
// Positive-integer-only — anything else (negative, decimal, alphanumeric)
// falls through to fuzzy-name matching so a session named "-1" / "1.5"
// stays reachable.
const isPositionLike = /^\d+$/.test(trimmed)
```

The narrow regex is deliberate. Earlier drafts of this spec rejected negative and decimal inputs as "invalid position" attempts, but a session may legitimately be named `-1`, `1.5`, or `2.0` — under the broad-regex variant, those tabs were trapped in the position-validation branch and could not be reached via `:goto` at all. Only purely-digit inputs (`1`, `42`) are unambiguous as a position request; everything else is treated as a name query.

Branch behavior:

| Input shape                                                               | Behavior                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty / whitespace-only                                                   | `notifyInfo('Usage: :goto <position or name>')`.                                                                                                                                                                                                                                                                                                                                                                  |
| `isPositionLike`, in range (`1 <= numeric <= len`)                        | `setActiveSessionId(sessions[numeric - 1].id)`. 1-indexed.                                                                                                                                                                                                                                                                                                                                                        |
| `isPositionLike`, `numeric === 0`                                         | `notifyInfo('Position must be a positive integer')`. (`0` matches the regex but fails the `position < 1` guard; the message preserves the "did you mean :goto 1?" UX without a fuzzy fallback.)                                                                                                                                                                                                                   |
| `isPositionLike`, `numeric > len`                                         | ``notifyInfo(`No tab at position ${numeric}`)``.                                                                                                                                                                                                                                                                                                                                                                  |
| Not `isPositionLike` (negative, decimal, alphanumeric, name), `len === 0` | `notifyInfo('No open sessions')`.                                                                                                                                                                                                                                                                                                                                                                                 |
| Not `isPositionLike`, `len > 0`, fuzzy match                              | Score every tab name with the existing `fuzzyMatch` from `registry/fuzzyMatch.ts`. If the **best** score is `0` (no real match), ``notifyInfo(`No tab matching ${args}`)``. Otherwise jump to the highest-scoring tab. Ties (multiple tabs at the same top score) are broken by **first occurrence in the `sessions` array**, which is the user's tab-strip order — deterministic and matches what the user sees. |

Worth calling out: `:goto -1`, `:goto 1.5`, `:goto 1.0`, `:goto NaN`, `:goto 2abc` all fall to the fuzzy-name branch. These are perfectly valid tab names and the fuzzy matcher will score them against the live tab list — a session named `1.5` stays reachable via `:goto 1.5`. If no session matches, the user sees the standard `No tab matching X` message rather than a position-specific error.

Tie-breaking is deliberate and not delegated to `notifyInfo('Multiple matches')`: forcing the user to disambiguate is more annoying than the small risk of "wrong tab" on identically-named tabs, and tab names are user-controlled — duplicates are the user's choice and they can rename to disambiguate.

### `:new` failure modes

No user-input validation is possible. `createSession()` is fire-and-forget at the workspace level; the underlying `useSessionManager.createSession` handles its own IPC errors internally via `console.warn` and the round-12 `pendingSpawns` re-fire path.

For this iteration, `:new` failures are **silent in the UI**. In packaged Tauri builds the developer console is not visible to the user, so a spawn failure produces no visible feedback. The user can re-issue `:new` to retry. Threading a workspace-level failure callback into `useSessionManager.createSession` is out of scope here; if real-world usage shows users hitting this path, a follow-up spec can add a notify path symmetric with the other commands' failure surfaces.

### Stub split commands

Both `:split-horizontal` and `:split-vertical` invoke:

```typescript
notifyInfo('Split-pane support is coming in a future release')
```

No retry logic, no flag, no progressive disclosure. The same message is intentionally shared — they are the same not-yet-implemented feature from the user's point of view.

### What this section does NOT define

- **No toast queueing.** Successive `notifyInfo` calls collapse to the latest message — the previous timer is cleared. If the user triggers two failure cases in quick succession, only the second is visible. This is acceptable because each command is a discrete user action; there is no batching scenario where lost messages would matter.
- **No accessibility live-region wrapping.** The existing `fileError` banner uses `role="alert"`; the info banner uses `role="status"` (less assertive — does not interrupt screen readers mid-sentence). Both surfaces are picked up by assistive tech without a separate live-region wrapper.
- **No persistence.** Messages do not survive reload. They reflect transient command failures, not application state.

---

## Section 6 — Testing approach

### Coverage map

| Layer           | Files                                               | What we prove                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit**        | `parseQuery.test.ts` (new)                          | The `parseQuery` helper splits verb / args correctly across whitespace, leading/trailing trim, no-args, multi-token args, empty input.                                                                                                                                                                                                                                        |
| **Unit**        | `buildWorkspaceCommands.test.ts` (new)              | Given a fixed `useSessionManager`-shaped deps object, the helper returns exactly eight commands in the documented order with the documented ids and labels, and each `execute` invokes the right `useSessionManager` method with the right arguments — including the no-active and stale-id branches from Section 5.                                                          |
| **Component**   | `CommandPalette.test.tsx` (existing, **updated**)   | The palette renders / filters / dispatches using the new top-level `filteredResults` and `clampedSelectedIndex` fields. Bare-`:` keystrokes no longer open the palette. `Ctrl+:` toggles open / close, suppresses key auto-repeats, and runs `preventDefault` + `stopPropagation` on both directions.                                                                         |
| **Component**   | `useCommandPalette.test.ts` (existing, **updated**) | The hook signature accepts an optional `commands` parameter; when supplied, derivation reads from it. When the prop changes between renders with the palette open, `filteredResults` re-derives on the same render, and `clampedSelectedIndex` snaps to a valid index after the result list shrinks.                                                                          |
| **Integration** | `WorkspaceView.command-palette.test.tsx` (new)      | `<WorkspaceView />` mounts `<CommandPalette />` inline (not from `App.tsx`); pressing `Ctrl+:` opens the palette over a real session manager; `:new` increments the tab count; `:close` calls `removeSession` against the active id; `:rename foo` updates the active tab name; `:next` / `:previous` cycle correctly with wrap; `:goto 2` / `:goto <name>` switch active id. |
| **Integration** | `WorkspaceView.notifyInfo.test.tsx` (new)           | The info banner appears for the documented Section-5 cases (`:close` with no active, `:goto` out-of-range, `:goto` no-match, `:split-horizontal` / `:split-vertical`). The banner auto-dismisses after 5 seconds, dismisses on click, and successive `notifyInfo` calls collapse to the latest message.                                                                       |

### Specific behavioral tests required

Several behaviors are non-obvious and must have their own assertions, not just "the happy path renders":

1. **Stale-commands closure (Section 2 fix).** Mount the palette with a `commands` array whose `execute` closures capture `activeSessionId = 'a'`. Open the palette. Re-render with a fresh `commands` array whose closures capture `activeSessionId = 'b'`. Press Enter on `:close`. Expected: `removeSession` called with `'b'`, not `'a'`. Without the `useMemo` filter step, this fails — the test directly exercises the round-2 codex finding.
2. **`clampedSelectedIndex` shrink (Section 2 fix).** Open palette. Type a query that yields five results. Press ArrowDown three times so `state.selectedIndex = 3`. Type more characters so the result list shrinks to two. Expected: `clampedSelectedIndex === 1` and the palette renders the second item highlighted; pressing Enter dispatches the second item, not `undefined`.
3. **Auto-repeat suppression (Section 3 fix).** Dispatch a `keydown` for `Ctrl+:` with `repeat: false` — palette opens. Dispatch a second `keydown` with `repeat: true` while still open — palette stays open AND `preventDefault` was called on the repeat (asserted via a spy). Without the suppress-before-guard ordering, the latter assertion fails.
4. **Capture phase wins over xterm (Section 3 fix).** Mount a child element with its own keydown handler that calls `event.stopPropagation()`. Dispatch `Ctrl+:` from that child. Expected: the palette opens regardless. This proves the document-level capture listener observed the event before the descendant's bubble-phase handler had a chance to suppress it.
5. **`:goto` numeric edge cases (Section 5 fix).** For each of `''`, `'0'`, `'-1'`, `'1.5'`, the `:goto` execute path triggers the documented `notifyInfo` and does NOT call `setActiveSessionId`. For `'2'` against three sessions, it calls `setActiveSessionId(sessions[1].id)`. (Note: tokens like `'NaN'` or `'2abc'` fail the `isNumericForm` regex and route through the fuzzy-name branch — they are exercised by the fuzzy edge-case test below, not here.)
6. **`:goto` fuzzy edge cases (Section 5 fix).** With sessions `['my-project', 'my-other', 'unrelated']`: `:goto my` selects the highest-scoring tab (and on a tie, the first by sessions-array order); `:goto zzz` triggers `notifyInfo` and does not switch.
7. **Stale-id collapse (Section 5 fix).** Set `activeSessionId = 'ghost'` while `sessions = [{ id: 'real' }]`. `:close` triggers the no-active `notifyInfo` and does NOT call `removeSession`. `:next` selects `sessions[0]` (the first session, not the wrong-tab modulo result).

### Existing tests that need updates

| Test                                                                 | Update                                                                                                                                                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CommandPalette.test.tsx` "opens palette when `:` key is pressed"    | Becomes "opens palette when `Ctrl+:` is pressed". The plain-`:` variant is removed entirely (no longer a trigger).                                                                                             |
| `CommandPalette.test.tsx` "opens with `:` pre-filled in input"       | Trigger updated to `Ctrl+:`; the assertion that the input value is `':'` is preserved (pre-fill behavior unchanged per Section 3).                                                                             |
| `CommandPalette.test.tsx` arrow-navigation / Enter / Backspace tests | Trigger updated to `Ctrl+:`; assertions otherwise unchanged. Reads of `state.filteredResults` migrate to top-level `filteredResults`.                                                                          |
| `useCommandPalette.test.ts` shape assertions                         | The returned object's shape changes per Section 2 ("Hook return shape"): assertions on `state.filteredResults` migrate to top-level `filteredResults`; new assertions cover the optional `commands` parameter. |
| `App.test.tsx` (if it asserts the palette mounts at the `App` level) | Update to assert the palette mounts inside `WorkspaceView`.                                                                                                                                                    |

### What this section does NOT define

- **No visual / snapshot tests for the info banner.** Visual treatment is documented in Section 5; behavior is tested above. Adding snapshot tests would lock down design choices that may legitimately move.
- **No E2E (wdio) coverage.** The integration tests at the React-Testing-Library layer cover the cross-component contracts. A wdio pass is appropriate when the implementation lands but is not part of this spec's must-have list.
- **No performance assertions.** The `useMemo` filter step is described qualitatively as "essentially free"; benchmark tests would over-specify what is currently a non-issue.

<!-- codex-reviewed: 2026-05-05T08:40:54Z -->
