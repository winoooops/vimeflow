import type { ChangedFile } from '../../../diff/types'

export interface LineDelta {
  added: number
  removed: number
}

export const aggregateLineDelta = (files: ChangedFile[]): LineDelta =>
  files.reduce(
    (acc, file) => ({
      added: acc.added + (file.insertions ?? 0),
      removed: acc.removed + (file.deletions ?? 0),
    }),
    { added: 0, removed: 0 }
  )
