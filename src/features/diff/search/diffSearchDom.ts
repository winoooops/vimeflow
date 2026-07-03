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
  // Bulk matches: a solid-enough lavender band with brightened text (vim
  // search-highlight style) so hits stay explicit over the green/red diff row
  // tints — the plain `selection` token at 30% alpha washed out there.
  `::highlight(${DIFF_SEARCH_HIGHLIGHT}) { background-color: color-mix(in srgb, var(--color-primary-container) 45%, transparent); color: var(--color-on-surface); }`,
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

/** `data-line-index` is `unifiedIndex` or `unifiedIndex,splitGridRow`; visual
 * order is the first component in the unified column and the second in split
 * columns (verified against the real renderer). */
const parseLineOrder = (el: HTMLElement, rawIndex: string): number | null => {
  const nums = rawIndex
    .split(',')
    .map((part) => (part.trim() === '' ? Number.NaN : Number(part)))

  if (nums.length > 2 || nums.some((n) => !Number.isFinite(n))) {
    return null
  }

  return nums.length === 1 ||
    el.closest('[data-deletions], [data-additions]') === null
    ? nums[0]
    : nums[1]
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

  for (const el of root.querySelectorAll<HTMLElement>(
    '[data-content] [data-line]'
  )) {
    const rawIndex = el.getAttribute('data-line-index')
    if (rawIndex === null) {
      continue
    }

    const order = parseLineOrder(el, rawIndex)
    if (order === null) {
      continue
    }

    const side = sideForLine(el)
    const key = `${side}:${rawIndex}`
    // Empty lines render a lone "\n" text node; strip the trailing newline so
    // offsets always index the raw source line.
    const text = el.textContent.replace(/\n$/, '')

    lines.push({ key, side, order, text })
    elements.set(key, el)
  }

  return { lines, elements }
}

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
    if (el?.isConnected !== true) {
      continue
    }

    const range = rangeForMatch(el, match.start, match.end)
    if (range !== null) {
      bulkRanges.push(range)
    }
  }

  CSS.highlights.set(DIFF_SEARCH_HIGHLIGHT, new Highlight(...bulkRanges))

  if (activeIndex < 0 || activeIndex >= matches.length) {
    CSS.highlights.delete(DIFF_SEARCH_ACTIVE_HIGHLIGHT)

    return
  }

  const active = matches[activeIndex]
  const activeEl = collected.elements.get(active.key)

  const activeRange =
    activeEl?.isConnected === true
      ? rangeForMatch(activeEl, active.start, active.end)
      : null

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
