import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/e2e-bridge'
import App from './App.tsx'
import { themeService } from './theme'
import { initTerminalThemeBridge } from './features/terminal/theme/themeBridge'

themeService.init()
initTerminalThemeBridge()

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
