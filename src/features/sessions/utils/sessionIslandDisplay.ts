export const SESSION_ISLAND_DISPLAY_MODES = [
  'dots',
  'numbers',
  'labels',
] as const

export type SessionIslandDisplayMode =
  (typeof SESSION_ISLAND_DISPLAY_MODES)[number]

export const resolveSessionIslandDisplay = (
  value: string
): SessionIslandDisplayMode =>
  SESSION_ISLAND_DISPLAY_MODES.includes(value as SessionIslandDisplayMode)
    ? (value as SessionIslandDisplayMode)
    : 'dots'
