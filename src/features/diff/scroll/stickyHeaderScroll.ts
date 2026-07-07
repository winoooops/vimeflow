// Shared, header-aware scroll primitive for the diff viewer. Every navigation
// and search path routes reveal-a-target scrolling through here so the sticky
// per-file header is always compensated for — the "always take the file header
// into account" guarantee (VIM-280). Pierre renders each file inside a
// `diffs-container` custom element with an open shadow root, and the sticky file
// header lives inside that shadow tree.

export const PIERRE_DIFF_CONTAINER_SELECTOR = 'diffs-container'

// Small breathing gap so a revealed row never sits flush against the header.
const STICKY_HEADER_SCROLL_GAP_PX = 4

// Measures the tallest sticky file header covering the top of the scroll body,
// looking in both the light DOM (tests) and every Pierre shadow root. Returns 0
// when no sticky header is present (e.g. the file header is disabled).
export const stickyHeaderOffsetForDiffRoot = (root: HTMLElement): number => {
  const headers = [
    ...root.querySelectorAll<HTMLElement>('[data-diffs-header][data-sticky]'),
  ]

  for (const container of root.querySelectorAll<HTMLElement>(
    PIERRE_DIFF_CONTAINER_SELECTOR
  )) {
    if (container.shadowRoot !== null) {
      headers.push(
        ...container.shadowRoot.querySelectorAll<HTMLElement>(
          '[data-diffs-header][data-sticky]'
        )
      )
    }
  }

  const height = Math.max(
    0,
    ...headers.map((header) => header.getBoundingClientRect().height)
  )

  return height === 0 ? 0 : height + STICKY_HEADER_SCROLL_GAP_PX
}

// A range already sitting fully within the visible viewport (below any sticky
// header) needs no scroll — moving the cursor is enough. Keeps `[` / `]` from
// jerking the page when the next hunk is already on screen (VIM-272).
export const isLineRangeFullyVisible = (
  container: HTMLElement,
  firstLine: HTMLElement,
  lastLine: HTMLElement
): boolean => {
  if (container.clientHeight <= 0) {
    return false
  }

  const containerRect = container.getBoundingClientRect()
  const stickyOffset = stickyHeaderOffsetForDiffRoot(container)
  const firstRect = firstLine.getBoundingClientRect()
  const lastRect = lastLine.getBoundingClientRect()
  const top = Math.min(firstRect.top, lastRect.top)
  const bottom = Math.max(firstRect.bottom, lastRect.bottom)
  const visibleTop = containerRect.top + stickyOffset

  return top >= visibleTop && bottom <= containerRect.bottom
}

// Whether a line range fits within the header-adjusted visible height, so hunk
// jumps only try to show the whole range when it can actually clear the header.
export const lineRangeFitsBelowHeader = (
  container: HTMLElement,
  firstLine: HTMLElement,
  lastLine: HTMLElement
): boolean => {
  if (container.clientHeight <= 0) {
    return true
  }

  const available =
    container.clientHeight - stickyHeaderOffsetForDiffRoot(container)
  const firstRect = firstLine.getBoundingClientRect()
  const lastRect = lastLine.getBoundingClientRect()
  const top = Math.min(firstRect.top, lastRect.top)
  const bottom = Math.max(firstRect.bottom, lastRect.bottom)

  return bottom - top <= available
}

// Corrects scrollIntoView when the target row lands underneath the sticky
// header instead of actually being visible.
const revealLineBelowStickyHeader = (
  container: HTMLElement,
  line: HTMLElement,
  reservePreviousRow: boolean
): void => {
  const stickyOffset = stickyHeaderOffsetForDiffRoot(container)
  if (stickyOffset === 0) {
    return
  }

  const containerTop = container.getBoundingClientRect().top
  const lineRect = line.getBoundingClientRect()
  const rowOffset = reservePreviousRow ? lineRect.height : 0
  const overlap = containerTop + stickyOffset + rowOffset - lineRect.top

  if (overlap > 0) {
    container.scrollTop = Math.max(0, container.scrollTop - Math.ceil(overlap))
  }
}

// THE shared entry point: scroll `element` into `container`, then nudge it clear
// of the sticky file header. `reservePreviousRow` keeps one row visible above
// the target on upward moves.
export const scrollElementIntoViewBelowHeader = (
  container: HTMLElement,
  element: HTMLElement,
  options: {
    block?: ScrollLogicalPosition
    reservePreviousRow?: boolean
  } = {}
): void => {
  element.scrollIntoView({
    block: options.block ?? 'nearest',
    inline: 'nearest',
  })

  revealLineBelowStickyHeader(
    container,
    element,
    options.reservePreviousRow ?? false
  )
}
