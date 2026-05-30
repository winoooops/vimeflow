# 2026-05-21 — Terminal copy support design

## 1. Summary

The terminal pane (`src/features/terminal/components/TerminalPane/Body.tsx`,
where `new Terminal({...})` lives at line 583) instantiates xterm.js without
any **app-level** copy plumbing — `@xterm/xterm@6.0.0` has **no
`copyOnSelection` Terminal option** (it existed in v5 and was removed for
the new namespaced package), and Vimeflow registers no `onSelectionChange`
listener, no copy keystroke handler, and no right-click menu over the
terminal pane. xterm.js itself does register an internal `contextmenu`
listener on `terminal.element` for its built-in right-click behavior (see
`node_modules/@xterm/xterm/src/browser/CoreBrowserTerminal.ts:355`); the
new `TerminalContextMenu` coexists with it by attaching its own
`contextmenu` listener that calls `event.preventDefault()` to suppress
xterm's default (Section 4 specifies the exact ordering and Section 6 the
menu's accessibility contract). As a result, **paste works but copy is
silently absent** — no application-level copy / auto-copy / custom menu
has ever shipped. Paste appears to work because xterm.js's textarea proxy accepts the
browser's native paste event and forwards the pasted text through
`terminal.onData` to the existing `write_pty` IPC; no application code
contributes to the paste path today.

