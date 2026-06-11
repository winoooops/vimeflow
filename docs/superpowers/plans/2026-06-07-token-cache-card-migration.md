# Token Cache Card Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the agent activity panel's Token Cache card to match `docs/design/agent_status_sidebar/token-cache-card-kit` exactly (tinted card + hit-rate sparkline, no pulse dot), and collect the per-pane hit-rate history into the session model with localStorage persistence keyed by `ptyId`.

**Architecture:** The hit-rate trend is collected per active pane (the activity panel binds to `activePtyBackedPanePtyId`). A new `Pane.cacheHistory` lives in the `useSessionManager` session model and is mirrored to localStorage (Tier 2, exactly like `activityPanelCollapsedStore.ts`). A small collector hook turns each changed `currentUsage` snapshot into one deduped, capped reading. `TokenCache` is rebuilt into the kit's `CacheBlock` shape and reads `history` from the active pane.

**Tech Stack:** React 18 + TypeScript, Tailwind v4 semantic tokens (the kit palette equals our tokens), Vitest + Testing Library, `@fontsource-variable/instrument-sans`.

**Decisions locked with the user:** cadence **A** (append on changed snapshot, dedup consecutive-equal, cap last 40); **load Instrument Sans**; **Tier 2** persistence (`Pane` field + localStorage keyed by `ptyId`).

### Authoritative source & resolved ambiguities (codex round 1)

- **The runnable `Token Cache Card.html` wins** over the migration doc's prose where they differ ("open it; copy from it").
- **Big number color (F8):** the digits are `#e3e0f7` (`text-on-surface`); only the `%` glyph + sparkline + card tint/border follow the tone. The acceptance-criteria phrase "Number … follow the same tone" means the readout block's theme, not the digit fill — the HTML and screenshot both show white digits.
- **Tone source (F4):** tone is derived from the **rounded integer percent** (`pct >= 70 / >= 40`), never the raw fraction, so the digit and the tint can never disagree (69.5% → shows `70` → success).
- **Zero/empty state (F5):** zero tokens render `0%` (not an em dash) with the **cold** tone and a flat empty bar; the caption is **always** "cached this turn". The string "no data yet" appears **only** inside the empty sparkline.

### Palette mapping (verbatim — no judgment)

| kit hex             | token / usage                                                                 |
| ------------------- | ----------------------------------------------------------------------------- |
| `#7defa1`           | tone ≥70 (number readout `%`, sparkline, tint, border) — also `success-muted` |
| `#e2c7ff`           | tone 40–69 (`primary`)                                                        |
| `#cba6f7`           | stack-bar cached mid-share + tint mid (`primary-container`)                   |
| `#ff94a5`           | tone <40 (`tertiary`)                                                         |
| `#a8c8ff`→`#8aa9d8` | stack-bar `wrote` gradient                                                    |
| `#e3e0f7`           | big number + value figures (`text-on-surface`)                                |
| `#8a8299`           | labels / captions (`text-on-surface-muted`)                                   |
| `#6c7086`           | hints (`text-[#6c7086]`)                                                      |
| `#4a444f`           | sparkline empty + borders `rgba(74,68,79,a)` (`outline-variant`)              |

### Font rule (F7 — critical)

`font-mono` in this repo resolves to **Ioskeley Mono**, NOT JetBrains Mono. The kit requires **JetBrains Mono** for the `%`, captions, labels, and value figures, and for the sparkline empty text. Use `style={{ fontFamily: "'JetBrains Mono', monospace" }}` (a shared `JETBRAINS` const) for those — never `font-mono`. The big number uses `font-display` (Instrument Sans, loaded in Task 1). Hints use `font-sans` (Inter).

### Project-rule reminders

- No semicolons, single quotes, trailing commas es5, explicit return types on exported functions, arrow components only, no `console.log`, `test()` not `it()`.
- **Comments: one short line max** — no multi-line blocks, no task/PR refs.
- Every new `*.test.ts(x)` must `import { test, expect, describe, ... } from 'vitest'`.
- **COMMIT TRAILERS:** every `git commit` below must end with **both** trailers (codex participated via review):
  ```
  Co-Authored-By: codex <codex@openai.com>
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
  Commit examples show `# + trailers` as a reminder; always include both lines.

---

## File Structure

**Create:** `cacheHistoryStore.ts` (+test, sessions/utils) · `Sparkline.tsx` (+test, agent-status/components) · `useCacheHistoryCollector.ts` (+test, agent-status/hooks).

**Modify:** `cacheRate.ts` (+test) · `sessions/types/index.ts` · `sessionFromInfo.ts` (+test) · `useSessionManager.ts` (+tests) · `TokenCache.tsx` (+test) · `AgentStatusPanel/index.tsx` (+test) · `WorkspaceView.tsx` (+tests) · `index.css` + `package.json`.

---

## Task 1: Load Instrument Sans

**Files:** `package.json`, `src/index.css:30` (after the JetBrains Mono face)

- [ ] **Step 1: Install** — `npm i @fontsource-variable/instrument-sans` (if the variable package 404s: `npm i @fontsource/instrument-sans` and point `src` at a static weight file in Step 2).

- [ ] **Step 2: Add the `@font-face`** after the JetBrains Mono block:

```css
@font-face {
  font-family: 'Instrument Sans';
  font-style: normal;
  font-display: swap;
  font-weight: 400 700;
  src: url('@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2')
    format('woff2-variations');
}
```

- [ ] **Step 3: Verify** — `npm run build` succeeds (Vite resolves the url). The Tailwind `font-display` family already lists `'Instrument Sans'` first; no config change.

- [ ] **Step 4: Commit** — `git commit -m "feat(agent-status): load Instrument Sans for display numerals"` `# + trailers`

