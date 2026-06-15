export {}

declare global {
  interface BrowserPaneBoundsCapture {
    sequence: number
    sessionId: string
    paneId: string
    bounds: {
      x: number
      y: number
      width: number
      height: number
    }
    visible: boolean
    shortcutContext?: {
      paneIds: string[]
      activePaneId: string | null
    }
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
      getBrowserPaneBoundsCaptures(): BrowserPaneBoundsCapture[]
    }
  }
}
