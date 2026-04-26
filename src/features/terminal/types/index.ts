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
