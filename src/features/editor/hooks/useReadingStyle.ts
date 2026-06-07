import { useSyncExternalStore } from 'react'
import {
  getReadingStyle,
  type ReadingStyle,
  type ReadingStyleId,
} from '../data/readingStyles'
import {
  getReadingStyleId,
  setReadingStyleId,
  subscribeReadingStyle,
} from '../utils/readingStyleStore'

export interface UseReadingStyleResult {
  style: ReadingStyle
  styleId: ReadingStyleId
  setStyleId: (id: ReadingStyleId) => void
}

/**
 * Subscribe to the shared, persisted reading-style preference. Every consumer
 * (the ⚙ menu, the reading view) re-renders together when the choice changes,
 * because they all read the same external store via `useSyncExternalStore`.
 */
export const useReadingStyle = (): UseReadingStyleResult => {
  const styleId = useSyncExternalStore(
    subscribeReadingStyle,
    getReadingStyleId,
    getReadingStyleId
  )

  return {
    style: getReadingStyle(styleId),
    styleId,
    setStyleId: setReadingStyleId,
  }
}
