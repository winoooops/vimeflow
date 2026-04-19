export {}

declare global {
  interface Window {
    __VIMEFLOW_E2E__?: {
      getTerminalBuffer(): string
      getTerminalBufferForSession(sessionId: string): string
      getVisibleSessionId(): string | null
      getActiveSessionIds(): string[]
      listActivePtySessions(): Promise<string[]>
    }
  }
}
