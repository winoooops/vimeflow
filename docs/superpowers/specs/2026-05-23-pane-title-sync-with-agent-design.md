# 2026-05-23 — Pane title sync with coding agent

## 1. Problem, goals, non-goals

### 1.1 Problem

Vimeflow's tab strip today shows session labels derived purely from cwd:
`tabName(cwd, index)` in `src/features/sessions/utils/tabName.ts` returns
the last path segment, or `"session N"` when the cwd is `~`. The label
is stored on `session.name`, lives in React state only (no Rust
persistence), and is editable in two places — the sidebar Card inline
edit (`useRenameState.ts`) and the command palette `:rename <name>`.

Meanwhile every Claude Code and Codex session already has a title that
the agent itself maintains:

- **Claude Code** writes `ai-title` (auto-generated) and `custom-title`
  (`/rename`-set) events into its transcript JSONL at
  `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`.
- **Codex** writes a `{"id","thread_name","updated_at"}` line into
  `~/.codex/session_index.jsonl`, one line per session, last-write-wins
  on `id`. (Codex also keeps SQLite `threads.title` in `state_<N>.sqlite`,
  but that column is the auto-derived first-user-message and is **not**
  updated by `/rename`; verified by spot-check against two sessions
  whose `session_index.thread_name` differed from `threads.title`.)

The Codex stage-2 spec
(`docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md`,
"Sources to ignore") deliberately discounts `session_index.jsonl` as a
**general** live signal — it is only written for "certain interactive
flows (thread-naming)" and lags for sessions that never run those flows.
This spec accepts that constraint: we read `session_index.jsonl` **only
for titles**, which IS the thread-naming flow the file tracks, and
treat absence-of-row as "no agent title for this session yet" with a
graceful fallback to `session.name`. See §6 for the fallback contract.

Today the workspace UI is structurally blind to those titles — a user
runs `/rename pr-review-approval-workflow` in Claude and the pane header
still shows `vimeflow`. The naming systems drift.

The gap goes the other way too: in Vimeflow the user has no
single-keystroke path to rename the pane and have the agent keep its
own transcript title in sync.

### 1.2 Goals

1. **Agent → UI (PR1).** When Claude or Codex updates its session title,
   the pane header that hosts that agent's PTY reflects the new title
   without parsing the terminal scrollback. Latency target: within one
   adapter-watcher debounce interval of the agent's `fsync` (the current
   `watcher_runtime` polls on a fixed interval — see §6 for the exact
   number and for the "should-we-replace-this-with-a-real-fs-watcher"
   discussion). We do **not** promise a hard ≤ 500 ms wallclock budget;
   the spec budgets against the watcher cadence so the goal stays
   honest if §6 keeps the existing polling path.
2. **UI → agent (PR2).** A single chord — `Ctrl+:` then `r` — over a
   focused pane lets the user rename it; the rename is written to the
   agent's transcript by injecting `/rename <sanitized-title>\n` into
   the PTY, so the agent itself owns the file mutation and the title
   round-trips back through the PR1 channel. Title input is sanitized
   before injection (newlines, carriage returns, and other C0 control
   bytes are rejected with a UI error rather than silently stripped);
   mechanics are specified in §5.
3. **Single source of truth.** The agent's transcript / session-index
   is authoritative; the pane header always reflects what the agent
   currently believes its title to be. No client-side override flag.
4. **Two PRs out of one spec.** PR1 lands first and is independently
   valuable (read-only sync); PR2 builds on the PR1 event channel.

### 1.3 Non-goals

1. **Tab labels are out of scope.** `session.name` stays cwd-derived
   (`tabName`) and renamable via the existing `:rename` and Card
   inline edit. The tab strip does **not** auto-update from agent
   title. Agent title only renders in the pane Header. This
   intentionally avoids the "tab label jumps" UX that a
   one-source-of-truth model would force, and preserves the
   `:goto <name>` fuzzy-matching design from
   `2026-05-04-command-palette-trigger-actions-design.md`.
2. **No `manualOverride` / sticky-rename flag.** Per Q3 of the
   clarifying questions, the source of truth is the agent's transcript
   / session-index; there is no per-pane "user said this so ignore the
   agent" state. The PR2 chord writes through the agent, so a rename
   round-trips and there is no client-side conflict to resolve. IO
   failure and simultaneous agent updates are addressed in §6.
3. **No persistence beyond what the agent itself persists.** Vimeflow
   does not add any new on-disk state for the agent title. On reload,
   the adapter re-reads the transcript / session-index and re-emits
   the current title. This is consistent with the
   deliberate-ephemeral rename policy from
   `2026-04-25-pty-reattach-on-reload-design.md` — we are not undoing
   that decision, only routing the persistence layer through the
   agent rather than through our own session store.
