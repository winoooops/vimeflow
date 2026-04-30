# Token Cache Block — Design Spec

**Date:** 2026-04-30
**Status:** Approved (brainstorming complete; harness Phase 2 implementation pending)
**Author:** Claude (with Will)
**Related:** Vimeflow Claude Design `Vimeflow.html` (project ID `e9c4e751-f5ca-40eb-9ce7-611948803ce4`)

## 1. Why

The right activity panel currently surfaces context-window usage, cost, rate limits, tool calls, file changes, and test results — but not how efficiently the agent is using prompt caching. Prompt caching is the single largest cost lever in a Claude Code session: cache reads cost ~10% of normal input, cache creations cost ~125%, and uncached fresh input costs the full price. A session with a degrading cache hit rate is one that's burning budget for no reason, and the user often doesn't notice until rate-limit pressure is already high.

This block surfaces that signal in the activity panel using the canonical Anthropic prompt-caching formula and the data Claude Code already emits in its statusline JSON.

## 2. Canonical formula

Per the Anthropic Messages API reference, the three additive input-token buckets are:

```
total_input_tokens
  = input_tokens                  // uncached fresh input
  + cache_creation_input_tokens   // tokens written to cache (~1.25× cost)
  + cache_read_input_tokens       // tokens read from cache (~0.1× cost)
```

The cache hit rate is the fraction of total input that came from cache:

```
cache_hit_rate = cache_read_input_tokens / total_input_tokens
```

Returns `null` when `total_input_tokens === 0` (the empty / "no data yet" state). This is the only formula the block uses — for the headline percentage, the stack-bar segment widths, and the tone-coded headline color.

## 3. Existing data flow + the gap to close

**What already works (no changes needed):**

```
Claude Code writes statusline.json on every turn
  └── notify watcher — src-tauri/src/agent/watcher.rs:198, 238, 277
       └── parse_statusline() — src-tauri/src/agent/statusline.rs:24-90
            └── ParsedStatusline { event: AgentStatusEvent, … } with current_usage populated
                 └── tauri::emit("agent-status", AgentStatusEvent)
                      └── useAgentStatus listens, payload arrives with p.contextWindow.currentUsage
```

The Rust side, the wire format, and the TS binding (`src/bindings/CurrentUsage.ts`) all already carry the four canonical fields. **No Rust work is required for this feature.**

**The gap:** `useAgentStatus` normalizes the wire payload into `AgentStatus`, and that normalization (`src/features/agent-status/hooks/useAgentStatus.ts:221-228`) only copies four fields out of `p.contextWindow`:

```ts
// Current code — currentUsage is silently dropped:
contextWindow: p.contextWindow
  ? {
      usedPercentage: p.contextWindow.usedPercentage ?? 0,
      contextWindowSize: Number(p.contextWindow.contextWindowSize),
      totalInputTokens: Number(p.contextWindow.totalInputTokens),
      totalOutputTokens: Number(p.contextWindow.totalOutputTokens),
    }
  : prev.contextWindow,
```

The downstream `ContextWindowState` interface at `src/features/agent-status/types/index.ts:89-94` matches — no `currentUsage` field. So consumers of `useAgentStatus` cannot see the cache numbers today, even though they are flowing on the wire and parsed correctly by Rust. **Closing this gap is Phase 1, Feature 1.**

## 4. Component anatomy

```
TokenCache (root, mounted in AgentStatusPanel between ContextBucket and the scrollable region)
├── Header           "TOKEN CACHE"            — uppercase 8px, tracking 0.08em, Tailwind class text-outline (matches BudgetMetrics labels)
├── CacheStackBar    horizontal 6px bar       — three segments: cached (green) / wrote (lavender) / fresh (coral); 1px gaps; rounded-full
├── PercentReadout
│   ├── Big number   font-mono tabular-nums   — 2.25rem; color tracks tone (semantic.success / primary.container / semantic.tertiary)
│   ├── Pulse dot    Tailwind `animate-pulse` — visible iff cacheHitRate(usage) !== null; matches existing pattern (ActivityEvent / ToolCallSummary / FileStatusBar)
│   └── Caption      uppercase 8px            — "CACHED THIS TURN" populated; "no data yet" empty (Tailwind class text-outline-variant)
└── StatGrid         3 cols, gap-2            — MetricCell-style cards from BudgetMetrics; each with raw token count + label + one-line hint
    ├── cached       "free reuse"             — count from currentUsage.cacheReadInputTokens
    ├── wrote        "uploaded"               — count from currentUsage.cacheCreationInputTokens
    └── fresh        "new tokens"             — count from currentUsage.inputTokens
```

