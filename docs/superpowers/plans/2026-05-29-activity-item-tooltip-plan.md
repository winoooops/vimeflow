# Activity item tooltip migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the agent-status activity-feed hover tooltip to the structured, kind-aware card in `docs/design/activity-item-tooltip/ActivityTooltip.html`, fix the row's text-caret (I-beam) cursor, and forward a small head preview of Claude Code tool-result content so the card shows real command output / file previews.

**Architecture:** A 2-PR stack on `feat/activity-item-tooltip-migration`. **PR1** is frontend-only on tier-1 data (cursor fix + redesigned `ActivityTooltipContent`), and declares the optional `resultPreview` field so the card compiles. **PR2** forwards `result_preview` end-to-end: a new bounded head-preview extractor in the Rust Claude transcript parser → a new field on the shared `AgentToolCallEvent` (defaulted `None` at every other construction site) → ts-rs binding → `RecentToolCall` → `toolCallsToEvents` → the card's `<pre>`. Fields with no live data source degrade (render-when-present). Full design + rationale: `docs/superpowers/specs/2026-05-29-activity-item-tooltip-design.md`.

**Tech Stack:** React 19 + TypeScript (Vitest + Testing Library), Tailwind (Obsidian-Lens tokens), `@floating-ui/react` `<Tooltip>`; Rust transcript parser (`serde_json::Value`, ts-rs bindings under `cfg(test)`).

**Commit trailer:** every commit below must end with the `Co-Authored-By` trailer required by your execution environment, exactly once, per `rules/common/git-workflow.md` (e.g. `Co-Authored-By: codex <codex@openai.com>` for Codex-assisted commits). The `git commit` examples omit it for brevity.

---

## File structure

**PR1 (frontend only):**

- Modify: `src/features/agent-status/components/ActivityEvent.tsx` — row cursor; rewrite `ActivityTooltipContent` to the structured card; add `buildCopyText` + `isToolEvent`; pass `{ event, label, now }`.
- Modify: `src/features/agent-status/types/activityEvent.ts` — add `ToolActivityEvent.resultPreview?: string | null` (spec §4 step 5a).
- Modify: `src/features/agent-status/hooks/useAgentStatus.ts` — zero-duration mapper fix.
- Test: `src/features/agent-status/components/ActivityEvent.test.tsx`, `src/features/agent-status/hooks/useAgentStatus.test.ts`.

**PR2 (full-stack):**

- Modify: `crates/backend/src/agent/types.rs` — add `result_preview: Option<String>` to `AgentToolCallEvent`.
- Modify: `crates/backend/src/agent/adapter/claude_code/transcript.rs` — add `tool_result_preview`; populate at the done/failed site; `None` at the running site.
- Modify: `crates/backend/src/agent/adapter/codex/transcript.rs` — `result_preview: None` at all five sites.
- Modify: `src/bindings/AgentToolCallEvent.ts` — regenerated.
- Modify: `src/features/agent-status/types/index.ts` (`RecentToolCall`), `.../hooks/useAgentStatus.ts` (mapping), `.../utils/toolCallsToEvents.ts` (copy), `.../components/ActivityEvent.tsx` (render `<pre>`).
- Test: the Rust `transcript.rs` test module + the frontend test files above.

---

# PR1 — Frontend redesign + cursor (tier-1 data, no backend)

## Task 1: Row cursor + non-selectable (spec §2)

**Files:**

- Modify: `src/features/agent-status/components/ActivityEvent.tsx:274`
- Test: `src/features/agent-status/components/ActivityEvent.test.tsx`

- [ ] **Step 1: Write the failing test** — append to the `describe('ActivityEvent — basic row', …)` block in `ActivityEvent.test.tsx`:

```tsx
test('activity row uses a default cursor and is not text-selectable', () => {
  render(<ActivityEvent event={toolEvent()} now={now} />)
  const row = screen.getByRole('article', { name: 'EDIT' })

  expect(row).toHaveClass('cursor-default')
  expect(row).toHaveClass('select-none')
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/features/agent-status/components/ActivityEvent.test.tsx -t "default cursor"`
Expected: FAIL — element does not have class `cursor-default`.

- [ ] **Step 3: Add the classes** — in the `<article>` `className` (ActivityEvent.tsx:274), insert `cursor-default select-none` after `py-1`:

```tsx
className =
  'flex items-start gap-2 rounded-md py-1 cursor-default select-none outline-none focus-visible:ring-1 focus-visible:ring-primary-container'
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/features/agent-status/components/ActivityEvent.test.tsx -t "default cursor"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/agent-status/components/ActivityEvent.tsx src/features/agent-status/components/ActivityEvent.test.tsx
git commit -m "fix(agent-status): use default cursor on activity rows, not the text caret"
```

## Task 2: Zero-duration mapper fix (spec §3)

`useAgentStatus` maps `durationMs` with `Number(p.durationMs) || null`, turning a `0n` duration into `null` (drops the `0s` chip). `AgentToolCallEvent.durationMs` is a non-null `bigint`, so map it directly.

