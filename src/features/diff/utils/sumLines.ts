import type { ChangedFile } from '../types'

export interface LineTotals {
  added: number
  removed: number
}

export const sumLines = (files: ChangedFile[]): LineTotals =>
  files.reduce<LineTotals>(
    (acc, f) => ({
      added: acc.added + (f.insertions ?? 0),
      removed: acc.removed + (f.deletions ?? 0),
    }),
    { added: 0, removed: 0 }
  )
