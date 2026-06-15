/**
 * Terminal feature domain types
 */

/**
 * Terminal session status
 */
export type TerminalStatus =
  | 'idle'
  | 'spawning'
  | 'running'
  | 'exited'
  | 'error'

/**
 * Terminal session data model
 */
export interface TerminalSession {
  /** Unique session identifier */
  id: string
  /** Human-readable session name */
  name: string
  /** Process ID of the PTY */
  pid: number | null
  /** Current working directory */
  cwd: string
  /** Shell command (e.g., '/bin/bash', 'claude') */
  shell: string
  /** Environment variables */
  env: Record<string, string>
  /** Session status */
  status: TerminalStatus
  /** Created timestamp */
  createdAt: Date
  /** Last activity timestamp */
  lastActivityAt: Date
}

/**
 * Terminal tab UI model
 */
export interface TerminalTab {
  /** Associated session ID */
  sessionId: string
  /** Tab display title */
  title: string
  /** Whether this tab is active */
  isActive: boolean
  /** Tab icon (🤖 for agent, 🐚 for shell) */
  icon: string
}

/**
 * PTY spawn command parameters
 */
export interface PTYSpawnParams {
  /** Shell to spawn (e.g., '/bin/bash', 'claude'). If undefined, backend chooses platform default. */
  shell?: string
  /** Working directory */
  cwd: string
  /** Environment variables */
  env?: Record<string, string>
  /** Terminal size */
  cols?: number
  rows?: number
  /**
   * Whether to create a `.vimeflow/sessions/<uuid>/` agent-bridge directory in
   * the cwd. The agent statusline (Claude Code transcript watching) requires
   * this — when the user explicitly creates a tab via the workspace UI, the
   * bridge IS the product. Defaults to `false` so callers (e.g. tests, ad-hoc
   * spawns) don't pollute arbitrary cwd values with bookkeeping dirs.
   *
   * Round 8, Finding 3 (claude MEDIUM): previously hardcoded `true` in
   * `desktopTerminalService.spawn`, so every spawn — including throwaway test
   * sessions, integration runs in `/tmp`, and any third-party project root —
   * created a `.vimeflow/sessions/` tree that showed up in `git status`.
   */
  enableAgentBridge?: boolean
  /** Ephemeral (burner) PTY: skip the session cache and the agent-bridge dir. */
  ephemeral?: boolean
}

/**
 * PTY spawn command result
 */
export interface PTYSpawnResult {
  /** Assigned session ID */
  sessionId: string
  /** Process ID */
  pid: number
  /** Resolved working directory (absolute path from Rust) — Rust always returns this */
  cwd: string
  /** Resolved shell path used for this PTY. */
  shell: string
}

/**
 * PTY write command parameters
 */
export interface PTYWriteParams {
  /** Target session ID */
  sessionId: string
  /** Data to write to stdin */
  data: string
}

/**
 * PTY resize command parameters
 */
export interface PTYResizeParams {
  /** Target session ID */
  sessionId: string
  /** Number of rows */
  rows: number
  /** Number of columns */
  cols: number
}

/**
 * PTY kill command parameters
 */
export interface PTYKillParams {
  /** Target session ID */
  sessionId: string
}

/**
 * PTY event types — re-exported from generated bindings (Rust is source of truth)
 */
export type { PtyDataEvent as PTYDataEvent } from '../../../bindings'

export type { PtyExitEvent as PTYExitEvent } from '../../../bindings'

export type { PtyErrorEvent as PTYErrorEvent } from '../../../bindings'

/**
 * Terminal theme color palette
 */
export interface TerminalTheme {
  /** Foreground color */
  foreground: string
  /** Background color */
  background: string
  /** Cursor color */
  cursor: string
  /** Cursor accent color */
  cursorAccent: string
  /** Selection background */
  selectionBackground: string
  /** Selection foreground */
  selectionForeground?: string
  /** ANSI black */
  black: string
  /** ANSI red */
  red: string
  /** ANSI green */
  green: string
  /** ANSI yellow */
  yellow: string
  /** ANSI blue */
  blue: string
  /** ANSI magenta */
  magenta: string
  /** ANSI cyan */
  cyan: string
  /** ANSI white */
  white: string
  /** ANSI bright black */
  brightBlack: string
  /** ANSI bright red */
  brightRed: string
  /** ANSI bright green */
  brightGreen: string
  /** ANSI bright yellow */
  brightYellow: string
  /** ANSI bright blue */
  brightBlue: string
  /** ANSI bright magenta */
  brightMagenta: string
  /** ANSI bright cyan */
  brightCyan: string
  /** ANSI bright white */
  brightWhite: string
}

/** Restoration data per PTY, populated at mount-time restore and on
 * createSession. Consumed by `<TerminalPane>` Body when it mounts. */
export interface RestoreData {
  sessionId: string
  cwd: string
  pid: number
  replayData: string
  replayEndOffset: number
  bufferedEvents: { data: string; offsetStart: number; byteLen: number }[]
}

/** Handler that receives a buffered PTY event during pane drain. */
export type PaneEventHandler = (
  data: string,
  offsetStart: number,
  byteLen: number
) => void

/** Cleanup callback returned by `notifyPaneReady` — call on pane unmount. */
export type NotifyPaneReadyResult = () => void

/** Generic cleanup handle returned by terminal renderer subscriptions. */
export interface TerminalDisposable {
  dispose: () => void
}

/** Terminal grid dimensions. */
export interface TerminalSize {
  cols: number
  rows: number
}

/** Renderer-level keyboard event hook. Return false to stop the terminal. */
export type TerminalKeyEventHandler = (event: KeyboardEvent) => boolean

/** Terminal viewport object consumed by app logic. */
export interface TerminalSurface {
  readonly cols: number
  readonly rows: number
  readonly element: HTMLElement | undefined
  open: (container: HTMLElement) => void
  focus: () => void
  dispose: () => void
  clear: () => void
  write: (data: string, callback?: () => void) => void
  refresh: (start: number, end: number) => void
  onData: (handler: (data: string) => void) => TerminalDisposable
  onResize: (handler: (size: TerminalSize) => void) => TerminalDisposable
  hasSelection: () => boolean
  getSelection: () => string
  paste: (text: string) => void
  selectAll: () => void
  onSelectionChange: (listener: () => void) => TerminalDisposable
  attachKeyEventHandler: (handler: TerminalKeyEventHandler) => void
  applyTheme: (theme: TerminalTheme) => void
}

/** Controller used to fit a terminal surface to its container. */
export interface TerminalFitController {
  fit: () => void
}

/** Renderer addon handle owned by the terminal adapter. */
export interface TerminalRendererHandle {
  dispose: () => void
}

/** Parser hooks emitted from terminal control sequences. */
export interface TerminalParser {
  registerOscHandler: (
    identifier: number,
    handler: (data: string) => boolean
  ) => TerminalDisposable
}

/** Reads the currently visible terminal text for automation and diagnostics. */
export interface TerminalViewportReader {
  readVisibleText: () => string
}

/** Complete terminal renderer instance created for a pane. */
export interface TerminalInstance {
  terminal: TerminalSurface
  parser: TerminalParser
  viewportReader: TerminalViewportReader
  fitController: TerminalFitController
  attachRenderer: () => TerminalRendererHandle
}