---

## Task 2: Cache-history pure logic in `cacheRate.ts`

**Files:** `src/features/agent-status/utils/cacheRate.ts` (+ `.test.ts`)

- [ ] **Step 1: Write failing tests** (append; `makeUsage` helper already exists in this file):

```ts
import {
  cacheHitPercentage,
  cacheToneFromPercent,
  pushCacheReading,
  CACHE_HISTORY_LIMIT,
} from './cacheRate'

describe('cacheHitPercentage', () => {
  test('rounds the rate to an integer percent', () => {
    expect(cacheHitPercentage(makeUsage(7500, 1800, 700))).toBe(75)
  })
  test('returns null when there is no usage', () => {
    expect(cacheHitPercentage(null)).toBeNull()
  })
})

describe('cacheToneFromPercent', () => {
  test('cold below 40', () => expect(cacheToneFromPercent(39)).toBe('cold'))
  test('warming at 40', () => expect(cacheToneFromPercent(40)).toBe('warming'))
  test('warming at 69', () => expect(cacheToneFromPercent(69)).toBe('warming'))
  test('healthy at 70', () => expect(cacheToneFromPercent(70)).toBe('healthy'))
})

describe('pushCacheReading', () => {
  test('appends a changed reading', () => {
    expect(pushCacheReading([42, 51], 49)).toEqual([42, 51, 49])
  })
  test('returns the SAME reference on a consecutive duplicate', () => {
    const h = [42, 51]
    expect(pushCacheReading(h, 51)).toBe(h)
  })
  test('caps to the most recent CACHE_HISTORY_LIMIT and keeps the newest', () => {
    const full = Array.from({ length: CACHE_HISTORY_LIMIT }, (_, i) => i)
    const next = pushCacheReading(full, 999)
    expect(next).toHaveLength(CACHE_HISTORY_LIMIT)
    expect(next[next.length - 1]).toBe(999)
    expect(next[0]).toBe(1)
  })
})
```

- [ ] **Step 2: Verify failure** — `npx vitest run src/features/agent-status/utils/cacheRate.test.ts` → FAIL (symbols not exported).

- [ ] **Step 3: Implement** (append to `cacheRate.ts`):

```ts
export const CACHE_HISTORY_LIMIT = 40

export const cacheHitPercentage = (
  usage: CurrentUsageState | null | undefined
): number | null => {
  const rate = cacheHitRate(usage)

  return rate === null ? null : Math.round(rate * 100)
}

// Tone from the rounded percent so the digit and the tint never disagree.
export const cacheToneFromPercent = (pct: number): CacheTone =>
  pct >= 70 ? 'healthy' : pct >= 40 ? 'warming' : 'cold'

// Dedups a consecutive-equal reading (returns the same ref); caps to last N.
export const pushCacheReading = (
  history: number[],
  reading: number,
  cap = CACHE_HISTORY_LIMIT
): number[] => {
  if (history.length > 0 && history[history.length - 1] === reading) {
    return history
  }

  return [...history, reading].slice(-cap)
}
```

> **F1 fix:** `pushCacheReading` returns the _same array reference_ on a no-op so the caller can reference-compare (a length check fails once history is at the cap — `[...full40, x].slice(-40)` is still length 40).

- [ ] **Step 4: Verify pass** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(agent-status): add cacheHitPercentage, cacheToneFromPercent, pushCacheReading"` `# + trailers`

---

## Task 3: localStorage shim `cacheHistoryStore.ts` (Tier 2)

**Files:** `src/features/sessions/utils/cacheHistoryStore.ts` (+ `.test.ts`)

- [ ] **Step 1: Write failing test:**

```ts
import { afterEach, describe, expect, test } from 'vitest'
import {
  readCacheHistory,
  writeCacheHistory,
  deleteCacheHistory,
} from './cacheHistoryStore'

afterEach(() => localStorage.clear())

describe('cacheHistoryStore', () => {
  test('round-trips a history array', () => {
    writeCacheHistory('pty-1', [42, 51, 49])
    expect(readCacheHistory('pty-1')).toEqual([42, 51, 49])
  })
  test('returns [] when nothing is stored', () => {
    expect(readCacheHistory('missing')).toEqual([])
  })
  test('returns [] for malformed json', () => {
    localStorage.setItem('vimeflow:agent:cacheHistory:x', '{nope')
    expect(readCacheHistory('x')).toEqual([])
  })
  test('rejects arrays with out-of-range or non-integer entries', () => {
    localStorage.setItem('vimeflow:agent:cacheHistory:y', '[1, 200, 3]')
    expect(readCacheHistory('y')).toEqual([])
    localStorage.setItem('vimeflow:agent:cacheHistory:z', '[1, 2.5, 3]')
    expect(readCacheHistory('z')).toEqual([])
  })
  test('caps the read result to the most recent CACHE_HISTORY_LIMIT', () => {
    const big = Array.from({ length: 50 }, (_, i) => i % 100)
    writeCacheHistory('pty-big', big)
    expect(readCacheHistory('pty-big')).toHaveLength(40)
  })
  test('delete removes the key', () => {
    writeCacheHistory('pty-2', [1, 2])
    deleteCacheHistory('pty-2')
    expect(readCacheHistory('pty-2')).toEqual([])
  })
})
```

- [ ] **Step 2: Verify failure** → module not found.

- [ ] **Step 3: Implement** (mirrors `activityPanelCollapsedStore.ts`; hardened parser per F11):