**Files:**

- Modify: `src/features/agent-status/hooks/useAgentStatus.ts:537`
- Test: `src/features/agent-status/hooks/useAgentStatus.test.ts`

- [ ] **Step 1: Write the failing test** — add inside `describe('useAgentStatus', …)` (the `emit`, `renderHook`, fake-timers harness already exists at the top of the file):

```tsx
test('maps a 0 ms completed tool call to durationMs 0 (not null)', async () => {
  const { result } = renderHook(() => useAgentStatus('session-1'))
  await vi.waitFor(() => {
    expect(listen).toHaveBeenCalledWith('agent-tool-call', expect.any(Function))
  })

  act(() => {
    emit('agent-tool-call', {
      sessionId: 'pty-session-1',
      toolUseId: 'toolu_zero',
      tool: 'Bash',
      args: 'true',
      status: 'done',
      timestamp: '2026-04-22T12:00:00Z',
      durationMs: 0n,
      isTestFile: false,
    })
  })

  expect(result.current.recentToolCalls[0]?.durationMs).toBe(0)
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/features/agent-status/hooks/useAgentStatus.test.ts -t "0 ms completed"`
Expected: FAIL — received `null`, expected `0`.

- [ ] **Step 3: Fix the mapper** — at `useAgentStatus.ts:537`, change:

```ts
durationMs: Number(p.durationMs) || null,
```

to:

```ts
// durationMs is a non-null bigint on the wire; `|| null` would coerce a
// legitimate 0 ms duration to null and drop the "0s" chip. Map directly.
durationMs: Number(p.durationMs),
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/features/agent-status/hooks/useAgentStatus.test.ts -t "0 ms completed"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/agent-status/hooks/useAgentStatus.ts src/features/agent-status/hooks/useAgentStatus.test.ts
git commit -m "fix(agent-status): preserve 0 ms tool-call durations in the activity feed"
```

## Task 3: Declare the optional `resultPreview` field (spec §4 step 5a)

Lands in PR1 so Task 4/5's preview-aware code typechecks against the union; always `undefined` until PR2 populates it.

**Files:**

- Modify: `src/features/agent-status/types/activityEvent.ts:27-33`

- [ ] **Step 1: Add the field** to the `ToolActivityEvent` interface:

```ts
export interface ToolActivityEvent extends BaseActivityEvent {
  kind: 'edit' | 'bash' | 'read' | 'write' | 'grep' | 'glob' | 'meta'
  tool: string
  durationMs: number | null
  diff?: { added: number; removed: number }
  bashResult?: { passed: number; total: number }
  /**
   * Small head preview of the tool_result content, for the activity
   * tooltip body. Populated by the producer in PR2; always undefined in
   * PR1 (the card degrades to the tier-1 body when absent). Tool events
   * only — Think/User never carry it.
   */
  resultPreview?: string | null
}
```

- [ ] **Step 2: Type-check** — no test yet (type-only change).

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/agent-status/types/activityEvent.ts
git commit -m "feat(agent-status): declare optional resultPreview on ToolActivityEvent"
```

## Task 4: `buildCopyText` + `isToolEvent` helpers (spec §3)

**Files:**

- Modify: `src/features/agent-status/components/ActivityEvent.tsx` (add near the existing `writeClipboardText` helper)
- Test: `src/features/agent-status/components/ActivityEvent.test.tsx`

- [ ] **Step 1: Write the failing tests** — new `describe` block in `ActivityEvent.test.tsx`. (`buildCopyText` is internal; assert it through Copy behavior — extend the existing copy test, and add a preview case using an event with `resultPreview`.)

```tsx
test('Copy copies body alone when there is no resultPreview', async () => {
  const user = userEvent.setup()
  const writeText = vi.fn().mockResolvedValue(undefined)
  setClipboard({ writeText })

  render(
    <ActivityEvent
      event={toolEvent({ kind: 'bash', tool: 'Bash', body: 'pnpm test' })}
      now={now}
    />
  )
  fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))
  const details = await screen.findByRole('dialog', {
    name: 'BASH activity details',
  })
  await user.click(
    within(details).getByRole('button', { name: 'Copy activity details' })
  )

  expect(writeText).toHaveBeenCalledWith('pnpm test')
})

test('Copy joins body and resultPreview when present', async () => {
  const user = userEvent.setup()
  const writeText = vi.fn().mockResolvedValue(undefined)
  setClipboard({ writeText })

  render(
    <ActivityEvent
      event={toolEvent({
        kind: 'bash',
        tool: 'Bash',
        body: 'pnpm test',
        resultPreview: '✓ 4 passed',
      })}
      now={now}
    />
  )
  fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))
  const details = await screen.findByRole('dialog', {
    name: 'BASH activity details',
  })
  await user.click(
    within(details).getByRole('button', { name: 'Copy activity details' })
  )

  expect(writeText).toHaveBeenCalledWith('pnpm test\n\n✓ 4 passed')
})
```

- [ ] **Step 2: Run, verify they fail** (they need the rewritten component from Task 5; failing for now is expected)

Run: `npx vitest run src/features/agent-status/components/ActivityEvent.test.tsx -t "Copy "`
Expected: FAIL.

- [ ] **Step 3: Add the helpers** near the top of `ActivityEvent.tsx` (after the `import` of `ActivityEventType` / before `ActivityTooltipContent`):

```tsx
const isToolEvent = (event: ActivityEventType): event is ToolActivityEvent =>
  'tool' in event

