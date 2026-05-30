# Activity item tooltip — design

- **Date:** 2026-05-29
- **Status:** Reviewed (codex) — implementation-ready
- **Area:**
  - Frontend — `src/features/agent-status/components/ActivityEvent.tsx`, `.../types/activityEvent.ts`, `.../utils/toolCallsToEvents.ts`, `.../hooks/useAgentStatus.ts`, `.../hooks/useActivityEvents.ts`, `.../types/index.ts`, `src/bindings/AgentToolCallEvent.ts`
  - Backend — `crates/backend/src/agent/types.rs` (shared `AgentToolCallEvent` struct + ts-rs derive), `crates/backend/src/agent/adapter/claude_code/transcript.rs` (PR2: will populate `result_preview`), `crates/backend/src/agent/adapter/codex/transcript.rs` (PR2: will default `result_preview` to `None`)
- **Topic:** Migrate the activity-feed hover tooltip to the `docs/design/activity-item-tooltip/ActivityTooltip.html` mockup — a kind-aware, structured card — fix the activity row's text-caret (I-beam) cursor, and extract and forward a small preview of Claude Code tool-result content so the card can show real command output / file previews.

## Goal

Hovering (or focusing) an activity row in the agent-status panel should reveal a structured, kind-aware detail card matching the mockup: a header (kind tag + meta chips + Copy) over a per-kind body (command + output, file + preview, think/user text, etc.). The row itself should use a normal arrow cursor, not the text I-beam it shows today. Where the data to populate a mockup field does not exist in the live pipeline, the card degrades gracefully rather than inventing it.

## Background (current state)

- **Row + tooltip:** `ActivityEvent.tsx` renders each feed row as an `<article>` wrapped in the shared `<Tooltip>` (`src/components/Tooltip.tsx`, `@floating-ui/react` — decision `2026-04-22-tooltip-library.md`). The content component (`ActivityTooltipContent`) today shows only `label` + a `<pre>` of `event.body` (one string) + a Copy button; `placement="left"`, `interactive`, `maxWidth={520}`.
- **Cursor:** the `<article>` (ActivityEvent.tsx:266–275) sets no `cursor-*` utility, so over selectable text the browser shows the I-beam caret — the reported "large input indicator".
- **Data model:** `ActivityEvent` (activityEvent.ts) is a discriminated union over `kind`; the only body payload is `body: string`. `ToolActivityEvent` _declares_ `diff?{added,removed}` and `bashResult?{passed,total}`, plus `durationMs`, `status`, `isTestFile`. `ThinkActivityEvent` / `UserActivityEvent` carry only `body`.
- **Pipeline (live — important):** the **only** feed producer is `useActivityEvents(status)` → `toolCallsToEvents(status.toolCalls.active, status.recentToolCalls)`, which builds **tool events only**. `RecentToolCall` (assembled in `useAgentStatus.ts:~532` from the `agent-tool-call` event) carries `{id, tool, args, status, durationMs, timestamp, isTestFile}` — **no `diff`, no `bashResult`** — and the producer **never emits `think`/`user` events**. So `diff`/`bashResult`/think/user are exercised only by component tests today, never by the live feed.
- **Event source:** `agent-tool-call` (`AgentToolCallEvent`, a shared struct in `agent/types.rs`) is emitted by the Rust transcript parsers — `claude_code/transcript.rs` (`process_tool_result`, line 630, + a running-state site at 497) and `codex/transcript.rs` (five sites).
- **Result-content extraction exists but is test-only:** claude*code/transcript.rs has `extract_tool_result_content` but calls it **only inside the test-match branch** (line 589, under `if let Some(matched) = call.test_match`) — non-test results (Read / Edit / Grep / plain Bash) are not extracted today. When a test command matches, the captured content (capped at `MAX_TOOL_RESULT_CONTENT_LEN = 256 KiB`, keeping the **tail** `TOOL_RESULT_TAIL_LEN = 64 KiB` for the summary parser) builds a `TestRunSnapshot` for the `TestResults` panel — **not** an ActivityEvent `bashResult` — and never reaches the tooltip. PR2 must extract a \_new* small head preview for **every emitted** Claude Code tool-call completion — i.e. each non-orphaned `tool_result` (orphans are dropped before emit at transcript.rs:579, as today); the five Codex-adapter sites default `result_preview` to `None` this round (see D5).

