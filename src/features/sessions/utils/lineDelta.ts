import type { Session } from '../../workspace/types'

export const lineDelta = (
  session: Session
): { added: number; removed: number } => {
  let added = 0
  let removed = 0
  for (const change of session.activity.fileChanges) {
    added += change.linesAdded
    removed += change.linesRemoved
  }

  return { added, removed }
}
