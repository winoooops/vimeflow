# Single-File Diff Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vim-modal in-file search for the diff viewer — floating glass button, modeless glass popup, CSS-Highlight-API match painting into pierre's shadow DOM, `/`-`n`-`p`-`Esc` keyboard contract.

**Architecture:** A pure matcher (`matchDiffLines`) runs over lines collected from pierre's shadow root; a DOM adapter paints matches via `CSS.highlights` (styles injected through pierre's `unsafeCSS` option) and re-applies on `onPostRender`; a `useDiffSearch` hook owns state and hands `useKeyboard` a `searchOpen` flag plus four callbacks. Spec: `docs/superpowers/specs/2026-07-02-diff-search-design.md` (codex-reviewed — every contract referenced below is defined there).

**Tech Stack:** React 19 hooks, `@pierre/diffs@1.2.2` (`MultiFileDiff`), CSS Custom Highlight API, Vitest + Testing Library, Tailwind theme tokens.

**Conventions that apply to every task** (from `rules/` + CLAUDE.md): no semicolons, single quotes, arrow-function components, explicit return types on exports, no `console.log`, `test()` not `it()`, no hardcoded colors outside `src/theme/` (CSS `var(--color-*)` references are fine), conventional commits. Work in the `feature/vim-252` worktree.

---

## File structure

```
src/features/diff/
├── search/
│   ├── matchDiffLines.ts          # Task 1 — pure matcher + shared types
│   ├── matchDiffLines.test.ts
│   ├── diffSearchDom.ts           # Tasks 2–3 — shadow-root collect / paint / scroll (only file touching pierre DOM)
│   └── diffSearchDom.test.ts
├── hooks/
│   ├── useDiffSearch.ts           # Task 4 — state owner
│   ├── useDiffSearch.test.ts
│   ├── useKeyboard.ts             # Task 7 — modal keys (modify)
│   └── useKeyboard.test.ts        # Task 7 (extend)
├── components/
│   ├── DiffSearchButton.tsx       # Task 5
│   ├── DiffSearchButton.test.tsx
│   ├── DiffSearchPopup.tsx        # Task 6
│   └── DiffSearchPopup.test.tsx
└── Panel.tsx                      # Task 8 — wiring (modify)
    Panel.test.tsx                 # Task 8 (extend)
docs/design/UNIFIED.md             # Task 9 — in-pane tool layer exception note
```

---

### Task 1: Pure matcher — `matchDiffLines`

**Files:**
- Create: `src/features/diff/search/matchDiffLines.ts`
- Test: `src/features/diff/search/matchDiffLines.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'vitest'
import { matchDiffLines, type DiffSearchLine } from './matchDiffLines'

const line = (
  side: 'deletions' | 'additions',
  lineIndex: number,
  text: string
): DiffSearchLine => ({ key: `${side}:${lineIndex}`, side, lineIndex, text })

describe('matchDiffLines', () => {
  test('returns empty for empty query', () => {
    expect(matchDiffLines([line('additions', 0, 'const search = 1')], '')).toEqual([])
  })

  test('matches case-insensitively with column offsets', () => {
    expect(matchDiffLines([line('additions', 0, 'const Search = search')], 'search')).toEqual([
      { key: 'additions:0', side: 'additions', lineIndex: 0, start: 6, end: 12 },
      { key: 'additions:0', side: 'additions', lineIndex: 0, start: 15, end: 21 },
    ])
  })

  test('scans non-overlapping (vim-style)', () => {
    expect(matchDiffLines([line('additions', 0, 'aaaa')], 'aa')).toHaveLength(2)
  })

  test('orders deletions before additions on the same lineIndex, then by lineIndex', () => {
    const matches = matchDiffLines(
      [
        line('additions', 2, 'foo'),
        line('additions', 1, 'foo'),
        line('deletions', 1, 'foo'),
      ],
      'foo'
    )
    expect(matches.map((m) => m.key)).toEqual(['deletions:1', 'additions:1', 'additions:2'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/diff/search/matchDiffLines.test.ts`
Expected: FAIL — cannot resolve `./matchDiffLines`

- [ ] **Step 3: Write the implementation**

```typescript
export type DiffSearchSide = 'deletions' | 'additions'

export interface DiffSearchLine {
  /** Unique per rendered line: `${side}:${lineIndex}` */
  key: string
  side: DiffSearchSide
  lineIndex: number
  text: string
}

export interface DiffSearchMatch {
  key: string
  side: DiffSearchSide
  lineIndex: number
  /** Column offsets into the raw line text (start inclusive, end exclusive). */
  start: number
  end: number
}

const SIDE_RANK: Record<DiffSearchSide, number> = { deletions: 0, additions: 1 }

/** Case-insensitive, non-overlapping substring scan in visual order (spec §4). */
export const matchDiffLines = (
  lines: DiffSearchLine[],
  query: string
): DiffSearchMatch[] => {
  if (query === '') {
    return []
  }

  const needle = query.toLowerCase()
  const matches: DiffSearchMatch[] = []

  for (const { key, side, lineIndex, text } of lines) {
    const haystack = text.toLowerCase()
    let from = 0

    for (;;) {
      const start = haystack.indexOf(needle, from)
      if (start === -1) {
        break
      }

      matches.push({ key, side, lineIndex, start, end: start + needle.length })
      from = start + needle.length
    }
  }

  return matches.sort(
    (a, b) =>
      a.lineIndex - b.lineIndex ||
      SIDE_RANK[a.side] - SIDE_RANK[b.side] ||
      a.start - b.start
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/diff/search/matchDiffLines.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/search/matchDiffLines.ts src/features/diff/search/matchDiffLines.test.ts
git commit -m "feat(diff): add pure search matcher for diff lines"
```

---

### Task 2: DOM adapter — constants, feature guard, `collectLines`

**Files:**
- Create: `src/features/diff/search/diffSearchDom.ts`
- Test: `src/features/diff/search/diffSearchDom.test.ts`

Pierre DOM facts this task encodes (verified against `@pierre/diffs@1.2.2` dist — spec §1): lines live in `container.shadowRoot`, each is `<div data-line data-line-index data-line-type>` under `[data-content]`, whose column ancestor is `[data-unified]`, `[data-deletions]`, or `[data-additions]`; `textContent` equals the raw source line plus a trailing `"\n"` on empty lines.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'vitest'
import { collectLines, supportsHighlightApi } from './diffSearchDom'