## Scope decision — B

Restyle the tooltip to the mockup **and** thread a new, small `resultPreview` through the existing `agent-tool-call` event so the card can show real bash output / read previews. Fields with no live data source degrade.

### Data availability — mockup field → live source → status

| Mockup field                                            | Live source today                                                                                                | Status           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| kind tag (BASH/EDIT…)                                   | `event.kind` → label via existing `getLabel` (keeps `CREATED TEST` / `UPDATED TEST` for `isTestFile` Write/Edit) | ✅ tier-1        |
| `ago`                                                   | `event.timestamp`                                                                                                | ✅ tier-1        |
| `duration`                                              | `event.durationMs` (completed rows only; running rows show elapsed in the `ago`/RUNNING chip — see §3)           | ✅ tier-1        |
| OK / FAILED / RUNNING chip                              | `event.status` (running → RUNNING; done/failed → OK/FAILED)                                                      | ✅ tier-1        |
| command / file / tool-args text                         | `event.body` (summarized args, ≤100 chars)                                                                       | ✅ tier-1        |
| bash `output[]`, read `preview`, edit post-edit snippet | `tool_result` content → new `resultPreview`                                                                      | 🟡 tier-2 (PR2)  |
| edit `+add` / `−rem`                                    | `ToolActivityEvent.diff` — declared, but the live producer never sets it (`RecentToolCall` carries no diff)      | ⚠️ not live — D6 |
| bash `passed/total`                                     | `ToolActivityEvent.bashResult` — declared, never populated live                                                  | ⚠️ not live — D6 |
| THINK text, USER text                                   | `think`/`user` events are **never produced** live (`toolCallsToEvents` emits tool events only)                   | ⚠️ not live — D6 |
| `exit` code (numeric)                                   | only `status` (done/failed)                                                                                      | ❌ non-goal      |
| `tokens` count                                          | —                                                                                                                | ❌ non-goal      |
| edit `before[]` / `after[]`                             | — (`args` summarized to 100 chars)                                                                               | ❌ non-goal      |
| read `lines` range                                      | —                                                                                                                | ❌ non-goal      |

**Running rows** (`status: 'running'`, `durationMs: null`) show a RUNNING indicator with elapsed time computed from `event.timestamp` (which the producer fills from `ActiveToolCall.startedAt` for running rows, as today), no OK/FAILED chip, and no `resultPreview` (no result yet). Full running-state rendering is in §3.

## Decisions locked

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Source                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| D1  | Scope B: tooltip redesign **plus** extracting and forwarding a small preview (`resultPreview`) for each **emitted** Claude Code tool-call completion (orphaned `tool_result`s, which are dropped before emit, are excluded).                                                                                                                                                                                                                                                                                                                                                             | user                           |
| D2  | Row cursor → `cursor-default` (arrow) + `select-none`; the tooltip **card** keeps text selection (Copy stays the primary copy path). The exact Copy payload (body vs structured text vs including `resultPreview`) is specified in §3.                                                                                                                                                                                                                                                                                                                                                   | user                           |
| D3  | `resultPreview` is a **new, small, head-oriented** preview (first lines — exact cap in §4), NOT the existing 256 KiB tail-truncated test-parser content. Head, because the mockup shows the first lines of output; small, to keep event payloads light.                                                                                                                                                                                                                                                                                                                                  | recommended — flagged for veto |
| D4  | Ship as a 2-PR stack on `feat/activity-item-tooltip-migration`: **PR1** = tooltip redesign + cursor on tier-1 data (no backend change); **PR2** = backend `resultPreview` wiring + tier-2 body.                                                                                                                                                                                                                                                                                                                                                                                          | user                           |
| D5  | `result_preview` is a new **field** on the shared `AgentToolCallEvent` struct (`agent/types.rs`), not a new IPC command — no `ipc.rs` arm or `electron/backend-methods.ts` allowlist entry. Because the struct is built at multiple sites (claude_code done/failed **populates** it; the claude_code running site, all five `codex/transcript.rs` sites, and any Rust test builders default to `None`), §4 must give **every** site a value or PR2 won't compile. ts-rs regen carries the field to `AgentToolCallEvent.ts` (the `Option<String>` → TS nullability nuance handled in §4). | fact                           |
| D6  | The mockup's edit diff chips, bash `passed/total`, and THINK/USER variants are **not populated by the live pipeline today**. This migration renders each **when present and degrades when absent** — it does **not** add producers for them. Wiring diff/bashResult/think/user into the live feed is a separate follow-up.                                                                                                                                                                                                                                                               | recommended — flagged for veto |

