export {}

declare global {
  interface VimeflowE2ePtyDataEvent {
    readonly sessionId: string
    readonly data: string
    readonly bytesBase64?: string
    readonly offsetStart: number
    readonly byteLen: number
  }

  interface Window {
    __VIMEFLOW_E2E__?: {
      clearRecordedPtyDataEvents(): void
      getRecordedPtyDataEvents(): readonly VimeflowE2ePtyDataEvent[]
      getTerminalBuffer(): string
      getTerminalBufferForSession(sessionId: string): string
      getTerminalRendererConfig(): {
        readonly terminalRenderer: string | null
        readonly ghosttyRenderStateDriverProvider: string | null
      }
      getVisibleTerminalSelection(): string
      getVisibleTerminalSize(): { readonly cols: number; readonly rows: number } | null
      getVisibleSessionId(): string | null
      getActiveSessionIds(): string[]
      listActivePtySessions(): Promise<string[]>
      selectAllVisibleTerminal(): boolean
      startRecordingPtyDataEvents(): Promise<void>
      writeInputToVisibleTerminal(data: string): Promise<boolean>
      writeOutputToVisibleTerminal(data: string): boolean
    }
  }
}