const buildCopyText = (event: ActivityEventType): string =>
  'resultPreview' in event && event.resultPreview
    ? `${event.body}\n\n${event.resultPreview}`
    : event.body
```

Add `ToolActivityEvent` to the existing type import:

```tsx
import type {
  ActivityEvent as ActivityEventType,
  ActivityEventKind,
  ToolActivityEvent,
} from '../types/activityEvent'
```

(These tests pass once Task 5 wires `buildCopyText` into the component.)

- [ ] **Step 4: Commit with Task 5** (helpers + component land together so the file compiles).

## Task 5: Rewrite `ActivityTooltipContent` to the structured card (spec §3)

**Files:**

- Modify: `src/features/agent-status/components/ActivityEvent.tsx` (replace `ActivityTooltipContentProps` + `ActivityTooltipContent`; update the call site in `ActivityEvent`)
- Test: `src/features/agent-status/components/ActivityEvent.test.tsx`

- [ ] **Step 1: Write the failing tests** — new `describe('ActivityEvent — structured tooltip', …)`:

```tsx
test('tooltip header shows the kind tag and an OK chip for a done tool call', async () => {
  render(
    <ActivityEvent
      event={toolEvent({ kind: 'bash', tool: 'Bash', status: 'done' })}
      now={now}
    />
  )
  fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))
  const details = await screen.findByRole('dialog', {
    name: 'BASH activity details',
  })

  expect(within(details).getByText('BASH')).toBeInTheDocument()
  expect(within(details).getByText('OK')).toBeInTheDocument()
})

test('failed tool call shows FAILED; running shows RUNNING (in the tooltip)', async () => {
  const { rerender } = render(
    <ActivityEvent
      event={toolEvent({ kind: 'bash', tool: 'Bash', status: 'failed' })}
      now={now}
    />
  )
  fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))
  // Scope to the dialog: the row's own status pill also renders "FAILED".
  const failed = await screen.findByRole('dialog', {
    name: 'BASH activity details',
  })
  expect(within(failed).getByText('FAILED')).toBeInTheDocument()

  rerender(
    <ActivityEvent
      event={{
        id: 'r',
        kind: 'bash',
        tool: 'Bash',
        body: 'pnpm test',
        timestamp: '2026-04-22T11:59:52Z',
        status: 'running',
        durationMs: null,
      }}
      now={now}
    />
  )
  fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))
  const running = await screen.findByRole('dialog', {
    name: 'BASH activity details',
  })
  expect(within(running).getByText('RUNNING')).toBeInTheDocument()
})

test('bash card appends passed/total when bashResult is present', async () => {
  render(
    <ActivityEvent
      event={toolEvent({
        kind: 'bash',
        tool: 'Bash',
        status: 'done',
        bashResult: { passed: 4, total: 4 },
      })}
      now={now}
    />
  )
  fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))
  // Scope to the dialog: the row's own status pill also renders "OK 4/4".
  const details = await screen.findByRole('dialog', {
    name: 'BASH activity details',
  })
  expect(within(details).getByText('OK 4/4')).toBeInTheDocument()
})

test('think card renders no status chip', async () => {
  render(
    <ActivityEvent
      event={{
        id: 'th',
        kind: 'think',
        body: 'considering options',
        timestamp: '2026-04-22T11:59:42Z',
        status: 'done',
      }}
      now={now}
    />
  )
  fireEvent.focus(screen.getByRole('article', { name: 'THINK' }))
  const details = await screen.findByRole('dialog', {
    name: 'THINK activity details',
  })
  expect(within(details).queryByText('OK')).not.toBeInTheDocument()
  expect(within(details).getByText('considering options')).toBeInTheDocument()
})

test('no resultPreview → no output pre block', async () => {
  render(
    <ActivityEvent
      event={toolEvent({ kind: 'read', tool: 'Read', body: 'src/x.ts' })}
      now={now}
    />
  )
  fireEvent.focus(screen.getByRole('article', { name: 'READ' }))
  const details = await screen.findByRole('dialog', {
    name: 'READ activity details',
  })
  // eslint-disable-next-line testing-library/no-node-access -- assert the <pre> output block is absent
  expect(details.querySelector('pre')).toBeNull()
})

