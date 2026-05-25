import type { FileContents } from '@pierre/diffs'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'

export interface PierreFileInputs {
  oldFile: FileContents
  newFile: FileContents
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
