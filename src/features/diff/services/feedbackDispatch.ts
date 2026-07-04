import type { DiffLineAnnotation } from '@pierre/diffs'
import {
  isFileLevelReviewAnnotation,
  reviewCommentCategory,
  type ReviewComment,
  type ReviewCommentCategory,
} from '../hooks/useFeedbackBatch'

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
  /**
   * Which diff view the comments were authored against. A file with both
   * staged AND unstaged changes (git status `MM`) produces two batch entries
   * for the same path whose line numbers refer to different comparisons —
   * the payload labels each so the agent addresses the correct version.
   */
  staged: boolean
  annotations: DiffLineAnnotation<ReviewComment>[]
}

// The target suffix only — the caller prepends the "> [#n · Category] " tag.
const formatAnnotationTarget = (
  entry: DispatchEntry,
  annotation: DiffLineAnnotation<ReviewComment>
): string => {
  const filePath = stripControls(entry.filePath)
  const stagedLabel = entry.staged ? 'staged' : 'unstaged'

  if (isFileLevelReviewAnnotation(annotation)) {
    return `${filePath} (file) [${stagedLabel}]`
  }

  if (annotation.metadata.target?.scope === 'range') {
    const { startLine, endLine, side } = annotation.metadata.target

    return `${filePath}:${startLine}-${endLine} (${side}) [${stagedLabel}]`
  }

  return `${filePath}:${annotation.lineNumber} (${annotation.side}) [${stagedLabel}]`
}

const CATEGORY_LABEL: Record<ReviewCommentCategory, string> = {
  question: 'Question',
  change: 'Change request',
  bug: 'Bug',
  suggestion: 'Suggestion',
}

// Per-category instruction — the VIM-253 intent. A Question asks the agent to
// answer in its reply; the rest ask it to change files.
const CATEGORY_INSTRUCTION: Record<ReviewCommentCategory, string> = {
  question: 'Answer inline in your reply. Do not edit files.',
  change: 'Make this change.',
  bug: 'Fix this.',
  suggestion: 'Apply this if you agree.',
}

// The structured payload the agent receives. Each item is tagged with its
// category (the VIM-253 intent) and a [#n] handle it can reply against — the
// seam for structured Q&A (VIM-249 / VIM-283). The category chip in the UI is
// just the face value of this.
export const formatFeedbackPayload = (entries: DispatchEntry[]): string => {
  const totalCount = entries.reduce((s, e) => s + e.annotations.length, 0)
  const header = `> Inline review — ${totalCount} item${totalCount === 1 ? '' : 's'}. Reply to each by its [#n].`

  const blocks: string[] = []
  let index = 0
  for (const entry of entries) {
    for (const annotation of entry.annotations) {
      index += 1
      const category = reviewCommentCategory(annotation.metadata)

      const textLines = annotation.metadata.text
        .split('\n')
        .map((line) => `> ─ ${stripControls(line)}`)

      blocks.push(
        [
          `> [#${index} · ${CATEGORY_LABEL[category]}] ${formatAnnotationTarget(entry, annotation)}`,
          ...textLines,
          `> → ${CATEGORY_INSTRUCTION[category]}`,
          '>',
        ].join('\n')
      )
    }
  }

  return [
    header,
    '>',
    ...blocks,
    '> ―',
    '> When done, reply referencing each [#n].',
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