This spec describes a **frontend-only** addition that fills the gap. A new
`useTerminalClipboard({ terminal })` hook (under `src/features/terminal/hooks/`,
matching the project's hook-per-concern pattern) implements copy-on-selection
manually via `terminal.onSelectionChange` plus a mouseup gate (Section 5
specifies the gating that prevents partial-drag selections from clobbering
the clipboard), intercepts platform-native shortcuts via
`terminal.attachCustomKeyEventHandler`, and exposes
`{ copy, paste, selectAll, clear }` callbacks. A new feature-local
`TerminalContextMenu` component renders a right-click menu over the active
pane that invokes those same callbacks. `Body.tsx` is touched in two places
**at component top level** (React hook rules require this — the Terminal is
created inside an existing `useEffect`, so the hook cannot live there): a
`useTerminalClipboard({ terminal })` call after the existing
`useState<Terminal | null>(null)` at `Body.tsx:207`, and a
`<TerminalContextMenu>` mount inside the existing return tree. The hook is a
no-op while `terminal === null` and reacts to it becoming non-null via the
existing `setTerminal(newTerminal)` at `Body.tsx:753` — both the cache-reuse
branch and the create-new branch culminate in that call, so both lifecycle
paths flow through the hook for free. No Terminal init options change; the
`new Terminal({ ... })` block at `Body.tsx:583` is left alone.

No Rust backend, no new IPC, and no preload changes are required.
`navigator.clipboard.writeText` is already proven in this Electron renderer
by the `writeClipboardText` helper in
`src/features/agent-status/components/ActivityEvent.tsx:91`, which calls
`clipboard.writeText` directly and throws `Error('Clipboard API unavailable')`
when the async API is missing (no `document.execCommand('copy')` textarea
fallback is in place today; whether the new hook's `copy` callback should
adopt the same throwing-only posture or add a fallback is deferred to
Section 4's hook contract). The **read path** — `navigator.clipboard.readText`,
used by the new paste callback and the context-menu Paste item — has
**no existing call site** in the renderer and must be validated during
implementation; Section 5 covers the fallback strategy if the Electron
sandbox denies clipboard read.

## 2. Scope

### In scope

- **Terminal copy** from the active pane's xterm.js selection to the system
  clipboard, triggered by any of:
  - A drag-selection that completes inside the terminal viewport (auto-copy
    on mouseup, when the selection is non-empty),
  - A platform-native keyboard shortcut on an existing selection (binding
    table in Section 5), or
  - The "Copy" item in the new right-click context menu.
- **Symmetric paste shortcut** (additive only): `Ctrl+Shift+V`
  (Linux / Windows) / `Cmd+Shift+V` (macOS) bound through the same hook.
  The existing browser-native `Ctrl+V` / `Cmd+V` paste path is **not
  modified**; both shortcuts must continue to deliver pasted text to the
  PTY via the existing `terminal.onData → write_pty` flow.
- **Right-click context menu** with two items in v1, mapped to specific xterm
  methods (no ambiguity):
  - **Copy** → calls `terminal.getSelection()` + writes to clipboard;
    disabled when `terminal.hasSelection() === false`.
  - **Paste** → reads clipboard + calls `terminal.paste(text)`.

  v1 deliberately ships with a two-item menu surface. The hook still
  exposes `selectAll` and `clear` callbacks (§4) — they call
  `terminal.selectAll()` and `terminal.clear()` respectively — so future
  iterations can grow the menu without touching the hook, but no menu
  item invokes them today. Selection-clearing is incidental to Copy and
  is never exposed as a menu item (matches gnome-terminal / iTerm2).
  Tracked in §7.5 future work.

  Feature-local under `src/features/terminal/components/`. Positioned at
  the click location, dismissed on outside click / `Escape` / item
  activation. Accessibility contract (roles, keyboard navigation) is
  defined in Section 6.

- **Hook extraction** as
  `src/features/terminal/hooks/useTerminalClipboard.ts`, with the signature
  defined in Section 4 and matching the project's sibling hooks
  (`usePaneShortcuts`, `useTerminal`, `usePtyExitListener`).
- **Co-located tests** (`useTerminalClipboard.test.ts`,
  `TerminalContextMenu.test.tsx`) at the 80% coverage floor mandated by
  `rules/CLAUDE.md`. Test surface: copy with selection, copy with no
  selection (no-op), paste success, paste rejected by clipboard permission
  (fallback per Section 5), `selectAll`, `clear`, copy-on-selection trigger
  gating, platform-modifier branching, and the right-click menu's four
  items + dismissal paths.
- **`Body.tsx` integration**: one `useTerminalClipboard({ terminal })` call
  at component top level (immediately after the existing
  `useState<Terminal | null>(null)` at `Body.tsx:207`), plus one
  `<TerminalContextMenu>` JSX mount inside the existing return tree. The
  hook is a no-op while `terminal === null` and re-runs its side effects
  once `terminal` becomes non-null via the existing
  `setTerminal(newTerminal)` at `Body.tsx:753`. The Terminal-creation
  `useEffect` (covering both the cache-reuse branch at `Body.tsx:568` and
  the create-new branch at `Body.tsx:583`) is **not modified** — both paths
  culminate in `setTerminal`, so both lifecycle paths flow through the hook
  automatically. No Terminal init options change.

### Out of scope (deferred)

- **Editor "Copy Path" implementation**, diff-hunk copy, command-palette
  item copy, image clipboard, or any surface outside the terminal pane.
  Scope was narrowed to "terminal copy only" during the planner
  clarification step. Other call sites that already work today (such as
  `ActivityEvent.tsx`'s `writeClipboardText`) remain unchanged.
- **OSC 52 (remote-to-local clipboard from the PTY).** A power-user
  feature that warrants its own design pass; tracked in Section 7
  "Out of scope / future work".
- **A shared `clipboardService` abstraction across features.** Approach 3
  in the planner's option set was declined; `ActivityEvent.tsx`'s inline
  `writeClipboardText` helper stays in place.
- **Tmux-style "copy mode"** (keyboard-driven selection without a mouse).
  Tracked in Section 7.
- **Clipboard sanitization or paste preview** (e.g. strip leading newlines
  on multi-line paste, warn before pasting URLs with shell metacharacters).
  Not in scope.
- **Changes to the existing `Ctrl+V` / `Cmd+V` paste path.** The "reclaim
  `Ctrl+V` for PTY passthrough" alternative was explicitly declined in the
  planner's trigger-mechanism question; the new shortcut is purely
  additive.
- **Rust backend / new IPC / preload changes.** None — this work is 100%
  frontend. The `electron/backend-methods.ts` allowlist is untouched; no
  new method is added.

## 3. Design overview

### Chosen approach (recap)

The planner session compared three approaches: (1) inline in `Body.tsx`,
(2) extract a `useTerminalClipboard` hook + feature-local context menu, and
(3) build a shared cross-feature clipboard service. **Approach 2 was
selected** for matching the project's hook-per-concern convention
(`usePaneShortcuts`, `useTerminal`, `usePtyExitListener` are right next door
under `src/features/terminal/hooks/`), for staying under the 800-line file
ceiling on `Body.tsx`, and for letting the clipboard logic be exercised by
unit tests against a mocked `Terminal` rather than only through a full
`TerminalPane` render. Approach 1 was rejected for testability; Approach 3
was rejected as YAGNI under the "terminal copy only" scope.

### File layout

**New files (4):**

| Path                                                            | Purpose                                                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/terminal/hooks/useTerminalClipboard.ts`           | Wires `onSelectionChange` + mouseup gating, `attachCustomKeyEventHandler`, and exposes `{ copy, paste, selectAll, clear }`. Contract in Section 4.      |
| `src/features/terminal/hooks/useTerminalClipboard.test.ts`      | Unit tests against a mocked `Terminal` (selection helpers, key event handler, `paste`). Coverage list in Section 7's testing subsection.                |
| `src/features/terminal/components/TerminalContextMenu.tsx`      | Right-click menu rendering four items. Positioned at click coordinates; dismissed on outside click / `Escape` / item activation. Contract in Section 6. |
| `src/features/terminal/components/TerminalContextMenu.test.tsx` | RTL test for the four items, disabled-Copy state when no selection, dismissal paths, and keyboard accessibility.                                        |

**Edited files (1):**

| Path                                                     | Edit                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/terminal/components/TerminalPane/Body.tsx` | Two top-level additions: a `useTerminalClipboard({ terminal })` call after the existing `useState<Terminal \| null>` at line 207, and a `<TerminalContextMenu>` mount inside the existing return. The Terminal-creation `useEffect` and the `new Terminal({ ... })` block at line 583 are unchanged. |

**Files NOT changed (load-bearing non-goals):**

- `crates/backend/**` — no Rust changes; no new IPC command added to the
  router under `crates/backend/src/runtime/`.
- `electron/backend-methods.ts` — IPC allowlist untouched. (The four-file
  IPC pattern — inner `mod.rs` + `state.rs` + `ipc.rs` match arm +
  `electron/backend-methods.ts` allowlist — is documented in the
  contributor's memory of past IPC work; this spec does not trigger it
  because no new IPC method is added.)
- `electron/preload.ts` (and any other preload bridge) — no new
  `contextBridge.exposeInMainWorld` entry added.
- `src/features/agent-status/components/ActivityEvent.tsx` — keeps its
  inline `writeClipboardText` helper (Section 2 explicit non-goal).
- `src/features/terminal/services/terminalService.ts` and the PTY
  write/read path — unchanged. Pasted text continues to flow through
  `terminal.onData → service.write` as it does today.

### Dependency direction

```
Body.tsx (top level)
  ├── const [terminal, setTerminal] = useState<Terminal | null>(null)  (existing — Body.tsx:207)
  ├── useEffect(() => { ... new Terminal({...}) ... setTerminal(...) }) (existing — unchanged)
  ├── const { copy, paste, selectAll, clear, isOpen, openAt, close,
  │           hasSelection }
  │     = useTerminalClipboard({ terminal })                          (NEW)
  │       └── reads: Terminal public API only
  │           (onSelectionChange, hasSelection, getSelection,
  │            clear, selectAll, paste,
  │            attachCustomKeyEventHandler, element)
  │       └── writes: navigator.clipboard.writeText / readText
  │       └── owns:
  │             • copy-on-selection mouseup gate
  │             • platform-native shortcut interception per §4 table
  │               (macOS: Cmd+C copy, Cmd+Shift+V paste;
  │                Linux/Win: Ctrl+Shift+C copy, Ctrl+Shift+V paste)
  │               via terminal.attachCustomKeyEventHandler
  │             • a `contextmenu` listener attached to terminal.element
  │               that calls event.preventDefault() (suppressing xterm's
  │               built-in contextmenu handler at CoreBrowserTerminal.ts:355)
  │               and sets isOpen=true + openAt={x:event.clientX,
  │               y:event.clientY}
  └── return (
        ...
        <TerminalContextMenu                                           (NEW)
          isOpen={isOpen} position={openAt} onClose={close}
          onCopy={copy} onPaste={paste}
          canCopy={hasSelection}
        />
        // Hook still exposes selectAll/clear (§4) but the v1 menu does
        // not surface them — see §6.
      )
```

The hook depends only on xterm.js's public `Terminal` API and the browser
Clipboard API; it has zero coupling to React Router, the workspace store,
IPC, or any other feature. The menu is a pure controlled component that
takes the callbacks as props. The exact signature of `useTerminalClipboard`
— including how `isOpen` / `openAt` / `close` are exposed and how
`hasSelection` is kept in sync with xterm's selection state — is fixed in
Section 4.

### What this spec does NOT prescribe (intentional latitude for the implementer)

- The exact icon set on the menu items (Material Symbols name choices live
  in the implementation; Section 6 fixes only the accessibility contract,
  not the icon names).
- Whether copy errors surface as a toast, a console warning, or are
  swallowed silently — see Section 4's copy-failure-policy decision
  (deferred).
- The CSS framing of the menu container. Tailwind tokens already drive the
  rest of the app per `tailwind.config.js`; the menu uses the same
  `bg-surface-container` / `text-on-surface` tokens, but the exact class
  list is implementation latitude.

## 4. `useTerminalClipboard` hook contract

### Signature

```typescript
import type { Terminal } from '@xterm/xterm'

export type ClipboardModifier = 'meta' | 'ctrl'

export interface UseTerminalClipboardOptions {
  /** The active xterm.js Terminal, or `null` when the Terminal-creation
   *  `useEffect` in `Body.tsx` has not yet fired `setTerminal(newTerminal)`
   *  (Body.tsx:753). When `null`, every returned callback is a no-op
   *  and `hasSelection` is `false`. */
  terminal: Terminal | null

  /** Override the platform-detected modifier. When omitted, the hook
   *  detects the platform internally via
   *  `navigator.platform.toLowerCase().includes('mac')` (mirrors the
   *  derivation `WorkspaceView` already performs for `usePaneShortcuts`)
   *  and chooses `'meta'` on macOS, `'ctrl'` elsewhere. The option
   *  exists for tests to pin a value without stubbing `navigator`, and
   *  for power users who want to invert the default. **No
   *  prop-threading from `WorkspaceView` is required** — that's the
   *  whole point of detecting internally; keeps the spec's "edited
   *  files: Body.tsx only" guarantee intact. */
  preferModifier?: ClipboardModifier

  /** Called when a copy attempt rejects (both `writeText` AND the
   *  textarea fallback failed). Defaults to a no-op; consumers
   *  decide whether to toast, console-warn, or swallow. */
  onCopyError?: (error: unknown) => void

  /** Called when `navigator.clipboard.readText()` **rejects** (e.g.
   *  the Electron sandbox denies clipboard read, or the API is
   *  unavailable). Defaults to a no-op. **Not called** when the
   *  read succeeds but returns an empty string — that case is a
   *  silent no-op (see `paste()` below). */
  onPasteError?: (error: unknown) => void
}

export interface UseTerminalClipboardResult {
  /** `true` iff `terminal !== null && terminal.hasSelection()`.
   *  Kept in sync via `terminal.onSelectionChange`. */
  hasSelection: boolean

  /** Whether the right-click context menu is currently open. */
  isOpen: boolean

  /** Click coordinates (viewport-space `clientX` / `clientY`)
   *  when `isOpen === true`. `null` when closed. */
  openAt: { x: number; y: number } | null

  /** Close the menu. Idempotent; safe to call when already closed. */
  close: () => void

  /** Copy current selection to the clipboard. Resolves when the
   *  write completes (or all fallbacks have failed). No-op when
   *  `terminal === null` or `terminal.hasSelection() === false`. */
  copy: () => Promise<void>

  /** Paste clipboard contents into the terminal via
   *  `terminal.paste(text)`. No-op when `terminal === null` or when
   *  the clipboard read **succeeds with an empty string**. Calls
   *  `onPasteError(error)` when `readText` **rejects** (sandbox
   *  denial / API unavailable). */
  paste: () => Promise<void>

  /** `terminal.selectAll()`. No-op when `terminal === null`. */
  selectAll: () => void

  /** `terminal.clear()` — wipes the buffer including scrollback,
   *  making the prompt line the new first line (per xterm docs).
   *  **Not** `clearSelection()`. No-op when `terminal === null`. */
  clear: () => void
}

export const useTerminalClipboard = (
  options: UseTerminalClipboardOptions
): UseTerminalClipboardResult => {
  /* impl */
}
```

### Side effects (one `useEffect`, deps: `[terminal, preferModifier]`)

**Callback freshness via refs.** `onCopyError` and `onPasteError` are
intentionally **not** in the effect's dependency array — including them
would cause the entire effect (re-`attachCustomKeyEventHandler`,
re-subscribe `onSelectionChange`, re-attach DOM listeners) to re-run on
every parent re-render that produces a new error-callback identity. The
hook instead stores each callback in a `useRef` updated each render
(latest-callback pattern), and read-sites call
`onCopyErrorRef.current(error)` / `onPasteErrorRef.current(error)`.
This is the same pattern `usePaneShortcuts.ts:55-64` uses for its
`onTerminalZoneFocus` and `isTerminalContainerActive` callback props
— consistent with the existing hook idiom in this repo.

1. **Selection-change subscription** —
   `terminal.onSelectionChange(() => setHasSelection(terminal.hasSelection()))`.
   Disposed via the `IDisposable` returned by xterm.
2. **Custom key event handler** —
   `terminal.attachCustomKeyEventHandler(handler)` where `handler` returns
   `false` (suppress xterm) for bound shortcuts and `true` otherwise. xterm
   overwrites the prior handler on each call; cleanup re-registers
   `() => true` to restore default behavior.
3. **Contextmenu listener** on `terminal.element`. xterm types
   `Terminal.element` as `HTMLElement | undefined`; the hook narrows it
   inside the effect (`const element = terminal.element; if (!element)
return`) before attaching. In practice `terminal.element` is always
   defined by the time the hook sees a non-null `terminal` (Body.tsx
   calls `terminal.open(node)` at lines 575 / 600 BEFORE
   `setTerminal(newTerminal)` at line 753), but the guard satisfies
   strict-TS and protects against future Body.tsx reorderings:

   ```ts
   const element = terminal.element
   if (!element) return // narrows HTMLElement | undefined → HTMLElement

   const handleContextMenu = (event: MouseEvent): void => {
     event.preventDefault() // suppress xterm's CoreBrowserTerminal.ts:355 handler
     event.stopPropagation()
     setIsOpen(true)
     setOpenAt({ x: event.clientX, y: event.clientY })
   }
   element.addEventListener('contextmenu', handleContextMenu, {
     capture: true,
   })
   ```

   `{ capture: true }` ensures this handler runs **before** xterm's
   internal handler (xterm uses non-capturing listeners). Cleanup removes
   with matching options.

The effect short-circuits at the top when `terminal === null` (just
returns no-op cleanup). When `terminal` flips from `null` → non-null, the
fresh attach runs once; when a session unmounts (rare —
`setTerminal(null)` at `Body.tsx:783`), cleanup detaches and resets
`isOpen` / `openAt` / `hasSelection`.

### Behavior contract — per callback

| Callback      | Pre-conditions                                    | Mechanism                                                                                                                                                                                                                                                                                                   | Notes                                                                                                                      |
| ------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `copy()`      | `terminal !== null` AND `terminal.hasSelection()` | `text = terminal.getSelection()`; `await navigator.clipboard.writeText(text)`. On reject → textarea fallback (see "Copy failure policy" below). On both-fail → `onCopyError(error)`.                                                                                                                        | Does NOT call `terminal.clearSelection()` — selection persists until the user clicks/types, matching xterm default.        |
| `paste()`     | `terminal !== null`                               | `text = await navigator.clipboard.readText()`. If `text === ''` (success, empty clipboard) → silent no-op. If `text !== ''` → `terminal.paste(text)`. If `readText` **rejects** → call `onPasteError(error)`. **No write-side fallback today** — Section 5 documents the read-fallback decision (deferred). | Pasted text flows through xterm's existing `onData` → `write_pty`. Bracketed paste mode is honored automatically by xterm. |
| `selectAll()` | `terminal !== null`                               | `terminal.selectAll()`. Synchronous.                                                                                                                                                                                                                                                                        | `hasSelection` flips to `true` via `onSelectionChange`.                                                                    |
| `clear()`     | `terminal !== null`                               | `terminal.clear()`. Synchronous; wipes buffer + scrollback.                                                                                                                                                                                                                                                 | Does not touch selection state directly.                                                                                   |
| `close()`     | always                                            | `setIsOpen(false); setOpenAt(null)`.                                                                                                                                                                                                                                                                        | Idempotent.                                                                                                                |

### Key event handler — shortcut bindings

The handler gates on `event.type === 'keydown'` at its very first line and
returns `true` (pass-through) for any other event type. xterm invokes the
custom key handler for `keydown` / `keyup` / `keypress`; without this gate
a single `Ctrl+Shift+V` press would fire `paste()` twice (once on keydown,
once on keyup). After the gate, the handler returns `false` (suppress
xterm) for any combination matching a bound shortcut **regardless of
selection state**, and runs the action only when its pre-condition is
met. This split prevents the bound combo from leaking to the PTY when
the action is a no-op (see "Selection-less suppression" below).

| Modifier setting         | `event.code` | Required modifiers     | Forbidden                       | Action when `hasSelection()` | Action when no selection                                         |
| ------------------------ | ------------ | ---------------------- | ------------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| `'meta'` (macOS)         | `'KeyC'`     | `metaKey`              | `ctrlKey`, `altKey`, `shiftKey` | suppress + `void copy()`     | **pass-through** (return `true`; see invariant below)            |
| `'meta'` (macOS)         | `'KeyV'`     | `metaKey` + `shiftKey` | `ctrlKey`, `altKey`             | suppress + `void paste()`    | suppress + `void paste()` (paste itself handles empty-clipboard) |
| `'ctrl'` (Linux/Windows) | `'KeyC'`     | `ctrlKey` + `shiftKey` | `metaKey`, `altKey`             | suppress + `void copy()`     | **suppress + no-op** (see "Selection-less suppression" below)    |
| `'ctrl'` (Linux/Windows) | `'KeyV'`     | `ctrlKey` + `shiftKey` | `metaKey`, `altKey`             | suppress + `void paste()`    | suppress + `void paste()`                                        |

All other events return `true`. Key invariants:

- **Linux/Windows `Ctrl+C` is NEVER intercepted** — must remain available
  for SIGINT delivery. The user opted into `Ctrl+Shift+C` in the planner's
  trigger-mechanism question.
- **Selection-less suppression for `Ctrl+Shift+C` (Linux/Windows).** When
  the user presses `Ctrl+Shift+C` with no selection, the handler still
  returns `false` so xterm does NOT process it. If we returned `true`,
  xterm would forward `Ctrl+C` (the ASCII Shift+letter is the same code
  point as the unshifted letter for Ctrl-modified input — `Ctrl+Shift+C`
  produces `\x03`, identical to `Ctrl+C`) and inadvertently send SIGINT
  to the running process. This is the bug codex flagged in the
  whole-spec review; the suppression-without-action behavior fixes it.
- **macOS `Cmd+C` with no selection** returns `true` (pass-through). On
  macOS `Cmd` is not encoded into PTY input, so pass-through is safe —
  xterm sees `Cmd+C` and emits nothing to the PTY (no SIGINT risk).
- **Existing `Ctrl+V` / `Cmd+V` paste path is untouched.** The handler
  returns `true` for those; xterm's textarea-proxy paste continues to
  drive the legacy path.
- **Matching is by `event.code`, not `event.key`** — `event.code` reports
  physical key position, surviving AZERTY/QWERTZ layouts.
  `usePaneShortcuts.ts:82-89` documents the same convention.

### Copy failure policy (decision — deferred from §1 and §3)

`copy()` uses a two-tier write path:

1. **Primary:** `await navigator.clipboard.writeText(text)`.
2. **Fallback:** create a hidden `<textarea>` with the text selected and
   call `document.execCommand('copy')`. Remove the textarea after.

If both fail, call `onCopyError(error)` with the final `unknown` error.

This is **deliberately different** from `ActivityEvent.tsx`'s
`writeClipboardText`, which throws immediately when `writeText` is
missing. Justification: the terminal-copy surface is more central to user
workflow (every `git diff` / log message / shell output is a copy
candidate), so the ~20-line fallback is worth the resilience to sandbox
quirks. `ActivityEvent.tsx` is intentionally unchanged (Section 2
non-goal); converging the two helpers is tracked in Section 7's
future-work list.

### Cleanup ordering (rare — only on `terminal` identity change)

When `terminal` changes identity (session unmount/remount, or
`preferModifier` changes), the `useEffect` cleanup disposes
`onSelectionChange` first (otherwise stale events fire during teardown),
then restores the default key handler, removes the contextmenu listener,
and resets `isOpen` / `openAt` / `hasSelection`. The fresh attach then
runs on the new terminal.

### Cross-section signposts

- §5 — copy-on-selection **mouseup gating** (manual implementation since
  xterm v6 has no `copyOnSelection`) and paste **read-fallback** strategy.
- §6 — `<TerminalContextMenu>`'s accessibility contract and exact item
  bindings to the callbacks above.
- §7 — testing coverage list and verification matrix for the bindings
  table above (one row → one test case).

## 5. Behavior contract

This section nails down the runtime behaviors that affect what the user
sees, beyond the static binding contract in §4. Two items deferred since
§1 (copy-on-selection mouseup gating, paste-read fallback strategy) are
both resolved below.

### 5.1 Copy-on-selection — mouseup gating

xterm.js v6 has no `copyOnSelection` option (see §1), so the hook
implements it manually. The naive approach — copy on every
`onSelectionChange` fire — is wrong: that event fires once at selection
start, and again on every mouse-move while the user drags. A copy at
every fire would clobber the clipboard on every pixel of mouse motion.

The gate uses three signals (mousedown + selection change + mouseup) so
auto-copy only fires for **actual drag gestures** — not for
`terminal.selectAll()` from the menu, not for keyboard-driven extensions,
and not for any other programmatic selection:

```ts
// Inside the same useEffect that owns the other listeners (see §4).
// `element` is the already-narrowed HTMLElement from the contextmenu
// listener block in §4 (same useEffect, same narrowing).
let isDragging = false
let pendingSelection = false

const handleMouseDown = (event: MouseEvent): void => {
  // Only left-button drag (button === 0) starts a copy gesture. Right-
  // button mousedowns route to the contextmenu listener (§4); middle-
  // button is unused.
  if (event.button !== 0) return
  isDragging = true
  pendingSelection = false
}

const selectionDisposable = terminal.onSelectionChange(() => {
  const has = terminal.hasSelection()
  setHasSelection(has)
  // Only arm the copy when the selection happened DURING a drag.
  // selectAll() from the menu, paste replaying selection, and
  // programmatic selection from inside test fixtures will all fire
  // onSelectionChange without `isDragging` being true — and so do
  // NOT clobber the clipboard.
  if (isDragging && has) {
    pendingSelection = true
  }
})

const handleMouseUp = (): void => {
  if (!isDragging) return
  isDragging = false
  if (!pendingSelection || !terminal.hasSelection()) return
  pendingSelection = false
  // queueMicrotask trampoline so xterm's own mouseup handler (which
  // finalises the selection range) runs first; getSelection() then
  // returns the final string, not an in-progress range.
  queueMicrotask(() => {
    if (terminal.hasSelection()) {
      void copy()
    }
  })
}

element.addEventListener('mousedown', handleMouseDown, { passive: true })
element.addEventListener('mouseup', handleMouseUp, { passive: true })
```

Cleanup disposes the `IDisposable` and removes both DOM listeners.

- **Drag released outside `terminal.element`.** If the user drags off
  the terminal and releases the mouse over another DOM node, the
  `mouseup` on `terminal.element` never fires. `isDragging` stays
  `true` until the NEXT mousedown on the terminal, which resets it.
  No spurious copy occurs because the gated mouseup runs only on
  `terminal.element`. The user can retry by re-selecting; this matches
  gnome-terminal's behavior.
- **`selectAll()` from menu or programmatic selection.** These fire
  `onSelectionChange` without `isDragging === true`, so
  `pendingSelection` stays `false` and no copy runs. The user copies
  the selectAll'd buffer via the menu's Copy item (or the shortcut)
  rather than auto-copy.
- **Selection going empty during drag.** When `onSelectionChange`
  fires with `hasSelection() === false` mid-drag, `pendingSelection`
  remains `false` (the gating `if` rejects empty selections). On
  mouseup with empty selection, no copy happens. The clipboard is
  left untouched.
- **Why mouseup-tied-to-mousedown, not a `setTimeout` debounce.** A
  timer loses correctness near `Shift+Click` selection extensions
  (no mouseup-during-drag transition). The mousedown/mouseup
  bracketing mirrors how xterm itself wired selection in the v5
  implementation of `copyOnSelection` (before it was removed).

### 5.2 Mouse-reporting mode (vim, tmux, etc.)

When the inner program enables mouse-reporting (DEC private modes
1000 / 1002 / 1003 / 1006), xterm.js forwards mouse events to the PTY
instead of using them for native selection. Native drag-to-select stops
working unless the user holds `Shift`, which xterm interprets as "force
native selection regardless of mouse-reporting".

The hook does **not** intercept this — it relies on xterm's existing
behavior. Two consequences:

- **`copy-on-selection` only fires when a selection actually occurs.**
  In a tmux pane, dragging without `Shift` produces no selection, no
  `onSelectionChange`, and no copy.
- **`Shift+drag` selects natively and triggers the mouseup gate above.**
  That selection is then auto-copied just like outside mouse-reporting
  mode.

The right-click **context menu** opens reliably regardless of
mouse-reporting mode: the hook's `contextmenu` listener uses
`{ capture: true }` and calls `event.preventDefault()` before xterm's
own contextmenu handler at `CoreBrowserTerminal.ts:355` runs.

However, **the right-mouse-button `mousedown` event still reaches xterm
before the contextmenu fires**. Browser event order is
`mousedown → mouseup → contextmenu`, and xterm's mouse-reporting path
listens on `mousedown`. So in `vim` / `tmux` mouse-reporting mode, a
right-click sends a button-2 mouse-press escape sequence to the PTY
(the inner program sees it) AND opens our context menu (the user sees
it). This is an **accepted** behavior of this spec — programs that bind
right-click meaningfully (rare for the workflows this app supports) may
see an extra event. Suppressing it would require a capture-phase
`mousedown` filter that risks breaking xterm's own selection logic for
left-clicks; the trade-off is not worth it for v1. §7 lists this as
known-behavior in the QA matrix.

### 5.3 Selection-clearing semantics

The hook does **not** call `terminal.clearSelection()` anywhere. After a
successful `copy()`, the selection persists — matching xterm's default
and the behavior of gnome-terminal / iTerm2 (so the user can copy the
same selection again or extend it). xterm clears the selection itself
when the user clicks without dragging, presses Escape (in some modes),
or the active program rewrites the selected region.

The menu's `Clear` item runs `terminal.clear()` (buffer wipe per §4)
and does NOT separately clear the selection; if the selection happens
to lie in the wiped region, xterm's internal selection invalidation
takes care of it.

### 5.4 Paste-read fallback strategy (deferred from §1, §4)

`paste()` calls `navigator.clipboard.readText()`. The hook handles two
failure modes explicitly; **no `execCommand('paste')` fallback ships in
this spec** because `execCommand('paste')` is deprecated and disabled by
default in Chrome/Electron.

- **Mode A — `readText` is `undefined` on `navigator.clipboard`.**
  Detected at call time (not at hook construction — the API surface
  could be polyfilled later). The hook calls
  `onPasteError(new Error('Clipboard read API unavailable'))` and
  returns immediately.
- **Mode B — `readText()` rejects.** Typical cause: Electron sandbox
  denies the `clipboard-read` permission. The hook awaits the promise
  inside a try/catch; the catch calls `onPasteError(error)` with the
  rejected `unknown`.

```ts
// `onPasteErrorRef` is the latest-callback ref described in §4's
// "Callback freshness via refs" note; deps stay minimal so callers
// don't pay a re-attach cost when they re-render with a new callback.
const paste = useCallback(async (): Promise<void> => {
  if (!terminal) return

  const clipboard = window.navigator.clipboard
  if (clipboard?.readText === undefined) {
    onPasteErrorRef.current(new Error('Clipboard read API unavailable'))
    return
  }

  try {
    const text = await clipboard.readText()
    if (text === '') return // success, empty clipboard → silent no-op (§4)
    terminal.paste(text)
  } catch (error: unknown) {
    onPasteErrorRef.current(error)
  }
}, [terminal])
```

**Existing `Ctrl+V` / `Cmd+V` is unaffected.** That path is owned by
xterm's textarea proxy + native browser paste event; the hook never
touches it (§2). Even if `readText` is denied in Mode A or B, the
legacy paste path continues to work — only the new shortcut and the
context-menu Paste item are affected.

§7's verification matrix exercises both modes (mocked
`navigator.clipboard` in unit tests; manual permission denial in the
QA matrix).

### 5.5 Focus model — which pane copies?

The hook is mounted once per `TerminalPane` (via `Body.tsx`). Each pane
gets its own hook instance with its own `Terminal` and its own
listeners. The implication for each trigger:

| Trigger                   | Routing                                                                                                                 | Active pane required?                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Keyboard shortcut         | `attachCustomKeyEventHandler` runs only on the focused terminal — xterm routes keyboard via its focused textarea proxy. | Yes (the focused pane).               |
| Copy-on-selection mouseup | `mouseup` listener is on `terminal.element`, so it fires for whichever pane the mouse releases over.                    | No (whichever pane the cursor is in). |
| Right-click contextmenu   | Same as mouseup — listener is on `terminal.element`.                                                                    | No.                                   |

The hook does not consult `activeSessionId` or the pane-focus state.
Active-pane logic (`Ctrl/Cmd+1–4`, pane focus rings) is `WorkspaceView`
/ `usePaneShortcuts`' concern; the hook composes cleanly alongside them.

### 5.6 Pane lifecycle — mount / unmount / re-mount

`Body.tsx`'s Terminal-creation `useEffect` has deps `[sessionId]` and
its cleanup (`Body.tsx:778-781`) calls `entry.terminal.dispose()` and
`terminalCache.delete(sessionId)` on every unmount. So the
`terminalCache` is effectively a **within-mount-cycle** cache (it
exists so multiple effect runs in a single mount don't recreate the
Terminal); it does **not** persist Terminals across unmount/remount.

Behavior in each scenario:

- **First mount of a pane.** `cached` is `undefined`, the `else` branch
  at `Body.tsx:582` creates a new Terminal, runs `terminal.open(node)`,
  loads the renderer addons, and finally `setTerminal(newTerminal)` at
  `Body.tsx:753`. The hook's `useEffect` (deps
  `[terminal, preferModifier]`) sees `null → non-null` and attaches its
  three listeners.
- **Session unmount.** The order in which the hook's effect cleanup
  runs relative to the Terminal-creation effect's cleanup depends on
  React's effect-ordering rules (which are subtle and have been
  documented inconsistently across React releases). The hook's
  cleanup is therefore **defensive**: every call that could fail on
  a disposed terminal is guarded so the lifecycle is correct
  regardless of order. Concretely:

  ```ts
  return () => {
    try {
      selectionDisposable.dispose() // xterm IDisposable — idempotent
    } catch {
      /* terminal already disposed; safe to swallow */
    }
    try {
      terminal.attachCustomKeyEventHandler(() => true) // restore default
    } catch {
      /* terminal already disposed; restoration is moot */
    }
    // DOM listener removal is always safe — removing from a detached
    // node is a no-op, not an error.
    element.removeEventListener('contextmenu', handleContextMenu, {
      capture: true,
    })
    element.removeEventListener('mousedown', handleMouseDown)
    element.removeEventListener('mouseup', handleMouseUp)
    setIsOpen(false)
    setOpenAt(null)
    setHasSelection(false)
  }
  ```

  Then Body.tsx's own cleanup at `Body.tsx:778-781` disposes the
  Terminal and deletes the cache entry — whether that runs before
  or after the hook's cleanup is irrelevant under this defensive
  pattern.

