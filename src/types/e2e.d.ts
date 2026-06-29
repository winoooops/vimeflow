import type { BrowserPaneBoundsCapture as BrowserPaneBoundsCaptureSource } from '../features/browser/browserBridge'

export {}

declare global {
  type BrowserPaneBoundsCapture = BrowserPaneBoundsCaptureSource
  type E2eNativeOverlayRect = {
    x: number
    y: number
    width: number
    height: number
  }

  type E2eNativeOverlayProbeCounts = {
    actions: number
    closes: number
  }

  interface Window {
    __VIMEFLOW_E2E__?: {
      getTerminalBuffer(): string
      getTerminalBufferForSession(sessionId: string): string
      getVisibleSessionId(): string | null
      getVisiblePtyId(): string | null
      getActiveSessionIds(): string[]
      invokeBackend<T>(
        method: string,
        args?: Record<string, unknown>
      ): Promise<T>
      emitBackendEvent(event: string, payload: unknown): void
      listActivePtySessions(): Promise<string[]>
      startBrowserPaneBoundsCapture(): boolean
      clearBrowserPaneBoundsCaptures(): void
      stopBrowserPaneBoundsCapture(): void
      getBrowserPaneBoundsCaptures(): BrowserPaneBoundsCapture[]
      openNativeOverlayProbeMenu(
        anchorRect: E2eNativeOverlayRect
      ): Promise<{ accepted: boolean; reason?: string }>
      closeNativeOverlayProbeMenu(): Promise<void>
      getNativeOverlayProbeCounts(): E2eNativeOverlayProbeCounts
    }
  }
}