```ts
import { CACHE_HISTORY_LIMIT } from '../../agent-status/utils/cacheRate'

const STORAGE_KEY_PREFIX = 'vimeflow:agent:cacheHistory:'

const storageKey = (ptyId: string): string => `${STORAGE_KEY_PREFIX}${ptyId}`

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const isPercent = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100

export const readCacheHistory = (ptyId: string): number[] => {
  const storage = getStorage()
  if (!storage) {
    return []
  }
  try {
    const raw = storage.getItem(storageKey(ptyId))
    if (raw === null) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every(isPercent)) {
      return []
    }

    return parsed.slice(-CACHE_HISTORY_LIMIT)
  } catch {
    return []
  }
}

export const writeCacheHistory = (ptyId: string, history: number[]): void => {
  const storage = getStorage()
  if (!storage) {
    return
  }
  try {
    storage.setItem(storageKey(ptyId), JSON.stringify(history))
  } catch {
    // Quota exceeded / private mode — in-memory state stays consistent.
  }
}

export const deleteCacheHistory = (ptyId: string): void => {
  const storage = getStorage()
  if (!storage) {
    return
  }
  try {
    storage.removeItem(storageKey(ptyId))
  } catch {
    // Match the writer's silent-on-failure policy.
  }
}
```

- [ ] **Step 4: Verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(sessions): add cacheHistoryStore localStorage shim"` `# + trailers`

---

## Task 4: `Pane.cacheHistory` type + restore hydration

**Files:** `src/features/sessions/types/index.ts:84` (before `active`), `src/features/sessions/utils/sessionFromInfo.ts` (+ `.test.ts`)

- [ ] **Step 1: Add the field** before `active: boolean`:

```ts
  /** Per-pane hit-rate trend (percent readings) for the sparkline; hydrated by ptyId. */
  cacheHistory?: number[]
```

> **F10 decision:** kept **optional**, consistent with `Pane`'s seven other optional fields (`userLabel?`, `agentTitle?`, …). Initialization is guaranteed at every construction site (hydrate in `sessionFromInfo`, reset to `[]` on restart), and every read uses `?? []`, so there is no "missing init" gap.

- [ ] **Step 2: Write failing test** in `sessionFromInfo.test.ts` (reuse the existing `aliveInfo(id, cwd)` helper — F12):

```ts
test('hydrates cacheHistory from the store for an Alive pane', () => {
  window.localStorage.setItem('vimeflow:agent:cacheHistory:pty-1', '[10,20,30]')
  const session = sessionFromInfo(aliveInfo('pty-1', '/home/x'), 0)
  expect(session.panes[0].cacheHistory).toEqual([10, 20, 30])
})

test('defaults cacheHistory to [] when nothing persisted', () => {
  const session = sessionFromInfo(aliveInfo('pty-2', '/home/y'), 0)
  expect(session.panes[0].cacheHistory).toEqual([])
})
```

- [ ] **Step 3: Verify failure** → `cacheHistory` undefined.

- [ ] **Step 4: Implement** in `sessionFromInfo.ts` — import the reader and add the field to `paneBase` (it already uses `satisfies Pane`):

```ts
import { readCacheHistory } from './cacheHistoryStore'
```

```ts
const paneBase = {
  kind: 'shell',
  id: 'p0',
  ptyId: info.id,
  cwd: info.cwd,
  agentType: 'generic',
  status,
  cacheHistory: readCacheHistory(info.id),
  active: true,
} satisfies Pane
```

- [ ] **Step 5: Verify pass.**
- [ ] **Step 6: Commit** — `git commit -m "feat(sessions): hydrate Pane.cacheHistory from store on restore"` `# + trailers`

---

## Task 5: `appendPaneCacheReading` + lifecycle cleanup in `useSessionManager`

**Files:** `src/features/sessions/hooks/useSessionManager.ts` (+ `.test.tsx`)

Sites (verified): return interface ~line 82; imports at top; `updatePaneCwd` ~1717; `removeSession` kill loop ~931 (`for (const ptyId of allKilledPtyIds) dropAllForPty(ptyId)`); `removePane` ~1336 (`dropAllForPty(target.ptyId)`); `restartSession` ~1493 (`dropAllForPty(oldPane.ptyId)`) and `replacementPane` literal ~1528 (which already clears `userLabel`/`agentTitle`).