const buildLine = (lineIndex: number, type: string, text: string): HTMLElement => {
  const el = document.createElement('div')
  el.setAttribute('data-line', '')
  el.setAttribute('data-line-index', String(lineIndex))
  el.setAttribute('data-line-type', type)
  el.textContent = text
  return el
}

const buildColumn = (kind: 'unified' | 'deletions' | 'additions'): {
  code: HTMLElement
  content: HTMLElement
} => {
  const code = document.createElement('code')
  code.setAttribute(`data-${kind}`, '')
  const content = document.createElement('div')
  content.setAttribute('data-content', '')
  code.appendChild(content)
  return { code, content }
}

const buildContainer = (...codes: HTMLElement[]): HTMLElement => {
  const container = document.createElement('div')
  const shadow = container.attachShadow({ mode: 'open' })
  const pre = document.createElement('pre')
  codes.forEach((c) => pre.appendChild(c))
  shadow.appendChild(pre)
  return container
}

describe('collectLines', () => {
  test('collects unified lines in DOM order with side from data-line-type', () => {
    const { code, content } = buildColumn('unified')
    content.appendChild(buildLine(0, 'context', 'alpha'))
    content.appendChild(buildLine(1, 'change-deletion', 'removed'))
    content.appendChild(buildLine(2, 'change-addition', 'added'))

    const { lines } = collectLines(buildContainer(code))

    expect(lines).toEqual([
      { key: 'additions:0', side: 'additions', lineIndex: 0, text: 'alpha' },
      { key: 'deletions:1', side: 'deletions', lineIndex: 1, text: 'removed' },
      { key: 'additions:2', side: 'additions', lineIndex: 2, text: 'added' },
    ])
  })

  test('collects both split columns with side from the column ancestor', () => {
    const del = buildColumn('deletions')
    del.content.appendChild(buildLine(0, 'change-deletion', 'old'))
    const add = buildColumn('additions')
    add.content.appendChild(buildLine(0, 'change-addition', 'new'))

    const { lines, elements } = collectLines(buildContainer(del.code, add.code))

    expect(lines.map((l) => l.key)).toEqual(['deletions:0', 'additions:0'])
    expect(elements.get('deletions:0')?.textContent).toBe('old')
  })

  test('returns empty when the container has no shadow root', () => {
    expect(collectLines(document.createElement('div'))).toEqual({
      lines: [],
      elements: new Map(),
    })
  })

  test('returns empty for null container', () => {
    expect(collectLines(null).lines).toEqual([])
  })
})

