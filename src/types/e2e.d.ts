import type { BrowserPaneBoundsRequest } from '../features/browser/types'

export {}

declare global {
  interface BrowserPaneBoundsCapture extends BrowserPaneBoundsRequest {
    sequence: number
  }

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