**Out of scope (deferred to a single follow-up spec, paired with transcript reading + persistent cross-session storage):**

- In-session sparkline (12-sample trend) — needs accumulation; statusline.json is a single-snapshot file
- History bars of past sessions (Claude-web style) — needs persistent storage
- Global status bar `⚡ N% cached` indicator — the global status bar zone itself doesn't exist yet
- Rust transcript-JSONL reader for historical samples
- Schema-v2 extension to `app_data_dir/sessions.json` for per-session cache history

These are tightly coupled and will be addressed together. This Phase 1 block is a pure function of the latest `currentUsage` snapshot; nothing it renders requires history.

## 5. State behavior

The block is purely a function of `usage`. Pulse and populated-state derive from whether `cacheHitRate(usage)` returns a number or `null`:

| Condition                                   | Pulse | Numbers | Caption            |
| ------------------------------------------- | ----- | ------- | ------------------ |
| `usage === null` or all three buckets are 0 | off   | zeros   | "no data yet"      |
| `usage` populated (any bucket > 0)          | on    | live    | "CACHED THIS TURN" |

`AgentStatusPanel` is only mounted when `status.isActive` is true (`AgentStatusPanel.tsx:48-58`), so the panel-mount check IS the activity check. Phase 1 honestly maps to this reality: there is no separate `running / awaiting / completed / errored / idle` distinction on the consumer side yet, so the block does not pretend to differentiate them. When session-state derivation is added in a separate design pass, `TokenCache` can be extended with an explicit `state` prop and a richer matrix.

## 6. Data + API contracts

### 6.1 Phase 1, Feature 1 — surface `currentUsage` through the hook

```ts
// src/features/agent-status/types/index.ts — NEW interface
export interface CurrentUsageState {
  inputTokens: number // narrowed from bigint at the hook boundary
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
}

// existing ContextWindowState — extend with one field
export interface ContextWindowState {
  usedPercentage: number
  contextWindowSize: number
  totalInputTokens: number
  totalOutputTokens: number
  currentUsage: CurrentUsageState | null // NEW
}
```

The wire `CurrentUsage` binding at `src/bindings/CurrentUsage.ts` carries `bigint` fields, matching how Rust serializes `u64`. The hook narrows them at normalization, consistent with how the surrounding fields (`contextWindowSize`, `totalInputTokens`, etc.) are already narrowed in the same code block.

```ts
// src/features/agent-status/hooks/useAgentStatus.ts — diff for the contextWindow normalization
contextWindow: p.contextWindow
  ? {
      usedPercentage: p.contextWindow.usedPercentage ?? 0,
      contextWindowSize: Number(p.contextWindow.contextWindowSize),
      totalInputTokens: Number(p.contextWindow.totalInputTokens),
      totalOutputTokens: Number(p.contextWindow.totalOutputTokens),
+     currentUsage: p.contextWindow.currentUsage
+       ? {
+           inputTokens: Number(p.contextWindow.currentUsage.inputTokens),
+           outputTokens: Number(p.contextWindow.currentUsage.outputTokens),
+           cacheCreationInputTokens: Number(p.contextWindow.currentUsage.cacheCreationInputTokens),
+           cacheReadInputTokens: Number(p.contextWindow.currentUsage.cacheReadInputTokens),
+         }
+       : null,
    }
  : prev.contextWindow,
```

`createDefaultStatus` (`useAgentStatus.ts:32-44`) already returns `contextWindow: null`, so the per-session reset on `sessionId` change continues to clear `currentUsage` along with everything else — no separate reset key needed.

The narrowing is safe: realistic per-turn token counts are ≤10⁶, well inside `Number.MAX_SAFE_INTEGER` (~9 × 10¹⁵).

### 6.2 Phase 1, Feature 2 — pure utilities

