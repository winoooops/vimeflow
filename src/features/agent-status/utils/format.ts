/**
 * Formats a token count for compact display.
 *
 * - n < 1000     → exact ("700")
 * - n < 100,000  → one decimal ("1.5k", "7.5k", "85.0k")
 * - n ≥ 100,000  → rounded ("100k", "200k")
 *
 * NOTE: `ContextBucket.tsx` defines its own slightly different formatter
 * (M-aware, always one decimal at the k bucket). They are intentionally
 * separate — consolidating would change ContextBucket's display behavior
 * and is out of scope for this module.
 */
export const formatTokens = (n: number): string => {
  if (n < 1000) {
    return String(n)
  }

  const k = n / 1000

  return k >= 100 ? `${Math.round(k)}k` : `${parseFloat(k.toFixed(1))}k`
}
