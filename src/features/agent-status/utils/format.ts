// Not consolidated with ContextBucket's M-aware formatter — would change that component's display.
export const formatTokens = (n: number): string => {
  if (n < 1000) {
    return String(n)
  }

  const k = n / 1000

  return k >= 100 ? `${Math.round(k)}k` : `${parseFloat(k.toFixed(1))}k`
}