- **Pane remount (e.g. layout switch).** Because the previous unmount
  cleanup deleted the cache entry, the next mount runs the `else`
  branch and creates a fresh Terminal. The hook attaches to the new
  Terminal as if it were a first mount.
- **`preferModifier` change at runtime.** Unlikely outside tests, but
  if it happens the hook's effect deps re-trigger: cleanup against the
  current Terminal, then re-attach the handler with the new modifier
  setting. The Terminal itself is unaffected.

The hook is fully reactive to `terminal` identity changes; no global
listeners or singleton state is used.

## 6. `TerminalContextMenu` component contract

### Signature

```typescript
import type { ReactElement } from 'react'

export interface TerminalContextMenuProps {
  /** Whether the menu is rendered. Mirrors `isOpen` from
   *  `useTerminalClipboard`. */
  isOpen: boolean

  /** Viewport coordinates (`clientX` / `clientY` of the contextmenu
   *  event). Used to position the menu via floating-ui's virtual
   *  reference element. Required when `isOpen === true`; ignored
   *  when `false`. */
  position: { x: number; y: number } | null

  /** Called when the menu should close (Escape pressed, outside
   *  click, or any item activated). Should call the hook's
   *  `close()`. */
  onClose: () => void

  /** Item handlers. Each is called BEFORE `onClose`, so any
   *  async error reporting in the handler can fire before the menu
   *  unmounts. */
  onCopy: () => void // hook's `void copy()` — fire-and-forget
  onPaste: () => void // hook's `void paste()`

  // v1 ships only Copy + Paste — the hook still exposes `selectAll` /
  // `clear` (§4) for callers, but no menu item invokes them. If a
  // future iteration adds those items, the props go here.

  /** Whether the Copy item is enabled. Wired to the hook's
   *  `hasSelection`. When `false`, the item is rendered with
   *  `aria-disabled="true"` and its onClick is suppressed. */
  canCopy: boolean
}

export const TerminalContextMenu = (
  props: TerminalContextMenuProps
): ReactElement | null => {
  /* impl */
}
```