```ts
// src/features/agent-status/utils/cacheRate.ts
import type { CurrentUsageState } from '../types'

export type CacheTone = 'healthy' | 'warming' | 'cold'

export interface CacheBuckets {
  cached: number // cacheReadInputTokens
  wrote: number // cacheCreationInputTokens
  fresh: number // inputTokens
  total: number // sum
}

/** Sum the three additive buckets. Null/undefined → all zeros. */
export function cacheBuckets(
  usage: CurrentUsageState | null | undefined
): CacheBuckets

/**
 * Canonical Anthropic cache hit rate: cached / (cached + wrote + fresh).
 * Returns null when total is 0 — caller renders the empty state.
 */
export function cacheHitRate(
  usage: CurrentUsageState | null | undefined
): number | null

/** Tone bucket for headline color. */
export function cacheTone(rate: number | null): CacheTone | null
//   rate === null → null     (empty state — no tone)
//   rate >= 0.7   → 'healthy' (semantic.success / #50fa7b)
//   rate >= 0.4   → 'warming' (primary.container / #cba6f7)
//   rate <  0.4   → 'cold'    (semantic.tertiary / #ff94a5)
```

### 6.3 Phase 1, Feature 3 — component props

```ts
// src/features/agent-status/components/TokenCache.tsx
import type { CurrentUsageState } from '../types'

export interface TokenCacheProps {
  usage: CurrentUsageState | null
}
```

That's the entire prop surface. No `state`, no `history`. The component is a pure function of `usage`.

## 7. Token + class map

All from existing tokens in `docs/design/tokens.ts` and Tailwind theme in `tailwind.config.js` — no new tokens, no new classes.

