import type { ToolCount, ToolJarEntry } from '../types'

// Cap how many tiles the jar (and tags view) can show so a long session with
// many tools can't shatter into a mosaic of illegible slivers. Tools are ranked
// by count; everything past the top (TJ_MAX_TILES - 1) folds into a single
// "others" tile that keeps the full list for its hover breakdown. Only fold
// membership is by count — the shown tiles stay in their original (insertion)
// order so they hold position as counts tick (the packer lays tiles in input
// order and avoids jitter only if that order is stable). A session at or under
// the cap stays fully expanded.
export const TJ_MAX_TILES = 8

export const toolJarAggregate = (tools: ToolCount[]): ToolJarEntry[] => {
  if (tools.length <= TJ_MAX_TILES) {
    return tools
  }

  // Names of the top (TJ_MAX_TILES - 1) tools by count — these keep their tile.
  const kept = new Set(
    [...tools]
      .sort((a, b) => b.count - a.count)
      .slice(0, TJ_MAX_TILES - 1)
      .map((t) => t.name)
  )

  const majors = tools.filter((t) => kept.has(t.name))

  const folded = tools
    .filter((t) => !kept.has(t.name))
    .sort((a, b) => b.count - a.count)
  const sum = folded.reduce((acc, t) => acc + t.count, 0)

  return [...majors, { name: 'others', count: sum, others: folded }]
}