When `isOpen === false`, the component returns `null` (no portal mount).

### Positioning

Use `@floating-ui/react` (already a project dependency — see
`src/components/Tooltip.tsx:11-26`) with a virtual reference element:

```typescript
const { refs, floatingStyles } = useFloating({
  open: isOpen,
  onOpenChange: (open) => {
    if (!open) onClose()
  },
  placement: 'bottom-start',
  middleware: [
    offset(0),
    flip({ fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
    shift({ padding: 8 }),
  ],
})

useEffect(() => {
  if (!position) return
  refs.setReference({
    getBoundingClientRect: () => ({
      x: position.x,
      y: position.y,
      top: position.y,
      left: position.x,
      right: position.x,
      bottom: position.y,
      width: 0,
      height: 0,
    }),
  })
}, [position, refs])
```

`flip` keeps the menu on-screen near viewport edges; `shift` adds an
8-px edge padding.

### Accessibility contract

The menu composes the following `@floating-ui/react` primitives — all
required for the contract to actually work (omitting any of them
results in unfocused open, focus on disabled items, or stuck-Tab
navigation):

```typescript
const listRef = useRef<Array<HTMLElement | null>>([])
const [activeIndex, setActiveIndex] = useState<number | null>(null)
const disabledIndices = canCopy ? [] : [0] // Copy = index 0; disabled when no selection

const role = useRole(context, { role: 'menu' })
const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true })
const listNavigation = useListNavigation(context, {
  listRef,
  activeIndex,
  onNavigate: setActiveIndex,
  loop: true, // wrap from last back to first
  disabledIndices, // skip the disabled Copy item
  openOnArrowKeyDown: false, // menu is opened via right-click, not arrow keys
})

const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
  role,
  dismiss,
  listNavigation,
])

// JSX shape:
//   <FloatingPortal>
//     {isOpen && (
//       <FloatingFocusManager context={context} initialFocus={canCopy ? 0 : 1}>
//         <div ref={refs.setFloating} {...getFloatingProps()} role="menu">
//           <button ref={(n) => { listRef.current[0] = n }}
//                   {...getItemProps({ onClick: ... })}
//                   aria-disabled={!canCopy || undefined}>Copy</button>
//           ... three more items ...
//         </div>
//       </FloatingFocusManager>
//     )}
//   </FloatingPortal>
```

