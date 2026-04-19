export {}

declare global {
  interface Window {
    __VIMEFLOW_E2E__?: {
      getTerminalBuffer(): string
      getActiveSessionIds(): string[]
      listActivePtySessions(): Promise<string[]>
    }
  }
}
