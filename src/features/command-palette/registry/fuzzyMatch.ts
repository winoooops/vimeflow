/**
 * Fuzzy match scoring algorithm.
 * Returns a score for how well a query matches a target string.
 * Higher scores indicate better matches.
 *
 * Scoring strategy:
 * - Exact match: 1000
 * - Prefix match: 500 + (100 / query.length)
 * - Substring match: 100 + position penalty
 * - Character-skip match: 10 + consecutive char bonus
 * - No match: 0
 */
export const fuzzyMatch = (query: string, target: string): number => {
  if (!query || query.trim() === '') {
    return 0
  }

  const normalizedQuery = query.toLowerCase().trim()
  const normalizedTarget = target.toLowerCase()

  // Exact match
  if (normalizedQuery === normalizedTarget) {
    return 1000
  }

  // Prefix match (highest weight)
  if (normalizedTarget.startsWith(normalizedQuery)) {
    return 500 + 100 / normalizedQuery.length
  }

  // Substring match
  const substringIndex = normalizedTarget.indexOf(normalizedQuery)
  if (substringIndex !== -1) {
    // Earlier positions score higher
    const positionPenalty = substringIndex * 2

    return Math.max(100 - positionPenalty, 50)
  }

  // Character-skip match (e.g., "op" matches "open")
  let queryIndex = 0
  let consecutiveMatches = 0
  let maxConsecutive = 0
  let lastMatchIndex = -1

  for (
    let i = 0;
    i < normalizedTarget.length && queryIndex < normalizedQuery.length;
    i++
  ) {
    if (normalizedTarget[i] === normalizedQuery[queryIndex]) {
      queryIndex++
      if (lastMatchIndex === i - 1) {
        consecutiveMatches++
        maxConsecutive = Math.max(maxConsecutive, consecutiveMatches)
      } else {
        consecutiveMatches = 1
      }
      lastMatchIndex = i
    }
  }

  // If all query characters were matched
  if (queryIndex === normalizedQuery.length) {
    return 10 + maxConsecutive * 5
  }

  return 0
}