4. **No OSC 0/2 title path in v1.** Some terminal programs emit the
   window-title escape on OSC 0/2. We deliberately don't listen — the
   transcript / session-index source is more reliable (an agent may
   set OSC titles to a constant like `"Claude Code"` that doesn't
   reflect the session's `/rename` value). Listed as future work in
   §8.
5. **`aider` and `generic` agent types are not covered.** Neither
   adapter gains a new trait method; instead, the Claude and Codex
   adapters' existing `tail_transcript` implementations handle title
   parsing internally (Claude piggybacks on its line parser; Codex
   spawns a sidecar `session_index.jsonl` watcher — see §4.2 and
   §4.3). `NoOpAdapter` and any future adapter without title
   handling simply do nothing extra in `tail_transcript`; their
   panes continue to show `session.name`. Future work may add a
   formal `title_source()` trait method when there is a third
   adapter to share it with.
6. **No multi-pane title aggregation.** Each pane Header shows its
   own agent's title. The mapping is via the pane's `ptyId` (the
   per-pane PTY handle that today's `detect_agent_in_session` already
   keys events on); the adapter binds one PTY to one agent session, so
   `ptyId` is the natural join key for the new title event. The tab
   strip continues to show a single `session.name`. We do not compute
   a session-level title by concatenating pane titles.

### 1.4 Naming conventions used in this spec

- **agent title** — the title string emitted by the agent
  (`aiTitle` / `customTitle` for Claude; `thread_name` for Codex).
- **pane header** — the per-pane title strip inside `TerminalPane`
  rendering session/branch/status (separate from the tab strip).
- **session label** — `session.name`, rendered in the tab strip and
  sidebar.
- **agent session id** — the agent's own session UUID. Exposed in the
  Rust struct as `AgentStatusEvent::agent_session_id` (snake_case);
  serialized to JSON / the TS binding as `agentSessionId` via serde
  `rename_all = "camelCase"`. Distinct from Vimeflow's `session.id`
  (which is the React session model id) and from `ptyId` (the PTY
  handle string that today's adapter pipeline already keys events on).
  One Vimeflow session can host multiple agent sessions if multiple
  panes run agents.
- **`ptyId`** — the per-pane PTY handle (`Pane.ptyId`); used as the
  primary key when the frontend matches an `AgentStatusEvent` (and the
  new `AgentSessionTitleEvent`) to a pane.

## 2. User experience

### 2.1 Where the agent title renders

The pane Header (`src/features/terminal/components/TerminalPane/Header.tsx`,
line 67 — currently renders `{session.name}` in a single `truncate`
span) becomes the only surface that takes the agent title. The
Header component receives a new optional prop `paneAgentTitle?:
string` (today its prop bag has `agent`, `session`, `pipStatus`,
`worktreeName`, `branch`, `added`, `removed`, `isFocused`,
`isCollapsed`, `onToggleCollapse`, `onClose` — see
`Header.tsx:9–21`); the new prop is plumbed from
`TerminalPane/index.tsx:216`, which already has the pane in scope
and currently spreads `session` into `<Header session={session}>`.
The line-67 render becomes `{paneAgentTitle ?? session.name}`.

The tab strip (`src/features/sessions/components/Tab.tsx`) is
unchanged per non-goal §1.3 #1; it always shows `session.name`.

| State                                                  | Pane Header shows | Tab strip shows |
| ------------------------------------------------------ | ----------------- | --------------- |
| Pane has no agent yet (agent not detected)             | `session.name`    | `session.name`  |
| Agent detected, but no title event yet                 | `session.name`    | `session.name`  |
| Claude has emitted `ai-title`                          | `<aiTitle>`       | `session.name`  |
| Claude has emitted `custom-title` (`/rename`)          | `<customTitle>`   | `session.name`  |
| Codex's `session_index.jsonl` row has `thread_name`    | `<thread_name>`   | `session.name`  |

Visual treatment: the title renders at the existing `text-[12.5px]`
weight per D10 of
`2026-05-09-terminal-pane-ui-adjustments-design.md`. **One visual
treatment regardless of source** — `ai-title` and `custom-title` and
the `session.name` fallback all use the same span style. The title
slot must not flicker between two visual treatments as the agent
toggles its title; one slot, one style, content-only diff. (A future
spec may add a small indicator badge for "user-renamed via `/rename`"
vs "auto-generated"; out of scope here — see §8.)

The `truncate` behavior at `Header.tsx:67` is preserved verbatim:
long titles ellipsize at the pane-header width; no wrapping. A pane
header narrower than ~12 characters will visibly truncate any agent
title.

### 2.2 Agent → UI sync (PR1) walk-through

**Event identity contract.** Two distinct identifiers appear in this
flow and must not be confused:

- `event.sessionId` on the new `agent-session-title` event = the
  **`ptyId`** (matching today's `AgentStatusEvent.session_id` Rust
  field → `sessionId` JSON, which is also `ptyId` per §1.4). This is
  the join key for the frontend.
- `event.agentSessionId` = the **agent's own UUID**, equal to
  `aiTitle.sessionId` / `customTitle.sessionId` in the Claude
  transcript and to `row.id` in the Codex `session_index.jsonl`.
  Informational; not used as a join key on the frontend.

The adapter watcher is started per-pane (per `ptyId`) and knows its
pane's agent UUID internally. Its filter rule: emit
`agent-session-title` only if the on-disk event's session-UUID equals
the adapter's known agent UUID for this PTY. On emit, the event
carries `sessionId = <ptyId>` (so the frontend matches by PTY) AND
`agentSessionId = <agent UUID>` (so consumers can cross-reference).
Pane **does not gain** an `agent_session_id` field; the existing
`ptyId` is the link, mirroring how `AgentStatusEvent` is matched
today.

Walk-through:

1. User opens a Claude pane in a fresh checkout. Pane Header shows
   `vimeflow` (the `tabName(cwd, idx)` fallback).
2. User sends a few prompts. Claude internally generates an `ai-title`
   ("Investigate slow startup") and writes one or more
   `{"type":"ai-title","aiTitle":"...","sessionId":"<claude-uuid>"}`
   events to its transcript JSONL. The `sessionId` here is **Claude's
   own session UUID**, not Vimeflow's `ptyId`.
3. The Claude adapter (which already tails the transcript for status
   / cost / cwd events) parses the new event. It filters: does
   `event.sessionId` equal the adapter's known agent UUID for this
   PTY? If yes, emit `agent-session-title` with
   `{ sessionId: <ptyId>, agentSessionId: <claude-uuid>,
   title: "...", source: "ai-generated" }`.
4. The frontend's title subscriber (see §3 for the hook shape)
   receives the event, matches it to a pane by `ptyId`
   (`event.sessionId === pane.ptyId`), sets `pane.agentTitle =
   "Investigate slow startup"`.
5. Pane Header re-renders. Total latency from Claude's `fsync` to the
   re-render: bounded by the adapter watcher cadence — see §6.
6. User runs `/rename slow-startup-fix` in Claude. Claude writes a
   `{"type":"custom-title","customTitle":"slow-startup-fix",
   "sessionId":"<claude-uuid>"}` event. The adapter re-emits with the
   new title and `source: "user-renamed"`. Pane Header updates to
   "slow-startup-fix".

For Codex: same flow, with two specifics.

- The watch target is `~/.codex/session_index.jsonl`. The adapter
  reads the file (or re-reads on mtime change — see §6) and locates
  the row whose `id` equals the adapter's known agent UUID for this
  PTY. On a `thread_name` change, emit `agent-session-title` with
  `{ sessionId: <ptyId>, agentSessionId: <codex-uuid>,
  title: <thread_name>, source: "user-renamed" }`. Codex titles
  always carry `source: "user-renamed"` because the file is **only**
  written by the thread-naming flow (per §1.1).
- A Codex session that has **never** been `/rename`d does not appear
  in `session_index.jsonl` at all (per §1.1). For those sessions, no
  `agent-session-title` event is ever emitted; the pane Header keeps
  showing `session.name`. This is the expected steady state for
  ephemeral Codex sessions and is **not** a bug.

### 2.3 UI → agent rename (PR2) walk-through

1. Pane is focused (workspace `activeContainerId` is the terminal
   container per `2026-05-17-shared-focus-highlight-design.md`, AND
   the pane's own `active === true` per the pane-focus model).
2. User presses `Ctrl+:`. **Leader-key state engages** — the command
   palette is NOT toggled yet. The frontend enters a short leader
   window (default 500 ms, configurable via a single constant; see
   §5.4).
3. **Resolution inside the leader window:**
   - User presses `r` → leader consumed, rename chord triggers,
     palette does NOT open. Go to step 4.
   - User presses any other key (other than `Escape`) → leader
     exits and the command palette opens. The second keystroke is
     **NOT** forwarded into the palette input (v1 limitation —
     the existing `open()` API in `useCommandPalette` takes no
     query-seed argument; adding one is a bigger surface change
     than v1 wants). User-recovery: simply type the desired
     character once the palette is open.
   - User presses `Escape` → leader exits cleanly; neither chord
     nor palette opens.
   - 500 ms elapses with no follow-up → leader exits and the
     command palette opens (preserving today's UX, modulo the 500
     ms latency).
4. An inline rename input opens at the pane Header position,
   pre-filled with `pane.agentTitle ?? session.name`. The text is
   pre-selected so a fresh type replaces it; arrow keys / clicks edit
   in place.
5. User edits and presses Enter. The frontend:
   1. Validates the input — sanitization contract in §5.4 (rejects
      `\n`, `\r`, other C0 control bytes; caps length; trims surrounding
      whitespace).
   2. Resolves the focused pane's `ptyId`.
   3. Calls a new `rename_agent_session` IPC (Rust side), passing
      `{ ptyId, title }`.
   4. The Rust backend formats `/rename <title>\n` (the same on-the-wire
      string the user would have typed) and writes it to the PTY's
      stdin via the existing PTY-write path (`pty_write` /
      equivalent — verified in §5).
6. The agent (Claude or Codex) processes the `/rename` slash command
   in its own input stream:
   - Claude appends a new `custom-title` event to its transcript JSONL.
   - Codex updates its `session_index.jsonl` row for this session.
7. The PR1 watcher detects the change, emits `agent-session-title`,
   pane Header re-renders.

Total perceived latency, keystroke (Enter) → pane Header updated:

- ~5 ms — IPC call, PTY write
- ~10–50 ms — agent reads stdin, processes command, writes file
- bounded by adapter watcher cadence (see §6)
- ~5 ms — event emit, React re-render

**PTY input-state precondition (v1 limitation).** Step 5.4 writes
`/rename <title>\n` directly to the PTY without inspecting whether
the agent has unflushed typed input. Concretely: if the user has
typed `"please review th"` into Claude's prompt without pressing
Enter, then chord-renames, the bytes the agent will see are
`"please review th/rename <title>\n"`. The agent's slash-command
lexer requires `/` at the start of the line and will treat this as
a literal prompt, NOT a `/rename`. The pane Header stays unchanged
(no transcript title event fires) and the agent processes the
combined string as a normal turn.

v1 response: this is a **documented known limitation**, not a fixed
behavior. The chord assumes the agent's input line is empty (the
common case — chord users will typically rename when not actively
typing). Recovery is "press Enter or backspace to clear the agent's
input line, then retry the chord." A non-blocking inline hint in
the rename input (e.g. "tip: clear the agent prompt before
renaming") may be added — confirm in §5.

v2 candidates (out of scope; tracked in §8): inject `\x15` (readline
`unix-line-discard`) before `/rename` to clear the agent's input
line; expose an "is line empty" probe over the PTY adapter; or use
agent-specific control channels (Claude MCP, Codex JSON-RPC) instead
of PTY injection.

### 2.4 Escape / cancel behavior

- Inside the leader window (after `Ctrl+:`, before follow-up): pressing
  `Escape` exits the leader cleanly — neither chord nor palette opens.
- Inside the rename input: `Escape` cancels (no IPC fired); `Enter`
  submits (validation may reject); blur (focus loss) cancels (matches
  the existing `useRenameState` blur policy).

### 2.5 Failure-visible behavior (simple v1)

Keeping the v1 surface intentionally minimal — see §6 for the full
failure-mode contract.

| What goes wrong                                             | What the user sees                                  |
| ----------------------------------------------------------- | --------------------------------------------------- |
| Disallowed character in rename input (e.g. paste with `\n`) | Inline error under the input; submission blocked    |
| Submit on a pane with no live agent                         | Toast: "no agent in this pane to rename"            |
| PTY write fails (write returns error)                       | Toast: "failed to send /rename to agent"            |
| Agent crashes or `/rename` not supported by this CLI vers.  | Pane Header stays on prior title; no error toast    |
| Adapter file-watcher misses an update                       | Pane Header stale until next event or reload        |
| User reloads the app                                        | Adapter re-reads and re-emits; title restored       |

The "agent crashes or `/rename` unsupported" row deliberately does NOT
toast: we have no synchronous channel to confirm the agent accepted
the command. Surfacing a toast on every PTY write that didn't produce
a matching title event would be noisy (and would fire incorrectly
during legitimate agent latency). Future hardening discussed in §6.

## 3. Data model + event channel

### 3.1 New `Pane` fields

`src/features/sessions/types/index.ts` (`Pane` interface, lines 8–43)
gains two optional fields:

```typescript
interface Pane {
  // ...existing fields (id, ptyId, cwd, agentType, status, active, ...)

  /**
   * Title emitted by the agent for the agent session bound to this PTY.
   * `undefined` when no agent has emitted a title yet for this pane.
   * Source layer is the new `agent-session-title` event (§3.2).
   * The pane Header (§2.1) renders `agentTitle ?? session.name`.
   */
  agentTitle?: string

  /**
   * Where the current `agentTitle` came from. `'ai-generated'` for
   * Claude's `ai-title` events; `'user-renamed'` for Claude's
   * `custom-title` events and for every Codex `thread_name` (Codex
   * `session_index.jsonl` is only written by the thread-naming flow,
   * per §1.1).
   *
   * Undefined iff `agentTitle` is undefined.
   *
   * v1 does not visually distinguish the two (§2.1). The field exists
   * so future work (§8) and analytics / debugging can tell them apart
   * without round-tripping back through the event log.
   */
  agentTitleSource?: 'ai-generated' | 'user-renamed'
}
```

No other `Pane` field changes. `RestoreData` (the PTY-reattach payload
from `2026-04-25-pty-reattach-on-reload-design.md`) does **not**
persist `agentTitle` — on reload the adapter re-emits, restoring the
title through the event channel rather than from a cached value.
Matches the "no persistence beyond what the agent persists" non-goal
§1.3 #3.

### 3.2 The `agent-session-title` event

A new event channel on the existing `EventSink` infrastructure
(`crates/backend/src/agent/events.rs` adds a fifth constant alongside
`agent-status`, `agent-tool-call`, `agent-turn`, `agent-cwd`):

```rust
// crates/backend/src/agent/events.rs
pub const AGENT_SESSION_TITLE: &str = "agent-session-title";
```

```rust
// crates/backend/src/agent/types.rs — new struct alongside AgentStatusEvent

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Used by frontend
pub struct AgentSessionTitleEvent {
    /// PTY session ID (same shape as AgentStatusEvent.session_id;
    /// the frontend matches on this).
    pub session_id: String,

    /// Agent's own session UUID (Claude transcript `sessionId` /
    /// Codex `session_index.jsonl` `id`). Informational; frontend
    /// does not join on this.
    pub agent_session_id: String,

    /// The title string the agent currently believes its session
    /// has. Sanitized server-side per §3.2.1 below. The frontend
    /// trusts the wire value verbatim.
    pub title: String,

    /// Where the title came from.
    pub source: TitleSource,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum TitleSource {
    /// Claude `ai-title` event.
    AiGenerated,
    /// Claude `custom-title` event or any Codex `thread_name` update.
    UserRenamed,
}
```

The `derive(ts_rs::TS)` qualifier matches the existing pattern in
`crates/backend/src/agent/types.rs` (every other event struct in the
file uses the fully-qualified path). The file does not bring `TS`
into scope via `use`; adopting the unqualified `derive(TS)` would
require a new import and split convention.

#### 3.2.1 Sanitization contract (server side)

The adapter applies these rules to any title string read from disk
**before** emitting `AgentSessionTitleEvent`. PR2's PTY-write path
(§5.4) applies the same rules **before** writing `/rename` so the
agent never sees a malformed string in the first place; PR1's
sanitization is defensive (in case the on-disk source contains an
unexpected value — e.g. a hand-edited transcript or a future agent
version that doesn't sanitize).

Rules, applied in order:

1. **Replace** any C0 control byte (`U+0000`–`U+001F`) and `U+007F`
   (DEL) with a single ASCII space. Catches `\n`, `\r`, `\t`, NUL.
2. **Collapse** runs of whitespace to a single ASCII space.
3. **Trim** leading and trailing whitespace.
4. **Truncate** to ≤ 200 bytes on a UTF-8 character boundary. Correct
   recipe (the obvious one is off-by-one — a char starting at byte
   200 occupies bytes 200..200+len, overflowing the 200-byte cap):

   ```rust
   const CAP: usize = 200;
   if s.len() > CAP {
       // Find the last char-boundary index ≤ CAP.
       let mut cut = CAP;
       while !s.is_char_boundary(cut) && cut > 0 {
           cut -= 1;
       }
       s.truncate(cut);
   }
   ```

   This guarantees `s.len() ≤ 200` (post-truncation) and `s` remains
   valid UTF-8. The 200-byte cap below the field doc is therefore
   honored exactly.
5. **Empty-result rule (transition-aware).** If the sanitized result
   is empty (zero length after step 3), the adapter's behavior
   depends on whether it last emitted a non-empty title for this
   PTY:
   - **First-time empty / still empty.** `last_emitted_title` is
     `None`. **No emit.** Pane Header keeps showing `session.name`
     via the existing fallback. This is the steady state for
     sessions the agent has never titled.
   - **Transitioning non-empty → empty.** `last_emitted_title` is
     `Some(prior)`. **Emit `{ title: "", source: ... }`** so the
     frontend can clear the stale title; reset
     `last_emitted_title` to `None`. The frontend treats `title ===
     ""` as `agentTitle = undefined`, restoring the
     `session.name` fallback.

This rule is the only acceptable way to handle Claude emitting an
empty `ai-title` mid-session, or Codex's `session_index.jsonl` row
disappearing (e.g. file rewrite that drops it). The 200-byte cap +
the transition-aware empty rule together guarantee that the
frontend's `agentTitle ?? session.name` never resolves to an empty
string or to a string containing newlines, AND that stale titles
get cleared rather than persisting forever.

#### Frontend interpretation

Per §4.5, the listener applies:

```typescript
agentTitle: payload.title.length === 0 ? undefined : payload.title
agentTitleSource: payload.title.length === 0 ? undefined : payload.source
```

The `length === 0` check is the contract between sanitizer and
subscriber; both layers agree that the empty-string payload is a
clear signal, not a real title.

JSON shape on the wire (post serde `camelCase` / `kebab-case`):

```json
{
  "sessionId": "pty-uuid-1234",
  "agentSessionId": "0a1b95fd-54bc-4635-9161-983f661d74da",
  "title": "Connect Browserbase to Vimeflow Claude design tab",
  "source": "ai-generated"
}
```

The `source` discriminant is `"ai-generated"` (Claude `ai-title`) or
`"user-renamed"` (Claude `custom-title`, all Codex titles).

**Server-side sanitization is the single source of truth.** The
adapter sanitizes the title string (per the rules above) before
emitting; the frontend trusts the wire value and renders it
unconditionally. PR2's input validation in §5.4 enforces the same
rules pre-PTY-write, so the agent's transcript / index file always
contains an already-sanitized value — meaning PR1's sanitization is
defensive (handles unexpectedly-shaped on-disk content) but should
never actually mutate a value that came from a PR2 rename.

### 3.3 Frontend subscriber + pane-store dispatch

A new hook (final placement decided in §4 — likely a sibling of
`useAgentStatus`) subscribes to the event and dispatches the matched
update into the session store:

High-level sketch — see §4.5 for the final, race-safe implementation
(this version omits the `cancelled` race guard and the
empty-clear interpretation for readability). `listen<T>` from
`src/lib/backend.ts` delivers the BARE payload (callback signature:
`(payload: T) => void`); there is no `event` wrapper, matching the
convention every other listener in `useAgentStatus` uses (see
useAgentStatus.ts:374, :448, :513). The actual implementation MUST
follow §4.5 verbatim — including the `cancelled` flag and the
`payload.title.length === 0 ? undefined : payload.title` clear
interpretation. Do not transcribe the snippet below directly into
the implementation.

The subscriber is global (one listener per app lifetime). It walks
every session's `panes` to find the one matching by `ptyId`. The
walk is O(total panes) per event; bounded by active sessions ×
panes-per-session (≤ ~16 in practice). Not a hot path; no
optimization warranted.

The same hook surface exposes a write path for PR2:

```typescript
// PR2 only — defined in §5
const renameAgentSession = async (
  ptyId: string,
  title: string
): Promise<void> => {
  await invoke('rename_agent_session', { ptyId, title })
}
```

The IPC contract for `rename_agent_session` is fully specified in §5;
referenced here only to give §3 a complete picture of the data
model's write path.

### 3.4 No SQLite / on-disk storage

This spec does **not** add any new table, file, or persisted blob.
`agentTitle` lives in React state only. On reload, the adapter
re-emits and the field repopulates. Persistence is routed through
the agent's own state, per §1.3 #3.

### 3.5 Bindings generation

The Rust struct uses `#[cfg_attr(test, ts(export))]` so the existing
`ts-rs` test pipeline emits `src/bindings/AgentSessionTitleEvent.ts`
and `src/bindings/TitleSource.ts` on `cargo test`. Same pattern as
`AgentStatusEvent`; no new build-script work, no new entry in
`package.json` scripts.

**Hand-maintained barrel.** `src/bindings/index.ts` re-exports
generated types and is hand-maintained (per the file's own header
comment: "This barrel file is hand-maintained"). PR1 must add two
exports in the agent-events section of that file:

```typescript
// src/bindings/index.ts — agent events block
export type { AgentSessionTitleEvent } from './AgentSessionTitleEvent'
export type { TitleSource } from './TitleSource'
```

Without the barrel update, consumer code importing
`AgentSessionTitleEvent` from `../../../bindings` will fail to
resolve, even though the underlying generated file exists. This is a
common forgotten step in this repo — call it out explicitly in PR1's
test plan (§7).

### 3.6 What `ptyId` looks like in practice

For grounding: `Pane.ptyId` is a UUID generated **frontend-side** in
`src/features/terminal/services/desktopTerminalService.ts:159`
(`const sessionId = crypto.randomUUID()`) and passed to Rust on PTY
spawn. The new event's `sessionId` field carries the same string.
Cross-pane collisions are not possible at the UUID-generation layer.

**Reload preserves PTY ids for live sessions** (per the
`2026-04-25-pty-reattach-on-reload-design.md` cache): when the
backend's `SessionCache` re-hydrates a still-running PTY on app
reload, the original PTY id is restored, so the adapter's watcher
re-attaches against the same id and the frontend's reconstructed
`Pane` carries the same `ptyId` — title events emitted after reload
match the restored pane (§6.5 depends on this). Only entirely
**new** spawns (the user opens a new pane after reload) get a fresh
`crypto.randomUUID()`. So: fresh spawns = fresh ids; surviving PTYs
keep their cached ids.

## 4. PR1 — agent → UI sync

PR1 is independently shippable: it lands the read-only sync from
agent to pane Header. PR2 builds on the event channel introduced here.

### 4.1 Scope of PR1 (files changed)

| File                                                                  | Change                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------ |
| `crates/backend/src/agent/events.rs`                                  | Add `AGENT_SESSION_TITLE` const (§3.2)                       |
| `crates/backend/src/agent/types.rs`                                   | Add `AgentSessionTitleEvent` + `TitleSource`                 |
| `crates/backend/src/agent/adapter/claude_code/transcript.rs`          | Extend transcript line parser to recognize `ai-title` / `custom-title` (§4.2) |
| `crates/backend/src/agent/adapter/codex/mod.rs`                       | Spawn session-index watcher in `tail_transcript`             |
| `crates/backend/src/agent/adapter/codex/session_index.rs` *(new)*     | `session_index.jsonl` reader + change detector               |
| `src/bindings/AgentSessionTitleEvent.ts` *(generated)*                | Emitted by `ts-rs` on `cargo test`                           |
| `src/bindings/TitleSource.ts` *(generated)*                           | Emitted by `ts-rs` on `cargo test`                           |
| `src/bindings/index.ts`                                               | Add two exports (§3.5)                                        |
| `src/features/sessions/types/index.ts`                                | Two new optional `Pane` fields (§3.1)                        |
| `src/features/sessions/hooks/useSessionManager.ts`                    | Global `agent-session-title` listener + dispatch (§4.5)      |
| `src/features/terminal/components/TerminalPane/Header.tsx`            | Add `paneAgentTitle?: string` prop; line 67 becomes `{paneAgentTitle ?? session.name}` |
| `src/features/terminal/components/TerminalPane/index.tsx`             | Pass `paneAgentTitle={pane.agentTitle}` when mounting `<Header>` (line ~216) |

PR1 does **not** add or modify any IPC method — read-only sync flows
entirely over the existing event channel.

### 4.2 Claude adapter — title parsing piggybacks on existing watch

The Claude adapter's `tail_transcript`
(`crates/backend/src/agent/adapter/claude_code/transcript.rs`) already
opens the per-pane transcript JSONL and parses line-by-line. The new
parsing is two additional match arms added to the existing dispatch:

See §3.2.1's "Parser integration" subsection for the actual match
arms — the parser dispatches via `line_type(&value)` on
`serde_json::Value`, and `emit_title` errors are logged but never
propagate out of `process_line` (which returns `()`).

**Where the agent_session_id comes from for Claude.** The Claude
transcript filename IS the agent session UUID
(`<uuid>.jsonl` under `~/.claude/projects/<encoded-cwd>/`). Inside
`tail_transcript`, derive it from `transcript_path.file_stem()` and
hold it as a local binding for the lifetime of the tail:

```rust
let claude_agent_session_id: String = transcript_path
    .file_stem()
    .and_then(|s| s.to_str())
    .map(|s| s.to_owned())
    .ok_or_else(|| "could not derive claude session id from transcript path".to_owned())?;
```

The parser then uses this binding as BOTH the filter check AND the
value emitted in `AgentSessionTitleEvent.agent_session_id`:

```rust
"ai-title" => {
    let event_session_id = raw_event.fields.get("sessionId")
        .and_then(|v| v.as_str());
    if event_session_id == Some(&claude_agent_session_id) {
        let title = raw_event.fields.get("aiTitle")
            .and_then(|v| v.as_str()).unwrap_or("");
        emit_title(
            &events, &session_id, &claude_agent_session_id, title,
            TitleSource::AiGenerated, &mut last_title_memo,
        )?;
    }
}
// `custom-title` arm: same filter + emit pattern.
```

The filter is defense-in-depth: Claude's self-consistency means
`event.sessionId == filename-derived UUID` always holds, but the
guard catches any future schema drift. The trait does NOT gain a
new method to expose `agent_session_id`; the adapter remains the
stateless `ClaudeCodeAdapter` it is today.

**Event emission shape.** `EventSink::emit_json` takes a
`serde_json::Value`, not a struct. `emit_title` implements the
**transition-aware empty rule from §3.2.1 #5** — empty input clears
a prior emit, idempotent otherwise:

```rust
fn emit_title(
    events: &Arc<dyn EventSink>,
    session_id: &str,
    agent_session_id: &str,
    raw_title: &str,
    source: TitleSource,
    last_title_memo: &mut Option<String>,
) -> Result<(), String> {
    let sanitized = sanitize_title(raw_title); // Option<String>; None = empty
    match (sanitized, last_title_memo.as_deref()) {
        // New non-empty title, same as last → de-dup, no emit.
        (Some(title), Some(prev)) if prev == title => Ok(()),
        // New non-empty title, different from last (or first emit) → emit.
        (Some(title), _) => {
            let value = serde_json::to_value(&AgentSessionTitleEvent {
                session_id: session_id.to_owned(),
                agent_session_id: agent_session_id.to_owned(),
                title: title.clone(),
                source,
            }).map_err(|e| format!("serialize AgentSessionTitleEvent: {e}"))?;
            events.emit_json(AGENT_SESSION_TITLE, value)?;
            *last_title_memo = Some(title);
            Ok(())
        }
        // Empty input, prior non-empty → emit clear (title=""); reset memo.
        (None, Some(_)) => {
            let value = serde_json::to_value(&AgentSessionTitleEvent {
                session_id: session_id.to_owned(),
                agent_session_id: agent_session_id.to_owned(),
                title: String::new(),
                source,
            }).map_err(|e| format!("serialize AgentSessionTitleEvent: {e}"))?;
            events.emit_json(AGENT_SESSION_TITLE, value)?;
            *last_title_memo = None;
            Ok(())
        }
        // Empty input, no prior → nothing to clear.
        (None, None) => Ok(()),
    }
}
```

**Parser integration.** The real Claude transcript parser
(`crates/backend/src/agent/adapter/claude_code/transcript.rs:118,
279` — `fn line_type(value: &Value)` + `fn process_line(...)`)
parses each line into `serde_json::Value` and dispatches via
`line_type(&value)`. The `ai-title` / `custom-title` match arms
above are sketches; the actual implementation matches on the
`Value` keys, e.g.:

```rust
match line_type(&value) {
    "ai-title" => {
        let event_session_id = value.get("sessionId")
            .and_then(Value::as_str);
        if event_session_id == Some(claude_agent_session_id.as_str()) {
            let raw_title = value.get("aiTitle")
                .and_then(Value::as_str).unwrap_or("");
            if let Err(err) = emit_title(
                events, session_id, &claude_agent_session_id, raw_title,
                TitleSource::AiGenerated, last_title_memo,
            ) {
                log::warn!("agent-session-title emit failed: {err}");
            }
        }
    }
    "custom-title" => { /* same shape, TitleSource::UserRenamed */ }
    // ...existing arms
}
```

`process_line` returns `()`, so any `emit_title` error is logged
and swallowed — a serialization failure on one line MUST NOT kill
the tail thread (see §6.3). `last_title_memo` is owned by the
caller (`process_line` extends to carry an `&mut Option<String>`
title-memo parameter — small additive change).

**De-duplication.** Claude emits identical `ai-title` events
repeatedly (verified empirically: a single transcript in
`~/.claude/projects/-home-will-projects-vimeflow/` contained 61
identical `ai-title` lines for one session). The adapter holds the
**last-emitted title** for this PTY in an in-memory `Option<String>`
captured by the tail closure (`last_title_memo` above), and
`emit_title` skips the emit when the new sanitized title equals the
last one. No disk persistence (consistent with §1.3 #3). On reload,
the memo is reset to `None` and the first event re-emits regardless
of value, which is correct (frontend has a fresh state too).

### 4.3 Codex adapter — new `session_index.jsonl` watcher

Codex titles live in a **different file** from its rollout JSONL, so
the Codex adapter cannot piggyback the same way.
`CodexAdapter::tail_transcript` spawns a sidecar thread that watches
`~/.codex/session_index.jsonl`. The handle returned by
`tail_transcript` is extended to own a second join handle so `Drop`
cleanly joins both.

```rust
// In CodexAdapter::tail_transcript (sketch):
let codex_home = self.codex_home.clone(); // existing struct field
let session_id_for_titles = session_id.clone();
let events_for_titles = Arc::clone(&events);

// Start the rollout tail FIRST and unconditionally — title support
// must never gate the status / cost / cwd channel.
let mut handle = transcript::start_tailing(
    Arc::clone(&events_for_titles),
    session_id.clone(),
    transcript_path.clone(),
    cwd,
)?;

// Title support is BEST-EFFORT. Attempt to derive Codex's session
// UUID from the rollout filename — `rollout-<ISO-ts>-<uuid>.jsonl`
// — but if the filename does not match (future Codex changes the
// scheme, or the file came from `codex resume` with an unusual
// path), LOG and continue without title support. The rollout tail
// keeps running.
match parse_rollout_filename_uuid(&transcript_path) {
    Some(agent_session_id) => {
        let aux_stop = Arc::new(AtomicBool::new(false));
        let title_join = session_index::spawn_watch(
            codex_home.join("session_index.jsonl"),
            agent_session_id,
            session_id_for_titles,
            events_for_titles,
            Arc::clone(&aux_stop),
        )?;
        handle.attach_aux_join(aux_stop, title_join);
    }
    None => {
        log::warn!(
            "codex title sync disabled for this session: \
             rollout filename {:?} does not match expected \
             `rollout-<ISO-ts>-<uuid>.jsonl` pattern",
            transcript_path.file_name()
        );
        // Pane Header falls back to session.name; no agent-session-title
        // emit ever fires for this pane. Status / cwd / cost continue.
    }
}
Ok(handle)
```

**Alternative source for `agent_session_id`.** The Codex locator
(`crates/backend/src/agent/adapter/codex/locator/`) already resolves
the rollout path by querying SQLite — the same query returns the
thread `id` (the `agent_session_id`) as a sibling column. A v1.1
refinement could plumb that id directly into `tail_transcript`
instead of parsing the filename, eliminating the filename-parse
failure mode entirely. Out of scope for v1 because it requires
threading a new value through the locator API; the filename parser
is a strict subset of work.

**Adapter-state implications.** `CodexAdapter` does NOT gain a new
`agent_session_id` field; the UUID is derived from the
`transcript_path` filename inside `tail_transcript` (the rollout file
already names the session UUID — verified against
`~/.codex/sessions/2026/04/17/rollout-2026-04-17T00-48-54-019d9a6a-….jsonl`).
`ClaudeCodeAdapter` similarly stays stateless. Neither adapter gains
a new trait method. The lifecycle plumbing change is **only**
`TranscriptHandle` gaining an optional secondary join slot.

**`TranscriptHandle` extension.**
`crates/backend/src/agent/adapter/base/transcript_state.rs` already
defines `TranscriptHandle` with a primary stop_flag + join_handle
pair (verified at the file head):

```rust
// existing
pub struct TranscriptHandle {
    stop_flag: Arc<AtomicBool>,
    join_handle: Option<std::thread::JoinHandle<()>>,
}

impl TranscriptHandle {
    pub(crate) fn new(
        stop_flag: Arc<AtomicBool>,
        join_handle: std::thread::JoinHandle<()>,
    ) -> Self { ... }

    pub fn stop(mut self) {
        // Release pairs with Acquire load in the tail loop.
        self.stop_flag.store(true, Ordering::Release);
        if let Some(h) = self.join_handle.take() { let _ = h.join(); }
    }
}

impl Drop for TranscriptHandle { /* mirrors stop() */ }
```

PR1 EXTENDS the struct additively — primary stop_flag /
join_handle stay; second optional pair is added for Codex's
session-index sidecar:

```rust
pub struct TranscriptHandle {
    stop_flag: Arc<AtomicBool>,                       // existing — primary
    join_handle: Option<std::thread::JoinHandle<()>>, // existing — primary
    aux_stop: Option<Arc<AtomicBool>>,                // NEW — sidecar stop
    aux_join: Option<std::thread::JoinHandle<()>>,    // NEW — sidecar join
}

impl TranscriptHandle {
    pub(crate) fn new(
        stop_flag: Arc<AtomicBool>,
        join_handle: std::thread::JoinHandle<()>,
    ) -> Self {
        Self {
            stop_flag,
            join_handle: Some(join_handle),
            aux_stop: None,
            aux_join: None,
        }
    }

    pub fn attach_aux_join(
        &mut self,
        stop: Arc<AtomicBool>,
        join: std::thread::JoinHandle<()>,
    ) {
        self.aux_stop = Some(stop);
        self.aux_join = Some(join);
    }
}

impl Drop for TranscriptHandle {
    fn drop(&mut self) {
        // Flip BOTH stop flags first so neither thread sleeps for its
        // full poll interval before observing the stop signal.
        self.stop_flag.store(true, Ordering::Release);
        if let Some(stop) = self.aux_stop.take() {
            stop.store(true, Ordering::Release);
        }
        // Then join in order — primary first (preserves existing
        // ordering), then aux.
        if let Some(h) = self.join_handle.take() { let _ = h.join(); }
        if let Some(h) = self.aux_join.take()    { let _ = h.join(); }
    }
}
```

The `Release` ordering on both stores pairs with `Acquire` loads in
the watcher loops, matching the existing primary tail's stop
contract. `TranscriptHandle::stop(self)` is updated symmetrically.

The Codex sidecar's loop wakes from sleep promptly via interruptible
short sleeps:

```rust
// session_index::spawn_watch loop body
loop {
    if stop.load(Ordering::Acquire) { break; }
    // ...mtime check + emit...
    // 500 ms poll, broken into 5×100 ms so the stop flag is observed promptly.
    for _ in 0..5 {
        if stop.load(Ordering::Acquire) { break; }
        std::thread::sleep(Duration::from_millis(100));
    }
}
```

Other adapters (Claude, NoOp) leave `aux_stop` / `aux_join` as
`None`; behavior unchanged.

**Watcher loop semantics.** New file
`crates/backend/src/agent/adapter/codex/session_index.rs`,
`pub fn spawn_watch(...) -> std::io::Result<std::thread::JoinHandle<()>>`:

1. **Initial read.** On thread start, open the file. If it exists,
   parse line-by-line — `session_index.jsonl` is **append+rewrite**
   with last-write-wins semantics per `id` (§1.1). The reader MUST
   take the **last** row whose `id` matches our `agent_session_id`,
   not the first. Concretely, iterate every line and OVERWRITE on
   each id match (equivalent to deserializing into a
   `HashMap<id, row>` and reading our key); taking the first match
   would surface stale renames after the user `/rename`d repeatedly.
   **If found, emit immediately** with the latest `thread_name` (so
   a reload restores the current title without waiting for the next
   change). Set `last_emitted_title` to the emitted value. If the
   file or our row does not exist, `last_emitted_title` stays
   `None`; no emit.
2. **Watch loop.** Re-check the file's mtime every 500 ms (matching
   Claude's transcript-tail EOF poll for symmetry). On mtime
   advance: re-read the file, re-locate the row.
   - Row's `thread_name` differs from `last_emitted_title` and is
     non-empty after sanitize → emit `{ title, source: UserRenamed }`;
     update memo to the emitted value.
   - Row missing (file changed; row pruned) AND `last_emitted_title`
     is `Some(_)` → emit clear (`{ title: "", source: UserRenamed }`)
     so the frontend restores `session.name`; reset memo to `None`.
     (Per §3.2.1's transition-aware empty rule.)
   - Row missing AND `last_emitted_title` is `None` → no emit
     (steady state for sessions the user never `/rename`d).
   - `thread_name` unchanged → no emit (memo de-dup).
   - Row's `thread_name` is empty/whitespace-only AND
     `last_emitted_title` is `Some(_)` → emit clear.
3. **Graceful shutdown.** Watcher exits when its `JoinHandle` is
   joined (via `TranscriptHandle::Drop`) — `spawn_watch` accepts a
   shared `Arc<AtomicBool>` "stop" flag that the Drop path flips
   before joining (mirroring `WatcherHandle::Drop` in
   `base/watcher_runtime.rs:50–54`).

**Why mtime polling, not the `notify` crate.** The existing
`base/watcher_runtime.rs` uses `notify` (real fs events) with a 3-
second polling fallback. For PR1 we deliberately do NOT reuse that
infra for `session_index.jsonl` — `watcher_runtime` is tuned to one
file per session, and `session_index.jsonl` is a single global file
shared across all sessions. Adopting it would require either a
single shared watcher with fan-out (new infra) or N watchers on the
same path (wasteful and confusing). 500-ms mtime polling is the
minimum viable v1; the dedicated-watcher refactor is listed in §8.

**Cross-process read race.** Codex rewrites
`session_index.jsonl` (rather than appending) on rename — verified
by inspecting Codex's binary strings for `tempfile` / `rename`
patterns and by the file's modest size (one line per session, total
KBs not MBs). The read either sees the pre-write state or the
post-write state; if a partial line is observed (write-rename race
window), JSON parse on that line fails and the watcher proceeds to
the next tick. No emit on parse failure.

### 4.4 Watcher cadence and debounce

Actual measured cadences in the existing code (verified by reading
the source):

- **`base/watcher_runtime.rs`** — uses the `notify` crate for real fs
  events; polling fallback runs up to once every 3 seconds (the
  polling thread sleeps up to that long before re-checking). This is
  the status-source watcher; PR1 does NOT touch it.
- **`claude_code/transcript.rs:26`** — `POLL_INTERVAL =
  Duration::from_millis(500)`. The transcript tail loop sleeps 500
  ms at EOF before re-checking for new lines. Claude's title parse
  piggybacks on this loop.
- **Codex `session_index.jsonl` watcher (new in PR1)** — 500-ms
  mtime poll, matching Claude's `POLL_INTERVAL` for consistency.

Title latency budgets:

- **Claude.** Title event lands within Claude's `fsync` + up to 500
  ms (worst case: the tail loop just slept and is waiting for the
  next EOF re-check). p95 ~250 ms; p99 ~500 ms.
- **Codex.** Title event lands within Codex's `fsync` + up to 500 ms
  mtime-poll latency + a single `serde_json::from_str` parse. p95
  ~250 ms; p99 ~500 ms.

**The manual checklist's "≤ 500 ms" target in §4.6 holds at the p99
upper bound, not as a hard wallclock SLA.** Under load (slow disk,
contended scheduler) the budget can stretch. PR1's checklist is
"observe within a few seconds"; sub-second is the typical case.

**No debouncing within a single cadence tick.** Each tick emits at
most one title-changed event (because the last-emitted memo only
updates on emit). Multiple `/rename`s between ticks coalesce into one
emit reflecting the latest value.

The "should we switch to a single shared fs-watcher / `notify`-crate
watcher for `session_index.jsonl`?" question is acknowledged in §8
as future work. PR1 deliberately does not change the watcher
runtime; PR1's title support is a small addition layered on top.

### 4.5 Frontend wiring — listener placement (revised)

The listener **must be global**, not nested in `useAgentStatus`.
`useAgentStatus(sessionId)` is per-session — today's WorkspaceView
calls it only for the active session, so listening for
`agent-session-title` there would update only the active session's
panes. Inactive split panes (visible behind / beside the active
session) would silently keep stale titles. The earlier draft of this
section was wrong on that point and is replaced below.

The listener lives in **`useSessionManager.ts`**, alongside the
existing global state. `useSessionManager` is instantiated once at
the top of the workspace tree (via `WorkspaceView`); the listener
mounts on that single instance and updates every session's panes
regardless of focus.

```typescript
// useSessionManager.ts — new useEffect, sibling to the existing
// session-restore / OSC-7 cwd-listener effects already in this hook.
useEffect(() => {
  let cancelled = false
  let unlistenFn: UnlistenFn | undefined
  void listen<AgentSessionTitleEvent>(
    'agent-session-title',
    (payload) => {
      // Empty payload.title is the explicit "clear" signal per
      // §3.2.1's transition-aware empty rule. Coerce both fields
      // to undefined so the Header falls back to session.name.
      const cleared = payload.title.length === 0
      const nextTitle = cleared ? undefined : payload.title
      const nextSource = cleared ? undefined : payload.source
      setSessions((sessions) => {
        // Early-out: if no pane in any session has ptyId ===
        // payload.sessionId, return the same `sessions` reference
        // so React skips the re-render. Without this guard,
        // every event would rebuild every session/pane object,
        // even when the event targets no pane in the current state
        // (which happens during reload churn or for stale events).
        const matchExists = sessions.some((s) =>
          s.panes.some((p) => p.ptyId === payload.sessionId)
        )
        if (!matchExists) {
          return sessions
        }
        return sessions.map((session) => ({
          ...session,
          panes: session.panes.map((pane) =>
            pane.ptyId === payload.sessionId
              ? {
                  ...pane,
                  agentTitle: nextTitle,
                  agentTitleSource: nextSource,
                }
              : pane
          ),
        }))
      })
    }
  ).then((fn) => {
    if (cancelled) {
      fn()
    } else {
      unlistenFn = fn
    }
  })
  return () => {
    // Handle the race where unmount fires before listen resolves:
    // set `cancelled` so the .then() above calls fn() instead of
    // storing it. If unmount fires after resolution, unlistenFn is
    // set and we call it here.
    cancelled = true
    unlistenFn?.()
  }
}, [])
```

The `cancelled` flag is necessary because `listen<T>` is async; a
fast mount→unmount cycle can resolve the promise after the cleanup
function has already run, in which case the cleanup needs to know
the listener should be torn down on resolution. Without the flag,
the listener would leak across re-mounts under stress (verified by
the no-leak test in §4.6).

No `resolvePtyId()` filter — the listener processes events for any
PTY, and the `pane.ptyId === payload.sessionId` membership check
inside the dispatch is the only filter needed. This trades a tiny
amount of work per event (one walk of session × pane arrays) for a
much simpler invariant: title sync is independent of which session
or pane is "active".

#### 4.5.1 Why not `useAgentStatus`

The per-session `useAgentStatus` listener pattern works for `agent-
status` / `agent-turn` / `agent-tool-call` because those events
populate state that is **only displayed for the active session**
(the cost panel, the turn timer, the tool-call chip — all rendered
in `AgentStatusPanel` which mounts per active session). Title sync
is different: every visible pane Header consumes
`pane.agentTitle`, and panes in non-active sessions can still be
visible in split layouts. The global listener placement reflects
that difference.

#### 4.5.2 Session-manager `setPaneAgentTitle` setter (optional helper)

The walk-and-set logic above is inlined in the listener; if a future
caller (e.g. a manual "reset title" command) needs to mutate
`pane.agentTitle` programmatically, factor it out then. v1 does NOT
expose a separate `setPaneAgentTitle` callback — the field is
write-only via the event channel.

### 4.6 PR1 test surface

**Rust:**

- `claude_code/transcript.rs` unit tests:
  - Feed an `ai-title` line whose `sessionId` matches the adapter's
    `agent_session_id` → assert one `AgentSessionTitleEvent` emit
    with `source: AiGenerated`, correct `title`, `agentSessionId`,
    `sessionId == ptyId`.
  - Feed a `custom-title` line same way → assert `source:
    UserRenamed`.
  - Feed an `ai-title` with mismatched `sessionId` → no emit.
  - Feed two identical `ai-title` events back-to-back → exactly ONE
    emit (de-duplication memo).
  - Feed an `ai-title` then a `custom-title` (same session) → TWO
    emits in order; second has `source: UserRenamed`.
  - Feed an `ai-title` with title containing `\n` → emitted title
    has `\n` replaced per §3.2.1.
  - Feed an `ai-title` with empty `aiTitle` → NO emit (empty-result
    rule §3.2.1).
- `codex/session_index.rs` unit tests:
  - Fixture: file containing two rows, one matching our
    `agent_session_id` with `thread_name: "first"`. Watcher starts
    → **emits "first" on initial read** (this is the reload-restore
    behavior — see §4.3 step 1). Then the row is updated to
    `thread_name: "second"` → second emit with `title: "second"`.
  - Fixture: file with no matching row at start → no emit. Row
    appears later with `thread_name: "appearing"` → one emit.
  - Fixture: row's `thread_name` rewritten to the SAME value → no
    emit (memo de-dup).
  - Fixture: partial/corrupt line (write race) → no emit, no panic;
    next tick recovers.
  - Fixture: filename-derived UUID — `parse_rollout_filename_uuid`
    correctly extracts the UUID from
    `rollout-2026-04-17T00-48-54-019d9a6a-….jsonl`; returns `None`
    for malformed names.

**TypeScript:**

- `useSessionManager.test.tsx`:
  - Mount `useSessionManager`, simulate an `agent-session-title`
    event with `sessionId` matching a pane's `ptyId` → assert that
    pane has updated `agentTitle` and `agentTitleSource`; other
    panes (and panes in other sessions) are untouched.
  - Simulate an event with `sessionId` matching NO pane → no state
    change.
  - Mount and unmount the hook → `unlistenFn` is called on
    unmount (no listener leak).
- `Header.test.tsx`:
  - `pane.agentTitle = "foo"` → header renders `"foo"`.
  - `pane.agentTitle = undefined` → header renders `session.name`.
  - `pane.agentTitle = "very-long-title-that-exceeds-the-pane-width"`
    → header renders truncated (CSS `truncate` class applied).

**Manual checklist** (no automated coverage):

- Open a Claude pane in a fresh checkout, send a few prompts, wait for
  Claude's auto-title generation, observe pane Header changes from
  `vimeflow` (cwd-derived) to the auto-generated title.
- Type `/rename my-feature` in Claude, observe pane Header changes to
  `my-feature` within a few hundred ms.
- Open a Codex pane, type `/rename my-codex-task`, observe pane
  Header changes within ~500 ms.
- Open a Codex pane and DON'T `/rename`, observe pane Header stays on
  the cwd-derived `session.name`. Verify no row appears in
  `~/.codex/session_index.jsonl` for this session's id (using
  `grep '<agent_session_id>' ~/.codex/session_index.jsonl`).
- Close and reopen the app; verify renamed pane Headers restore to
  the agent title within one watcher cadence (Codex: ≤ 500 ms;
  Claude: as soon as the read-stream re-opens the transcript).

## 5. PR2 — chord → agent rename

PR2 builds on PR1's event channel: the chord renames the pane by
injecting `/rename` into the PTY, and PR1's adapter watchers close
the loop by re-emitting `agent-session-title` after the agent
persists the new title.

### 5.1 Scope of PR2 (files changed)

| File                                                                  | Change                                              |
| --------------------------------------------------------------------- | --------------------------------------------------- |
| `src/features/command-palette/hooks/useCommandPalette.ts`             | `Ctrl+:` becomes a leader key with 500-ms window (§5.2) |
| `src/features/command-palette/chordRegistry.ts` *(new)*               | Tiny module that lets features register follow-up handlers |
| `src/features/command-palette/hooks/usePaneRenameChord.ts` *(new)*    | Chord state machine; owns rename modal state (§5.2) |
| `src/features/workspace/WorkspaceView.tsx`                            | Mount `usePaneRenameChord()`; render its `renderNode` |
| `src/features/terminal/components/PaneRenameInput.tsx` *(new)*        | Portal-mounted rename modal anchored to pane Header (§5.3) |
| `src/features/terminal/components/TerminalPane/Header.tsx`            | Register pane-header DOM ref in `paneHeaderRefs` map for portal anchor |
| `src/features/terminal/paneHeaderRefs.ts` *(new)*                     | Tiny module exporting a ref-map keyed by `ptyId`    |
| `src/features/sessions/utils/sanitizeTitle.ts` *(new)*                | TS port of §3.2.1 (frontend pre-validation)         |
| `src/lib/backend.ts`                                                  | Add `renameAgentSession({ ptyId, title })` invoke   |
| `electron/backend-methods.ts`                                         | Allowlist `rename_agent_session` (per IPC checklist)|
| `crates/backend/src/agent/mod.rs`                                     | Re-export `rename_agent_session` (per IPC checklist)|
| `crates/backend/src/runtime/state.rs`                                 | New `BackendState::rename_agent_session` method (per IPC checklist) |
| `crates/backend/src/agent/state.rs`                                   | New `AgentWatcherState::agent_type_for_pty(&str) -> Option<AgentType>` |
| `crates/backend/src/runtime/ipc.rs`                                   | Match-arm dispatch (per IPC checklist)              |
| `crates/backend/src/agent/types.rs`                                   | New `RenameAgentSessionRequest`                     |
| `src/bindings/RenameAgentSessionRequest.ts` *(generated)*             | Emitted via `ts-rs` on `cargo test`                 |
| `src/bindings/index.ts`                                               | Add export for `RenameAgentSessionRequest`          |

### 5.2 Chord keybinding infrastructure

Today `useCommandPalette.ts:19` toggles the palette on `Ctrl+:`
immediately. PR2 layers a small leader-key state in front of the
toggle:

```typescript
// useCommandPalette.ts — revised handler (sketch; final shape
// integrates with the existing handler module structure)
const LEADER_WINDOW_MS = 500

let leaderTimer: ReturnType<typeof setTimeout> | null = null
let leaderActive = false

const handleKeyDown = (event: KeyboardEvent): void => {
  // Leader engaged from a prior Ctrl+:
  if (leaderActive) {
    const consumed = chordRegistry.dispatch(event)
    leaderActive = false
    if (leaderTimer) {
      clearTimeout(leaderTimer)
      leaderTimer = null
    }
    if (consumed) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === 'Escape') {
      // Cancel cleanly — leader exits, palette stays closed.
      event.preventDefault()
      event.stopPropagation()
      return
    }
    // No registered chord matched → open palette as the deferred
    // toggle. v1 does NOT forward the second key into the palette
    // input (existing `open()` takes no seed); the user simply
    // re-types in the open palette.
    //
    // BOTH preventDefault AND stopPropagation are load-bearing here:
    // without them, the second keystroke (e.g. printable text or
    // `Enter`) would still target the underlying focused surface
    // (the terminal) and get sent to the agent as a stray input.
    // Failing to stop it would silently corrupt user input every
    // time the chord falls through to the palette.
    event.preventDefault()
    event.stopPropagation()
    handlersRef.current.open()
    return
  }

  if (isPaletteToggle(event)) {
    event.preventDefault()
    event.stopPropagation()
    // Preserve today's close-toggle: if the palette is already
    // open, Ctrl+: closes it. No leader window engages in that
    // case — closing a UI element should not impose latency.
    if (stateRef.current.isOpen) {
      handlersRef.current.close()
      return
    }
    leaderActive = true
    leaderTimer = setTimeout(() => {
      leaderActive = false
      handlersRef.current.open(/* no follow-up */)
    }, LEADER_WINDOW_MS)
    return
  }

  // ...existing handlers
}
```

`chordRegistry` is a tiny module letting features (PR2's rename
chord; any future chord-binding) register follow-up handlers keyed
on a single key:

```typescript
// src/features/command-palette/chordRegistry.ts (new)
type ChordHandler = (event: KeyboardEvent) => boolean // true = consumed
const handlers = new Map<string, ChordHandler>()
export const registerChord = (
  key: string,
  fn: ChordHandler
): (() => void) => {
  handlers.set(key, fn)
  return () => handlers.delete(key)
}
export const dispatch = (event: KeyboardEvent): boolean => {
  const h = handlers.get(event.key)
  return h ? h(event) : false
}
```

PR2's chord registers `r`. The chord hook OWNS the rename-input
mount state, so it is mounted ONCE at the top of the workspace
tree (e.g. inside `WorkspaceView`) — the same scope as
`useSessionManager`. The hook returns the mount node (a portal-
rendered `<PaneRenameInput>` when open) and a `void` API.

```typescript
// usePaneRenameChord.ts (new)
type RenameTarget = { ptyId: string; pane: Pane } | null

// `resolveFocusedPane` is supplied by the caller (WorkspaceView),
// which owns the focus state. The hook does not import or read
// focus state directly — there is no global `useFocusedPane` to
// reach for; the active-pane data lives in WorkspaceView's session/
// pane state plus `activeContainerId` (per
// `2026-05-17-shared-focus-highlight-design.md`).
export const usePaneRenameChord = (
  resolveFocusedPane: () => Pane | null
): {
  renderNode: ReactNode
} => {
  const [target, setTarget] = useState<RenameTarget>(null)
  // Wrap the resolver in a ref so the chord-registration effect
  // doesn't re-bind on every WorkspaceView re-render.
  const resolverRef = useRef(resolveFocusedPane)
  resolverRef.current = resolveFocusedPane

  useEffect(() => {
    return registerChord('r', () => {
      const pane = resolverRef.current()
      if (!pane) return false
      setTarget({ ptyId: pane.ptyId, pane })
      return true
    })
  }, [])

  const renderNode = target ? (
    <PaneRenameInput
      pane={target.pane}
      onSubmit={async (title) => {
        // Await + catch so PTY-write errors / agent-type-not-supported
        // errors surface as toasts per §2.5. The IPC throws a string
        // error from the Result<(), String> we get back from Rust.
        try {
          await renameAgentSession(target.ptyId, title)
          setTarget(null)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('does not support /rename')) {
            toast.error("this agent doesn't support /rename")
          } else if (msg.includes('no live agent')) {
            toast.error('no agent in this pane to rename')
          } else {
            toast.error(`failed to send /rename: ${msg}`)
          }
          // Leave the input open so the user can decide whether to
          // retry or cancel.
        }
      }}
      onCancel={() => setTarget(null)}
    />
  ) : null

  return { renderNode }
}
```

**Mount site.** `WorkspaceView` calls `usePaneRenameChord` ONCE,
passing its own focused-pane resolver:

```typescript
// WorkspaceView.tsx
const resolveFocusedPane = useCallback((): Pane | null => {
  if (activeContainerId !== TERMINAL_CONTAINER_ID) return null
  const session = sessions.find((s) => s.id === activeSessionId)
  return session?.panes.find((p) => p.active) ?? null
}, [activeContainerId, activeSessionId, sessions])

const { renderNode: paneRenameNode } = usePaneRenameChord(resolveFocusedPane)
// ...
return (
  <>
    {/* ...existing tree... */}
    {paneRenameNode}
  </>
)
```

`renderNode` mounts stable in the tree (sibling to `<DockPanel />`,
not inside `TerminalPane` — otherwise the input would unmount when
the user switches panes mid-rename).

**Portal anchor.** `PaneRenameInput` uses a portal to position itself
over the pane's Header DOM node. The pane's `ptyId` resolves to a
DOM ref via a small `paneHeaderRefs` map maintained by
`TerminalPane/Header.tsx` (each Header registers its ref on mount,
unregisters on unmount). PaneRenameInput reads the target ref's
bounding rect and positions absolutely; if the ref is unavailable
(pane closed mid-rename), the modal renders centered in the
workspace as a fallback.

`focusedPane()` resolves the active pane via the existing focus
infra (`activeContainerId` for the workspace container per
`2026-05-17-shared-focus-highlight-design.md` + per-session
`pane.active` boolean). If focus is not on a terminal pane (e.g. the
dock has focus), the chord is a no-op and the leader falls through
to the palette.

**Backward compatibility.** Without any registered chord, the
leader-window simply delays the palette open by 500 ms — a slight
regression to the current "palette opens instantly" UX. v1 accepts
this as the cost of the chord layer; future work (§8) may shrink the
window further or fast-path the palette open when no chords are
registered.

**Escape inside the leader window.** `Escape` is treated as an
implicit cancel — leader exits without opening the palette and
without firing any chord. Implemented as a short-circuit at the top
of the `if (leaderActive)` branch, not as a registered chord.

### 5.3 Rename input UX

`openRenameInputFor(pane)` mounts an inline modal anchored to the
pane Header. The input renders **over** the existing title slot at
`Header.tsx:67` — same width, same font, so the visual swap is just
"label → input" in place.

Behavior:

- Pre-filled with `pane.agentTitle ?? session.name`. Text is
  pre-selected (`select()` on mount); a fresh keystroke replaces;
  arrow keys / home / end / click position the cursor.
- Validation per §5.4 runs on every keystroke. Disallowed input is
  highlighted inline (red underline + tooltip describing the rule,
  e.g. "control characters are not allowed"). The Submit button (or
  `Enter`) is disabled while invalid.
- `Enter` submits (only when validation is `valid`).
- `Escape` cancels (no IPC fired).
- Blur (focus loss) cancels — same policy as the existing
  `useRenameState.ts` blur behavior.
- A small one-line tip appears under the input the first time the
  chord is used per session: `tip: make sure the agent's prompt is
  empty before renaming` — the documented v1 known-limitation hint
  from §2.3 step 5. "First time per session" can be tracked in
  `sessionStorage` (cleared on app close) so repeat users aren't
  nagged.

Visual: glassmorphism panel matching the design-system tokens
(`bg-surface-container/80 backdrop-blur`), 1× pane Header height,
focus ring via existing tokens. No new design tokens — reuses
existing primitives.

### 5.4 Title input validation

`src/features/sessions/utils/sanitizeTitle.ts`, the TypeScript port
of the Rust sanitizer (§3.2.1). Same allowed character set, same
order, but with **different empty / control-char policy** — the
frontend REJECTS so the user can correct their input rather than
silently accepting a mutilated value.

```typescript
const MAX_BYTES = 200

export type TitleValidation =
  | { kind: 'valid'; sanitized: string }
  | { kind: 'empty' } // post-trim empty
  | {
      kind: 'invalid'
      reason: 'control-char' | 'too-long'
      offendingByte?: number // index of the first offending input byte
    }

export const validateTitle = (raw: string): TitleValidation => {
  // 1. Detect C0 / DEL → REJECT (do not silently strip — the user
  //    typed it, they should see the error and decide what to do).
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i)
    if ((c >= 0 && c <= 0x1f) || c === 0x7f) {
      return { kind: 'invalid', reason: 'control-char', offendingByte: i }
    }
  }
  // 2. Collapse whitespace runs to single space.
  let s = raw.replace(/\s+/g, ' ')
  // 3. Trim.
  s = s.trim()
  // 4. Empty?
  if (s.length === 0) return { kind: 'empty' }
  // 5. Byte length check (UTF-8). new TextEncoder().encode(s).length
  //    is the canonical byte count; a 4-byte char that pushes total
  //    past 200 → reject (frontend does not auto-truncate; the
  //    backend's defensive truncate handles non-frontend sources).
  const bytes = new TextEncoder().encode(s)
  if (bytes.length > MAX_BYTES) {
    return { kind: 'invalid', reason: 'too-long' }
  }
  return { kind: 'valid', sanitized: s }
}
```

Frontend behavior on each `TitleValidation` shape:

- `valid` → enable submit; on submit, send `sanitized`.
- `empty` → disable submit; show "title cannot be empty".
- `invalid { reason: 'control-char' }` → disable submit; show
  "control characters are not allowed (e.g. ⏎, ⇥)".
- `invalid { reason: 'too-long' }` → disable submit; show "title
  is too long (max 200 bytes)".

**Layered policy summary:**

| Layer            | C0 / DEL  | Whitespace runs | Empty result          | Over 200 bytes |
| ---------------- | --------- | --------------- | --------------------- | -------------- |
| Frontend §5.4    | reject    | collapse        | reject (disable Submit) | reject       |
| Backend §3.2.1   | replace→` `| collapse        | drop event (no emit)  | truncate to ≤200 |

The backend layer is defensive — it never sees a malformed PR2
write (frontend already gated), but it MUST tolerate hand-edited
transcripts or future agent versions that bypass our sanitizer.

### 5.5 IPC: `rename_agent_session`

Per the IPC checklist (4 files; missing the `ipc.rs` arm makes the
UI silently fail while tests pass):

**Backend state extensions.** `BackendState`
(`crates/backend/src/runtime/state.rs:12`) holds the existing
`agents: AgentWatcherState` (re-exported from
`agent::adapter::base::watcher_runtime`) and `pty: PtyState` (both
private). PR2 adds:

1. **Agent-type-by-PTY storage.** `AgentWatcherState::insert` today
   takes `(session_id, WatcherHandle)`. PR2 extends it to also
   record the detected `AgentType` for that session — either by
   bumping the value type to `(WatcherHandle, AgentType)` or by
   adding a parallel `HashMap<String, AgentType>` field guarded by
   the same lock. Implementer's choice; both are mechanical.
2. A new method on `AgentWatcherState`:
   `pub fn agent_type_for_pty(&self, pty_id: &str) -> Option<AgentType>`
   — returns the stored type from #1. `None` means "no live agent
   for this PTY" (closed pane, never-detected pane).
3. A new public method on `BackendState`:

```rust
// crates/backend/src/runtime/state.rs — new public method on
// BackendState, sibling to spawn_pty / write_pty.
pub fn rename_agent_session(
    &self,
    req: RenameAgentSessionRequest,
) -> Result<(), String> {
    // 1. Lookup the agent type by PTY id. None = no live agent.
    let agent_type = self.agents
        .agent_type_for_pty(&req.pty_id)
        .ok_or_else(|| format!(
            "no live agent in pty {} to rename", req.pty_id
        ))?;
    // 2. Reject agent types that don't support /rename.
    if !matches!(agent_type, AgentType::ClaudeCode | AgentType::Codex) {
        return Err(format!(
            "agent type {agent_type:?} does not support /rename"
        ));
    }
    // 3. Server-side sanitize (defense in depth — frontend already
    //    validated, but the IPC boundary re-checks against the
    //    same rules from §3.2.1).
    let title = sanitize_title(&req.title)
        .ok_or_else(|| "title is empty after sanitization".to_owned())?;
    // 4. Format the slash command and write it to the PTY via the
    //    existing pty write path. PtyState::write takes a typed
    //    `&SessionId` (newtype wrapper around String — see
    //    crates/backend/src/terminal/state.rs:261) and returns
    //    `anyhow::Result<()>`; convert at the boundary so the IPC
    //    surface stays `Result<_, String>` like every other agent
    //    IPC.
    let command = format!("/rename {title}\n");
    let session_id = SessionId::from(req.pty_id.clone());
    self.pty.write(&session_id, command.as_bytes())
        .map_err(|e| format!("pty write failed: {e}"))?;
    Ok(())
}
```

The two distinct error shapes (`no live agent` vs `does not support
/rename`) let the frontend pick the right toast message (per §2.5
failure-visible behavior).

The method is intentionally **not** `async` — `PtyState::write` is
synchronous (see `terminal/state.rs:261`). The `.await` in the IPC
match arm becomes a no-op; rename it to a plain call:

```rust
"rename_agent_session" => {
    let req: RenameAgentSessionRequest = serde_json::from_value(args)?;
    state.rename_agent_session(req)
        .map(|()| serde_json::Value::Null)
}
```

`detect_agent_in_session` (today, read-only — verified at
`crates/backend/src/agent/commands.rs`) gets a small extension to
record the detected `AgentType` via the new `AgentWatcherState`
storage path. That extension lives in the same commit as the PR2
backend change so the lookup has data to find.

```rust
// crates/backend/src/agent/types.rs — new request struct
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct RenameAgentSessionRequest {
    pub pty_id: String,
    pub title: String,
}
```

See the IPC match-arm snippet above — synchronous, no `.await`.

```typescript
// electron/backend-methods.ts — append to the allowlist
export const BACKEND_METHODS = [
  // ...existing entries
  'rename_agent_session',
] as const
```

Forgetting the `ipc.rs` arm is a known recurring bug shape in this
repo (the four-files rule); the PR2 review checklist (§7.4) must
verify all 4 files were updated.

### 5.6 PTY-write mechanics

The PTY-write path reuses the existing `PtyState::write` method that
serves user keystrokes today. The `/rename <title>\n` bytes go
through the same channel as any normal user input — no privileged
path. Implications:

- The agent's input echo (if any) shows `/rename <title>` in the
  terminal scroll, like the user typed it. **Intentional** —
  visually traceable.
- If the user has unflushed text in the agent's prompt (per §2.3
  v1 limitation), the bytes concatenate. Pane Header stays
  unchanged because the agent's slash-command lexer requires `/`
  at the start of the line. User-recovery: clear the agent's
  prompt and retry.
- The trailing `\n` is exactly one byte (LF, `0x0A`). Both Claude
  and Codex TUIs treat a single LF on stdin as "submit current
  line" (verified empirically against the sample transcripts in
  `~/.claude/projects/-home-will-projects-vimeflow/` and
  `~/.codex/sessions/`). No CRLF needed.

### 5.7 PR2 test surface

**Rust:**

- `state.rs` unit tests for `rename_agent_session`:
  - Happy path: ClaudeCode pty + valid title → `pty_state.write`
    called with `b"/rename foo\n"`.
  - Codex pty + valid title → same.
  - Aider/Generic pty → returns `Err("does not support /rename")`.
  - Empty-after-sanitize title → returns `Err`.
  - Title with C0 chars → sanitized server-side; `write` called
    with cleaned bytes.
- Bindings: `cargo test` regenerates
  `RenameAgentSessionRequest.ts`; verify barrel export is added to
  `src/bindings/index.ts` (regression-prone — see §3.5).

**TypeScript:**

- `sanitizeTitle.test.ts`:
  - Valid title → `{ kind: 'valid' }`.
  - Title with `\n` → `{ kind: 'invalid', reason: 'control-char' }`.
  - Whitespace-only → `{ kind: 'empty' }`.
  - 201-byte UTF-8 title → `{ kind: 'invalid', reason: 'too-long' }`.
  - A 4-byte UTF-8 char straddling the 200-byte cap → reject.
- `usePaneRenameChord.test.tsx`:
  - `Ctrl+:` then `r` opens rename input.
  - `Ctrl+:` alone (after 500 ms) opens palette.
  - `Ctrl+:` then non-`r` non-Escape key opens the palette but does
    NOT forward the second key (v1 limitation; see §2.3 step 3 and
    §5.2 fallback comment).
  - `Ctrl+:` then `Escape` cancels both chord and palette.
  - Chord with no focused pane → no-op; leader falls through to
    palette.
- `PaneRenameInput.test.tsx`:
  - Mounted with `pane.agentTitle = "old"` → input value is "old",
    pre-selected.
  - Type `new` and `Enter` → `renameAgentSession({ ptyId, title:
    "new" })` invoked.
  - Type with `\n` (via paste simulation) → submit disabled,
    control-char error shown.
  - `Escape` → input closes, no IPC.

**Manual checklist:**

- Press `Ctrl+:` then `r` over a Claude pane → rename input opens
  pre-filled with the current title (or `session.name` fallback).
- Type a new title, press `Enter` → pane Header updates within
  ~500 ms via the PR1 channel.
- Press `Ctrl+:` then `r` over a Codex pane → same flow.
- Press `Ctrl+:` alone (don't follow up) → palette opens after
  ~500 ms.
- Type `/rename foo` directly in Claude or Codex (bypassing the
  chord) → pane Header updates via the PR1 channel anyway.
- Try renaming a pane while typing in the agent's prompt → observe
  the documented v1 limitation (no Header change; agent processes
  concatenated text as a turn). Recover by clearing the prompt
  and retrying.

## 6. Edge cases & races

This section aggregates the failure modes referenced from earlier
sections and specifies the cross-cutting races.

### 6.1 Failure-mode contract (consolidated)

| # | Scenario                                                                | Behavior                                                                 | Spec ref       |
| - | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------- |
| 1 | Agent emits no title (Claude or Codex never `/rename`d)                 | Pane Header shows `session.name` indefinitely                            | §2.1, §2.2     |
| 2 | Claude transcript contains an `ai-title` with empty `aiTitle`           | If memo is `None` → no emit; if memo is `Some(_)` → emit clear            | §3.2.1 #5, §4.2|
| 3 | Codex `session_index.jsonl` row vanishes (file rewrite drops it)        | If memo is `Some(_)` → emit clear; else no emit                          | §4.3 step 2    |
| 4 | Partial / torn JSON line on `session_index.jsonl` read (write race)     | Line parse fails; watcher skips; next tick recovers                      | §4.3 cross-process race |
| 5 | Adapter file watcher dies (panic in tail thread)                        | Claude: status + title events both stop (shared thread). Codex: title events stop; rollout-tail + status events continue (sidecar). Recovery: reload. | §6.3 below |
| 6 | User chord-renames while typing in agent prompt                         | `/rename` concatenates with their text; agent treats as prompt; Header stays | §2.3 step 5, §5.6 |
| 7 | User chord-renames while agent is mid-turn (busy)                       | Agent buffers input; `/rename` processed after turn finishes; Header updates with normal latency | §6.2 below |
| 8 | PTY write fails (`PtyState::write` returns error)                       | Frontend toast: "failed to send /rename to agent"; no state change       | §2.5, §5.5     |
| 9 | Agent CLI version doesn't support `/rename`                             | Agent ignores or treats as literal; no transcript event; Header stays    | §2.5, §6.3 below |
| 10| App reload mid-rename (after chord submit, before transcript event)     | Reload re-attaches; adapter's initial-read picks up the new title        | §4.3 step 1, §6.5 below |
| 11| Multiple panes for the same agent session UUID (shouldn't happen)       | Each watcher independently filters by UUID → all matching panes update   | §6.4 below     |
| 12| Title with adversarial chars (emoji, RTL, zero-width)                   | Allowed (sanitizer only strips C0/DEL); rendered as-is; CSS `truncate` handles overflow | §3.2.1, §5.4 |

### 6.2 Cross-cutting race: chord rename vs. agent auto-title

**Scenario.** User chord-renames to `"my-feature"`. The bytes hit
the PTY; Claude processes the `/rename` and writes a `custom-title`
event. Concurrently, Claude's auto-title generator decides the
session warrants a new `ai-title` and writes one.

**Resolution.** The Claude transcript is append-only — both events
land, in some on-disk order. The adapter's last-emitted memo
de-duplicates identical titles but does NOT prefer `custom-title`
over `ai-title` semantically; whichever event lands last wins, in
the order the parser reads them.

**Why this is OK.** Claude's own UI treats `custom-title` as
overriding `ai-title` until cleared; in practice the auto-title
generator is gated on "no custom title set" so the race window is
narrow. If it does happen, the user-set title is what they just
typed and the auto-title is a stale auto-summary — re-running the
chord trivially recovers.

**Why this is NOT addressed in v1.** Tracking
`custom-title-set-wins-over-ai-title` in our memo would require
modeling Claude's internal title-priority rules, which can change
between Claude versions. The transcript-as-source-of-truth design
(per §1.2 #3) explicitly opts out of that modeling — Claude
arbitrates, we observe.

### 6.3 Adapters dying mid-stream

Two distinct cases, depending on which thread panics:

**Claude — single-thread title piggyback.** The Claude transcript
tail thread parses status, cost, cwd, AND title events in the same
loop. A panic kills the whole thread; PR1 inherits that behavior —
title events stop AND status events stop. Recovery: reload the app
(which respawns the tail).

**Codex — sidecar isolation.** Codex's session-index watcher runs
in its OWN thread (the `aux_join` slot on `TranscriptHandle` —
§4.3). A panic in the session-index watcher kills ONLY title events
for that PTY; the rollout-tail thread keeps emitting status / cost
/ cwd events. Conversely, a panic in the rollout-tail thread leaves
the session-index watcher running (titles keep flowing) — although
without status updates, the pane Header's `agentTitle` is the only
moving part.

Neither case has new resilience in PR1. The existing
`watcher_runtime` 3-second polling fallback (`base/watcher_runtime`)
covers the status SOURCE re-detect, not the tail thread itself. A
parser panic still loses the affected watcher until reload.

Future work (§8 #12): wrap individual line parses in `Result` and
log-and-skip on per-line parse failures, so one malformed event
doesn't kill the whole watcher.

### 6.4 Defensive: multiple panes sharing an agent session UUID

Not a known case (one PTY per agent session per pane), but the
design must not silently corrupt state if it happens. Each pane's
adapter watcher independently filters by its derived
`agent_session_id`. If two panes happen to share a UUID (e.g. two
PTYs both attached to the same Claude session via
`claude --resume <id>`), both watchers emit identically — both
panes update to the same title. Idempotent; no corruption.

The frontend's per-event walk-and-update (§4.5) acts on every
matching pane, so the dispatch is naturally idempotent across
multiple emits for the same `payload.sessionId`. Since
`payload.sessionId` is the PTY id (not the agent UUID), this only
matches one pane in practice; PTY ids cannot collide because
`crypto.randomUUID()` produces a 122-bit random value.

### 6.5a Agent exit / PTY death — title clearing

`pane.agentTitle` is owned by the agent watcher. When the watcher
shuts down for ANY reason, the title MUST clear so the pane Header
falls back to `session.name`. Otherwise a closed Claude session
leaves its last title stuck on the pane.

Trigger paths:

1. **User-initiated stop.** Frontend calls `stop_agent_watcher`;
   `WatcherHandle::stop` runs, the tail loop observes the stop
   flag, exits cleanly. Before joining, the loop emits a final
   `{ title: "", source: ... }` clear event (uses the same
   `emit_title` helper from §3.2.1; passes the raw title as
   empty string and relies on the transition-aware rule —
   skips emit if memo was already `None`).
2. **PTY exit.** When the underlying PTY dies (`PtyExitEvent` in
   the existing terminal pipeline), the agent watcher is torn
   down by the same shutdown path. Same clear-on-exit.
3. **Polling-detected disconnect.** Today the frontend's
   `useAgentStatus` polls `detect_agent_in_session` and infers
   agent exit (sets `agentExited: true`,
   `useAgentStatus.ts:303`). On that transition, the existing
   call to `stop_agent_watcher` runs the same shutdown — clear
   path covered.
4. **Adapter panic.** Tail thread panics; no clear emit happens
   (§6.3 — known limitation; the panic itself loses BOTH
   status and title until reload). Pane Header stays on the
   stale title until reload, at which point either the agent
   re-attaches (fresh initial-read, possibly emits new title)
   or the pane shows `session.name` (no agent re-attaches).

Implementation: extend each watcher loop with a "post-stop emit"
step before the join. For the Claude transcript tail, this lives
at the bottom of the loop where `stop_flag` is observed. For the
Codex session-index sidecar, same shape. The clear emit is
idempotent (the transition-aware empty rule de-dups when memo is
already `None`).

The frontend's listener (§4.5) already coerces empty `payload.title`
to `agentTitle: undefined`, so no frontend change is needed.

### 6.5 Reload mid-rename

User chord-renames; the PTY write succeeds; before the agent
finishes its transcript write, the user reloads the app.

- Backend: PTY survives reload (per
  `2026-04-25-pty-reattach-on-reload-design.md`); the agent keeps
  running with the new `/rename` still in flight.
- Frontend: React state resets; the adapter restarts.
- The adapter's initial-read (§4.3 step 1 for Codex; the file-tail
  catch-up loop for Claude) picks up the agent's persisted new
  title and emits it. Pane Header shows the new title.

This is the load-bearing reason `last_emitted_title` resets to
`None` on reload (and why the spec explicitly does NOT persist it
across reloads): the fresh memo + initial-read combination recovers
automatically.

## 7. Testing & rollout

### 7.1 Test inventory

Aggregated from §4.6 and §5.7. The PR1 test surface is
**self-sufficient** — PR1 lands and passes without depending on any
PR2 file. The PR2 surface adds tests that exercise the round-trip
(chord → IPC → PTY → adapter → event → Header).

### 7.2 Verification commands

```bash
npm run type-check        # tsc -b across the project
npm run lint              # ESLint
npm run test              # Vitest (all suites)
cargo test --manifest-path crates/backend/Cargo.toml
```

Frontend tests assert against generated bindings — if `cargo test`
is skipped, `AgentSessionTitleEvent.ts` / `TitleSource.ts` are
missing and TypeScript fails at type-check. The two test commands
are load-bearing-together; PR1's CI must run both, with `cargo
test` before `npm run type-check`.

### 7.3 Observability

PR1 does NOT add new log statements beyond what the existing
adapter pattern already does. Each title emit is visible in the
event log captured by `StdoutEventSink` (line in the LSP frame
stream), so debugging is "scroll the event stream for
`agent-session-title`".

Future telemetry (§8 #8) could count title-emit-rate per session
as a proxy for "user is actively renaming" — out of scope for v1.

### 7.4 Two-PR rollout

**PR1 — read-only sync (`feat/pane-title-sync-pr1`)**

- Branches from `main`.
- Files: §4.1 table.
- Acceptance: Manual checklist in §4.6 passes; all Rust and TS
  tests green.
- Reviewer checklist:
  - [ ] `src/bindings/index.ts` has new exports for
    `AgentSessionTitleEvent` and `TitleSource`.
  - [ ] `Header.tsx` accepts `paneAgentTitle?: string`; line 67
    renders `{paneAgentTitle ?? session.name}`.
  - [ ] `TerminalPane/index.tsx` passes
    `paneAgentTitle={pane.agentTitle}` to `<Header>`.
  - [ ] `useSessionManager` listener has the `cancelled` race
    guard (§4.5) and clear-on-empty interpretation (§3.2.1).
  - [ ] `TranscriptHandle::Drop` flips `aux_stop` BEFORE joining
    `aux_join` (§4.3).
  - [ ] Claude transcript parser uses the filename-derived
    `agent_session_id` as both filter and emitted value (§4.2).
  - [ ] Codex initial-read emits on first observation; row-missing
    transitions emit clear (§4.3 step 2).
  - [ ] Sanitizer uses the correct char-boundary truncation
    recipe (§3.2.1 #4).

**PR2 — chord + write-back (`feat/pane-title-sync-pr2`)**

- Branches from `main` (NOT from PR1's branch — both target `main`
  independently). If PR2 starts before PR1 is merged, rebase PR2
  on top of PR1's merge to inherit the event channel.
- Files: §5.1 table.
- Acceptance: Manual checklist in §5.7 passes.
- Reviewer checklist:
  - [ ] All four IPC files updated: `crates/backend/src/agent/mod.rs`,
    `crates/backend/src/runtime/state.rs`,
    `crates/backend/src/runtime/ipc.rs`,
    `electron/backend-methods.ts` (§5.5; the four-files rule).
  - [ ] `useCommandPalette` leader logic preserves backward-compat
    palette-open after the 500 ms window (§5.2).
  - [ ] `sanitizeTitle.ts` frontend rules match `sanitize_title`
    backend rules per the §5.4 layered policy table.
  - [ ] `Escape` inside the leader window cancels cleanly (§5.2).

No feature flags or staged rollout — both PRs ship to all users
immediately. The risk profile is contained: PR1 only adds new
state, never mutates existing flows; PR2 adds a new chord behind a
specific key combination that doesn't exist today.

## 8. Open questions and future work

Each item is its own potential follow-up spec; none blocks PR1 or
PR2.

1. **Persist agent title across reload (cheaper restore).** Today
   the adapter re-emits on reload, so the title flashes back after
   a brief delay (Codex: ≤ 500 ms; Claude: as soon as the tail
   re-opens). Persisting `pane.agentTitle` in the Rust
   `SessionCache` would make reload instant. Cost: a small schema
   migration. Per §1.3 #3, deliberately deferred.

2. **Visual indicator for `ai-generated` vs `user-renamed`.** The
   `agentTitleSource` field is already in the event payload and
   on the `Pane` (§3.1). A subtle badge or tooltip could
   distinguish the two. Held until UX feedback indicates it's
   needed.

3. **OSC 0/2 title fallback.** For agents without a structured
   title source (`aider`, `generic`, future TUI agents), tap
   xterm.js's `onTitleChange` to populate `pane.agentTitle` from
   the OSC escape. Lower fidelity than transcript parsing but
   universal.

4. **`/rename` for non-empty agent prompts.** v1's documented
   limitation in §2.3 step 5 / §5.6 is that chord-renaming while
   the user has unflushed text in the agent's prompt produces a
   concatenated turn. Future hardening could inject `\x15`
   (readline `unix-line-discard`) before `/rename`, or use
   agent-specific control channels (Claude MCP, Codex JSON-RPC)
   instead of PTY injection.

5. **Single shared watcher for `session_index.jsonl`.** v1 spawns
   one mtime-poll watcher per Codex pane (§4.3, §4.4). A single
   process-wide watcher with fan-out filtering would reduce
   syscall load when many Codex panes are open.

6. **`notify`-crate-driven watchers.** Match
   `base/watcher_runtime`'s pattern — real fs events for
   `session_index.jsonl` and Claude transcripts with 3-second
   polling fallback. Better latency than the 500 ms mtime poll;
   cross-platform via the `notify` crate's abstractions.

7. **`title_source()` trait method.** Once a third adapter (e.g.
   `aider`) wants to participate in title sync, lift the
   per-adapter logic into a formal trait method on `AgentAdapter`
   per the alternative considered in §1.3 #5 and §4.3.

8. **Telemetry on chord usage.** Count title-emit-rate per session
   and chord-trigger-rate per app session. Could inform whether
   the chord is discoverable / useful / right-keyed.

9. **Chord-window tuning.** 500 ms is a guess. Telemetry could
   inform a shorter (or longer) window. Could also be user-
   configurable.

10. **Wire the chord into the command palette as `:rename-pane`.**
    So the chord and the palette converge on the same action; the
    chord becomes a shortcut.

11. **Per-pane title in tab strip on hover.** Even though the tab
    strip stays session-derived (§1.3 #1), a hover tooltip
    showing the active pane's agent title would help users
    identify sessions in a busy strip without focusing each pane.

12. **Per-line parse resilience in the Claude transcript tail.**
    Today a single malformed JSON line panics the whole tail
    thread (§6.3). Wrapping each line parse in a `Result` and
    logging-and-skipping would let one bad event coexist with
    healthy ones.
