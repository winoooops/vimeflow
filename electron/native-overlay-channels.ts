export const NATIVE_OVERLAY_OPEN = 'native-overlay:open'

export const NATIVE_OVERLAY_CLOSE = 'native-overlay:close'

export const NATIVE_OVERLAY_PRELOAD = 'native-overlay:preload'

export const NATIVE_OVERLAY_ACTION_RESULT = 'native-overlay:action-result'

export const NATIVE_OVERLAY_RESUME = 'native-overlay:resume'

export const NATIVE_OVERLAY_MOUSE_PASSTHROUGH =
  'native-overlay:mouse-passthrough'

export type NativeOverlayInvokeChannel =
  | typeof NATIVE_OVERLAY_OPEN
  | typeof NATIVE_OVERLAY_CLOSE
  | typeof NATIVE_OVERLAY_PRELOAD
  | typeof NATIVE_OVERLAY_ACTION_RESULT
  | typeof NATIVE_OVERLAY_RESUME
  | typeof NATIVE_OVERLAY_MOUSE_PASSTHROUGH

export const NATIVE_OVERLAY_ACTION = 'native-overlay:action'

export const NATIVE_OVERLAY_CLOSED = 'native-overlay:closed'

export const NATIVE_OVERLAY_RENDER = 'native-overlay:render'

export const NATIVE_OVERLAY_CLEAR = 'native-overlay:clear'

export const NATIVE_OVERLAY_KEYDOWN = 'native-overlay:keydown'

export const NATIVE_OVERLAY_READY = 'native-overlay:ready'
