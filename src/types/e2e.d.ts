import type { BrowserPaneBoundsCapture as BrowserPaneBoundsCaptureSource } from '../features/browser/browserBridge'

export {}

declare global {
  type BrowserPaneBoundsCapture = BrowserPaneBoundsCaptureSource
  interface Window {
    __VIMEFLOW_E2E__?: {
      getTerminalBuffer(): string
      getTerminalBufferForSession(sessionId: string): string
      getVisibleSessionId(): string | null
      getVisiblePtyId(): string | null
      getLayoutCreatorGrid(): { cols: number; rows: number } | undefined
      getLayoutCreatorDraftGrid(): { cols: number; rows: number } | undefined
      getActiveSessionIds(): string[]
      invokeBackend<T>(
        method: string,
        args?: Record<string, unknown>
      ): Promise<T>
      emitBackendEvent(event: string, payload: unknown): void
      listActivePtySessions(): Promise<string[]>
      dispatchCommandPaletteShortcut(): Promise<boolean>
      readGhosttyGrid(ptyId?: string): Promise<string | null>
      readGhosttyPresentation(ptyId?: string): Promise<string | null>
      startBrowserPaneBoundsCapture(): boolean
      clearBrowserPaneBoundsCaptures(): void
      stopBrowserPaneBoundsCapture(): void
      getBrowserPaneBoundsCaptures(): BrowserPaneBoundsCapture[]
    }
  }
}
