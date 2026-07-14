/**
 * Builds the whole-changelist review snapshot (VIM-327): for every file-strip
 * entry, fetch its parsed diff and pair the placement entry (hunk ranges) with
 * its prompt-side request file. Paths-only prompt — diff text is never sent.
 */
import type { ChangedFile, FileDiff } from '../types'
import type { ReviewRequestFile } from './feedbackDispatch'
import { buildDiffSnapshot, type ReviewedFile } from './pendingReviewRequests'

export interface ChangelistSnapshot {
  files: ReviewedFile[]
  requestFiles: ReviewRequestFile[]
}

export type FetchFileDiff = (
  path: string,
  staged: boolean,
  untracked: boolean
) => Promise<FileDiff>

const SNAPSHOT_CONCURRENCY = 8

// ponytail: minimal promise pool; results keep input order.
const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  )

  return results
}

export const fetchChangelistSnapshot = async (
  entries: readonly ChangedFile[],
  fetchFileDiff: FetchFileDiff,
  repoRoot: string
): Promise<ChangelistSnapshot> => {
  const normalizedRoot = repoRoot.replace(/[\\/]+$/, '')

  // TODO(VIM-341): replace N get_git_diff round-trips with the batch
  // hunk-range command — each response ships full file texts we discard.
  const paired = await mapWithConcurrency(
    entries,
    SNAPSHOT_CONCURRENCY,
    async (changedFile) => {
      const untracked = changedFile.status === 'untracked'

      const fileDiff = await fetchFileDiff(
        changedFile.path,
        changedFile.staged,
        untracked
      )
      const snapshot = buildDiffSnapshot(fileDiff, changedFile.staged)

      const requestFile: ReviewRequestFile = {
        ...snapshot,
        ...(normalizedRoot.length > 0
          ? { promptPath: `${normalizedRoot}/${snapshot.path}` }
          : {}),
        ...(untracked ? { untracked: true } : {}),
      }

      return { snapshot, requestFile }
    }
  )

  return {
    files: paired.map((pair) => pair.snapshot),
    requestFiles: paired.map((pair) => pair.requestFile),
  }
}
