import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from '../hooks/useFeedbackBatch'
import { AGENT_OUTCOME_META, THREAD_ROLLUP_META } from '../reviewCategoryMeta'

/**
 * One rendered conversation (VIM-298): the store stays flat, this is the
 * derived view-model. `turns` is store order (arrival order — attachAgentNote
 * appends). The batch-location snapshot is captured at group construction so
 * the follow-up dispatch has both the repo-relative handle coordinates and an
 * input to the repo-root resolver without re-deriving from render-time props.
 */
export interface ThreadGroup {
  threadId: string
  turns: DiffLineAnnotation<ReviewComment>[]
  rollup: { label: string; chip: string }
  resolved: boolean
  cwd: string
  filePath: string
  staged: boolean
}

export interface ThreadGroupsResult {
  /** One anchor annotation per group + pass-through pending/draft rows. */
  collapsed: DiffLineAnnotation<ReviewComment>[]
  groups: Map<string, ThreadGroup>
}

/**
 * The grouping key: threadId when present; orphan agent/reviewer annotations
 * and legacy dispatched roots self-key; pending user comments (and the draft
 * sentinel) have none — they render as flat rows, never inside a card.
 */
export const threadGroupKey = (
  annotation: DiffLineAnnotation<ReviewComment>
): string | undefined =>
  annotation.metadata.threadId ??
  (annotation.metadata.author !== 'self' ||
  annotation.metadata.dispatchedAt !== undefined
    ? annotation.metadata.id
    : undefined)

/**
 * Total rollup over the LATEST turn (a dispatched follow-up after a `clarify`
 * flips the thread back to awaiting the agent), with local resolve on top.
 * Every self turn inside a thread is dispatched by construction (follow-ups
 * are created atomically with a successful dispatch), so the self arm is Sent.
 */
export const threadRollup = (
  turns: DiffLineAnnotation<ReviewComment>[],
  resolved: boolean
): { label: string; chip: string } => {
  if (resolved) {
    return THREAD_ROLLUP_META.resolved
  }

  const latestTurn = turns.length === 0 ? undefined : turns[turns.length - 1]
  const latest = latestTurn?.metadata
  if (latest === undefined || latest.author === 'reviewer') {
    return THREAD_ROLLUP_META.open
  }

  if (latest.author === 'agent') {
    return latest.outcome === undefined
      ? AGENT_OUTCOME_META.reply
      : AGENT_OUTCOME_META[latest.outcome]
  }

  return THREAD_ROLLUP_META.sent
}

export const buildThreadGroups = (
  annotations: DiffLineAnnotation<ReviewComment>[],
  location: { cwd: string; filePath: string; staged: boolean }
): ThreadGroupsResult => {
  const groups = new Map<string, ThreadGroup>()
  const collapsed: DiffLineAnnotation<ReviewComment>[] = []

  for (const annotation of annotations) {
    const key = threadGroupKey(annotation)
    if (key === undefined) {
      collapsed.push(annotation)
      continue
    }

    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, {
        threadId: key,
        turns: [annotation],
        rollup: THREAD_ROLLUP_META.open,
        resolved: false,
        ...location,
      })
      collapsed.push(annotation)
      continue
    }

    existing.turns.push(annotation)
  }

  for (const group of groups.values()) {
    const root =
      group.turns.find((turn) => turn.metadata.id === group.threadId) ??
      group.turns[0]
    group.resolved = root.metadata.resolvedAt !== undefined
    group.rollup = threadRollup(group.turns, group.resolved)
  }

  // No groups → collapsed is element-wise identical to the input; returning
  // the input preserves array identity so a still-mounted MultiFileDiff does
  // not re-tokenize on a mere batch-key switch (the stable-EMPTY discipline
  // useFeedbackBatch documents).
  return { collapsed: groups.size === 0 ? annotations : collapsed, groups }
}

/**
 * Anchor label for the card header, total over line / range / file scopes
 * (PanelBody's private annotationTargetLabel only labels ranges).
 */
export const threadAnchorLabel = (
  annotation: DiffLineAnnotation<ReviewComment>
): string => {
  const target = annotation.metadata.target
  if (target?.scope === 'file') {
    return 'file'
  }

  if (target?.scope === 'range') {
    const prefix = target.side === 'deletions' ? 'L' : 'R'

    return target.startLine === target.endLine
      ? `line ${prefix}${target.startLine}`
      : `lines ${prefix}${target.startLine}-${prefix}${target.endLine}`
  }

  const prefix = annotation.side === 'deletions' ? 'L' : 'R'

  return `line ${prefix}${annotation.lineNumber}`
}