Required pieces:

- **`FloatingFocusManager`** — moves focus into the menu on open and
  traps it inside; restores focus to the previously-focused element
  on close. `initialFocus` points at index 0 (Copy) when enabled,
  index 1 (Paste) otherwise.
- **`useListNavigation` with `listRef`, `activeIndex`,
  `onNavigate`** — drives the Arrow Down / Arrow Up focus transfer
  between items. `listRef` is an array of refs to each `menuitem`
  button; the hook reads it to find the next focusable target.
- **`disabledIndices`** — array of indices that
  `useListNavigation` skips during keyboard nav (Copy when
  `!canCopy`).
- **`loop: true`** — wrapping at the ends of the list.
- **`getItemProps`** — must be spread onto each item's button. It
  wires the keyboard event handlers and `tabIndex` management; without
  it the focus contract is incomplete.

Rendered into a `<FloatingPortal>` so ancestor `overflow:hidden`
doesn't clip it.

| Element           | Role       | Accessible name                 | Notes                                                                      |
| ----------------- | ---------- | ------------------------------- | -------------------------------------------------------------------------- |
| Container `<div>` | `menu`     | `aria-label="Terminal actions"` | Mounted in a `FloatingPortal`.                                             |
| Copy item         | `menuitem` | Visible text "Copy"             | `aria-disabled="true"` when `!canCopy`; `aria-disabled` omitted otherwise. |
| Paste item        | `menuitem` | Visible text "Paste"            | Always enabled.                                                            |