| Element               | Source                                   | Notes                                                                                                 |
| --------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Header label color    | Tailwind class `text-outline`            | Already used by `BudgetMetrics.tsx:36` for label text                                                 |
| Empty caption color   | Tailwind class `text-outline-variant`    | Maps to `text.outlineVariant` in `tokens.ts:53` (#4a444f)                                             |
| Tone — healthy        | Tailwind `text-success` / `bg-success`   | Maps to `semantic.success` (#50fa7b); rate ≥ 0.7                                                      |
| Tone — warming        | Tailwind `text-primary-container` etc.   | Maps to `primary.container` (#cba6f7); 0.4 ≤ rate < 0.7                                               |
| Tone — cold           | Tailwind `text-tertiary` / `bg-tertiary` | Maps to `semantic.tertiary` (#ff94a5); rate < 0.4                                                     |
| Pulse animation       | Tailwind class `animate-pulse`           | Matches existing pattern in `ActivityEvent.tsx:180`, `ToolCallSummary.tsx:45`, `FileStatusBar.tsx:37` |
| Card surface          | Tailwind `bg-surface-container`          | Same as `MetricCell` in `BudgetMetrics`                                                               |
| Stat-grid label color | Tailwind `text-outline`                  | Same as MetricCell labels                                                                             |
| Stat-grid value color | Tailwind `text-on-surface`               | Same as MetricCell values; tone-neutral counts                                                        |

**Note on `stateToken.running.pulse.durationMs`:** the design tokens TS file (`docs/design/tokens.ts`) is a reference source, not a runtime import target — no production component in `src/` imports it. The existing pulse-dot pattern across the app uses Tailwind's built-in `animate-pulse` (default 2s cycle). For consistency, `TokenCache` does the same. If/when a custom pulse cycle is needed across the app, a follow-up should add a Tailwind keyframe + utility class and migrate all pulse dots in one pass.

## 8. Test matrix

### Feature 1 — `useAgentStatus.test.ts`

- `agent-status` event with `p.contextWindow.currentUsage` populated → `status.contextWindow.currentUsage` matches the input (numbers, not bigint)
- `agent-status` event with `currentUsage: null` → `status.contextWindow.currentUsage === null`
- `agent-status` event with `contextWindow: null` → `status.contextWindow` falls back to `prev.contextWindow` (existing behavior preserved)
- `sessionId` change resets `currentUsage` to null along with the rest of the status (existing reset path)
- `agent-status` event with `currentUsage` carrying `bigint` token counts → narrowed to `number` in the resulting state (verifies the `Number(...)` boundary). This is where bigint→number coercion is tested; the `cacheRate` utilities only ever see numbers.

### Feature 2 — `cacheRate.test.ts`

- `cacheBuckets`: null, undefined, all zeros, all positive (numeric inputs only — bigint coercion is tested at the hook boundary in Feature 1, not here)
- `cacheHitRate`: null usage → null; total === 0 → null; standard cases at 0%, 50%, 100%
- `cacheTone`: boundary values 0, 0.39, 0.40, 0.69, 0.70, 1.0 (off-by-one guards) and the `null` rate

### Feature 3 — `TokenCache.test.tsx`

- Empty state (`usage === null`): caption "no data yet", zeros in stat grid, tonal empty stack bar (no segments rendered), pulse dot hidden
- Empty state (zero buckets): same as null
- Populated, healthy: caption "CACHED THIS TURN", green tone, pulse dot active
- Populated, warming: lavender tone
- Populated, cold: coral tone
- Tone thresholds: assert color class at boundaries 0.39 / 0.40 / 0.69 / 0.70
- Stack-bar segments: widths sum to 100% in the populated case; tonal empty band rendered in the zero case (no segment elements present)
- No `setInterval` leaks: `vi.useFakeTimers()` + clean unmount assertion

### Feature 4 — `AgentStatusPanel.test.tsx`

- `<TokenCache>` mounts after `<ContextBucket>` and before the scrollable region
- Component receives an updated `usage` prop when `status.contextWindow.currentUsage` changes
- Panel does not crash when `currentUsage` is `null` (empty path)
- Session-id changes do not remount the upstream panel containers (existing test invariants)

### Feature 5 — `WorkspaceView.integration.test.tsx`

- A `useAgentStatus` mock returning a status with non-trivial `currentUsage` renders the populated TokenCache
- Same mock with `currentUsage: null` renders the empty state
- No regressions in existing integration tests

## 9. Implementation order

1. **Feature 1:** add `CurrentUsageState`, extend `ContextWindowState`, update `useAgentStatus` normalization + tests
2. **Feature 2:** `cacheRate.ts` pure functions + tests (depends on Feature 1's `CurrentUsageState` type)
3. **Feature 3:** `TokenCache.tsx` + tests (depends on Features 1 and 2)
4. **Feature 4:** wire into `AgentStatusPanel.tsx` + update its tests (depends on Feature 3)
5. **Feature 5:** `WorkspaceView.integration.test.tsx` extension (depends on Feature 4)

Coding-style and test-style requirements come from `rules/typescript/coding-style/CLAUDE.md` and `rules/typescript/testing/CLAUDE.md` (auto-loaded by path).

## 10. Anti-patterns to avoid

- **Custom rate formula.** Use only `cache_read / (read + creation + input)` from §2.
- **bigint in JSX.** Always narrow with `Number(...)` at the hook normalization boundary; React will throw on raw bigint.
- **Reading the wire shape directly in the component.** `TokenCache` consumes `CurrentUsageState` (numbers), never the bigint-bearing `CurrentUsage` binding.
- **Polling or watching anything new.** statusline.json is already watched by `watcher.rs`; the existing `agent-status` event already arrives with cache fields. Don't add a Tauri command, don't tail the transcript, don't subscribe to anything new.
- **Faking the green pulse.** Use Tailwind's `animate-pulse` class — matches the existing pattern in `ActivityEvent.tsx:180`, `ToolCallSummary.tsx:45`, and `FileStatusBar.tsx:37`. Do NOT write a custom `setInterval` and do NOT import `stateToken` from `docs/design/tokens.ts` (that file is reference-only — no production component imports it).
- **A `state` prop or in-memory ring buffer.** Both were considered and dropped — they'd lie about a state machine and a history source that don't exist.

## 11. Follow-up work (intentionally out of scope, will be one paired spec)

| Item                                                | Why it pairs                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| In-session sparkline                                | Needs sample accumulation; statusline.json is single-snapshot                            |
| History bars (past sessions, Claude-web style)      | Needs persistent cross-session storage                                                   |
| Rust transcript-JSONL reader for historical samples | Provides the data source for both the sparkline and the history bars                     |
| Schema-v2 extension to `app_data_dir/sessions.json` | Carries per-session `cache_history: Vec<CacheSample>` (filesystem-cache-for-PTY pattern) |
| Global status-bar `⚡ N% cached` indicator          | Global status-bar zone (UNIFIED.md §2) doesn't exist yet                                 |

These five items are tightly linked — the indicator and history bars both need the historical data source, and the data source needs persistence. They get a single follow-up spec together.
