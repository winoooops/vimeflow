import type { BrowserPaneBoundsCapture as BrowserPaneBoundsCaptureSource } from '../features/browser/browserBridge'

export {}

declare global {
  type BrowserPaneBoundsCapture = BrowserPaneBoundsCaptureSource

  interface Window {
    __VIMEFLOW_E2E__?: {
      getTerminalBuffer(): string
      getTerminalBufferForSession(sessionId: string): string
      getVisibleSessionId(): string | null
      getActiveSessionIds(): string[]
      listActivePtySessions(): Promise<string[]>
      startBrowserPaneBoundsCapture(): boolean
      clearBrowserPaneBoundsCaptures(): void
      stopBrowserPaneBoundsCapture(): void
      getBrowserPaneBoundsCaptures(): BrowserPaneBoundsCapture[]
    }
  }
}