describe('supportsHighlightApi', () => {
  test('is false in jsdom', () => {
    expect(supportsHighlightApi()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/diff/search/diffSearchDom.test.ts`
Expected: FAIL — cannot resolve `./diffSearchDom`

- [ ] **Step 3: Write the implementation**

```typescript
import type {
  DiffSearchLine,
  DiffSearchMatch,
  DiffSearchSide,
} from './matchDiffLines'

export const DIFF_SEARCH_HIGHLIGHT = 'vf-diff-search'
export const DIFF_SEARCH_ACTIVE_HIGHLIGHT = 'vf-diff-search-active'

/** Painted via pierre's `unsafeCSS` option — the only way to style inside its
 * shadow tree. Theme custom properties cascade across shadow boundaries. */
export const DIFF_SEARCH_UNSAFE_CSS = [
  `::highlight(${DIFF_SEARCH_HIGHLIGHT}) { background-color: var(--color-selection); }`,
  `::highlight(${DIFF_SEARCH_ACTIVE_HIGHLIGHT}) { background-color: var(--color-primary-container); color: var(--color-on-primary); }`,
].join('\n')

/** Bulk-paint cap (spec §4): the active match is painted separately and is
 * therefore always visible regardless of this cap. */
export const DIFF_SEARCH_BULK_PAINT_CAP = 1000

export interface CollectedDiffLines {
  lines: DiffSearchLine[]
  elements: Map<string, HTMLElement>
}

export const supportsHighlightApi = (): boolean =>
  typeof CSS !== 'undefined' && 'highlights' in CSS

const sideForLine = (el: HTMLElement): DiffSearchSide => {
  if (el.closest('[data-deletions]') !== null) {
    return 'deletions'
  }

  if (el.closest('[data-additions]') !== null) {
    return 'additions'
  }

  // Unified column: deletion rows carry data-line-type="change-deletion";
  // context and addition rows rank as 'additions' (DOM order is visual order).
  return el.getAttribute('data-line-type') === 'change-deletion'
    ? 'deletions'
    : 'additions'
}

/** Walk pierre's shadow root. Sole coupling point to pierre's DOM shape —
 * if pierre restructures, this returns [] and search degrades visibly to
 * "no matches" without throwing (spec §5). */
export const collectLines = (container: Element | null): CollectedDiffLines => {
  const root = container?.shadowRoot ?? null
  if (root === null) {
    return { lines: [], elements: new Map() }
  }

  const lines: DiffSearchLine[] = []
  const elements = new Map<string, HTMLElement>()

  for (const el of root.querySelectorAll<HTMLElement>('[data-content] [data-line]')) {
    const lineIndex = Number(el.getAttribute('data-line-index'))
    if (Number.isNaN(lineIndex)) {
      continue
    }

    const side = sideForLine(el)
    const key = `${side}:${lineIndex}`
    // Empty lines render a lone "\n" text node; strip the trailing newline so
    // offsets always index the raw source line.
    const text = (el.textContent ?? '').replace(/\n$/, '')

    lines.push({ key, side, lineIndex, text })
    elements.set(key, el)
  }

  return { lines, elements }
}
```

(`DiffSearchMatch` import is used by Task 3 — if the linter flags it as unused after this step, add it in Task 3 instead.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/diff/search/diffSearchDom.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/search/diffSearchDom.ts src/features/diff/search/diffSearchDom.test.ts
git commit -m "feat(diff): collect searchable lines from pierre shadow DOM"
```

---

### Task 3: DOM adapter — ranges, paint, clear, scroll

**Files:**
- Modify: `src/features/diff/search/diffSearchDom.ts` (append)
- Test: `src/features/diff/search/diffSearchDom.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append to the existing describe file)

```typescript
import { vi, afterEach } from 'vitest'
import { matchDiffLines } from './matchDiffLines'
import {
  clearPaint,
  paintMatches,
  rangeForMatch,
  scrollToMatch,
  DIFF_SEARCH_ACTIVE_HIGHLIGHT,
  DIFF_SEARCH_BULK_PAINT_CAP,
  DIFF_SEARCH_HIGHLIGHT,
} from './diffSearchDom'

describe('rangeForMatch', () => {
  test('spans a match across multiple token spans', () => {
    const el = document.createElement('div')
    // "const search" tokenized as <span>const </span><span>search</span>
    const a = document.createElement('span')
    a.textContent = 'const '
    const b = document.createElement('span')
    b.textContent = 'search'
    el.append(a, b)

    // match "t sea" = offsets 4..9, crossing the span boundary
    const range = rangeForMatch(el, 4, 9)

    expect(range?.startContainer).toBe(a.firstChild)
    expect(range?.startOffset).toBe(4)
    expect(range?.endContainer).toBe(b.firstChild)
    expect(range?.endOffset).toBe(3)
  })

  test('returns null when offsets exceed the text', () => {
    const el = document.createElement('div')
    el.textContent = 'ab'
    expect(rangeForMatch(el, 1, 9)).toBeNull()
  })
})

describe('paintMatches / clearPaint (stubbed registry)', () => {
  const registry = new Map<string, unknown>()
  const HighlightStub = vi.fn(function (this: { ranges: unknown[] }, ...ranges: unknown[]) {
    this.ranges = ranges
  })

  afterEach(() => {
    registry.clear()
    vi.unstubAllGlobals()
  })

  const stubHighlights = (): void => {
    vi.stubGlobal('Highlight', HighlightStub)
    vi.stubGlobal('CSS', { highlights: registry })
  }

  const collectedFixture = (): ReturnType<typeof collectLines> => {
    const { code, content } = buildColumn('unified')
    content.appendChild(buildLine(0, 'context', 'search me, search you'))
    const container = buildContainer(code)
    document.body.appendChild(container)
    return collectLines(container)
  }

  test('registers bulk and active highlights', () => {
    stubHighlights()
    const collected = collectedFixture()
    const matches = matchDiffLines(collected.lines, 'search')

    paintMatches(collected, matches, 1)

    expect(registry.has(DIFF_SEARCH_HIGHLIGHT)).toBe(true)
    expect(registry.has(DIFF_SEARCH_ACTIVE_HIGHLIGHT)).toBe(true)
  })

  test('no-ops without the Highlight API', () => {
    const collected = collectedFixture()
    expect(() =>
      paintMatches(collected, matchDiffLines(collected.lines, 'search'), 0)
    ).not.toThrow()
  })

  test('caps bulk ranges but always paints the active match', () => {
    stubHighlights()
    const longText = 'x '.repeat(DIFF_SEARCH_BULK_PAINT_CAP + 50)
    const { code, content } = buildColumn('unified')
    content.appendChild(buildLine(0, 'context', longText))
    const container = buildContainer(code)
    document.body.appendChild(container)
    const collected = collectLines(container)
    const matches = matchDiffLines(collected.lines, 'x')

    paintMatches(collected, matches, matches.length - 1)

    const bulk = HighlightStub.mock.calls[HighlightStub.mock.calls.length - 2]
    expect(bulk).toHaveLength(DIFF_SEARCH_BULK_PAINT_CAP)
    expect(registry.has(DIFF_SEARCH_ACTIVE_HIGHLIGHT)).toBe(true)
  })

  test('clearPaint deletes both registry entries', () => {
    stubHighlights()
    registry.set(DIFF_SEARCH_HIGHLIGHT, {})
    registry.set(DIFF_SEARCH_ACTIVE_HIGHLIGHT, {})

    clearPaint()

    expect(registry.size).toBe(0)
  })
})

describe('scrollToMatch', () => {
  test('scrolls the matched line element into view', () => {
    const el = document.createElement('div')
    const scrollSpy = vi.fn()
    el.scrollIntoView = scrollSpy
    const elements = new Map([['additions:0', el]])

    scrollToMatch(
      { key: 'additions:0', side: 'additions', lineIndex: 0, start: 0, end: 1 },
      elements
    )

    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' })
  })
})
```

(Reuse `buildLine` / `buildColumn` / `buildContainer` from Task 2's test file — they are module-level helpers there.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/features/diff/search/diffSearchDom.test.ts`
Expected: FAIL — `rangeForMatch` etc. not exported

- [ ] **Step 3: Append the implementation**

```typescript
/** Map column offsets [start, end) to a Range across the line's text nodes. */
export const rangeForMatch = (
  lineEl: HTMLElement,
  start: number,
  end: number
): Range | null => {
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let consumed = 0
  let startSet = false

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0

    if (!startSet && start < consumed + length) {
      range.setStart(node, start - consumed)
      startSet = true
    }

    if (startSet && end <= consumed + length) {
      range.setEnd(node, end - consumed)
      return range
    }

    consumed += length
  }

  return null
}

/** Fully re-register both highlight names (never patched incrementally —
 * spec §5 rebuild-race rule). Caller is responsible for gating on
 * paintEnabled/generation; this guards API support + connectivity only. */
export const paintMatches = (
  collected: CollectedDiffLines,
  matches: DiffSearchMatch[],
  activeIndex: number
): void => {
  if (!supportsHighlightApi()) {
    return
  }

  const bulkRanges: Range[] = []

  for (const match of matches.slice(0, DIFF_SEARCH_BULK_PAINT_CAP)) {
    const el = collected.elements.get(match.key)
    if (el === undefined || !el.isConnected) {
      continue
    }

    const range = rangeForMatch(el, match.start, match.end)
    if (range !== null) {
      bulkRanges.push(range)
    }
  }

  CSS.highlights.set(DIFF_SEARCH_HIGHLIGHT, new Highlight(...bulkRanges))

  const active = matches[activeIndex]
  const activeEl = active === undefined ? undefined : collected.elements.get(active.key)
  const activeRange =
    activeEl === undefined || !activeEl.isConnected
      ? null
      : rangeForMatch(activeEl, active.start, active.end)

  if (activeRange === null) {
    CSS.highlights.delete(DIFF_SEARCH_ACTIVE_HIGHLIGHT)
  } else {
    CSS.highlights.set(DIFF_SEARCH_ACTIVE_HIGHLIGHT, new Highlight(activeRange))
  }
}

export const clearPaint = (): void => {
  if (!supportsHighlightApi()) {
    return
  }

  CSS.highlights.delete(DIFF_SEARCH_HIGHLIGHT)
  CSS.highlights.delete(DIFF_SEARCH_ACTIVE_HIGHLIGHT)
}

export const scrollToMatch = (
  match: DiffSearchMatch,
  elements: Map<string, HTMLElement>
): void => {
  elements.get(match.key)?.scrollIntoView({ block: 'nearest' })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/diff/search/diffSearchDom.test.ts`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/search/diffSearchDom.ts src/features/diff/search/diffSearchDom.test.ts
git commit -m "feat(diff): paint search matches via CSS Highlight API"
```

---

### Task 4: State owner — `useDiffSearch`

**Files:**
- Create: `src/features/diff/hooks/useDiffSearch.ts`
- Test: `src/features/diff/hooks/useDiffSearch.test.ts`

Contract recap (spec §2/§4): file-key change → reset active to 0; `null` key → close + clear; same-file repaint → preserve + clamp; `setQuery` → reset to 0, `hasNavigated = false`, no scroll; first `commit` scrolls without stepping and sets `hasNavigated`; repaints are rAF-coalesced and generation-gated.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDiffSearch } from './useDiffSearch'
import * as dom from '../search/diffSearchDom'

const lines = [
  { key: 'additions:0', side: 'additions' as const, lineIndex: 0, text: 'search alpha' },
  { key: 'additions:1', side: 'additions' as const, lineIndex: 1, text: 'search beta' },
]

const collected = { lines, elements: new Map<string, HTMLElement>() }

beforeEach(() => {
  vi.spyOn(dom, 'collectLines').mockReturnValue(collected)
  vi.spyOn(dom, 'paintMatches').mockImplementation(() => undefined)
  vi.spyOn(dom, 'clearPaint').mockImplementation(() => undefined)
  vi.spyOn(dom, 'scrollToMatch').mockImplementation(() => undefined)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    cb(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const render = (fileKey: string | null = 'a.ts:unstaged') => {
  const focusPanel = vi.fn()
  const hook = renderHook(
    ({ key }) => useDiffSearch({ fileKey: key, paintEnabled: true, focusPanel }),
    { initialProps: { key: fileKey } }
  )
  // Simulate pierre's first onPostRender so lines are collected.
  act(() => hook.result.current.handlePostRender(document.createElement('div')))
  return { ...hook, focusPanel }
}

describe('useDiffSearch', () => {
  test('open/setQuery computes matches and activates the first without scrolling', () => {
    const { result } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('search'))

    expect(result.current.isOpen).toBe(true)
    expect(result.current.matchCount).toBe(2)
    expect(result.current.activeOrdinal).toBe(1)
    expect(dom.scrollToMatch).not.toHaveBeenCalled()
  })

  test('first commit scrolls without stepping; second commit steps', () => {
    const { result, focusPanel } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('search'))

    act(() => result.current.commit(1))
    expect(result.current.activeOrdinal).toBe(1)
    expect(dom.scrollToMatch).toHaveBeenCalledTimes(1)
    expect(focusPanel).toHaveBeenCalled()

    act(() => result.current.commit(1))
    expect(result.current.activeOrdinal).toBe(2)
  })

  test('step wraps both directions', () => {
    const { result } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('search'))

    act(() => result.current.step(-1))
    expect(result.current.activeOrdinal).toBe(2)
    act(() => result.current.step(1))
    expect(result.current.activeOrdinal).toBe(1)
  })

  test('zero matches: counter is 0 and step is a no-op', () => {
    const { result } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('nomatch'))

    expect(result.current.matchCount).toBe(0)
    act(() => result.current.step(1))
    expect(dom.scrollToMatch).not.toHaveBeenCalled()
  })

  test('file-key change resets the active match; null key closes and clears', () => {
    const { result, rerender } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('search'))
    act(() => result.current.step(1))
    expect(result.current.activeOrdinal).toBe(2)

    rerender({ key: 'b.ts:unstaged' })
    act(() => result.current.handlePostRender(document.createElement('div')))
    expect(result.current.activeOrdinal).toBe(1)
    expect(result.current.isOpen).toBe(true)

    rerender({ key: null })
    expect(result.current.isOpen).toBe(false)
    expect(result.current.query).toBe('')
    expect(dom.clearPaint).toHaveBeenCalled()
  })

  test('close clears query, paint, and reverts state', () => {
    const { result } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('search'))
    act(() => result.current.close())

    expect(result.current.isOpen).toBe(false)
    expect(result.current.query).toBe('')
    expect(dom.clearPaint).toHaveBeenCalled()
  })

  test('unmount clears paint', () => {
    const { result, unmount } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('search'))
    unmount()
    expect(dom.clearPaint).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/diff/hooks/useDiffSearch.test.ts`
Expected: FAIL — cannot resolve `./useDiffSearch`

- [ ] **Step 3: Write the implementation**

```typescript
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { matchDiffLines, type DiffSearchMatch } from '../search/matchDiffLines'
import {
  clearPaint,
  collectLines,
  paintMatches,
  scrollToMatch,
  type CollectedDiffLines,
} from '../search/diffSearchDom'

export interface UseDiffSearchOptions {
  /** `${path}:${'staged' | 'unstaged'}` or null when no diff is shown (also
   * null while the narrow placeholder is engaged — spec §2 close rule). */
  fileKey: string | null
  /** Mount ⇔ visible via DockPanel's conditional render; gates painting so a
   * hidden/stale panel can never own the global highlight registry (spec §5). */
  paintEnabled: boolean
  /** Returns focus to the diff panel root (existing `focusDiffRoot`). */
  focusPanel: () => void
}

export interface UseDiffSearchResult {
  isOpen: boolean
  query: string
  matchCount: number
  /** 1-based ordinal of the active match; 0 when there are none. */
  activeOrdinal: number
  open: () => void
  close: () => void
  setQuery: (query: string) => void
  step: (direction: 1 | -1) => void
  commit: (direction: 1 | -1) => void
  /** Wire to pierre options.onPostRender via a stable forwarding callback. */
  handlePostRender: (node: Element) => void
  inputRef: RefObject<HTMLInputElement | null>
}

export const useDiffSearch = ({
  fileKey,
  paintEnabled,
  focusPanel,
}: UseDiffSearchOptions): UseDiffSearchResult => {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQueryState] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [matches, setMatches] = useState<DiffSearchMatch[]>([])

  const collectedRef = useRef<CollectedDiffLines>({ lines: [], elements: new Map() })
  const containerRef = useRef<Element | null>(null)
  const hasNavigatedRef = useRef(false)
  const generationRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const recompute = useCallback(
    (nextQuery: string, reconcile: (count: number) => number): void => {
      const nextMatches = matchDiffLines(collectedRef.current.lines, nextQuery)
      setMatches(nextMatches)
      setActiveIndex(reconcile(nextMatches.length))
    },
    []
  )

  // Single paint effect: repaint whenever paint inputs change (spec §4 pipeline).
  useEffect(() => {
    if (!paintEnabled || !isOpen || query === '') {
      clearPaint()
      return
    }

    paintMatches(collectedRef.current, matches, activeIndex)
  }, [paintEnabled, isOpen, query, matches, activeIndex])

  // pierre rebuilt its DOM: re-collect on the next frame (coalesced), then
  // recompute with preserve+clamp (same-file rule, spec §2).
  const handlePostRender = useCallback(
    (node: Element): void => {
      containerRef.current = node
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }

      const generation = generationRef.current
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        if (generation !== generationRef.current) {
          return
        }

        collectedRef.current = collectLines(containerRef.current)
        setQueryState((current) => {
          recompute(current, (count) =>
            count === 0 ? 0 : Math.min(activeIndexRef.current, count - 1)
          )
          return current
        })
      })
    },
    [recompute]
  )

  // Ref mirror so the rAF callback clamps against the live index without
  // re-subscribing pierre options.
  const activeIndexRef = useRef(activeIndex)
  activeIndexRef.current = activeIndex

  const close = useCallback((): void => {
    generationRef.current += 1
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    setIsOpen(false)
    setQueryState('')
    setMatches([])
    setActiveIndex(0)
    hasNavigatedRef.current = false
    clearPaint()
    focusPanel()
  }, [focusPanel])

  const open = useCallback((): void => {
    setIsOpen(true)
    // Focus + select happens after the popup renders.
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const setQuery = useCallback(
    (next: string): void => {
      setQueryState(next)
      hasNavigatedRef.current = false
      recompute(next, () => 0)
    },
    [recompute]
  )

  const step = useCallback(
    (direction: 1 | -1): void => {
      if (matches.length === 0) {
        return
      }

      hasNavigatedRef.current = true
      const next = (activeIndex + direction + matches.length) % matches.length
      setActiveIndex(next)
      scrollToMatch(matches[next], collectedRef.current.elements)
    },
    [matches, activeIndex]
  )

  const commit = useCallback(
    (direction: 1 | -1): void => {
      if (matches.length > 0) {
        if (hasNavigatedRef.current) {
          const next = (activeIndex + direction + matches.length) % matches.length
          setActiveIndex(next)
          scrollToMatch(matches[next], collectedRef.current.elements)
        } else {
          hasNavigatedRef.current = true
          scrollToMatch(matches[activeIndex], collectedRef.current.elements)
        }
      }

      focusPanel()
    },
    [matches, activeIndex, focusPanel]
  )

  // File identity transitions (spec §2): new key → reset to first match;
  // null key → close entirely.
  const previousKeyRef = useRef(fileKey)
  useEffect(() => {
    if (fileKey === previousKeyRef.current) {
      return
    }

    previousKeyRef.current = fileKey
    if (fileKey === null) {
      close()
      return
    }

    hasNavigatedRef.current = false
    setActiveIndex(0)
  }, [fileKey, close])

  // Unmount / paint-authority loss: never leave global registry entries behind.
  useEffect(() => {
    return (): void => {
      generationRef.current += 1
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
      clearPaint()
    }
  }, [])

  const activeOrdinal = matches.length === 0 ? 0 : activeIndex + 1

  return useMemo(
    () => ({
      isOpen,
      query,
      matchCount: matches.length,
      activeOrdinal,
      open,
      close,
      setQuery,
      step,
      commit,
      handlePostRender,
      inputRef,
    }),
    [isOpen, query, matches.length, activeOrdinal, open, close, setQuery, step, commit, handlePostRender]
  )
}
```

Note: `setQueryState((current) => { recompute(...); return current })` inside the rAF callback is a functional-update trick to read the live query without adding it to `handlePostRender`'s deps (which must stay stable). If the linter objects to the side effect inside the updater, hoist a `queryRef` mirror (like `activeIndexRef`) and call `recompute(queryRef.current, …)` directly — behavior is identical; prefer whichever passes `react-hooks` lint cleanly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/diff/hooks/useDiffSearch.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/hooks/useDiffSearch.ts src/features/diff/hooks/useDiffSearch.test.ts
git commit -m "feat(diff): add useDiffSearch state hook"
```

---

### Task 5: `DiffSearchButton`

**Files:**
- Create: `src/features/diff/components/DiffSearchButton.tsx`
- Test: `src/features/diff/components/DiffSearchButton.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiffSearchButton } from './DiffSearchButton'

describe('DiffSearchButton', () => {
  test('renders an accessible search button and fires onOpen', async () => {
    const onOpen = vi.fn()
    render(<DiffSearchButton onOpen={onOpen} />)

    const button = screen.getByRole('button', { name: /search in diff/i })
    await userEvent.click(button)

    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/diff/components/DiffSearchButton.test.tsx`
Expected: FAIL — cannot resolve `./DiffSearchButton`

- [ ] **Step 3: Write the implementation** (spec §2 recipe: glass chip, icon-only hover)

```typescript
import type { ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'

interface DiffSearchButtonProps {
  onOpen: () => void
}

/** Floating search entry point — anchored by Panel 4px under the toolbar,
 * 22px off the right edge (spec §2). Hover tints the icon only. */
export const DiffSearchButton = ({
  onOpen,
}: DiffSearchButtonProps): ReactElement => (
  <IconButton
    icon="search"
    label="Search in diff"
    shortcut="/"
    size="md"
    className="absolute right-[22px] top-1 z-30 h-[34px] w-[34px] rounded-xl border border-outline-variant/25 bg-surface-container-high/30 text-on-surface-muted shadow-md backdrop-blur-[14px] backdrop-saturate-150 hover:bg-surface-container-high/30 hover:text-primary"
    onClick={onOpen}
  />
)
```

(If `IconButton`'s hover styles fight the override, check its variant classes and neutralize with explicit `hover:bg-…` as above; the contract is: fill/border never change on hover, icon color does.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/diff/components/DiffSearchButton.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/components/DiffSearchButton.tsx src/features/diff/components/DiffSearchButton.test.tsx
git commit -m "feat(diff): add floating search button"
```

---

### Task 6: `DiffSearchPopup`

**Files:**
- Create: `src/features/diff/components/DiffSearchPopup.tsx`
- Test: `src/features/diff/components/DiffSearchPopup.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { DiffSearchPopup } from './DiffSearchPopup'

const baseProps = {
  open: true,
  query: '',
  matchCount: 0,
  activeOrdinal: 0,
  confirming: false,
  inputRef: createRef<HTMLInputElement>(),
  onQueryChange: vi.fn(),
  onCommit: vi.fn(),
  onStep: vi.fn(),
  onClose: vi.fn(),
}

describe('DiffSearchPopup', () => {
  test('exposes a search landmark with labeled controls', () => {
    render(<DiffSearchPopup {...baseProps} />)

    expect(screen.getByRole('search')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /search in diff/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /previous match/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next match/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /close search/i })).toBeInTheDocument()
  })

  test('counter states: empty query → blank; matches → k/N; none → 0/0', () => {
    const { rerender } = render(<DiffSearchPopup {...baseProps} />)
    expect(screen.getByRole('status').textContent).toBe('')

    rerender(<DiffSearchPopup {...baseProps} query="se" matchCount={12} activeOrdinal={3} />)
    expect(screen.getByRole('status')).toHaveTextContent('3/12')

    rerender(<DiffSearchPopup {...baseProps} query="zz" matchCount={0} activeOrdinal={0} />)
    expect(screen.getByRole('status')).toHaveTextContent('0/0')
  })

  test('Enter commits forward, Shift+Enter backward, Esc closes', async () => {
    const onCommit = vi.fn()
    const onClose = vi.fn()
    render(<DiffSearchPopup {...baseProps} query="se" onCommit={onCommit} onClose={onClose} />)
    const input = screen.getByRole('textbox', { name: /search in diff/i })

    await userEvent.type(input, '{Enter}')
    expect(onCommit).toHaveBeenLastCalledWith(1)

    await userEvent.type(input, '{Shift>}{Enter}{/Shift}')
    expect(onCommit).toHaveBeenLastCalledWith(-1)

    await userEvent.type(input, '{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  test('Esc is inert while confirming (spec §3)', async () => {
    const onClose = vi.fn()
    render(<DiffSearchPopup {...baseProps} confirming onClose={onClose} />)

    await userEvent.type(screen.getByRole('textbox', { name: /search in diff/i }), '{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  test('typing forwards to onQueryChange', async () => {
    const onQueryChange = vi.fn()
    render(<DiffSearchPopup {...baseProps} onQueryChange={onQueryChange} />)

    await userEvent.type(screen.getByRole('textbox', { name: /search in diff/i }), 'a')
    expect(onQueryChange).toHaveBeenCalledWith('a')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/diff/components/DiffSearchPopup.test.tsx`
Expected: FAIL — cannot resolve `./DiffSearchPopup`

- [ ] **Step 3: Write the implementation** (spec §2 glass recipe; mounted always, class-toggled so the motion-safe transition can play; inert when closed)

```typescript
import type { KeyboardEvent, ReactElement, RefObject } from 'react'
import { IconButton } from '@/components/IconButton'

interface DiffSearchPopupProps {
  open: boolean
  query: string
  matchCount: number
  activeOrdinal: number
  confirming: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onQueryChange: (query: string) => void
  onCommit: (direction: 1 | -1) => void
  onStep: (direction: 1 | -1) => void
  onClose: () => void
}

/** Modeless in-pane search popup — #645 unpinned-panel recipe, deliberately
 * NOT the shared Popover (spec §2 primitive-choice + UNIFIED.md exception). */
export const DiffSearchPopup = ({
  open,
  query,
  matchCount,
  activeOrdinal,
  confirming,
  inputRef,
  onQueryChange,
  onCommit,
  onStep,
  onClose,
}: DiffSearchPopupProps): ReactElement => {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onCommit(event.shiftKey ? -1 : 1)
    }

    if (event.key === 'Escape') {
      event.stopPropagation()
      if (!confirming) {
        onClose()
      }
    }
  }

  return (
    <div
      role="search"
      inert={!open}
      className={`absolute right-[22px] top-1 z-30 flex w-[330px] max-w-[calc(100%-24px)] origin-top-right items-center gap-1.5 rounded-2xl border border-outline-variant/30 bg-surface-container-high/85 p-2 shadow-2xl backdrop-blur-[34px] backdrop-brightness-110 backdrop-saturate-[180%] motion-safe:transition-[opacity,transform] motion-safe:duration-200 motion-safe:ease-out ${
        open
          ? 'opacity-100 scale-100 translate-y-0'
          : 'pointer-events-none opacity-0 scale-[0.92] -translate-y-1.5'
      }`}
    >
      <input
        ref={inputRef}
        type="text"
        aria-label="Search in diff"
        placeholder="Search in diff…"
        spellCheck={false}
        value={query}
        onChange={(event): void => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className="min-w-0 flex-1 bg-transparent px-2 py-1 font-mono text-xs text-on-surface outline-none placeholder:text-on-surface-muted"
      />
      <span
        role="status"
        aria-live="polite"
        className="min-w-9 text-right font-mono text-[11px] text-on-surface-muted"
      >
        {query === '' ? '' : `${activeOrdinal}/${matchCount}`}
      </span>
      <span className="h-4 w-px bg-outline-variant/50" aria-hidden="true" />
      <IconButton icon="keyboard_arrow_up" label="Previous match" size="sm" onClick={(): void => onStep(-1)} />
      <IconButton icon="keyboard_arrow_down" label="Next match" size="sm" onClick={(): void => onStep(1)} />
      <IconButton icon="close" label="Close search" size="sm" onClick={onClose} />
    </div>
  )
}
```

(React 19 supports the `inert` boolean prop directly. `role="status"` gives the counter its accessible name-free live region — matches the test's `getByRole('status')`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/diff/components/DiffSearchPopup.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/components/DiffSearchPopup.tsx src/features/diff/components/DiffSearchPopup.test.tsx
git commit -m "feat(diff): add glass search popup"
```

---

### Task 7: Modal keys in `useKeyboard`

**Files:**
- Modify: `src/features/diff/hooks/useKeyboard.ts`
- Test: `src/features/diff/hooks/useKeyboard.test.ts` (extend — reuse the file's `dispatch`/`appendDiffRoot` helpers and its existing `baseOptions` pattern)

- [ ] **Step 1: Write the failing tests** (append a describe block)

```typescript
describe('search mode', () => {
  test('/ fires onOpenSearch and is prevented', () => {
    const onOpenSearch = vi.fn()
    const { ref } = appendDiffRoot()
    renderHook(() => useKeyboard(options({ rootRef: ref, onOpenSearch })))

    const event = dispatch('/')

    expect(onOpenSearch).toHaveBeenCalledTimes(1)
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('searchOpen remaps n/p to match navigation', () => {
    const onNextMatch = vi.fn()
    const onPreviousMatch = vi.fn()
    const onNextFile = vi.fn()
    const { ref } = appendDiffRoot()
    renderHook(() =>
      useKeyboard(
        options({ rootRef: ref, searchOpen: true, onNextMatch, onPreviousMatch, onNextFile })
      )
    )

    dispatch('n')
    dispatch('p')

    expect(onNextMatch).toHaveBeenCalledTimes(1)
    expect(onPreviousMatch).toHaveBeenCalledTimes(1)
    expect(onNextFile).not.toHaveBeenCalled()
  })

  test('search closed keeps n/p on file navigation', () => {
    const onNextFile = vi.fn()
    const onNextMatch = vi.fn()
    const { ref } = appendDiffRoot()
    renderHook(() =>
      useKeyboard(options({ rootRef: ref, searchOpen: false, onNextFile, onNextMatch }))
    )

    dispatch('n')

    expect(onNextFile).toHaveBeenCalledTimes(1)
    expect(onNextMatch).not.toHaveBeenCalled()
  })

  test('Esc closes search before cancelling visual mode', () => {
    const onCloseSearch = vi.fn()
    const onCancelVisualSelection = vi.fn()
    const { ref } = appendDiffRoot()
    renderHook(() =>
      useKeyboard(
        options({
          rootRef: ref,
          searchOpen: true,
          visualMode: true,
          onCloseSearch,
          onCancelVisualSelection,
        })
      )
    )

    dispatch('Escape')

    expect(onCloseSearch).toHaveBeenCalledTimes(1)
    expect(onCancelVisualSelection).not.toHaveBeenCalled()
  })

  test('confirming keeps Esc and / inert', () => {
    const onCloseSearch = vi.fn()
    const onOpenSearch = vi.fn()
    const { ref } = appendDiffRoot()
    renderHook(() =>
      useKeyboard(
        options({ rootRef: ref, confirming: true, searchOpen: true, onCloseSearch, onOpenSearch })
      )
    )

    dispatch('Escape')
    dispatch('/')

    expect(onCloseSearch).not.toHaveBeenCalled()
    expect(onOpenSearch).not.toHaveBeenCalled()
  })

  test('other diff keys stay bound while search is open', () => {
    const onStageHunk = vi.fn()
    const { ref } = appendDiffRoot()
    renderHook(() => useKeyboard(options({ rootRef: ref, searchOpen: true, onStageHunk })))

    dispatch('s')

    expect(onStageHunk).toHaveBeenCalledTimes(1)
  })
})
```

(`options(overrides)` refers to the test file's existing base-options factory; if it's named differently — e.g. `makeOptions` / inline object spreads — follow the file's local convention and add the four new callbacks + `searchOpen` to its defaults with `vi.fn()` / `false`.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/features/diff/hooks/useKeyboard.test.ts`
Expected: FAIL — new options unknown / handlers not firing

- [ ] **Step 3: Implement** — three edits to `useKeyboard.ts`:

**(a)** Extend `UseKeyboardOptions` (after `onToggleFilesListPinned`):

```typescript
  searchOpen: boolean
  onOpenSearch: () => void
  onCloseSearch: () => void
  onNextMatch: () => void
  onPreviousMatch: () => void
```

**(b)** Replace the visual-mode Escape block (currently `if (visualMode && event.key === 'Escape') { … }`) with the spec §3 priority chain (this code runs after the confirming branch and dialog gate, so both already take precedence):

```typescript
      if (event.key === 'Escape') {
        if (searchOpen) {
          event.preventDefault()
          event.stopPropagation()
          onCloseSearch()

          return
        }

        if (visualMode) {
          event.preventDefault()
          event.stopPropagation()
          onCancelVisualSelection()

          return
        }
      }
```

**(c)** In the `handlers` map, remap `n`/`p` and add `/`:

```typescript
        n: searchOpen ? onNextMatch : onNextFile,
        p: searchOpen ? onPreviousMatch : onPreviousFile,
        '/': onOpenSearch,
```

Destructure the five new options alongside the existing ones and add them to the effect's dependency array (the array is exhaustive in this file — keep it that way).

- [ ] **Step 4: Run the full hook suite**

Run: `npx vitest run src/features/diff/hooks/useKeyboard.test.ts`
Expected: PASS — all existing tests plus the 6 new ones

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/hooks/useKeyboard.ts src/features/diff/hooks/useKeyboard.test.ts
git commit -m "feat(diff): add modal search keys to diff keyboard"
```

---

### Task 8: Panel wiring

**Files:**
- Modify: `src/features/diff/Panel.tsx`
- Test: `src/features/diff/Panel.test.tsx` (extend — reuse its existing render harness/mocks)

Anchors in current `Panel.tsx` (line numbers from `feature/vim-252` @ `58bf8e00` — re-locate by symbol if drifted):
- `useToolbarState()` destructure: ~line 910 (`multiFileDiffOptions`)
- `reviewTargetFileKey` derivation: ~line 926 (the file-identity pattern to mirror)
- `useKeyboard({ … })` call: ~line 1572
- Populated root `<div ref={diffRootRef} data-testid="diff-populated-state" …>`: ~line 1791
- `<PanelBody … options={multiFileDiffOptions} …/>`: ~line 1954; its parent wrapper is the `relative` container that also hosts the `ChangedFilesList` overlay — the search button/popup anchor
- `focusDiffRoot()` already exists (used by file-comment delete)

- [ ] **Step 1: Write the failing tests** (append to `Panel.test.tsx`, following its existing setup — pierre is already mocked there; assert against the mock's received props)

```typescript
describe('diff search wiring', () => {
  test('passes a constant unsafeCSS and a stable onPostRender to pierre options', () => {
    const { rerender } = renderPanel()
    const first = lastPanelBodyOptions()

    expect(first.unsafeCSS).toContain('::highlight(vf-diff-search)')

    rerender()
    const second = lastPanelBodyOptions()
    expect(second.unsafeCSS).toBe(first.unsafeCSS)
    expect(second.onPostRender).toBe(first.onPostRender)
  })

  test('/ opens the search popup and focuses its input', async () => {
    renderPanel()

    fireEvent.keyDown(document, { key: '/' })

    const popup = await screen.findByRole('search')
    expect(popup).not.toHaveAttribute('inert')
  })

  test('popup closes when the selected file goes away', async () => {
    const { clearFiles } = renderPanel()
    fireEvent.keyDown(document, { key: '/' })
    await screen.findByRole('search')

    clearFiles()

    await waitFor(() => {
      expect(screen.getByRole('search')).toHaveAttribute('inert')
    })
  })
})
```

(`renderPanel` / `lastPanelBodyOptions` / `clearFiles` stand for the harness this file already uses to mount Panel with mock git data and to inspect the mocked `PanelBody`/`MultiFileDiff` props — wire the new assertions through whatever those helpers are actually called; add a `lastPanelBodyOptions` accessor to the existing PanelBody mock if one doesn't exist yet.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/features/diff/Panel.test.tsx -t 'diff search wiring'`
Expected: FAIL

- [ ] **Step 3: Implement the wiring** — five edits to `Panel.tsx`:

**(a)** Imports:

```typescript
import { useDiffSearch } from './hooks/useDiffSearch'
import { DIFF_SEARCH_UNSAFE_CSS } from './search/diffSearchDom'
import { DiffSearchButton } from './components/DiffSearchButton'
import { DiffSearchPopup } from './components/DiffSearchPopup'
```

**(b)** After the `useToolbarState()` destructure, mount the hook + compose options (mirror the `reviewTargetFileKey` pattern; `tooNarrow → null` implements the spec §2 narrow-close rule):

```typescript
  const diffSearchFileKey =
    selectedFilePath === null || tooNarrow
      ? null
      : `${selectedFilePath}:${selectedFileStaged ? 'staged' : 'unstaged'}`

  const diffSearch = useDiffSearch({
    fileKey: diffSearchFileKey,
    // Mount ⇔ visible: DockPanel renders the diff tab conditionally, so a
    // mounted Panel is the one visible painter (spec §5 authority).
    paintEnabled: true,
    focusPanel: focusDiffRoot,
  })

  const diffSearchPostRenderRef = useRef(diffSearch.handlePostRender)
  diffSearchPostRenderRef.current = diffSearch.handlePostRender
  const handleDiffPostRender = useCallback<
    NonNullable<FileDiffOptions<ReviewComment>['onPostRender']>
  >((node, instance) => {
    diffSearchPostRenderRef.current(node)
    // Compose-don't-replace (spec §4): if multiFileDiffOptions ever grows its
    // own onPostRender, forward to it here.
    void instance
  }, [])

  const diffOptionsWithSearch = useMemo<FileDiffOptions<ReviewComment>>(
    () => ({
      ...multiFileDiffOptions,
      unsafeCSS: DIFF_SEARCH_UNSAFE_CSS,
      onPostRender: handleDiffPostRender,
    }),
    [multiFileDiffOptions, handleDiffPostRender]
  )
```

(Adjust the `onPostRender` callback signature to whatever `FileDiffOptions['onPostRender']` actually declares — pierre types it as `(node, instance) => void`; if the generic import is awkward use `Parameters<NonNullable<FileDiffOptions<ReviewComment>['onPostRender']>>`.)

**(c)** Extend the `useKeyboard({ … })` call:

```typescript
    searchOpen: diffSearch.isOpen,
    onOpenSearch: diffSearch.open,
    onCloseSearch: diffSearch.close,
    onNextMatch: (): void => diffSearch.step(1),
    onPreviousMatch: (): void => diffSearch.step(-1),
```

**(d)** Swap the options prop on `PanelBody`: `options={multiFileDiffOptions}` → `options={diffOptionsWithSearch}`.

**(e)** In the populated JSX, inside the `relative` wrapper that hosts the `ChangedFilesList` overlay and `PanelBody`, render (button hidden while open — spec §2):

```tsx
          {!diffSearch.isOpen && <DiffSearchButton onOpen={diffSearch.open} />}
          <DiffSearchPopup
            open={diffSearch.isOpen}
            query={diffSearch.query}
            matchCount={diffSearch.matchCount}
            activeOrdinal={diffSearch.activeOrdinal}
            confirming={keyboardConfirmAction !== null}
            inputRef={diffSearch.inputRef}
            onQueryChange={diffSearch.setQuery}
            onCommit={diffSearch.commit}
            onStep={diffSearch.step}
            onClose={diffSearch.close}
          />
```

If that wrapper lacks `relative`, add it (the `ChangedFilesList` unpinned overlay already requires one — verify with the browser devtools if unsure which div it is).

- [ ] **Step 4: Run the Panel suite**

Run: `npx vitest run src/features/diff/Panel.test.tsx`
Expected: PASS — all existing + 3 new

- [ ] **Step 5: Run the whole diff module** (umbrella rule: full module, not just touched files)

Run: `npx vitest run src/features/diff`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/diff/Panel.tsx src/features/diff/Panel.test.tsx
git commit -m "feat(diff): wire vim-modal search into diff panel"
```

---

### Task 9: Design-system exception note + quality gate

**Files:**
- Modify: `docs/design/UNIFIED.md` (floating-surface / component-contract section)

- [ ] **Step 1: Add the exception note** — locate the floating-surface rule in `docs/design/UNIFIED.md` (the "compose `Dropdown`/`Menu`/`Popover`, don't hand-roll" contract) and append:

```markdown
> **In-pane tool layers (exception).** Absolutely-positioned surfaces that live
> *inside* a feature panel's subtree — the diff changed-files overlay (#645) and
> the diff search popup (VIM-252) — are not floating surfaces in this contract's
> sense: they are modeless, non-portaled, anchored to the panel (not a trigger),
> and must stay inside the panel for keyboard-scope containment. They reuse the
> glass recipe tokens directly and never import `@floating-ui`.
```

- [ ] **Step 2: Repo-wide quality gate** (CI "Code Quality Check" runs repo-wide — matching it locally is mandatory before push)

Run: `npm run lint && npm run format:check && npm run type-check`
Expected: all clean. Fix anything that surfaces (common trip-wires: unused import from Task 2's forward-declared type, CSpell on `vf-diff-search` — add to the inline dictionary or rename tokens consistently if flagged).

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: PASS (known unrelated local failure: `editorFileLifecycleStatus` home-path casing — pre-existing on macOS, not yours)

- [ ] **Step 4: Commit**

```bash
git add docs/design/UNIFIED.md
git commit -m "docs(design): record in-pane tool layer exception for diff search"
```

---

## Done criteria (map to Linear VIM-252 acceptance)

- Search operates within the selected diff file and jumps between matches → Tasks 1, 4, 7, 8.
- `/` opens, `Esc` closes, `n`/`p` modal navigation, count in the bar → Tasks 4, 6, 7, 8.
- Tests cover search navigation → Tasks 1, 4, 7 test suites; collapsed-region interaction is explicitly the follow-up collapse spec's criterion, not this PR's.
- After merge: PR via `/lifeline:request-pr` from `feature/vim-252`; CHANGELOG.md + CHANGELOG.zh-CN.md entries ride with the PR per repo convention.
