import type { DiffLineAnnotation } from '@pierre/diffs'
import {
  isFileLevelReviewAnnotation,
  reviewCommentCategory,
  type ReviewComment,
  type ReviewCommentCategory,
} from '../hooks/useFeedbackBatch'
import type { ReviewedFile } from './pendingReviewRequests'

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

/**
 * A typeless thread follow-up (VIM-298): belongs to ANOTHER root's thread and
 * has no category. `threadId !== id` is load-bearing — a dispatched ROOT
 * self-stamps `threadId === id` and may legitimately omit category (defaults
 * to a change request); it must NOT be classified as a follow-up.
 */
export const isFollowUpComment = (comment: ReviewComment): boolean =>
  comment.author === 'self' &&
  comment.threadId !== undefined &&
  comment.threadId !== comment.id &&
  comment.category === undefined

const FOLLOW_UP_LABEL = 'Follow-up'
const FOLLOW_UP_INSTRUCTION = 'Answer inline in your reply. Do not edit files.'
const FOLLOW_UP_EXCERPT_MAX = 200

/**
 * The one-line continuation marker quoting the latest prior turn (VIM-298).
 * The excerpt is agent-controlled text, so it passes the same control-char
 * strip as everything else entering the bracketed paste.
 */
export const followUpContextLine = (previous: ReviewComment): string => {
  const phrasing =
    previous.author === 'agent'
      ? 'your last reply'
      : previous.author === 'reviewer'
        ? 'the finding'
        : 'my earlier comment'
  const clean = stripControls(previous.text)
  const truncated = clean.length > FOLLOW_UP_EXCERPT_MAX
  const excerpt = truncated ? clean.slice(0, FOLLOW_UP_EXCERPT_MAX) : clean

  return `> ↩ Continuing our thread — ${phrasing}: "${excerpt}"${truncated ? ' (truncated)' : ''}`
}

