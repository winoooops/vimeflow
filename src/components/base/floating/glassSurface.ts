// The one floating-panel chrome. Every floating surface renders this — no per-call-site restyle.
export const GLASS_SURFACE =
  'z-50 rounded-lg bg-surface-container-high/95 backdrop-blur-md backdrop-saturate-150 border border-outline-variant/20 shadow-xl'

// The single floating-ui type the public primitives need. Re-exported so Dropdown/Menu/Popover
// type their `placement` prop without importing @floating-ui/react (ring 1 confines it here).
export type { Placement } from '@floating-ui/react'
