export type DiffSearchSide = 'deletions' | 'additions'

export interface DiffSearchLine {
  /** Unique per rendered line: `${side}:${raw data-line-index}` */
  key: string
  side: DiffSearchSide
  /** Visual order for the current pierre view mode. */
  order: number
  text: string
}

export interface DiffSearchMatch {
  key: string
  side: DiffSearchSide
  order: number
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

  for (const { key, side, order, text } of lines) {
    const haystack = text.toLowerCase()
    let from = 0

    for (;;) {
      const start = haystack.indexOf(needle, from)
      if (start === -1) {
        break
      }

      matches.push({
        key,
        side,
        order,
        start,
        end: start + needle.length,
      })
      from = start + needle.length
    }
  }

  return matches.sort(
    (a, b) =>
      a.order - b.order ||
      SIDE_RANK[a.side] - SIDE_RANK[b.side] ||
      a.start - b.start
  )
}