// The structured payload the agent receives. Each item is tagged with its
// category (the VIM-253 intent) and a [#n] handle it can reply against — the
// seam for structured Q&A (VIM-249 / VIM-283). The category chip in the UI is
// just the face value of this.
export const formatFeedbackPayload = (
  entries: DispatchEntry[],
  nonce: string,
  followUpContext?: string
): string => {
  const totalCount = entries.reduce((s, e) => s + e.annotations.length, 0)
  const header = `> Inline review — ${totalCount} item${totalCount === 1 ? '' : 's'}. Reply to each by its [#n].`

  const blocks: string[] = []
  let index = 0
  for (const entry of entries) {
    for (const annotation of entry.annotations) {
      index += 1
      const category = reviewCommentCategory(annotation.metadata)
      const followUp = isFollowUpComment(annotation.metadata)
      const label = followUp ? FOLLOW_UP_LABEL : CATEGORY_LABEL[category]

      const instruction = followUp
        ? FOLLOW_UP_INSTRUCTION
        : CATEGORY_INSTRUCTION[category]

      const textLines = annotation.metadata.text
        .split('\n')
        .map((line) => `> ─ ${stripControls(line)}`)

      blocks.push(
        [
          `> [#${index} · ${label}] ${formatAnnotationTarget(entry, annotation)}`,
          ...(followUp && followUpContext !== undefined
            ? [followUpContext]
            : []),
          ...textLines,
          `> → ${instruction}`,
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
    '> When done, end your reply with this exact block, echoing the nonce verbatim.',
    '> status is one of: "reply" (answers a question), "clarify" (you need the user to answer — the thread awaits them), "resolved" (you made the change), "deferred" (punted for later; cite the issue # in text), "rejected" (declined).',
    '> <<<VIMEFLOW_REPLY',
    `> {"v":1,"nonce":"${nonce}","replies":[{"id":1,"status":"reply","text":"..."}]}`,
    '> VIMEFLOW_REPLY>>>',
  ].join('\n')
}

// A short per-dispatch correlation token (VIM-249). Not a secret — it only
// distinguishes a reply to this dispatch from a superseded one on the same pty.
export const makeDispatchNonce = (): string =>
  Math.random().toString(36).slice(2, 8)

export const dispatchFeedbackBatch = async (
  _paneId: string,
  ptyId: string,
  entries: DispatchEntry[],
  nonce: string,
  writePty: (ptyId: string, data: string) => Promise<void>,
  followUpContext?: string
): Promise<void> => {
  const formatted = formatFeedbackPayload(entries, nonce, followUpContext)
  const payload = `${PASTE_START}${formatted}${PASTE_END}\r`

  await writePty(ptyId, payload)
}

export interface ReviewRequestFile extends ReviewedFile {
  promptPath?: string
  untracked?: boolean
}

const reviewRequestLine = (file: ReviewRequestFile): string => {
  const path = stripControls(file.path)

  const promptPath =
    file.promptPath === undefined ? '' : stripControls(file.promptPath)

  const base =
    promptPath.length > 0 ? `> ─ ${path} (${promptPath})` : `> ─ ${path}`

  return file.untracked === true
    ? `${base} (untracked — not in git diff; read the file, all lines are additions)`
    : base
}

// The "Request review" payload (VIM-304): instruct the primary agent to delegate
// a code review of a specific diff scope and emit the self-anchoring
// VIMEFLOW_REVIEW block, echoing the nonce. The findings self-anchor, so there
// is no [#n] item list — only the scope (paths + grouped half) + the contract.
export const formatReviewRequest = (
  files: ReviewRequestFile[],
  nonce: string
): string => {
  const unstaged = files.filter((file) => !file.staged)
  const staged = files.filter((file) => file.staged)

  const groups = [
    ...(unstaged.length > 0
      ? ['> unstaged diff (`git diff`):', ...unstaged.map(reviewRequestLine)]
      : []),
    ...(staged.length > 0
      ? [
          '> staged diff (`git diff --cached`):',
          ...staged.map(reviewRequestLine),
        ]
      : []),
  ]

  return [
    `> Delegate a code review of ${files.length === 1 ? 'this' : 'these'} ${files.length} change${files.length === 1 ? '' : 's'}:`,
    ...groups,
    '>',
    '> Anchor each finding with diff-side line numbers: "additions" uses new-file lines, "deletions" uses old-file lines.',
    '> In the JSON block, use the repo-relative path before the parentheses as each finding path.',
    '> category is one of: "bug", "suggestion", "change", "question". scope is "line", "range", or "file".',
    '> Anchor shapes: "line" uses side + line; "range" uses side + startLine + endLine; "file" uses neither.',
    '> Keep this nonce for later turns. If the user later asks you to address these findings, end that later reply with VIMEFLOW_REPLY using this same nonce.',
    '> In that later block, target each finding by its 1-based position in the findings array and include every decision you made.',
    '> Follow-up status is one of: "reply", "clarify", "resolved", "deferred", or "rejected".',
    '> Follow-up example (do not emit this block in the current review reply):',
    '> <<<VIMEFLOW_REPLY',
    `> {"v":1,"nonce":"${nonce}","replies":[{"target":"finding","id":1,"status":"resolved","text":"..."}]}`,
    '> VIMEFLOW_REPLY>>>',
    '>',
    '> When done, end your reply with this exact block — echo the nonce verbatim and self-report the reviewer name.',
    '> Also give a one-line overview in your normal reply (not in the block), especially if there is little to report.',
    '> <<<VIMEFLOW_REVIEW',
    `> {"v":1,"nonce":"${nonce}","reviewer":"<your name>","findings":[{"path":"<file>","scope":"line","side":"additions","line":1,"category":"bug","text":"..."}]}`,
    '> VIMEFLOW_REVIEW>>>',
  ].join('\n')
}

export const dispatchReviewRequest = async (
  ptyId: string,
  files: ReviewRequestFile[],
  nonce: string,
  writePty: (ptyId: string, data: string) => Promise<void>
): Promise<void> => {
  const formatted = formatReviewRequest(files, nonce)
  const payload = `${PASTE_START}${formatted}${PASTE_END}\r`

  await writePty(ptyId, payload)
}
