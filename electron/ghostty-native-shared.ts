// cspell:ignore Ghostty ghostty GHOSTTY
export interface GhosttyNativeBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface GhosttyNativePaneRequest {
  sessionId: string
  paneId: string
}

export interface GhosttyNativeShortcutContext {
  paneIds: string[]
  activePaneId: string | null
}

export interface GhosttyNativeUpdateRequest extends GhosttyNativePaneRequest {
  cwd: string
  bounds: GhosttyNativeBounds
  backgroundColor?: string
  bottomCornerRadius?: number
  visible: boolean
  shortcutContext?: GhosttyNativeShortcutContext
}

export interface GhosttyNativeDataRequest extends GhosttyNativePaneRequest {
  data: string
}

export function isBounds(value: unknown): value is GhosttyNativeBounds {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y) &&
    typeof value.width === 'number' &&
    Number.isFinite(value.width) &&
    typeof value.height === 'number' &&
    Number.isFinite(value.height)
  )
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

export function isOptionalFiniteNumber(value: unknown): value is number {
  return (
    value === undefined || (typeof value === 'number' && Number.isFinite(value))
  )
}
