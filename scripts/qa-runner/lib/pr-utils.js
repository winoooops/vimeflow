// Shared PR-body helpers for the QA runner (used by watch.js + run.js).

// The Linear issue this PR closes — prefer the `Closes/Fixes/Resolves VIM-N` magic
// word, fall back to the first VIM-N mention. Deterministic so status never posts
// to a related/historical ticket mentioned earlier in the body.
export const linkedVim = (body) => {
  const b = body || ''
  const closing = b.match(/\b(?:closes|fixes|resolves)\s+(VIM-\d+)\b/i)

  return (closing?.[1] || b.match(/\bVIM-\d+\b/i)?.[0])?.toUpperCase()
}