- [ ] **Step 1: Write failing test** (use this file's existing render/act harness — do NOT invent one):

```ts
test('appendPaneCacheReading appends a deduped reading and persists by ptyId', () => {
  // arrange: create one session/pane via the file's setup helper; capture sessionId, paneId, ptyId
  // act:
  //   result.current.appendPaneCacheReading(sessionId, paneId, 75)
  //   result.current.appendPaneCacheReading(sessionId, paneId, 75) // duplicate
  // assert:
  //   active pane.cacheHistory === [75]
  //   JSON.parse(localStorage.getItem('vimeflow:agent:cacheHistory:' + ptyId)) === [75]
})
```

- [ ] **Step 2: Verify failure** → `appendPaneCacheReading` is not a function.

- [ ] **Step 3: Implement.** Imports at top:

```ts
import {
  writeCacheHistory,
  deleteCacheHistory,
} from '../utils/cacheHistoryStore'
import { pushCacheReading } from '../../agent-status/utils/cacheRate'
```

Return interface (near line 82):

```ts
  appendPaneCacheReading: (
    sessionId: string,
    paneId: string,
    percentage: number
  ) => void
```

Implementation (next to `updatePaneCwd`); reference-compare per F1:

```ts
const appendPaneCacheReading = useCallback(
  (sessionId: string, paneId: string, percentage: number): void => {
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== sessionId) {
          return session
        }

        const panes = session.panes.map((pane) => {
          if (pane.id !== paneId) {
            return pane
          }
          const current = pane.cacheHistory ?? []
          const next = pushCacheReading(current, percentage)
          if (next === current) {
            return pane
          }
          writeCacheHistory(pane.ptyId, next)

          return { ...pane, cacheHistory: next }
        })

        return { ...session, panes }
      })
    )
  },
  []
)
```

Add `appendPaneCacheReading` to the returned object.

- [ ] **Step 4: Restart reset (F2)** — in `restartSession`'s `replacementPane` literal (~1528), add to the existing "clear sticky state" block:

```ts
              agentTitle: undefined,
              agentTitleSource: undefined,
              userLabel: undefined,
              cacheHistory: [],
```

and beside `dropAllForPty(oldPane.ptyId)` (~1493):

```ts
dropAllForPty(oldPane.ptyId)
deleteCacheHistory(oldPane.ptyId)
```

- [ ] **Step 5: Delete-on-retire (F3)** — co-locate cleanup with the other `dropAllForPty` retirement sites:
  - `removeSession` kill loop (~931): inside `for (const ptyId of allKilledPtyIds) { dropAllForPty(ptyId); deleteCacheHistory(ptyId) }`
  - `removePane` (~1336): beside `dropAllForPty(target.ptyId)` add `deleteCacheHistory(target.ptyId)`

- [ ] **Step 6: Verify** — `npx vitest run src/features/sessions/hooks/useSessionManager.test.tsx` → PASS. Add a focused test for the restart reset if the harness supports it; otherwise the existing restart test plus the append test cover it.
- [ ] **Step 7: Commit** — `git commit -m "feat(sessions): appendPaneCacheReading with persistence and lifecycle cleanup"` `# + trailers`

---

## Task 6: `useCacheHistoryCollector` hook

**Files:** `src/features/agent-status/hooks/useCacheHistoryCollector.ts` (+ `.test.tsx`)

- [ ] **Step 1: Write failing test:**

```tsx
import { describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCacheHistoryCollector } from './useCacheHistoryCollector'
import type { CurrentUsageState } from '../types'

const usage = (c: number, w: number, f: number): CurrentUsageState => ({
  inputTokens: f,
  outputTokens: 0,
  cacheCreationInputTokens: w,
  cacheReadInputTokens: c,
})

describe('useCacheHistoryCollector', () => {
  test('emits a reading on a changed percentage, dedups unchanged', () => {
    const onReading = vi.fn()
    const props = {
      ptyId: 'p',
      sessionId: 's',
      paneId: 'p0',
      usage: usage(7500, 1800, 700),
      onReading,
    }
    const { rerender } = renderHook((p) => useCacheHistoryCollector(p), {
      initialProps: props,
    })
    expect(onReading).toHaveBeenCalledWith('s', 'p0', 75)
    rerender({ ...props })
    expect(onReading).toHaveBeenCalledTimes(1)
  })

  test('does not emit when percentage is null', () => {
    const onReading = vi.fn()
    renderHook(() =>
      useCacheHistoryCollector({
        ptyId: 'p',
        sessionId: 's',
        paneId: 'p0',
        usage: null,
        onReading,
      })
    )
    expect(onReading).not.toHaveBeenCalled()
  })

  test('re-emits after ptyId changes (agent restart)', () => {
    const onReading = vi.fn()
    const base = {
      sessionId: 's',
      paneId: 'p0',
      usage: usage(7500, 1800, 700),
      onReading,
    }
    const { rerender } = renderHook((p) => useCacheHistoryCollector(p), {
      initialProps: { ...base, ptyId: 'p' },
    })
    rerender({ ...base, ptyId: 'q' })
    expect(onReading).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Verify failure** → module not found.

- [ ] **Step 3: Implement:**

```ts
import { useEffect, useRef } from 'react'
import type { CurrentUsageState } from '../types'
import { cacheHitPercentage } from '../utils/cacheRate'

export interface UseCacheHistoryCollectorArgs {
  ptyId: string | null
  sessionId: string | null
  paneId: string | null
  usage: CurrentUsageState | null
  onReading: (sessionId: string, paneId: string, percentage: number) => void
}

// Emits one reading per changed percentage; resets when the ptyId changes.
export const useCacheHistoryCollector = ({
  ptyId,
  sessionId,
  paneId,
  usage,
  onReading,
}: UseCacheHistoryCollectorArgs): void => {
  const lastRef = useRef<{ ptyId: string | null; pct: number | null }>({
    ptyId: null,
    pct: null,
  })
  const onReadingRef = useRef(onReading)
  onReadingRef.current = onReading

  useEffect(() => {
    if (ptyId === null || sessionId === null || paneId === null) {
      return
    }

    const pct = cacheHitPercentage(usage)
    if (pct === null) {
      return
    }

    const last = lastRef.current
    if (last.ptyId === ptyId && last.pct === pct) {
      return
    }

    lastRef.current = { ptyId, pct }
    onReadingRef.current(sessionId, paneId, pct)
  }, [ptyId, sessionId, paneId, usage])
}
```

- [ ] **Step 4: Verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(agent-status): add useCacheHistoryCollector"` `# + trailers`

---

## Task 7: `Sparkline` component (verbatim SVG port)

**Files:** `src/features/agent-status/components/Sparkline.tsx` (+ `.test.tsx`)

- [ ] **Step 1: Write failing test:**

```tsx
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sparkline } from './Sparkline'

describe('Sparkline', () => {
  test('renders "no data yet" when empty', () => {
    render(<Sparkline data={[]} color="#7defa1" />)
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })
  test('renders an svg with a line path when given data', () => {
    const { container } = render(
      <Sparkline data={[42, 51, 49, 75]} color="#7defa1" />
    )
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(container.querySelectorAll('path')).toHaveLength(2)
  })
  test('strokes with the provided tone color', () => {
    const { container } = render(<Sparkline data={[10, 90]} color="#ff94a5" />)
    expect(container.querySelectorAll('path')[1].getAttribute('stroke')).toBe(
      '#ff94a5'
    )
  })
})
```

- [ ] **Step 2: Verify failure** → module not found.

- [ ] **Step 3: Implement** (kit port; typed; unique gradient id; JetBrains Mono empty text per F7):

```tsx
import { useId, type ReactElement } from 'react'

export interface SparklineProps {
  data: number[]
  color: string
}

export const Sparkline = ({ data, color }: SparklineProps): ReactElement => {
  const gradientId = useId()

  if (data.length === 0) {
    return (
      <div
        data-testid="token-cache-sparkline-empty"
        className="grid h-full w-full place-items-center text-[10px] text-outline-variant"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        no data yet
      </div>
    )
  }

  const w = 100
  const h = 36
  const max = Math.max(100, ...data)
  const min = Math.max(0, Math.min(...data) - 10)
  const span = Math.max(1, max - min)
  const step = data.length > 1 ? w / (data.length - 1) : w
  const pts = data.map((v, i) => {
    const x = i * step
    const y = h - ((v - min) / span) * (h - 6) - 3

    return [x, y] as const
  })
  const linePath = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')
  const fillPath = `${linePath} L${w},${h} L0,${h} Z`
  const last = pts[pts.length - 1]

  return (
    <svg
      data-testid="token-cache-sparkline"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="block h-full w-full"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="1.8" fill={color} />
      <circle
        cx={last[0]}
        cy={last[1]}
        r="3.5"
        fill={color}
        fillOpacity="0.25"
      />
    </svg>
  )
}
```

- [ ] **Step 4: Verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(agent-status): add Sparkline trend component"` `# + trailers`

---

## Task 8: Rebuild `TokenCache.tsx` into the `CacheBlock` shape

**Files:** full rewrite of `src/features/agent-status/components/TokenCache.tsx`

Addresses F4 (tone from rounded pct), F5 (zero → `0%` + always "cached this turn"), F6 (kit outer wrapper), F7 (explicit JetBrains Mono), F8 (white digits, tone `%`), F9 (kit `fmt`).

- [ ] **Step 1: Replace the file:**

```tsx
import type { CSSProperties, ReactElement } from 'react'
import type { CurrentUsageState } from '../types'
import {
  cacheBuckets,
  cacheToneFromPercent,
  type CacheTone,
} from '../utils/cacheRate'
import { Sparkline } from './Sparkline'

export interface TokenCacheProps {
  usage: CurrentUsageState | null
  history: number[]
}

const JETBRAINS = "'JetBrains Mono', monospace"

const TONE_HEX: Record<CacheTone, string> = {
  healthy: '#7defa1',
  warming: '#e2c7ff',
  cold: '#ff94a5',
}

const TONE_TINT: Record<CacheTone, string> = {
  healthy: 'rgba(125,239,161,0.06)',
  warming: 'rgba(203,166,247,0.06)',
  cold: 'rgba(255,148,165,0.06)',
}

// Kit formatter — one decimal at >=1k (8.4k, 2.0k), raw below.
const fmt = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

const cachedShareHex = (sharePct: number): string =>
  sharePct >= 70 ? '#7defa1' : sharePct >= 40 ? '#cba6f7' : '#ff94a5'

const StackBar = ({
  cached,
  wrote,
  fresh,
  total,
}: {
  cached: number
  wrote: number
  fresh: number
  total: number
}): ReactElement => {
  if (total === 0) {
    return (
      <div
        data-testid="token-cache-stack-empty"
        className="h-2 w-full rounded-full"
        style={{ background: 'rgba(74,68,79,0.25)' }}
      />
    )
  }

  const cPct = (cached / total) * 100
  const wPct = (wrote / total) * 100
  const fPct = (fresh / total) * 100
  const cTone = cachedShareHex(cPct)

  return (
    <div
      className="flex h-2 w-full overflow-hidden rounded-full"
      style={{
        background: 'rgba(13,13,28,0.6)',
        border: '1px solid rgba(74,68,79,0.25)',
      }}
    >
      <div
        data-testid="token-cache-stack-cached"
        style={{
          width: `${cPct}%`,
          background: `linear-gradient(90deg, ${cTone}, ${cTone}cc)`,
          boxShadow: `inset 0 0 6px ${cTone}55`,
        }}
      />
      <div
        data-testid="token-cache-stack-wrote"
        style={{
          width: `${wPct}%`,
          background: 'linear-gradient(90deg, #a8c8ff, #8aa9d8)',
        }}
      />
      <div
        data-testid="token-cache-stack-fresh"
        style={{ width: `${fPct}%`, background: 'rgba(205,195,209,0.4)' }}
      />
    </div>
  )
}

const StatCell = ({
  label,
  value,
  hint,
  testId,
}: {
  label: string
  value: string
  hint: string
  testId: string
}): ReactElement => (
  <div className="flex flex-col gap-0.5">
    <span
      data-testid={testId}
      className="text-[11.5px] font-semibold tabular-nums text-on-surface"
      style={{ fontFamily: JETBRAINS }}
    >
      {value}
    </span>
    <span
      className="text-[9px] uppercase tracking-[0.06em] text-on-surface-muted"
      style={{ fontFamily: JETBRAINS }}
    >
      {label}
    </span>
    <span className="font-sans text-[10px] text-[#6c7086]">{hint}</span>
  </div>
)

export const TokenCache = ({
  usage,
  history,
}: TokenCacheProps): ReactElement => {
  const buckets = cacheBuckets(usage)
  const pct =
    buckets.total > 0 ? Math.round((buckets.cached / buckets.total) * 100) : 0
  const tone = cacheToneFromPercent(pct)
  const toneHex = TONE_HEX[tone]

  const cardStyle: CSSProperties = {
    borderRadius: 10,
    border: `1px solid ${toneHex}26`,
    background: `linear-gradient(135deg, ${TONE_TINT[tone]}, rgba(13,13,28,0.5))`,
  }

  return (
    <div
      data-testid="token-cache"
      style={{
        padding: '14px 16px',
        borderBottom: '1px solid rgba(74,68,79,0.18)',
      }}
    >
      <div
        className="mb-2.5 px-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-muted"
        style={{ fontFamily: JETBRAINS }}
      >
        Token cache
      </div>

      <div className="overflow-hidden" style={cardStyle}>
        <div className="flex items-end gap-3 px-3.5 py-3">
          <div>
            <div className="flex items-baseline gap-1">
              <span
                data-testid="token-cache-percent"
                data-tone={tone}
                className="font-display text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-on-surface"
              >
                {pct}
              </span>
              <span
                className="text-[13px] font-semibold"
                style={{ fontFamily: JETBRAINS, color: toneHex }}
              >
                %
              </span>
            </div>
            <div
              className="mt-0.5 text-[9.5px] uppercase tracking-[0.06em] text-on-surface-muted"
              style={{ fontFamily: JETBRAINS }}
            >
              cached this turn
            </div>
          </div>
          <div className="h-9 min-w-0 flex-1">
            <Sparkline data={history} color={toneHex} />
          </div>
        </div>

        <div
          style={{
            padding: '11px 14px 13px',
            borderTop: '1px solid rgba(74,68,79,0.2)',
            background: 'rgba(13,13,28,0.25)',
          }}
        >
          <StackBar {...buckets} />
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            <StatCell
              label="cached"
              value={fmt(buckets.cached)}
              hint="free reuse"
              testId="token-cache-stat-cached"
            />
            <StatCell
              label="wrote"
              value={fmt(buckets.wrote)}
              hint="uploaded"
              testId="token-cache-stat-wrote"
            />
            <StatCell
              label="fresh"
              value={fmt(buckets.fresh)}
              hint="new tokens"
              testId="token-cache-stat-fresh"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit** (tests in Task 9) — `git commit -m "feat(agent-status): rebuild TokenCache as tinted CacheBlock with sparkline"` `# + trailers`

---

## Task 9: Rewrite `TokenCache.test.tsx`

**Files:** full rewrite of `src/features/agent-status/components/TokenCache.test.tsx`

- [ ] **Step 1: Replace the file:**

```tsx
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TokenCache } from './TokenCache'
import type { CurrentUsageState } from '../types'

const makeUsage = (
  cached: number,
  wrote: number,
  fresh: number
): CurrentUsageState => ({
  inputTokens: fresh,
  outputTokens: 0,
  cacheCreationInputTokens: wrote,
  cacheReadInputTokens: cached,
})

describe('TokenCache — zero/empty state (kit-faithful)', () => {
  test('shows 0% (not an em dash) when usage is null', () => {
    render(<TokenCache usage={null} history={[]} />)
    expect(screen.getByTestId('token-cache-percent')).toHaveTextContent('0')
  })
  test('always shows the "cached this turn" caption', () => {
    render(<TokenCache usage={null} history={[]} />)
    expect(screen.getByText(/cached this turn/i)).toBeInTheDocument()
  })
  test('zero tokens tone is cold', () => {
    render(<TokenCache usage={makeUsage(0, 0, 0)} history={[]} />)
    expect(screen.getByTestId('token-cache-percent')).toHaveAttribute(
      'data-tone',
      'cold'
    )
  })
  test('renders the flat empty stack band when all buckets are zero', () => {
    render(<TokenCache usage={makeUsage(0, 0, 0)} history={[]} />)
    expect(screen.getByTestId('token-cache-stack-empty')).toBeInTheDocument()
  })
  test('"no data yet" comes only from the empty sparkline', () => {
    render(<TokenCache usage={null} history={[]} />)
    expect(
      screen.getByTestId('token-cache-sparkline-empty')
    ).toBeInTheDocument()
  })
})

describe('TokenCache — no pulse dot (kit forbids it)', () => {
  test('never renders a pulse dot', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} history={[42, 75]} />)
    expect(screen.queryByTestId('token-cache-pulse')).toBeNull()
  })
})

describe('TokenCache — populated', () => {
  test('renders the headline percentage with tabular-nums', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} history={[75]} />)
    const readout = screen.getByTestId('token-cache-percent')
    expect(readout).toHaveTextContent('75')
    expect(readout.className).toMatch(/tabular-nums/)
  })
  test('renders the sparkline when history is present', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} history={[42, 75]} />)
    expect(screen.getByTestId('token-cache-sparkline')).toBeInTheDocument()
  })
  test('uses the kit formatter (1.0k, not 1k) for round thousands', () => {
    render(<TokenCache usage={makeUsage(2000, 1000, 700)} history={[75]} />)
    expect(screen.getByTestId('token-cache-stat-cached')).toHaveTextContent(
      '2.0k'
    )
    expect(screen.getByTestId('token-cache-stat-wrote')).toHaveTextContent(
      '1.0k'
    )
    expect(screen.getByTestId('token-cache-stat-fresh')).toHaveTextContent(
      '700'
    )
  })
  test('renders the three hints', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} history={[75]} />)
    expect(screen.getByText(/free reuse/i)).toBeInTheDocument()
    expect(screen.getByText(/uploaded/i)).toBeInTheDocument()
    expect(screen.getByText(/new tokens/i)).toBeInTheDocument()
  })
})

describe('TokenCache — tone from rounded percent (F4)', () => {
  test('69.5% rounds to 70 and is healthy, not warming', () => {
    render(<TokenCache usage={makeUsage(139, 61, 0)} history={[]} />)
    const readout = screen.getByTestId('token-cache-percent')
    expect(readout).toHaveTextContent('70')
    expect(readout).toHaveAttribute('data-tone', 'healthy')
  })
  test('cold below 40', () => {
    render(<TokenCache usage={makeUsage(350, 350, 300)} history={[]} />)
    expect(screen.getByTestId('token-cache-percent')).toHaveAttribute(
      'data-tone',
      'cold'
    )
  })
  test('warming at exactly 40', () => {
    render(<TokenCache usage={makeUsage(400, 300, 300)} history={[]} />)
    expect(screen.getByTestId('token-cache-percent')).toHaveAttribute(
      'data-tone',
      'warming'
    )
  })
})

describe('TokenCache — stack bar', () => {
  test('three segments sum to ~100% when populated', () => {
    render(<TokenCache usage={makeUsage(7500, 1800, 700)} history={[75]} />)
    const widths = [
      parseFloat(screen.getByTestId('token-cache-stack-cached').style.width),
      parseFloat(screen.getByTestId('token-cache-stack-wrote').style.width),
      parseFloat(screen.getByTestId('token-cache-stack-fresh').style.width),
    ]
    const sum = widths.reduce((a, b) => a + b, 0)
    expect(sum).toBeGreaterThan(99.9)
    expect(sum).toBeLessThan(100.1)
  })
})
```

- [ ] **Step 2: Verify pass** — `npx vitest run src/features/agent-status/components/TokenCache.test.tsx`.
- [ ] **Step 3: Commit** — `git commit -m "test(agent-status): cover TokenCache sparkline, zero-state, no-pulse contract"` `# + trailers`

---

## Task 10: Thread `cacheHistory` through `AgentStatusPanel` (+ layout, F6)

**Files:** `src/features/agent-status/components/AgentStatusPanel/index.tsx` (props ~19; render ~82–93) (+ `.test.tsx`)

- [ ] **Step 1: Add the prop** to `AgentStatusPanelProps`:

```ts
  cacheHistory: number[]
```

- [ ] **Step 2: Restructure the top section (F6).** The kit card owns its full-width section padding + bottom divider, so move it OUT of the shared `p-2 gap-2` row:

```tsx
      <div className="flex flex-col gap-2 p-2">
        <ContextBucket
          usedPercentage={status.contextWindow?.usedPercentage ?? null}
          contextWindowSize={
            status.contextWindow?.contextWindowSize ?? DEFAULT_CONTEXT_WINDOW_SIZE
          }
          totalInputTokens={status.contextWindow?.totalInputTokens ?? 0}
          totalOutputTokens={status.contextWindow?.totalOutputTokens ?? 0}
        />
      </div>
      <TokenCache
        usage={status.contextWindow?.currentUsage ?? null}
        history={cacheHistory}
      />
```

- [ ] **Step 3: Update the panel test** — add `cacheHistory={[]}` to existing renders; add one case with `cacheHistory={[42, 75]}` asserting `token-cache-sparkline` appears.
- [ ] **Step 4: Verify pass** — `npx vitest run src/features/agent-status/components/AgentStatusPanel/index.test.tsx`.
- [ ] **Step 5: Commit** — `git commit -m "feat(agent-status): pass cacheHistory into AgentStatusPanel"` `# + trailers`

---

## Task 11: Wire the collector in `WorkspaceView`

**Files:** `src/features/workspace/WorkspaceView.tsx` (helper ~91; imports ~37–38; `useSessionManager` destructure ~174; `useAgentStatus` ~283; `<AgentStatusPanel>` ~1528)

- [ ] **Step 1: Imports (F13).** Delete the local `cacheHitPercentage` (lines 91–97). Replace the `cacheHitRate` import with `cacheHitPercentage`, and add the collector. Remove the now-unused `CurrentUsageState` import if nothing else uses it (`tsc --noUnusedLocals` will tell you):

```ts
import { cacheHitPercentage } from '../agent-status/utils/cacheRate'
import { useCacheHistoryCollector } from '../agent-status/hooks/useCacheHistoryCollector'
```

The existing call at ~line 1519 keeps working against the imported helper.

- [ ] **Step 2: Pull `appendPaneCacheReading`** into the `useSessionManager` destructure (~174, beside `updatePaneCwd`).

- [ ] **Step 3: Run the collector** right after `useAgentStatus` (~283). Gate `usage` on `agentStatus.sessionId === activePtyBackedPanePtyId` so a just-switched/restarted pane never inherits the previous pane's reading — the same ownership guard WorkspaceView already uses at lines 326/338/407/1246 (R2-F1):

```ts
useCacheHistoryCollector({
  ptyId: activePtyBackedPanePtyId ?? null,
  sessionId: activeSessionId,
  paneId: activePtyBackedPaneId ?? null,
  usage:
    agentStatus.sessionId === activePtyBackedPanePtyId
      ? (agentStatus.contextWindow?.currentUsage ?? null)
      : null,
  onReading: appendPaneCacheReading,
})
```

- [ ] **Step 4: Pass history** to the panel (~1528) — add `cacheHistory={activePtyBackedPane?.cacheHistory ?? []}`.

- [ ] **Step 5: Stale-ownership test (R2-F1)** — add a WorkspaceView test that when `agentStatus.sessionId` does NOT equal the active pane's ptyId (e.g. mid pane-switch, before `useAgentStatus` resets), `appendPaneCacheReading` is NOT called. Spy on `appendPaneCacheReading` via the `useSessionManager` mock and assert zero calls for the mismatched-snapshot render; assert it IS called once `agentStatus.sessionId` matches.

- [ ] **Step 6: Verify** — `npx vitest run src/features/workspace/ && npm run type-check`. Fix any test that built a bare `AgentStatusPanel`/`Pane` lacking the new prop/field.
- [ ] **Step 7: Commit** — `git commit -m "feat(workspace): collect per-pane cache history into the session model"` `# + trailers`

---

## Task 12: Full gate — render, lint, test, codex

- [ ] **Step 1: Browser render vs `screenshot.png`** — `npm run dev`, open the activity panel with an active agent. Verify against `docs/design/agent_status_sidebar/token-cache-card-kit/screenshot.png`: tinted card; **Instrument Sans** digits (white `#e3e0f7`), tone-colored `%`; tone-matched sparkline; stack bar (mint/blue/muted); 3-col breakdown in **JetBrains Mono** (not Ioskeley); `#6c7086` hints; **no pulse dot**; the section's 14/16 padding + bottom divider read correctly next to `ContextBucket` (F6). Adjust if anything drifts.
- [ ] **Step 2: Lint + format + full test + types** — `npm run lint && npm run format:check && npm run test && npm run type-check`. (Known pre-existing PTY-EOF parallel flake — re-run single-threaded if it trips.)
- [ ] **Step 3: Commit the design kit** — `git commit -m "docs(design): add token cache card migration kit"` `# + trailers`
- [ ] **Step 4: Codex review to zero findings** — from the worktree: `codex review --base main` (proxy-cleared, stdin `/dev/null`, no `--model`). Triage, fix need-fix items, re-run to convergence.
- [ ] **Step 5: PR** via `/lifeline:request-pr` once green + codex-clean.

---

## Codex round-1 resolutions

| #   | Sev  | Finding                                     | Resolution                                                                                   |
| --- | ---- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | HIGH | length no-op guard drops readings at cap    | `pushCacheReading` returns same ref on dedup; append reference-compares (Tasks 2, 5)         |
| 2   | HIGH | restart carries `cacheHistory` to new ptyId | `cacheHistory: []` on `replacementPane` + `deleteCacheHistory(oldPane.ptyId)` (Task 5.4)     |
| 3   | MED  | cleanup only in `removeSession`             | added at `removePane` + restart retire sites (Task 5.4–5.5)                                  |
| 4   | HIGH | tone from unrounded fraction                | `cacheToneFromPercent(pct)` on the rounded percent (Tasks 2, 8)                              |
| 5   | HIGH | em-dash/caption drift in empty state        | `0%`, always "cached this turn", "no data yet" only in sparkline (Tasks 8, 9)                |
| 6   | HIGH | missing kit outer wrapper / geometry        | wrapper padding `14px 16px` + bottom divider; TokenCache placed full-width (Tasks 8, 10)     |
| 7   | HIGH | `font-mono` → Ioskeley, not JetBrains       | explicit `JETBRAINS` font-family for `%`/labels/values/captions/sparkline-empty (Tasks 7, 8) |
| 8   | MED  | number tone-color ambiguity                 | resolved to HTML: white digits, tone `%` (header + Task 8)                                   |
| 9   | MED  | `formatTokens` not kit-exact                | kit-local `fmt` (Tasks 8, 9)                                                                 |
| 10  | MED  | optional vs required field                  | kept optional with documented init + guarded reads (Task 4)                                  |
| 11  | MED  | unhardened store parser                     | finite-int 0..100 validation + cap on read (Task 3)                                          |
| 12  | MED  | bad test fixture cast                       | reuse the existing `aliveInfo` helper (Task 4)                                               |
| 13  | LOW  | dangling WorkspaceView imports              | swap to `cacheHitPercentage`, drop unused (Task 11)                                          |
| 14  | LOW  | multi-line comments                         | trimmed to one line throughout                                                               |
| 15  | LOW  | missing codex commit trailer                | mandated in header; on every commit                                                          |

## Codex round-2 resolutions

| #    | Sev  | Finding                                                                 | Resolution                                                                                                                                     |
| ---- | ---- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-1 | HIGH | collector could attribute a stale pane's `currentUsage` to the new pane | gate `usage` on `agentStatus.sessionId === activePtyBackedPanePtyId` (WorkspaceView's existing idiom) + stale-ownership test (Task 11.3, 11.5) |
| R2-2 | LOW  | breakdown sub-panel padding drifted from kit `11px 14px 13px`           | exact inline `padding: '11px 14px 13px'` (Task 8)                                                                                              |

## Self-Review

**Acceptance criteria → tasks:** big % + "cached this turn" + sparkline (8); shared tone for number-readout/%/spark/tint/bar-lead (8, `cacheToneFromPercent`); proportional bar, blue wrote, muted fresh (8); 3-col counts, no legend dots (8); no pulse/past-sessions (8, asserted 9); empty states (8, 9); history collection — the main thing (2, 5, 6 + persistence 3, 4).

**Type consistency:** `appendPaneCacheReading(sessionId, paneId, percentage)` identical across Task 5 (def), 6 (`onReading`), 11 (call). `Pane.cacheHistory?: number[]` ↔ panel prop `cacheHistory: number[]` ↔ `TokenCacheProps.history: number[]`. `Sparkline {data, color}` consistent (7, 8). `cacheToneFromPercent`/`pushCacheReading`/`CACHE_HISTORY_LIMIT` defined once in `cacheRate.ts` (2), consumed in 3, 5, 8.
