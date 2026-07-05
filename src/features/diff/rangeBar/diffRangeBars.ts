import type { AnnotationSide, DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from '../hooks/useFeedbackBatch'

/** Attribute stamped onto the gutter cells inside a committed range's span.
 * Value is the edge role so the bar can round its ends. */
export const DIFF_RANGE_BAR_ATTR = 'data-vf-range-bar'

/** Persistent gutter bar for committed range comments. Pierre exposes no
 * decorations API, so — exactly like search — we tag shadow-DOM gutter cells in
 * `onPostRender` and style them here. This MUST stay a module constant: any
 * option merged into pierre (incl. `unsafeCSS`) that changes identity across
 * renders force-rebuilds its DOM. The bar sits at the gutter's right edge — the
 * seam between the line number and the code content (GitHub-style). Theme custom
 * properties cascade across the shadow boundary. */
export const DIFF_RANGE_BAR_UNSAFE_CSS = [
  `[data-gutter] > [${DIFF_RANGE_BAR_ATTR}] { position: relative; }`,
  `[data-gutter] > [${DIFF_RANGE_BAR_ATTR}]::after { content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 3px; background: var(--color-primary-container); pointer-events: none; }`,
  `[data-gutter] > [${DIFF_RANGE_BAR_ATTR}='first']::after { top: 2px; border-top-left-radius: 2px; border-top-right-radius: 2px; }`,
  `[data-gutter] > [${DIFF_RANGE_BAR_ATTR}='last']::after { bottom: 2px; border-bottom-left-radius: 2px; border-bottom-right-radius: 2px; }`,
  `[data-gutter] > [${DIFF_RANGE_BAR_ATTR}='single']::after { top: 2px; bottom: 2px; border-radius: 2px; }`,
].join('\n')

export interface RangeBarSpan {
  side: AnnotationSide
  startLine: number
  endLine: number
}

/** The committed range comments whose span the gutter bar should mark. */
export const rangeBarSpansForAnnotations = (
  annotations: DiffLineAnnotation<ReviewComment>[]
): RangeBarSpan[] =>
  annotations.flatMap((annotation) => {
    const target = annotation.metadata.target

    return target?.scope === 'range'
      ? [
          {
            side: target.side,
            startLine: target.startLine,
            endLine: target.endLine,
          },
        ]
      : []
  })

/** Stable key so the repaint effect only fires when the spans actually change,
 * not on every render (the annotations array is rebuilt each render). */
export const rangeBarSpansKey = (spans: RangeBarSpan[]): string =>
  spans
    .map((s) => `${s.side}:${s.startLine}-${s.endLine}`)
    .sort()
    .join('|')

// Which side a gutter cell belongs to — mirrors search's sideForLine, but the
// gutter cells live under the same [data-deletions]/[data-additions] columns.
const gutterCellSide = (el: HTMLElement): AnnotationSide => {
  if (el.closest('[data-deletions]') !== null) {
    return 'deletions'
  }

  if (el.closest('[data-additions]') !== null) {
    return 'additions'
  }

  // Unified column: deletion rows can use either pierre's change-deletion
  // marker or the normalized removed line type used by navigation.
  const lineType = el.getAttribute('data-line-type')

  return lineType === 'change-deletion' || lineType === 'removed'
    ? 'deletions'
    : 'additions'
}

const edgeRole = (line: number, span: RangeBarSpan): string => {
  if (span.startLine === span.endLine) {
    return 'single'
  }

  if (line === span.startLine) {
    return 'first'
  }

  return line === span.endLine ? 'last' : 'mid'
}

/** Walk pierre's shadow root and tag the gutter cells inside each committed
 * range. Sole coupling point to pierre's DOM shape — a restructure yields no
 * bar (silent degrade), never a throw. Re-run on every `onPostRender`: pierre
 * wipes custom attributes when it rebuilds its DOM. */
export const paintRangeBars = (
  container: Element | null,
  spans: RangeBarSpan[]
): void => {
  const root = container?.shadowRoot ?? null
  if (root === null) {
    return
  }

  for (const tagged of root.querySelectorAll(`[${DIFF_RANGE_BAR_ATTR}]`)) {
    tagged.removeAttribute(DIFF_RANGE_BAR_ATTR)
  }

  if (spans.length === 0) {
    return
  }

  for (const cell of root.querySelectorAll<HTMLElement>(
    '[data-gutter] > [data-column-number]'
  )) {
    const raw = cell.getAttribute('data-column-number')
    const line = raw === null ? Number.NaN : Number(raw)
    if (!Number.isFinite(line)) {
      continue
    }

    const side = gutterCellSide(cell)

    const span = spans.find(
      (s) => s.side === side && line >= s.startLine && line <= s.endLine
    )
    if (span !== undefined) {
      cell.setAttribute(DIFF_RANGE_BAR_ATTR, edgeRole(line, span))
    }
  }
}
