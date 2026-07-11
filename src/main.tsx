import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/e2e-bridge'
import App from './App.tsx'
import { NativeOverlayHost } from './components/NativeOverlayHost'
import { themeService } from './theme'
import { initTerminalThemeBridge } from './features/terminal/theme/themeBridge'
import {
  isNativeOverlayHostMode,
  nativeOverlayHostModeFrom,
} from './nativeOverlayMode'

themeService.init()
// The bridge intentionally lives for the renderer lifetime; storing the
// unsubscribe makes the lifetime contract explicit.
const cleanupTerminalThemeBridge = initTerminalThemeBridge()
void cleanupTerminalThemeBridge

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

const nativeOverlayMode = new URLSearchParams(window.location.search).get(
  'nativeOverlay'
)

const isNativeOverlayWindow = isNativeOverlayHostMode(nativeOverlayMode)
const nativeOverlayHostMode = nativeOverlayHostModeFrom(nativeOverlayMode)

createRoot(rootElement).render(
  <StrictMode>
    {isNativeOverlayWindow ? (
      <NativeOverlayHost mode={nativeOverlayHostMode} />
    ) : (
      <App />
    )}
  </StrictMode>
)
