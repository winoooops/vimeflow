export type NativeOverlayHostMode = 'menu' | 'tooltip'

const nativeOverlayHostModes = new Set(['1', 'menu', 'tooltip', 'popover'])

export const isNativeOverlayHostMode = (mode: string | null): boolean =>
  mode !== null && nativeOverlayHostModes.has(mode)

export const nativeOverlayHostModeFrom = (
  mode: string | null
): NativeOverlayHostMode => (mode === 'tooltip' ? 'tooltip' : 'menu')
