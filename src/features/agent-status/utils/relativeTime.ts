export const formatRelativeTime = (
  iso: string,
  now: Date = new Date()
): string => {
  const deltaMs = now.getTime() - new Date(iso).getTime()
  // Invalid / unparseable input yields NaN through every branch and
  // would render as 'NaN d ago'. Return a sentinel instead — callers
  // upstream (Rust transcript parser) should keep emitting valid ISO
  // strings, but we don't crash the feed if a malformed one slips by.
  if (Number.isNaN(deltaMs)) {
    return '?'
  }
  const s = Math.floor(deltaMs / 1000)
  // Negative deltas (future timestamp from clock skew) read as 'now'
  // too — written explicitly so the invariant holds if this function
  // is later extended with 'in Xm' semantics for the positive branch.
  if (s < 0) {
    return 'now'
  }
  // Minute-granularity: anything under a minute reads as 'now',
  // then we jump straight to Nm ago — we never display seconds.
  if (s < 60) {
    return 'now'
  }
  const m = Math.floor(s / 60)
  if (m < 60) {
    return `${m}m ago`
  }
  const h = Math.floor(m / 60)
  if (h < 24) {
    return `${h}h ago`
  }
  const d = Math.floor(h / 24)

  return `${d}d ago`
}

export const formatDuration = (ms: number): string => {
  if (Number.isNaN(ms)) {
    return '?'
  }
  // Negative durations are meaningless — the live-duration call site
  // already clamps with Math.max(0, …), but guarding here makes the
  // utility safe for any future caller that forgets the clamp. Mirrors
  // the explicit < 0 branch in formatRelativeTime.
  if (ms < 0) {
    return '?'
  }
  const s = Math.floor(ms / 1000)
  if (s < 60) {
    return `${s}s`
  }
  const m = Math.floor(s / 60)
  if (m < 60) {
    return `${m}m ${s % 60}s`
  }
  const h = Math.floor(m / 60)

  return `${h}h ${m % 60}m`
}
