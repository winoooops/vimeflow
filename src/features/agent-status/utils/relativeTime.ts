export const formatRelativeTime = (
  iso: string,
  now: Date = new Date()
): string => {
  const deltaMs = now.getTime() - new Date(iso).getTime()
  const s = Math.floor(deltaMs / 1000)
  if (s < 5) {
    return 'now'
  }
  if (s < 60) {
    return `${s}s ago`
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
