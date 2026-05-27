import type { FileContents } from '@pierre/diffs'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'

export interface PierreFileInputs {
  oldFile: FileContents
  newFile: FileContents
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

  return {
    oldFile: { name: oldName, contents: oldText },
    newFile: { name: newName, contents: newText },
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
