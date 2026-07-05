import type { FileContents } from '@pierre/diffs'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'

export interface PierreFileInputs {
  oldFile: FileContents
  newFile: FileContents
  identity: string
  diffCacheKey: string
}

/**
 * The newStart/newLines coordinates of a hunk as Pierre surfaces them. Used to
 * correlate a Pierre-focused hunk back to an index in the raw `GetGitDiffResponse`
 * hunk list for patch extraction.
 */
export interface PierreHunkRange {
  newStart: number
  newLines: number
}

const hashString = (value: string): string => {
  let hash = 2166136261

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}

export const diffIdentityForResponse = (
  response: GetGitDiffResponse
): string => {
  const { fileDiff, oldText, newText, rawDiff } = response

  const source =
    rawDiff.length > 0
      ? rawDiff
      : `${fileDiff.filePath}\0${oldText}\0${newText}`

  return hashString(
    `${fileDiff.filePath}\0${fileDiff.oldPath ?? ''}\0${
      fileDiff.newPath ?? ''
    }\0${source}`
  )
}

/**
 * Convert the Rust-side `GetGitDiffResponse` into the `{ oldFile, newFile }`
 * pair Pierre's `<MultiFileDiff>` consumes. Filename drives Pierre's Shiki
 * language inference, so on rename each side gets its actual path.
 */
export const toPierreInputs = (
  response: GetGitDiffResponse
): PierreFileInputs => {
  const { fileDiff, oldText, newText } = response
  const newName = fileDiff.newPath ?? fileDiff.filePath
  const oldName = fileDiff.oldPath ?? newName
  const identity = diffIdentityForResponse(response)
  const oldCacheKey = `${identity}:old:${oldName}`
  const newCacheKey = `${identity}:new:${newName}`

  return {
    oldFile: {
      name: oldName,
      contents: oldText,
      cacheKey: oldCacheKey,
    },
    newFile: {
      name: newName,
      contents: newText,
      cacheKey: newCacheKey,
    },
    identity,
    diffCacheKey: `${oldCacheKey}:${newCacheKey}`,
  }
}

/**
 * Find the index of a Pierre-focused hunk within the raw diff response's hunk
 * list. Matches on `newStart` and `newLines` — the same coordinates Pierre
 * surfaces for the focused hunk. Returns -1 when no hunk matches (e.g., Pierre
 * split the region differently than git).
 */
export const findRawDiffHunkIndex = (
  response: GetGitDiffResponse,
  pierreHunk: PierreHunkRange
): number =>
  response.fileDiff.hunks.findIndex(
    (h) =>
      h.newStart === pierreHunk.newStart && h.newLines === pierreHunk.newLines
  )
