export {}

declare global {
  interface Window {
    __VIMEFLOW_E2E__?: {
      getTerminalBuffer(): string
      getTerminalBufferForSession(sessionId: string): string
      getVisibleTerminalSize(): { readonly cols: number; readonly rows: number } | null
      getVisibleSessionId(): string | null
      getActiveSessionIds(): string[]
      listActivePtySessions(): Promise<string[]>
      writeOutputToVisibleTerminal(data: string): boolean
    }
  }
}
