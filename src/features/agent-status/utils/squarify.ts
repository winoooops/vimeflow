// cspell:ignore squarify squarified treemap Bruls Huizing Wijk labelable
import type { ToolJarEntry } from '../types'

/** A packed tile's pixel box, rounded to whole pixels. */
export interface PackedCell {
  data: ToolJarEntry
  x: number
  y: number
  w: number
  h: number
}

interface Sized {
  value: number
}

interface Rect<T> {
  data: T
  x: number
  y: number
  w: number
  h: number
}

// Squarified treemap (Bruls/Huizing/van Wijk): lays `items` (sized by `.value`)
// into the rect [X,Y,W,H], keeping each tile's aspect ratio as close to 1 as
// possible. Ported from the design handoff's `tjSquarify`.
const squarify = <T extends Sized>(
  items: readonly T[],
  X: number,
  Y: number,
  W: number,
  H: number
): Rect<T>[] => {
  const out: Rect<T>[] = []
  const kids = items.slice()
  let x = X
  let y = Y
  let w = W
  let h = H
  let row: T[] = []

  const side = (): number => Math.min(w, h)

  const worst = (candidate: readonly T[]): number => {
    const sum = candidate.reduce((acc, item) => acc + item.value, 0)
    const mx = Math.max(...candidate.map((item) => item.value))
    const mn = Math.min(...candidate.map((item) => item.value))
    const si = side()

    return Math.max((si * si * mx) / (sum * sum), (sum * sum) / (si * si * mn))
  }

  const carve = (): void => {
    const sum = row.reduce((acc, item) => acc + item.value, 0)
    if (w >= h) {
      const cw = sum / h
      let cy = y
      for (const item of row) {
        const ch = item.value / cw
        out.push({ data: item, x, y: cy, w: cw, h: ch })
        cy += ch
      }
      x += cw
      w -= cw
    } else {
      const ch = sum / w
      let cx = x
      for (const item of row) {
        const cw = item.value / ch
        out.push({ data: item, x: cx, y, w: cw, h: ch })
        cx += cw
      }
      y += ch
      h -= ch
    }
  }

  while (kids.length) {
    const candidate = kids[0]
    if (row.length === 0 || worst(row) >= worst(row.concat([candidate]))) {
      row.push(candidate)
      kids.shift()
    } else {
      carve()
      row = []
    }
  }
  if (row.length) {
    carve()
  }

  return out
}

interface WeightedEntry extends Sized {
  entry: ToolJarEntry
  weight: number
}

// Pack tool entries edge-to-edge into a w×h box. Each tile's target area is
// proportional to a compressed weight `max(1,count) ** exp` (exp < 1 compresses
// the range so the heavy hitter dominates while the tail stays legible), with a
// minimum-area floor so even a one-call tool is big enough to label. Geometry
// is rounded to whole pixels so a tile whose share barely changed keeps the
// exact same box (no transition fires → no perpetual jitter).
export const packTiles = (
  tools: readonly ToolJarEntry[],
  w: number,
  h: number,
  exp: number,
  minArea: number
): PackedCell[] => {
  const n = tools.length
  if (n === 0 || w <= 0 || h <= 0) {
    return []
  }

  const total = w * h
  const floor = Math.min(minArea, (total / n) * 0.92)
  const remaining = Math.max(0, total - floor * n)

  const weighted: WeightedEntry[] = tools.map((entry) => ({
    entry,
    weight: Math.pow(Math.max(1, entry.count), exp),
    value: 0,
  }))
  const sumW = weighted.reduce((acc, d) => acc + d.weight, 0)
  for (const d of weighted) {
    d.value = floor + (d.weight / sumW) * remaining
  }

  return squarify(weighted, 0, 0, w, h).map((cell) => ({
    data: cell.data.entry,
    x: Math.round(cell.x),
    y: Math.round(cell.y),
    w: Math.round(cell.w),
    h: Math.round(cell.h),
  }))
}
