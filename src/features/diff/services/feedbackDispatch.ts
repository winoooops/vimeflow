import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from '../hooks/useFeedbackBatch'

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

// Strip terminal control characters (C0 controls 0x00-0x1F + DEL 0x7F, which
// includes ESC and CR) from any user/repo-supplied text before it enters the
// bracketed-paste payload. git permits filenames containing newlines/ESC and
// comment text is free-form, so without this a crafted filename or comment
// could embed the paste-end sentinel (ESC [ 201 ~) — terminating the paste
// early — or a CR that injects extra prompt lines into the agent's terminal.
// A char-code filter avoids a control-character regex literal.
const stripControls = (value: string): string =>
  Array.from(value)
    .filter((ch) => {
      const code = ch.charCodeAt(0)

      return code > 0x1f && code !== 0x7f
    })
    .join('')

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
        const lines = a.metadata.text
          .split('\n')
          .map((line) => `> ─ ${stripControls(line)}`)

        return [
          `> ${stripControls(entry.filePath)}:${a.lineNumber} (${a.side})`,
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
