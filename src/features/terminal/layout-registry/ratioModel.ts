// cspell:ignore vsplit hsplit
import type { LayoutId } from '../../sessions/types'

export type RatioAxis = 'cols' | 'rows'

export interface LayoutRatios {
  readonly cols: readonly number[]
  readonly rows: readonly number[]
}

export const DEFAULT_RATIOS: Record<LayoutId, LayoutRatios> = {
  single: { cols: [1], rows: [1] },
  vsplit: { cols: [1, 1], rows: [1] },
  hsplit: { cols: [1], rows: [1, 1] },
  threeRight: { cols: [1.4, 1], rows: [1, 1] },
  quad: { cols: [1, 1], rows: [1, 1] },
}

export const getTrackCssVar = (
  axis: RatioAxis,
  trackIndex: number
): `--split-${RatioAxis}-${number}` => `--split-${axis}-${trackIndex}`

export const buildTrackTemplate = (
  axis: RatioAxis,
  tracks: readonly number[],
  dividerPx: number
): string => {
  if (tracks.length <= 1) {
    return 'minmax(0,1fr)'
  }

  return tracks
    .flatMap((track, trackIndex) =>
      trackIndex === tracks.length - 1
        ? [`var(${getTrackCssVar(axis, trackIndex)}, ${track}fr)`]
        : [
            `var(${getTrackCssVar(axis, trackIndex)}, ${track}fr)`,
            `${dividerPx}px`,
          ]
    )
    .join(' ')
}

export const getTrackBoundaryRatio = (
  tracks: readonly number[],
  trackIndex: number
): number => {
  const total = tracks.reduce((sum, track) => sum + track, 0)

  const leading = tracks
    .slice(0, trackIndex + 1)
    .reduce((sum, track) => sum + track, 0)

  return total > 0 ? leading / total : 0.5
}

export const updateTrackBoundaryRatio = (
  tracks: readonly number[],
  trackIndex: number,
  boundaryRatio: number
): readonly number[] => {
  const pairStart = Math.max(trackIndex, 0)
  const pairEnd = pairStart + 1

  if (pairEnd >= tracks.length) {
    return tracks
  }

  const left = tracks[pairStart] ?? 0
  const right = tracks[pairEnd] ?? 0
  const total = tracks.reduce((sum, track) => sum + track, 0)

  const fixedLeading = tracks
    .slice(0, pairStart)
    .reduce((sum, track) => sum + track, 0)
  const pairTotal = left + right
  const unclampedLeft = boundaryRatio * total - fixedLeading
  const nextLeft = Math.min(Math.max(unclampedLeft, 0), pairTotal)
  const nextRight = pairTotal - nextLeft

  return tracks.map((track, index) => {
    if (index === pairStart) {
      return nextLeft
    }

    if (index === pairEnd) {
      return nextRight
    }

    return track
  })
}

export const equalTrackRatios = (
  left: readonly number[],
  right: readonly number[]
): boolean =>
  left.length === right.length &&
  left.every((track, index) => track === right[index])