Icons (if added) are `<span class="material-symbols-outlined"
aria-hidden="true">` per the project's Material Symbols convention
(see `rules/typescript/testing/CLAUDE.md` "Material Symbols icon
verification"). The visible text label carries the accessible name.

### Keyboard navigation

Floating UI's `useListNavigation` provides:

- **Arrow Down / Arrow Up** — move focus among enabled items, wrapping
  at ends.
- **Enter / Space** — activate the focused item (fires its handler
  followed by `onClose`).
- **Escape** — dismisses the menu (`onClose` via `useDismiss`).
- **Tab / Shift+Tab** — moves focus out of the menu and dismisses.
- **Outside click** — dismisses via `useDismiss({ outsidePress: true })`.

On open, focus moves to the first enabled item (Copy when `canCopy`,
otherwise Paste). Disabled items are skipped by `useListNavigation`.

### Dismissal order

When an item is activated:

1. The item's handler (`onCopy` / `onPaste`) is called synchronously.
2. `onClose()` is called immediately after, in the same tick.

The order matters for `copy()` and `paste()` because both are
fire-and-forget Promises returned by the hook (`void copy()` /
`void paste()`); closing the menu unmounts the React state that owns
`isOpen`, but in-flight Promises still resolve and any error from the
latest-callback ref (`onCopyError` / `onPasteError`, §4) fires
regardless of mount state.

### Test surface (referenced by §7)

| Test case                                          | Why                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Renders four items when `isOpen` and `canCopy`     | Baseline; assert all four `menuitem` roles present.                            |
| Copy item is `aria-disabled` when `!canCopy`       | Disabled-state contract; the hook only un-disables when xterm has a selection. |
| Activating Copy fires `onCopy` then `onClose`      | Dismissal ordering.                                                            |
| Disabled Copy does NOT fire `onCopy`               | Suppression contract.                                                          |
| Escape key closes via `onClose`                    | Keyboard-dismissal contract.                                                   |
| Outside click closes via `onClose`                 | Click-dismissal contract.                                                      |
| ArrowDown / ArrowUp move focus among enabled items | Keyboard-nav contract.                                                         |
| `isOpen === false` renders `null`                  | Mount gating.                                                                  |

## 7. Integration, testing, risks, and future work

### 7.1 `Body.tsx` integration sketch

The single edit is approximately the diff below (line numbers shift as
`Body.tsx` evolves). The hook call is placed **after** the
Terminal-creation `useEffect`. The hook's cleanup is **defensive** (see
§5.6) so the placement order between the hook call and the
Terminal-creation `useEffect` does not affect correctness — the
cleanup tolerates a disposed terminal:

