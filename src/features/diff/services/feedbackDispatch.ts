import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from '../hooks/useFeedbackBatch'

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

export interface DispatchEntry {
  filePath: string
  annotations: DiffLineAnnotation<ReviewComment>[]
}

export const formatFeedbackPayload = (entries: DispatchEntry[]): string => {
  const totalCount = entries.reduce((s, e) => s + e.annotations.length, 0)
  const fileCount = entries.length
  const header = `> Inline review feedback (${totalCount} comment${totalCount === 1 ? '' : 's'} across ${fileCount} file${fileCount === 1 ? '' : 's'}):`

  const body = entries
    .flatMap((entry) =>
      entry.annotations.map((a) => {
        const lines = a.metadata.text.split('\n').map((line) => `> ─ ${line}`)

        return [
          `> ${entry.filePath}:${a.lineNumber} (${a.side})`,
          ...lines,
          '>',
        ].join('\n')
      })
    )
    .join('\n')

  return [
    header,
    '>',
    body,
    '> ―',
    '> Please address these and reply when done.',
  ].join('\n')
}

export const dispatchFeedbackBatch = async (
  _paneId: string,
  ptyId: string,
  entries: DispatchEntry[],
  writePty: (ptyId: string, data: string) => Promise<void>
): Promise<void> => {
  const formatted = formatFeedbackPayload(entries)
  const payload = `${PASTE_START}${formatted}${PASTE_END}\r`

  await writePty(ptyId, payload)
}