test('renders 0s for a 0 ms completed tool call', async () => {
  render(
    <ActivityEvent
      event={toolEvent({
        kind: 'bash',
        tool: 'Bash',
        status: 'done',
        durationMs: 0,
      })}
      now={now}
    />
  )
  fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))
  expect(await screen.findByText('0s')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run, verify they fail**

Run: `npx vitest run src/features/agent-status/components/ActivityEvent.test.tsx -t "structured tooltip"`
Expected: FAIL.

- [ ] **Step 3: Replace `ActivityTooltipContentProps` + `ActivityTooltipContent`** with the structured card. Keep `CopyState`, `writeClipboardText`, `COPY_FEEDBACK_MS` as they are:

```tsx
interface ActivityTooltipContentProps {
  event: ActivityEventType
  label: string
  now: Date
}

const StatusChip = ({ event }: { event: ToolActivityEvent }): ReactElement => {
  if (event.status === 'running') {
    return (
      <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-on-surface-variant">
        RUNNING
      </span>
    )
  }
  const ok = event.status === 'done'
  const counts =
    event.kind === 'bash' && event.bashResult
      ? ` ${event.bashResult.passed}/${event.bashResult.total}`
      : ''
  const palette = ok
    ? 'bg-success/[0.12] text-success'
    : 'bg-error/[0.12] text-error'

  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ${palette}`}
    >
      {(ok ? 'OK' : 'FAILED') + counts}
    </span>
  )
}

const TooltipBody = ({ event }: { event: ActivityEventType }): ReactElement => {
  const preview = isToolEvent(event) ? event.resultPreview : undefined
  const bodyClass =
    event.kind === 'think'
      ? 'text-xs text-on-surface italic'
      : event.kind === 'user'
        ? 'text-xs text-on-surface'
        : 'text-xs text-on-surface font-mono break-words'

  return (
    <div className="flex flex-col gap-2">
      <span className={bodyClass}>{event.body}</span>
      {preview ? (
        <pre className="thin-scrollbar max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-container/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-on-surface">
          {preview}
        </pre>
      ) : null}
    </div>
  )
}