```diff
 const [terminal, setTerminal] = useState<Terminal | null>(null)
 // ... existing useEffect setup, refs, sessionId tracking, etc.

 useEffect(() => {
   // ... existing Terminal-creation logic (lines 481-786) ...
 }, [sessionId])

+const clipboard = useTerminalClipboard({
+  terminal,
+  // Without onPasteError wired, QA rows 6/11 fail silently if Electron
+  // denies clipboard-read. Implementer MUST decide a surface here
+  // (toast, status bar, console error via an opted-in logger). Linting
+  // policy in this repo disallows `console.*` directly; route through
+  // the project's existing logger or add an inline
+  // `// eslint-disable-next-line no-console` when necessary.
+  onPasteError: (error) => { /* TODO: surface */ },
+  onCopyError:  (error) => { /* TODO: surface */ },
+})

 return (
   <div data-testid="terminal-pane-body-wrapper" className="...">
     <div ref={containerRef} data-testid="terminal-pane" ... />
+    <TerminalContextMenu
+      isOpen={clipboard.isOpen}
+      position={clipboard.openAt}
+      onClose={clipboard.close}
+      onCopy={() => { void clipboard.copy() }}
+      onPaste={() => { void clipboard.paste() }}
+      canCopy={clipboard.hasSelection}
+    />
// Note: clipboard.selectAll and clipboard.clear are not surfaced via
// the menu in v1 (§6); they remain on the hook for future iterations.
   </div>
 )