## Non-goals

- **Numeric exit codes** (mockup `exit: 1`). We only have `status: done|failed` → an OK/FAILED chip. No real exit code is in the stream.
- **Per-tool token counts** (mockup `tokens: 420`). Not tracked per tool call.
- **True edit before/after** (mockup `before[]`/`after[]`). `args` is summarized to `MAX_ARGS_LEN = 1024` (raised from 100 to carry the full command/path — see §3 as-built); `old/new_string` are not forwarded. Edit degrades to file + (when populated) `+N/−M` + (when present) the post-edit snippet from `resultPreview`.
- **Read line-range** (mockup `lines: 'L14-L62'`). Not captured.
- **New producers for diff/bashResult/think/user** (D6). Render-when-present only; wiring their live population is a separate follow-up.
- **Codex-adapter result previews.** The five `codex/transcript.rs` sites default `result_preview` to `None` this round; extracting previews from Codex transcripts is a follow-up (D5).
- **Sensitive-output redaction.** `resultPreview` **newly surfaces a slice of tool-result content in the activity tooltip** — including Read/Edit file-content previews the feed does not show today (and that aren't necessarily visible in the terminal either). We accept this new tooltip exposure and do not redact this round (rationale + scope in §5).
- **Tooltip library / interaction model.** No change to `@floating-ui/react`, hover/focus/dismiss, portal, or a11y roles.
- **Watcher/detection lifecycle**; no new IPC command.

## §2 · Cursor & row-interaction fix

**Problem.** The activity row `<article>` (`ActivityEvent.tsx:266–275`) sets no `cursor-*` utility. Over its selectable text the browser shows the I-beam (text) caret — the reported "large input indicator". The row has no click action; it is a hover/focus tooltip trigger and a roving-tabindex list item.

**Fix.** Add `cursor-default select-none` to the `<article>` `className`. Result: arrow cursor over the whole row, and dragging no longer starts a text selection.

- Current: `className="flex items-start gap-2 rounded-md py-1 outline-none focus-visible:ring-1 focus-visible:ring-primary-container"`
- After: `className="flex items-start gap-2 rounded-md py-1 cursor-default select-none outline-none focus-visible:ring-1 focus-visible:ring-primary-container"`

**Tooltip selection is unaffected.** The tooltip card renders through `FloatingPortal` (Tooltip.tsx) — into `document.body`, not as a DOM descendant of the `<article>`. `user-select: none` inherits only to descendants, so the row's `select-none` does **not** propagate into the card; its `<pre>` body stays selectable (browser default). Copy remains the primary copy path (§3 defines the Copy payload).

**Why not `cursor-pointer`.** The row triggers no click action; a hand cursor would imply one. `cursor-default` removes the misleading text caret without over-promising interactivity (D2).

**Test (PR1).** Extend `ActivityEvent.test.tsx` — assert the row exposes both classes:

```tsx
test('activity row uses a default cursor and is not text-selectable', () => {
  render(<ActivityEvent event={toolEvent()} now={now} />)
  const row = screen.getByRole('article', { name: 'EDIT' })
  expect(row).toHaveClass('cursor-default')
  expect(row).toHaveClass('select-none')
})
```

Lands in **PR1**; no backend dependency.

## §3 · Tooltip visual redesign

> **AS-BUILT (supersedes the sketch below).** The card shipped as a **verbatim port** of `docs/design/activity-item-tooltip/activity-tooltip.jsx` — the real `ActivityTooltip` component, committed `cb8fa0b`, which arrived _after_ this section was drafted — rendered on a new Tooltip **`bare`** mode so the floating surface **is** the card (one wrapper, no nested border). The shipped card: a kind-tinted accent stripe; a kind chip (Material-Symbol icon + **lowercase** kind, accent-tinted via a `KIND_ACCENT` map — bash `#a8c8ff`, edit/write `#e2c7ff`, read `#8a8299`, think `#c39eee`, user `#f0c674`, grep/glob/meta `#a8c8ff`); `· ago` + `duration` pips; a copy **icon** button; per-kind body = `$`-prefixed **CommandBlock** (bash/grep/glob/meta) / **FilePathChip** (edit/write/read, dir muted + filename bold) / italic-think / plain-user; and static keyboard-hint **footer placeholders** (`↵ rerun · ⌘O open in terminal`, `⌘O open file · ⌘D view diff`, `⌘O open file`, `esc`). The body shows the **full command / file path** — `MAX_ARGS_LEN` was raised `100 → 1024` in both transcript adapters so `event.body` carries the full text, **wrapped and contained** in the card (CommandBlock scrolls past `max-h-[12rem]`), while the activity-feed **row** keeps CSS-truncating it to one line. Copy copies the full body.
>
> **Deferred / not yet rendered:** the numeric `exit` pip, the OK/FAILED/RUNNING status chip, the result-output `<pre>` (§4 / PR2), the footer **actions** (rerun / open-in-terminal / open-file / view-diff are visual only this round), and edit `+/−` / bash `passed/total` / `lines` / `tokens` / before-after (D6 / non-goals). Tokens intentionally use the design jsx's accent hexes via arbitrary Tailwind values — fidelity to the committed design source takes precedence over the no-raw-hex guideline. The Tooltip gains an additive `bare?: boolean` prop in `src/components/Tooltip.tsx` (suppresses its default chrome so a consumer fully owns the surface). The prose sketch below records the original design **intent** and is superseded by the as-built card; the §1 data-availability/decisions tables likewise describe intent, not the shipped subset.

> **Note on the mockup.** `docs/design/activity-item-tooltip/ActivityTooltip.html` references `src/activity-tooltip.jsx`, which is **not** present in the design folder (only the HTML is). The card structure below is therefore specified from the mockup's prop contract (`kind` / `meta` / `body`), its visible "before" example, the existing `ActivityTooltipContent`, and the Obsidian-Lens tokens — not ported verbatim from a component we don't have.

**Surface.** Unchanged from today: the card renders via `<Tooltip interactive placement="left" maxWidth={520}>` (`@floating-ui/react`, portaled). Container keeps `w-[min(30rem,calc(100vw-2rem))]`.

**Card anatomy.**

```
┌ card ───────────────────────────────────────────────┐
│ [KIND TAG]      [ago] · [dur] · [status]    [⧉ Copy] │  header
│ ──────────────────────────────────────────────────── │
│ <per-kind body>                                       │
└───────────────────────────────────────────────────────┘
```

**Header.**

- **Kind tag** — `getLabel(event)` (keeps `CREATED TEST` / `UPDATED TEST`), `text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant` (as today).
- **Meta chips** — small mono (`text-[9px]/[10px] font-mono`), each rendered only when present:
  - `ago` — completed: `formatRelativeTime(event.timestamp, now)` (`now` / `Nm ago`); running: `running ${formatDuration(Math.max(0, now.getTime() - new Date(event.timestamp).getTime()))}` — the existing row formula, with the clock-skew clamp. `formatRelativeTime` alone does **not** produce elapsed running text.
  - `duration` — `formatDuration(event.durationMs)` for completed tool events (`durationMs != null`). PR1 also changes the `useAgentStatus` mapper from `Number(p.durationMs) || null` to `Number(p.durationMs)` — `AgentToolCallEvent.durationMs` is a non-null `bigint`, so a `0 ms` completion should map to `0` (rendering `0s`) rather than be coerced to `null` by `|| null`.
  - **status chip (tool kinds only — not think/user)** — `done → OK` (`text-success bg-success/[0.12]`), `failed → FAILED` (`text-error bg-error/[0.12]`), `running → RUNNING` (`text-on-surface-variant`). Appends `passed/total` only when `event.kind === 'bash' && event.bashResult` (render-when-present — D6); otherwise bare `OK`/`FAILED` (the live case today, since `bashResult` is not populated).
  - edit/write only: `+add` / `−rem` (`text-success` / `text-error`) **when `event.diff` is present** (not live — D6 degrade).
- **Copy button** — existing button + `aria-live` Copied/Failed feedback; mechanics (`idle/copied/failed`, `COPY_FEEDBACK_MS`) unchanged.
- **Union narrowing.** `durationMs`, `diff`, `bashResult`, and the status chip live on `ToolActivityEvent` only — the card (`ActivityTooltipContent` receives the full `ActivityEventType` union) gates them behind a `'tool' in event` narrow. `think`/`user` events render just the `ago` chip + their text body.

**Per-kind body.**

| kind                           | body layout                                     | source / tier                                                     |
| ------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------- |
| `bash`, `grep`, `glob`, `meta` | command/args line (mono) + output `<pre>` below | command = `body` (tier-1); output = `resultPreview` (tier-2, PR2) |
| `edit`, `write`                | file line (mono) + post-edit snippet `<pre>`    | file = `body` (tier-1); snippet = `resultPreview` (tier-2)        |
| `read`                         | file line (mono) + preview `<pre>`              | file = `body` (tier-1); preview = `resultPreview` (tier-2)        |
| `think`                        | text, italic (existing `getBodyClass`)          | `body` (tier-1)                                                   |
| `user`                         | text, non-mono                                  | `body` (tier-1)                                                   |

- The output/preview/snippet `<pre>` reuses today's styling: `thin-scrollbar max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-container/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-on-surface`.
- **Degradation.** When `resultPreview` is absent (PR1 always; under PR2 for running rows, Codex agents, or any completion with empty result content), the body shows just the command/file/text line. So PR1 ships the redesigned **header + structured shell** with the tier-1 body; PR2 fills the `<pre>` once `resultPreview` flows.

**Copy payload (resolves the §1 LOW / D2 forward-ref).** Copy intentionally copies the **substantive content** — the command/file/text body plus the result preview — and **not** the header chrome (kind tag, meta chips, status):

```ts
const buildCopyText = (event: ActivityEventType): string =>
  'resultPreview' in event && event.resultPreview
    ? `${event.body}\n\n${event.resultPreview}`
    : event.body
```

(`ActivityEvent.tsx` imports the union aliased — `import type { ActivityEvent as ActivityEventType } from '../types/activityEvent'` — because `ActivityEvent` is the component name in that file.) For think/user (no `resultPreview`) this is just `event.body`, preserving today's copy behavior. The `resultPreview` field shape is defined in §4.

**Component API.** `ActivityTooltipContent` changes from `({ body, label })` to `({ event, label, now })` so it can render per-kind. `ActivityEvent` already has `now` and the computed `label` in scope. The copy state machine is unchanged; it copies `buildCopyText(event)` instead of `body`.

**Tokens.** All values are existing Obsidian-Lens semantic tokens (`text-on-surface*`, `bg-surface-container*`, `text-success` / `text-error`, `text-outline`, `font-mono`). The mockup's raw hex (`#0d0d1c`, `#cba6f7`, …) is illustrative only — `UNIFIED.md` / `tailwind.config.js` tokens win.

**Tests (PR1, tier-1 only).** In `ActivityEvent.test.tsx`, within the `dialog`:

- header shows the kind tag + an `OK` / `FAILED` / `RUNNING` chip matching `status`;
- a `read`/`bash` card with no `resultPreview` renders the file/command line and **no** output `<pre>`;
- Copy copies `buildCopyText` (== `body` when no `resultPreview`) — existing copy tests still pass.

PR2 adds: the output `<pre>` appears when `resultPreview` is present, and Copy includes it.

## §4 · Data contract: `resultPreview` (PR2)

Carry a small **head** preview of each emitted Claude Code tool-call completion's result from the Rust parser to `ActivityEvent`, for the §3 body. **Almost entirely PR2** — the one exception is the optional frontend field declaration (step 5a), which lands in **PR1** so §3's `buildCopyText` and card body typecheck against the union (the field is simply always `undefined` until PR2 populates it).

**1 · Rust struct (`agent/types.rs`).** Add one field to `AgentToolCallEvent` (struct at line 309):

```rust
/// Small head preview of the tool_result content (first lines), for the
/// activity tooltip. None for running calls, Codex tool calls (this round),
/// and completions whose flattened result content is empty.
pub result_preview: Option<String>,
```

`#[serde(rename_all = "camelCase")]` → `resultPreview` on the wire. ts-rs (derived under `cfg(test)`) maps `Option<String>` → `resultPreview: string | null` in the regenerated `src/bindings/AgentToolCallEvent.ts` — the **same** mapping it already produces for `CostMetrics.totalCostUsd` (`Option<f64>` → `number | null`). So `AgentToolCallEvent` needs **no `types/index.ts` override** — it is re-exported from bindings as-is. (The separate `AgentStatusEvent` override addresses its own nullability quirk and does not apply here; still, verify the regenerated `AgentToolCallEvent.ts` shows `resultPreview: string | null` before relying on it.)

**2 · New head-preview extractor (`claude_code/transcript.rs`).** The existing `extract_tool_result_content` (line 774) caps its returned content at `MAX_TOOL_RESULT_CONTENT_LEN` (256 KiB **total**, with a `TOOL_RESULT_TAIL_LEN` 64 KiB tail carved out of that budget) for the test parser — far too large, and tail-biased, for a tooltip. Add a separate, small, head-only preview that **caps while collecting**:

```rust
const TOOL_RESULT_PREVIEW_MAX_LINES: usize = 24;
const TOOL_RESULT_PREVIEW_MAX_BYTES: usize = 4 * 1024;

/// First-N-lines / first-N-bytes head preview for the activity tooltip.
/// None when the flattened content is empty.
fn tool_result_preview(value: &Value) -> Option<String>
```

- **Bounded allocation & uniform caps.** Collect the `content` head directly and apply **both** caps to **both** shapes (plain string or array of `text` blocks). Stop at whichever comes first: **at most `MAX_LINES` content lines** (cut at the `MAX_LINES`-th newline — 24 content lines, not 25) or `MAX_BYTES` bytes. On truncation, append `TOOL_RESULT_TRUNCATED_MARKER` as a trailing **marker line**; the marker line is **not** counted toward `MAX_LINES`. Do **not** build a full `flatten_tool_result_content(value) -> String` first — that copies an arbitrarily large result before truncating (the test extractor specifically avoids this with its own pre-cap/prune); collect-and-stop keeps the working set near the cap, not near the raw result size.
- **UTF-8 / marker safety.** Collect the head up to the **full** `MAX_BYTES`; **only when the content is actually truncated**, trim the head back to the nearest **char boundary** at or below `MAX_BYTES − ("\n" + marker)` (`str::is_char_boundary` / `char_indices`, mirroring the boundary-safe slicing in `cap_with_head_and_tail`) and append the marker line — never slice mid-`char` (a byte-index slice through a multibyte char panics). Insert the separating `\n` only when the head does not already end with one (no blank line before the marker). Content at or under the caps is returned **verbatim** (no trim, no false marker); a truncated result (head + optional `\n` + marker) stays ≤ `MAX_BYTES`.
- Caps are tunable — chosen to match the mockup's ~6-line previews while bounding the per-event payload at ≤~4 KiB (≤~200 KiB **steady-state** across the 50-entry `RECENT_TOOL_CALLS_LIMIT` window; the one-time **catch-up transport** cost is larger and is treated in §5 R2).

**3 · Populate in `process_tool_result` (`claude_code`, line 555).** It already holds `value: &Value`. Compute `let result_preview = tool_result_preview(value);` **independently of** the `call.test_match` branch, and set it on the emitted event (line 630). The running-state emission (line 497) sets `result_preview: None` (no result yet).

**4 · Default `None` at every other construction site (compile gate — D5).** Adding the field is a compile error at each named-field site until filled:

- `claude_code/transcript.rs:497` (running) → `None`.
- `codex/transcript.rs` sites `429, 479, 527, 605, 647` → `None` (Codex preview extraction is a follow-up; non-goal §1).
- Any Rust test builders of `AgentToolCallEvent` → `None`.

**5 · Frontend types + mapping.**

- **5a · (PR1) `ToolActivityEvent` (`activityEvent.ts`):** add `resultPreview?: string | null` (tool events only — Think/User never carry it, matching §3's `'tool' in event` narrow). This lands in **PR1** so §3's preview-aware `buildCopyText` and card body typecheck; with no producer wiring yet it is always `undefined`, so PR1 always renders the tier-1 body.
- **5b · (PR2) `RecentToolCall` (`types/index.ts`):** add `resultPreview?: string | null` — **optional** at this layer so existing `RecentToolCall` fixtures/builders (e.g. `toolCallsToEvents.test.ts`, `useAgentStatus.test.ts`, `AgentStatusPanel/index.test.tsx`) don't each need the new field; the `useAgentStatus` mapper (5c) always sets it in production.
- **5c · (PR2) `useAgentStatus.ts` done/failed mapping (~line 532):** add `resultPreview: p.resultPreview ?? null` (normalizes a missing field to `null`; `??` not `||`, so a non-empty string survives). The running path builds `ActiveToolCall` (no result) — unchanged.
- **5d · (PR2) `toolCallsToEvents.ts`:** copy `resultPreview: r.resultPreview` onto the event built from each `RecentToolCall` (a fixture without the optional field yields `undefined`, which the optional `ToolActivityEvent.resultPreview` accepts; the active/running event omits it entirely).

**6 · Degradation.** `resultPreview` is `null`/absent for running rows, Codex tool calls, orphaned results (dropped before emit — §1), and empty-content completions. §3 renders the `<pre>` only when it is a non-empty string, so all of these degrade to the tier-1 body.

**Why `Option<String>`, not `String`.** A non-null empty-string default would force the UI to distinguish `""` from "no preview". `Option` / `null` is the honest "no preview" signal and matches the existing nullable-binding pattern. Tests for §4 are in §5.

## §5 · PR sequencing, testing & risks

### PR sequencing (D4)

Both PRs land on the `feat/activity-item-tooltip-migration` integration branch, which opens a final integration → `main` PR — child PRs are **not** opened directly against `main`.

- **PR1 — `feat(agent-status): redesign activity tooltip and fix row cursor`** (frontend only, tier-1 data, no backend):
  - §2 cursor fix (`cursor-default select-none` on the row).
  - §3 redesign: `ActivityTooltipContent` → structured header (kind tag + meta chips + status chip) + per-kind body; `buildCopyText`; API change to `({ event, label, now })`; `'tool' in event` narrowing.
  - §3 zero-duration mapper fix (`Number(p.durationMs)`).
  - §4 **step 5a only**: declare `ToolActivityEvent.resultPreview?: string | null` (always `undefined` in PR1 — the card always renders the tier-1 body).
  - No backend, no binding regen.
- **PR2 — `feat(agent-status): forward tool-result preview to the activity tooltip`** (full-stack; depends on PR1):
  - §4 steps 1–4: struct field, `tool_result_preview` helper, populate in `process_tool_result`, default `None` at the claude_code running site + five codex sites + Rust test builders.
  - Regenerate `src/bindings/AgentToolCallEvent.ts` and commit it.
  - §4 steps 5b–5d: `RecentToolCall` optional field, `useAgentStatus` mapping, `toolCallsToEvents` copy.

### Test plan

- **PR1 frontend** (extend `ActivityEvent.test.tsx`):
  - row carries `cursor-default` + `select-none` (§2).
  - card header shows the kind tag + an `OK`/`FAILED`/`RUNNING` chip matching `status`; `think`/`user` show **no** status chip.
  - running row → `RUNNING` + elapsed in the `ago` chip, no `duration` chip, no output `<pre>`.
  - a `read`/`bash` card with `resultPreview` undefined → file/command line, **no** `<pre>`.
  - `buildCopyText` copies `body` when no `resultPreview` (existing copy tests adapt).
  - `bashResult` present (fixture) → `OK 4/4`; `diff` present → `+/−` chips (render-when-present — D6).
  - `durationMs: 0` preserved by the mapper (`useAgentStatus.test.ts`) **and** rendered as `0s` by the card (`ActivityEvent.test.tsx`) — two layers.
- **PR2 Rust** (`transcript.rs` test module): `tool_result_preview` → `None` on empty; verbatim under caps (no marker); `> MAX_LINES` → 24 content lines + a separate marker line; `> MAX_BYTES` → byte-capped at a char boundary + marker line, total (content + newline + marker) ≤ `MAX_BYTES`; multibyte content never split mid-`char` (valid UTF-8, no panic); an array-of-`text`-blocks `content` is flattened and capped identically to a plain string (one array-shape case). `process_tool_result` → emitted event carries `result_preview` for a non-test Read/Bash; orphaned result → still no event; running → `None`. Existing transcript fixture tests still pass.
- **PR2 frontend**: `useAgentStatus` maps `resultPreview`; `toolCallsToEvents` copies it; card renders the `<pre>` when present and Copy includes it.
- **Bindings**: PR2 regenerates `AgentToolCallEvent.ts` (`resultPreview: string | null`) and commits it; if CI has a binding-drift check, it must pass. (Any brand-new `*.test.ts(x)` file needs explicit `vitest` imports per repo rule; these extend existing files.)
- **PR2 catch-up replay (R2)**: a transcript replay through `process_line` (multiple tool_use/tool_result completions) attaches a **bounded preview per completion**, so the catch-up burst is `N × ≤ MAX_BYTES`. Hundreds-scale throughput and event-queue stall are a **manual/perf** check (not unit-tested); steady-state frontend memory is bounded by the existing 50-entry `RECENT_TOOL_CALLS_LIMIT` slice.

### Risks & mitigations

| #   | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Sensitive output** — `resultPreview` newly surfaces tool-result content (incl. Read/Edit file previews) in the tooltip; not shown in the feed before, and not necessarily visible in the terminal (this is the §1 forward-ref).                                                                                                                                                                                                                                                                                                                                                           | Accepted this round, no redaction. Blast radius bounded by the small head cap (≤~4 KiB, first lines). Same data already lives in the local transcript/PTY. A redaction / opt-out is a noted follow-up; Codex previews stay off (`None`), so only Claude Code is affected.                                                                                                                                                                                                                                                                                                             |
| R2  | **Catch-up transport burst** — the Claude tailer replays the whole transcript on attach, emitting an `agent-tool-call` event per historical completion _before_ the frontend slices to 50. Adding `result_preview` makes each replayed completion event up to ~40× fatter (≤~4 KiB vs the ~100-char `args` today), so a long session's one-time catch-up burst is ≈ `4 KiB × completions` (e.g. ~2 MB at 500 completions) through the bounded stdout event queue — **not** capped by the frontend's 50-entry window (that bounds steady-state memory at ≤~200 KiB, and only after receipt). | Accept the one-time burst: the per-event head cap bounds each preview — the §5 replay-attach test asserts a bounded preview per completion — and the existing stdout event queue backpressures. Hundreds-scale throughput / queue-stall is a manual perf check, **not** unit-tested. If it profiles badly, the follow-up lever is **replay-aware emission** — suppress `result_preview` during the initial catch-up read and attach it only to live (post-EOF) events, mirroring the test-run emitter's latest-only replay batching — at the cost of preview-less rows on first open. |
| R3  | **ts-rs regen drift** — binding doesn't match expectation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | §4 verify-after-regen step; commit the regenerated `AgentToolCallEvent.ts`; rely on the `CostMetrics` `Option → \| null` precedent.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| R4  | **D6 sparse card** — edit `+/−`, bash counts, think/user never populate live, so the redesigned card looks emptier than the mockup.                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Documented (D6, render-when-present); reviewers warned. Wiring those producers is a separate follow-up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R5  | **Rust truncation bug** (panic / over-cap on multibyte).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Boundary-safe truncation (§4) + dedicated unit tests (above).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Rollback

PR2 is purely additive: reverting it returns `resultPreview` to always-`undefined`, and PR1's redesigned card degrades to the tier-1 body with no code change. The optional `ToolActivityEvent.resultPreview` field (PR1) is inert without PR2. PR1 is the load-bearing visual change; PR2 can be reverted independently.

### Open questions

- Preview caps (`24` lines / `4 KiB`) are first estimates — tune after observing real output density.
- A "show full output" affordance (expand beyond the preview) is explicitly out of scope; revisit if the preview proves too small.
- Codex result-preview extraction and live producers for diff/bashResult/think/user (D6) are tracked follow-ups, not part of this migration.
- The catch-up preview burst (R2) is accepted as a one-time cost; if profiling shows event-queue backpressure on very long transcripts, switch to replay-aware emission (live-only previews) — at the cost of preview-less rows on first open.

<!-- codex-reviewed: 2026-05-29T11:54:27Z -->
