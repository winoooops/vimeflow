/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TERMINAL_RENDERER?: string
  readonly VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER?: string
}

declare const __APP_VERSION__: string
