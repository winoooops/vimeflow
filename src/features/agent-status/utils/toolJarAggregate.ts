import type { ToolCount, ToolJarEntry } from '../types'

// Tools fold into a single "others" shape only when that genuinely reduces
// clutter — never on a hard total-calls cap. A tool is "trivial" when it is
// both small in absolute terms (<= TJ_OTHERS_MAX) AND a tiny share of all
// calls (< TJ_TRIVIAL_SHARE), so the bar scales with the session. Folding
// happens only when there are enough tiles to be crowded (> TJ_MIN_TILES) and
// enough trivial tools to be worth bundling (>= TJ_MIN_FOLD). Otherwise every
// tool shows individually — a short session stays fully expanded.
export const TJ_OTHERS_MAX = 3

export const TJ_TRIVIAL_SHARE = 0.05

export const TJ_MIN_TILES = 8

export const TJ_MIN_FOLD = 3

export const toolJarAggregate = (tools: ToolCount[]): ToolJarEntry[] => {
  const total = tools.reduce((sum, t) => sum + t.count, 0) || 1

  const isTrivial = (t: ToolCount): boolean =>
    t.count <= TJ_OTHERS_MAX && t.count / total < TJ_TRIVIAL_SHARE
  const small = tools.filter(isTrivial)

  if (tools.length <= TJ_MIN_TILES || small.length < TJ_MIN_FOLD) {
    return tools
  }

  const major = tools.filter((t) => !isTrivial(t))
  const sum = small.reduce((acc, t) => acc + t.count, 0)

  return [
    ...major,
    {
      name: 'others',
      count: sum,
      others: [...small].sort((a, b) => b.count - a.count),
    },
  ]
}