```

`onCopy` / `onPaste` are wrapped in `() => { void clipboard.copy() }`
because the menu prop expects `() => void`, not `() => Promise<void>`.

**`onCopyError` / `onPasteError` surface is a load-bearing
implementation decision.** Defaults to a no-op (§4), so if these are
left empty, QA rows 6 and 11 will pass only when the Electron build
grants `clipboard-read`. If the build denies it, the user sees Paste
do nothing with no error indication. Pre-merge gate: either confirm
`navigator.clipboard.readText()` resolves in the running Electron
build (dev test), or wire an error surface. If neither, scope back
the menu's Paste item and the `Ctrl/Cmd+Shift+V` shortcut to
"see-Body.tsx-comment-pending-fix" before shipping.

### 7.2 Testing strategy

Co-located test files per project convention:
`useTerminalClipboard.test.ts` next to the hook,
`TerminalContextMenu.test.tsx` next to the component. Vitest + Testing
Library; `test()` not `it()` per `vitest/consistent-test-it`. Coverage
target ≥80% per `rules/CLAUDE.md`.

#### 7.2.1 `useTerminalClipboard.test.ts` — coverage list

Mock `Terminal` is a stub implementing the hook's read surface
(`onSelectionChange`, `hasSelection`, `getSelection`, `clear`,
`selectAll`, `paste`, `attachCustomKeyEventHandler`, `element`).
`renderHook` from `@testing-library/react` drives lifecycle.
`navigator.clipboard` is mocked via `vi.stubGlobal('navigator', { ... })`.

| Test case                                                                                                   | Surface                                                      |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `terminal === null` → all callbacks are no-ops, `hasSelection === false`                                    | Null-terminal guard.                                         |
| Non-null terminal → attaches `onSelectionChange`, key handler, contextmenu and mouseup listeners            | Effect setup.                                                |
| `hasSelection` flips via `terminal.onSelectionChange`                                                       | State sync.                                                  |
| `copy()` with empty selection → no-op                                                                       | §4 pre-condition.                                            |
| `copy()` with non-empty selection → calls `writeText(text)`                                                 | §4 happy path.                                               |
| `copy()` when `writeText` rejects → falls back to `execCommand('copy')`                                     | §4 copy-failure fallback.                                    |
| `copy()` when both fail → `onCopyErrorRef.current(error)`                                                   | §4 final failure.                                            |
| `paste()` when `clipboard.readText === undefined` → `onPasteError(Error)`                                   | §5.4 Mode A.                                                 |
| `paste()` when `readText()` rejects → `onPasteError(error)`                                                 | §5.4 Mode B.                                                 |
| `paste()` empty string from clipboard → silent no-op                                                        | §4 empty-paste contract.                                     |
| `paste()` non-empty string → calls `terminal.paste(text)`                                                   | §4 happy path.                                               |
| `selectAll()` → calls `terminal.selectAll()`                                                                | §4.                                                          |
| `clear()` → calls `terminal.clear()`, NOT `clearSelection()`                                                | §4 Clear semantics.                                          |
| Right-click on `terminal.element` → `isOpen=true`, `openAt={x,y}`, `preventDefault()`                       | §4 contextmenu listener.                                     |
| `close()` → `isOpen=false`, `openAt=null`; idempotent                                                       | §4 menu close.                                               |
| Mouseup with non-empty selection → after microtask, `writeText` called                                      | §5.1 mouseup gate happy path.                                |
| Mouseup with empty selection → no copy                                                                      | §5.1 gate negative path.                                     |
| `selectAll()` then mouseup (no preceding mousedown) → no auto-copy                                          | §5.1 drag-gating regression test.                            |
| `preferModifier='ctrl'` + `Ctrl+Shift+C` with selection → handler returns `false`, copy called              | §4 binding row.                                              |
| `preferModifier='ctrl'` + `Ctrl+Shift+C` WITHOUT selection → handler returns `false`, no copy, no PTY input | §4 selection-less suppression (SIGINT-leak regression test). |
| `preferModifier='ctrl'` + `Ctrl+C` with selection → handler returns `true` (passes through for SIGINT)      | §4 invariant: Linux/Win Ctrl+C never intercepted.            |
| `preferModifier='meta'` + `Cmd+C` with selection → handler returns `false`, copy called                     | §4 binding row.                                              |
| `preferModifier='meta'` + `Cmd+C` without selection → handler returns `true`                                | §4 invariant.                                                |
| `preferModifier='ctrl'` + `Ctrl+Shift+V` → handler returns `false`, paste called                            | §4 binding row.                                              |
| `preferModifier='meta'` + `Cmd+Shift+V` → handler returns `false`, paste called                             | §4 binding row.                                              |
| `event.type === 'keyup'` for any binding → handler returns `true`                                           | §4 keydown-only gate.                                        |
| Cleanup on unmount → disposes sub, restores default key handler, removes DOM listeners                      | §4 cleanup.                                                  |
| Cleanup on `terminal` identity change → fresh attach on new                                                 | §5.6 lifecycle.                                              |
| Re-render with new `onCopyError` → effect does NOT re-attach                                                | §4 callback-freshness.                                       |

#### 7.2.2 `TerminalContextMenu.test.tsx` — coverage list

The eight cases in §6's test-surface table. RTL queries follow the
project priority order: `getByRole('menuitem', { name: 'Copy' })` etc.
No `getByTestId` — all items have visible text labels.

### 7.3 Manual verification matrix (pre-merge QA)

Runs against `npm run electron:dev` (NOT `npm run dev` — that script runs the bare Vite renderer with no PTY backend, so the terminal pane is empty and these rows cannot be verified). Each row gates the merge.

| #   | Scenario                                                    | Expected                                                           |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Drag-select text in idle terminal; release mouse            | Auto-copy; external paste yields the text.                         |
| 2   | Focus outside terminal; press copy shortcut                 | Nothing (terminal not focused).                                    |
| 3   | Focus terminal with selection; press platform copy shortcut | Clipboard has the selection text.                                  |
| 4   | Focus terminal, no selection; press `Ctrl+C` (Linux/Win)    | xterm sends `^C` to PTY; SIGINT delivered.                         |
| 5   | Focus terminal, no selection; press `Cmd+C` (Mac)           | No-op.                                                             |
| 6   | Press `Ctrl+Shift+V` / `Cmd+Shift+V` with text on clipboard | Text appears in terminal.                                          |
| 7   | Press `Ctrl+V` / `Cmd+V` with text on clipboard             | Text appears (legacy path unaffected).                             |
| 8   | Right-click in terminal                                     | Menu opens at click position; Copy + Paste items visible.          |
| 9   | Right-click with no selection                               | Menu opens; Copy is `aria-disabled`.                               |
| 10  | Right-click → Copy with selection                           | Clipboard has text; menu closes.                                   |
| 11  | Right-click → Paste                                         | Clipboard text pasted; menu closes.                                |
| 12  | Menu open, press Escape                                     | Menu closes.                                                       |
| 13  | Menu open, click outside                                    | Menu closes.                                                       |
| 14  | Menu open, Arrow Down when disabled Copy → stays on Paste   | Disabled Copy is skipped; loop wraps back to Paste.                |
| 15  | Right-click on macOS                                        | Copy chip renders as `⌘C`; Paste chip renders as `⌘⇧V`.            |
| 16  | Right-click on Linux/Windows                                | Copy chip renders as `Ctrl+Shift+C`; Paste chip as `Ctrl+Shift+V`. |
| 17  | `vim` with `:set mouse=a`: drag without Shift               | No selection; events flow to vim.                                  |
| 18  | vim mouse-mode: Shift+drag                                  | Native selection; auto-copy on release.                            |
| 19  | vim mouse-mode: right-click                                 | Menu opens; vim receives a button-2 mousedown (accepted per §5.2). |
| 20  | Layout switch (Mod+\) → copy in each pane                   | Lifecycle survives (§5.6).                                         |
| 21  | Close session tab, reopen                                   | Fresh terminal; copy works.                                        |

All 21 rows must pass before merge.

### 7.4 Risks & known accepted behaviors

| Risk                                                                  | Mitigation                                                          | Section  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| `terminal.element` could be undefined                                 | Effect narrows to local `element: HTMLElement`.                     | §4, §5.1 |
| React effect ordering: hook cleanup must run before terminal disposal | Hook call placed AFTER Terminal-creation `useEffect`.               | §5.6     |
| `readText` denied by Electron sandbox                                 | `onPasteError` surface; legacy `Ctrl+V` unaffected.                 | §5.4     |
| Right-button mousedown reaches PTY in mouse-reporting mode            | Accepted; documented + QA row 19.                                   | §5.2     |
| `writeText` denied (sandbox quirk)                                    | `execCommand('copy')` textarea fallback; `onCopyError` final catch. | §4       |
| Stale callback closures                                               | Latest-callback ref pattern (mirrors `usePaneShortcuts`).           | §4       |

### 7.5 Out of scope / future work

| Feature                                                                                                                                     | Why deferred                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OSC 52** (remote-to-local clipboard from PTY)                                                                                             | Power-user feature; warrants its own design pass to address the security implications of untrusted PTY writes to the system clipboard.                                                      |
| **Tmux-style "copy mode"** (keyboard-driven selection)                                                                                      | Rare for CLI-agent workflows; complicates the shortcut model.                                                                                                                               |
| **Clipboard sanitization / paste preview** (strip leading newlines, warn before pasting URLs with shell metacharacters, multi-line warning) | Cross-feature concern; the existing `Ctrl+V` path is also affected. Requires a separate sanitization-policy decision.                                                                       |
| **Image / rich-content clipboard**                                                                                                          | Out of scope; terminal output is text.                                                                                                                                                      |
| **Convergence of `writeClipboardText` between this hook and `ActivityEvent.tsx:91`**                                                        | Approach 3 declined in the planner clarification. Re-evaluate if a third call site appears.                                                                                                 |
| **Editor "Copy Path" implementation**                                                                                                       | Outside "terminal copy only" scope.                                                                                                                                                         |
| **Right-button mousedown suppression in mouse-reporting mode**                                                                              | Suppression risks breaking xterm's left-click selection. Revisit if a real workflow needs it.                                                                                               |
| **Select All / Clear menu items**                                                                                                           | Trimmed from v1 to keep the menu surface minimal. The hook's `selectAll` / `clear` callbacks (§4) remain available so growing the menu later is a JSX-only change in `TerminalContextMenu`. |

<!-- codex-reviewed: 2026-05-22T14:28:57Z -->