const ActivityTooltipContent = ({
  event,
  label,
  now,
}: ActivityTooltipContentProps): ReactElement => {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const copyText = buildCopyText(event)

  useEffect(() => {
    setCopyState('idle')
  }, [copyText])

  useEffect(() => {
    if (copyState === 'idle') {
      return
    }
    const id = window.setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_MS)

    return (): void => window.clearTimeout(id)
  }, [copyState])

  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      await writeClipboardText(copyText)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }, [copyText])

  const copyButtonLabel =
    copyState === 'copied'
      ? 'Copied activity details'
      : copyState === 'failed'
        ? 'Copy failed, try again'
        : 'Copy activity details'
  const copyFeedback =
    copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : ''

  const isRunning = event.status === 'running'
  const ago = isRunning
    ? `running ${formatDuration(Math.max(0, now.getTime() - new Date(event.timestamp).getTime()))}`
    : formatRelativeTime(event.timestamp, now)
  const duration =
    isToolEvent(event) && !isRunning && event.durationMs != null
      ? formatDuration(event.durationMs)
      : null
  const diff =
    (event.kind === 'edit' || event.kind === 'write') && event.diff
      ? event.diff
      : null

  return (
    <div className="w-[min(30rem,calc(100vw-2rem))]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant">
            {label}
          </span>
          <span className="text-[9px] font-mono text-outline">{ago}</span>
          {duration ? (
            <span className="text-[9px] font-mono text-outline">
              {duration}
            </span>
          ) : null}
          {isToolEvent(event) ? <StatusChip event={event} /> : null}
          {diff ? (
            <span className="flex items-center gap-1.5 text-[9px] font-mono">
              <span className="text-success">+{diff.added}</span>
              <span className="text-error">−{diff.removed}</span>
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            aria-live="polite"
            className="min-w-10 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant"
          >
            {copyFeedback}
          </span>
          <button
            type="button"
            aria-label={copyButtonLabel}
            onClick={(): void => {
              void handleCopy()
            }}
            className="inline-flex h-6 items-center gap-1 rounded-md bg-on-surface/10 px-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant transition-colors hover:bg-on-surface/15 hover:text-on-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
          >
            <span
              className="material-symbols-outlined text-sm"
              aria-hidden="true"
            >
              {copyState === 'copied' ? 'check' : 'content_copy'}
            </span>
            Copy
          </button>
        </div>
      </div>
      <TooltipBody event={event} />
    </div>
  )
}
```

- [ ] **Step 4: Update the call site** in `ActivityEvent` (the `<Tooltip content=…>` prop, ~line 259):

```tsx
<Tooltip
  content={<ActivityTooltipContent event={event} label={label} now={now} />}
  placement="left"
  maxWidth={520}
  interactive
  ariaLabel={`${label} activity details`}
  className="p-3"
>
```

- [ ] **Step 5: Run the full file, verify all pass** (Task 4 + Task 5 tests + existing tests still green)

Run: `npx vitest run src/features/agent-status/components/ActivityEvent.test.tsx`
Expected: PASS. Then `npm run type-check` and `npm run lint` — PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/agent-status/components/ActivityEvent.tsx src/features/agent-status/components/ActivityEvent.test.tsx
git commit -m "feat(agent-status): redesign the activity tooltip as a structured kind-aware card"
```

> **PR1 boundary.** Open PR1 (`feat(agent-status): redesign activity tooltip and fix row cursor`) against `feat/activity-item-tooltip-migration`. Tasks 6–10 are PR2.

---

# PR2 — Forward `resultPreview` end-to-end (full-stack)

## Task 6: `tool_result_preview` extractor (spec §4 step 2)

**Files:**

- Modify: `crates/backend/src/agent/adapter/claude_code/transcript.rs` (add near `extract_tool_result_content`, line ~774; reuse existing `text_block_type` / `text_block_text` / `TOOL_RESULT_TRUNCATED_MARKER`)

- [ ] **Step 1: Write the failing tests** in the `transcript.rs` `#[cfg(test)] mod tests`:

```rust
#[test]
fn tool_result_preview_none_on_empty() {
    assert_eq!(tool_result_preview(&serde_json::json!({})), None);
    assert_eq!(tool_result_preview(&serde_json::json!({ "content": "" })), None);
}

#[test]
fn tool_result_preview_returns_short_content_verbatim() {
    let v = serde_json::json!({ "content": "line 1\nline 2" });
    assert_eq!(tool_result_preview(&v), Some("line 1\nline 2".to_string()));
}

#[test]
fn tool_result_preview_caps_lines_and_marks() {
    let many = (0..100).map(|i| format!("line {i}")).collect::<Vec<_>>().join("\n");
    let out = tool_result_preview(&serde_json::json!({ "content": many })).unwrap();
    // 24 content lines + 1 marker line.
    assert_eq!(out.lines().filter(|l| *l != TOOL_RESULT_TRUNCATED_MARKER).count(), 24);
    assert!(out.ends_with(TOOL_RESULT_TRUNCATED_MARKER));
    assert!(out.len() <= TOOL_RESULT_PREVIEW_MAX_BYTES);
}

#[test]
fn tool_result_preview_caps_bytes_on_char_boundary() {
    // Multibyte content far larger than the byte cap must not panic and
    // must stay valid UTF-8 within the cap.
    let big = "é".repeat(TOOL_RESULT_PREVIEW_MAX_BYTES);
    let out = tool_result_preview(&serde_json::json!({ "content": big })).unwrap();
    assert!(out.len() <= TOOL_RESULT_PREVIEW_MAX_BYTES);
    assert!(out.ends_with(TOOL_RESULT_TRUNCATED_MARKER));
    assert!(std::str::from_utf8(out.as_bytes()).is_ok());
}

#[test]
fn tool_result_preview_handles_text_block_array() {
    let v = serde_json::json!({
        "content": [
            { "type": "text", "text": "first block" },
            { "type": "text", "text": "second block" }
        ]
    });
    assert_eq!(tool_result_preview(&v), Some("first block\nsecond block".to_string()));
}

#[test]
fn tool_result_preview_keeps_near_cap_content_unmarked() {
    // Content just under the byte cap (single line) must be returned verbatim
    // — no false [output truncated] marker from pre-reserving marker bytes.
    let near = "a".repeat(TOOL_RESULT_PREVIEW_MAX_BYTES - 1);
    let out = tool_result_preview(&serde_json::json!({ "content": near })).unwrap();
    assert_eq!(out.len(), TOOL_RESULT_PREVIEW_MAX_BYTES - 1);
    assert!(!out.contains(TOOL_RESULT_TRUNCATED_MARKER));
}
```

- [ ] **Step 2: Run, verify they fail**

Run: `cargo test --manifest-path crates/backend/Cargo.toml tool_result_preview`
Expected: FAIL — `tool_result_preview` not found.

- [ ] **Step 3: Implement the extractor** (near `extract_tool_result_content`):

```rust
const TOOL_RESULT_PREVIEW_MAX_LINES: usize = 24;
const TOOL_RESULT_PREVIEW_MAX_BYTES: usize = 4 * 1024;

/// First-N-lines / first-N-bytes head preview of a tool_result, for the
/// activity tooltip. Caps while collecting (never materialises the full
/// content) and truncates only on char boundaries. The marker line is added —
/// and the head trimmed to make room — ONLY when truncation actually occurs,
/// so content at or under the caps is returned verbatim. None when empty.
fn tool_result_preview(value: &Value) -> Option<String> {
    let content = value.get("content")?;
    let mut head = String::new();
    let mut lines = 0usize;
    let mut truncated = false;

    // Push whole `char`s (never mid-codepoint) up to the FULL caps. Returns
    // false once a cap is hit.
    fn take(s: &str, head: &mut String, lines: &mut usize, truncated: &mut bool) -> bool {
        for ch in s.chars() {
            if *lines >= TOOL_RESULT_PREVIEW_MAX_LINES
                || head.len() + ch.len_utf8() > TOOL_RESULT_PREVIEW_MAX_BYTES
            {
                *truncated = true;
                return false;
            }
            head.push(ch);
            if ch == '\n' {
                *lines += 1;
            }
        }
        true
    }

    if let Some(s) = content.as_str() {
        take(s, &mut head, &mut lines, &mut truncated);
    } else if let Some(arr) = content.as_array() {
        for block in arr {
            if text_block_type(block) != Some("text") {
                continue;
            }
            let Some(text) = text_block_text(block) else {
                continue;
            };
            if !head.is_empty()
                && !head.ends_with('\n')
                && !take("\n", &mut head, &mut lines, &mut truncated)
            {
                break;
            }
            if !take(text, &mut head, &mut lines, &mut truncated) {
                break;
            }
        }
    }

    if head.is_empty() {
        return None;
    }

    // Only on real truncation: trim the head to a char boundary that leaves
    // room for "\n" + marker, so head + marker line stays <= MAX_BYTES.
    // Under-cap content is returned verbatim (no trim, no marker).
    if truncated {
        let reserve = "\n".len() + TOOL_RESULT_TRUNCATED_MARKER.len();
        let limit = TOOL_RESULT_PREVIEW_MAX_BYTES.saturating_sub(reserve);
        let mut cut = limit.min(head.len());
        while cut > 0 && !head.is_char_boundary(cut) {
            cut -= 1;
        }
        head.truncate(cut);
        if !head.ends_with('\n') {
            head.push('\n');
        }
        head.push_str(TOOL_RESULT_TRUNCATED_MARKER);
    }

    Some(head)
}
```

- [ ] **Step 4: Run, verify they pass**

Run: `cargo test --manifest-path crates/backend/Cargo.toml tool_result_preview`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/agent/adapter/claude_code/transcript.rs
git commit -m "feat(agent): add bounded head-preview extractor for tool results"
```

## Task 7: Add `result_preview` to the event + populate / default it (spec §4 steps 1, 3, 4)

**Files:**

- Modify: `crates/backend/src/agent/types.rs:309`
- Modify: `crates/backend/src/agent/adapter/claude_code/transcript.rs` (sites 497, 630)
- Modify: `crates/backend/src/agent/adapter/codex/transcript.rs` (sites 429, 479, 527, 605, 647)
- Modify: `src/bindings/AgentToolCallEvent.ts` (regenerated)

- [ ] **Step 1: Add the struct field** to `AgentToolCallEvent` (after `is_test_file`):

```rust
    /// Small head preview of the tool_result content (first lines), for the
    /// activity tooltip. None for running calls, Codex tool calls (this
    /// round), and completions whose flattened result content is empty.
    pub result_preview: Option<String>,
```

- [ ] **Step 2: Run the build to enumerate every broken construction site**

Run: `cargo build --manifest-path crates/backend/Cargo.toml`
Expected: `error[E0063]: missing field \`result_preview\``at`claude_code/transcript.rs:497, 630`and`codex/transcript.rs:429, 479, 527, 605, 647`(plus any Rust test builders). To list just the sites:`cargo build --manifest-path crates/backend/Cargo.toml 2>&1 | grep -nE "missing field.\*result_preview"`.

- [ ] **Step 3: Default `None` at every construction site so the crate compiles** — claude_code/transcript.rs:497 (running) and :630 (done/failed), all five `codex/transcript.rs` sites, and any Rust test builders. Each named-field literal gets:

```rust
        result_preview: None,
```

This compiles, but leaves the done/failed site emitting no preview — the next step's test fails on exactly that.

- [ ] **Step 4: Write the populate test (red)** in the `transcript.rs` test module, using the file's existing `make_sink_and_emitter()` harness. `sink.recorded()` returns `Vec<(String, serde_json::Value)>` of emitted `(event_name, payload)`; the tool-call event name is the literal `"agent-tool-call"` and payload keys are camelCase:

```rust
#[test]
fn process_tool_result_attaches_result_preview() {
    let (sink, sink_dyn, mut emitter) = make_sink_and_emitter();
    let mut in_flight = InFlightToolCalls::new();
    in_flight.insert(
        "toolu_x".to_string(),
        InFlightToolCall {
            started_at: std::time::Instant::now(),
            started_at_iso: "2026-04-22T12:00:00Z".to_string(),
            tool: "Bash".to_string(),
            args: "echo hi".to_string(),
            is_test_file: false,
            test_match: None,
        },
    );
    let value = json!({
        "type": "tool_result",
        "tool_use_id": "toolu_x",
        "content": "hi\nthere",
        "is_error": false
    });

    process_tool_result(
        &value, "pty-1", None, &sink_dyn, &mut emitter, &mut in_flight,
        "2026-04-22T12:00:01Z",
    );

    let recorded = sink.recorded();
    let (_, payload) = recorded
        .iter()
        .find(|(name, _)| name == "agent-tool-call")
        .expect("agent-tool-call event");
    assert_eq!(payload["resultPreview"].as_str(), Some("hi\nthere"));
}
```

Run: `cargo test --manifest-path crates/backend/Cargo.toml process_tool_result_attaches`
Expected: FAIL — `resultPreview` is `null` (the done/failed site still defaults to `None`).

- [ ] **Step 5: Populate the done/failed site (green)** — in `process_tool_result` (~line 630), compute the preview from the `value` it already holds (independently of the `call.test_match` branch) and set it on the emitted event, replacing that site's `result_preview: None`:

```rust
    let result_preview = tool_result_preview(value);
    let event = AgentToolCallEvent {
        session_id: session_id.to_string(),
        tool_use_id,
        tool: tool_name,
        args,
        status,
        timestamp: timestamp.to_string(),
        duration_ms,
        is_test_file,
        result_preview,
    };
```

Run: `cargo test --manifest-path crates/backend/Cargo.toml process_tool_result_attaches`
Expected: PASS.

- [ ] **Step 6: Run backend tests, then regenerate + format bindings LAST**

Full `cargo test` re-runs the ts-rs `export_bindings` test and rewrites `src/bindings/` **raw**, so the Prettier formatting step must come **after** it:

1. `cargo test --manifest-path crates/backend/Cargo.toml` — unit tests + raw binding export.
2. `npm run generate:bindings` (= `cargo test … export_bindings && prettier --write src/bindings/`) — re-export then **format**, run last so nothing rewrites the bindings after Prettier.

Verify: `src/bindings/AgentToolCallEvent.ts` contains `resultPreview: string | null`, and `git diff --stat src/bindings/` shows only that intended addition (no formatting churn).

- [ ] **Step 7: Commit**

Review `git diff --cached` first (a dirty worktree may hold unrelated adapter edits), then stage the touched files explicitly:

```bash
git add crates/backend/src/agent/types.rs \
  crates/backend/src/agent/adapter/claude_code/transcript.rs \
  crates/backend/src/agent/adapter/codex/transcript.rs \
  src/bindings/AgentToolCallEvent.ts
git commit -m "feat(agent): forward a tool-result preview on agent-tool-call events"
```

## Task 8: Thread `resultPreview` through the frontend pipeline (spec §4 steps 5b–5d)

**Files:**

- Modify: `src/features/agent-status/types/index.ts:166-179` (`RecentToolCall`)
- Modify: `src/features/agent-status/hooks/useAgentStatus.ts:532-540` (mapping)
- Modify: `src/features/agent-status/utils/toolCallsToEvents.ts:75-86` (copy)
- Test: `useAgentStatus.test.ts`, `toolCallsToEvents.test.ts`

- [ ] **Step 1: Write the failing tests**

In `useAgentStatus.test.ts`:

```tsx
test('maps resultPreview from the agent-tool-call event', async () => {
  const { result } = renderHook(() => useAgentStatus('session-1'))
  await vi.waitFor(() => {
    expect(listen).toHaveBeenCalledWith('agent-tool-call', expect.any(Function))
  })
  act(() => {
    emit('agent-tool-call', {
      sessionId: 'pty-session-1',
      toolUseId: 't1',
      tool: 'Read',
      args: 'a.ts',
      status: 'done',
      timestamp: '2026-04-22T12:00:00Z',
      durationMs: 5n,
      isTestFile: false,
      resultPreview: 'file head',
    })
  })
  expect(result.current.recentToolCalls[0]?.resultPreview).toBe('file head')
})
```

In `toolCallsToEvents.test.ts`:

```ts
test('copies resultPreview onto the produced tool event', () => {
  const events = toolCallsToEvents(null, [
    {
      id: 't1',
      tool: 'Read',
      args: 'a.ts',
      status: 'done',
      durationMs: 5,
      timestamp: '2026-04-22T12:00:00Z',
      isTestFile: false,
      resultPreview: 'preview',
    },
  ])
  expect(events[0]).toMatchObject({ resultPreview: 'preview' })
})
```

- [ ] **Step 2: Run, verify they fail**

Run: `npx vitest run src/features/agent-status/hooks/useAgentStatus.test.ts src/features/agent-status/utils/toolCallsToEvents.test.ts -t resultPreview`
Expected: FAIL.

- [ ] **Step 3: Implement.** `RecentToolCall` (`types/index.ts`), add (optional — keeps existing fixtures compiling):

```ts
  resultPreview?: string | null
```

`useAgentStatus.ts` done/failed mapping (~line 539, in the `recentCall` object literal), add:

```ts
      resultPreview: p.resultPreview ?? null,
```

`toolCallsToEvents.ts` recent loop (~line 85, in the pushed object), add:

```ts
      resultPreview: r.resultPreview,
```

- [ ] **Step 4: Run, verify they pass**

Run: `npx vitest run src/features/agent-status/hooks/useAgentStatus.test.ts src/features/agent-status/utils/toolCallsToEvents.test.ts`
Expected: PASS. Then `npm run type-check` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/agent-status/types/index.ts src/features/agent-status/hooks/useAgentStatus.ts src/features/agent-status/utils/toolCallsToEvents.ts src/features/agent-status/hooks/useAgentStatus.test.ts src/features/agent-status/utils/toolCallsToEvents.test.ts
git commit -m "feat(agent-status): carry resultPreview through the activity pipeline"
```

## Task 9: Render the preview `<pre>` (PR2 UI, spec §3)

The card already renders `<pre>` when `resultPreview` is present (Task 5's `TooltipBody`). Now that the producer populates it, add the end-to-end render + copy tests.

**Files:**

- Test: `src/features/agent-status/components/ActivityEvent.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
test('renders the output pre block when resultPreview is present', async () => {
  render(
    <ActivityEvent
      event={toolEvent({
        kind: 'bash',
        tool: 'Bash',
        body: 'pnpm test',
        resultPreview: '✓ 4 passed\n✗ 0 failed',
      })}
      now={now}
    />
  )
  fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))
  const details = await screen.findByRole('dialog', {
    name: 'BASH activity details',
  })
  expect(within(details).getByText(/4 passed/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run, verify it passes** (Task 5 already implements the rendering)

Run: `npx vitest run src/features/agent-status/components/ActivityEvent.test.tsx -t "output pre block"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/agent-status/components/ActivityEvent.test.tsx
git commit -m "test(agent-status): cover resultPreview rendering in the activity tooltip"
```

## Task 10: Replay parse attaches a bounded preview per completion (spec §5 R2)

Spec §5 R2 accepts the one-time catch-up burst (one preview per historical completion on attach) and bounds it **per event**. This test drives the real replay parse entrypoint — `process_line` over assistant `tool_use` + user `tool_result` pairs, exactly as the file tailer replays a transcript — and asserts every emitted completion carries a bounded preview, so the burst is `N × ≤ MAX_BYTES`, never unbounded. (Hundreds-scale throughput / event-queue stall is a perf/manual concern, not unit-tested; steady-state frontend memory is bounded separately by the existing `RECENT_TOOL_CALLS_LIMIT` 50-slice in `useAgentStatus`. The per-event helper cap is covered by Task 6.)

**Files:**

- Test: `crates/backend/src/agent/adapter/claude_code/transcript.rs` test module

- [ ] **Step 1: Write the test**

```rust
#[test]
fn replay_parse_attaches_bounded_preview_per_completion() {
    let (sink, sink_dyn, mut emitter) = make_sink_and_emitter();
    let mut in_flight = InFlightToolCalls::new();
    let mut num_turns = 0_u32;
    let mut last_cwd = None;
    let mut last_title = None;
    let huge = "x".repeat(1024 * 1024);

    for i in 0..3 {
        let id = format!("toolu_{i}");
        let assistant = serde_json::to_string(&json!({
            "type": "assistant",
            "message": { "content": [
                { "type": "tool_use", "id": id, "name": "Bash", "input": { "command": "cmd" } }
            ] }
        }))
        .unwrap();
        let user = serde_json::to_string(&json!({
            "type": "user",
            "message": { "content": [
                { "type": "tool_result", "tool_use_id": id, "content": huge, "is_error": false }
            ] }
        }))
        .unwrap();

        for line in [assistant.as_str(), user.as_str()] {
            process_line(
                line, "pty-1", None, &sink_dyn, &mut emitter, &mut in_flight,
                &mut num_turns, &mut last_cwd, "agent-1", &mut last_title,
            );
        }
    }

    let recorded = sink.recorded();
    let completions: Vec<_> = recorded
        .iter()
        .filter(|(name, payload)| name == "agent-tool-call" && payload["status"] == "done")
        .collect();
    assert_eq!(completions.len(), 3);
    for (_, payload) in completions {
        let preview = payload["resultPreview"]
            .as_str()
            .expect("every replayed completion must carry a result preview");
        assert!(
            preview.len() <= TOOL_RESULT_PREVIEW_MAX_BYTES,
            "the preview must stay within the per-event cap"
        );
    }
}
```

- [ ] **Step 2: Run, verify it passes**

Run: `cargo test --manifest-path crates/backend/Cargo.toml replay_parse_attaches_bounded`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add crates/backend/src/agent/adapter/claude_code/transcript.rs
git commit -m "test(agent): assert replay parse attaches a bounded preview per completion"
```

> **PR2 boundary.** Open PR2 (`feat(agent-status): forward tool-result preview to the activity tooltip`) against `feat/activity-item-tooltip-migration`, stacked on PR1. After both merge to the integration branch, open the integration → `main` PR.

---

## Final verification (run before each PR)

- `npm run type-check` — PASS
- `npm run lint` — PASS
- `npm run format:check` — PASS
- `npm run test` — PASS (frontend)
- **PR2 backend (Rust), run in this order** (order matters — full `cargo test` rewrites the bindings raw, so Prettier must come last):
  1. `cargo test --manifest-path crates/backend/Cargo.toml` — unit tests + raw binding export
  2. `cargo fmt --check` and `cargo clippy --quiet -- -D warnings` for the backend crate (the Rust gates from `rules/rust/hooks.md`)
  3. `npm run generate:bindings` — re-export + Prettier (**format bindings last**)
  4. `git diff --exit-code src/bindings/` — clean (only the intended `resultPreview` addition)
- `npm run build` — PASS

<!-- codex-reviewed: 2026-05-29T11:54:27Z -->
