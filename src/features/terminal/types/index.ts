/**
 * Terminal feature domain types
 */

import type { GhosttyVtRenderSnapshot } from '../../../bindings'

export type { GhosttyVtRenderSnapshot } from '../../../bindings'

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
  ghosttySnapshot?: GhosttyVtRenderSnapshot
  bufferedEvents: {
    data: string
    offsetStart: number
    byteLen: number
    bytesBase64?: string
    ghosttySnapshot?: GhosttyVtRenderSnapshot
    ghosttyCwdUri?: string
  }[]
}

/** Handler that receives a buffered PTY event during pane drain. */
export type PaneEventHandler = (
  data: string,
  offsetStart: number,
  byteLen: number,
  bytesBase64?: string,
  ghosttySnapshot?: GhosttyVtRenderSnapshot,
  ghosttyCwdUri?: string
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

/** Source phase for output written into a terminal renderer. */
export type TerminalOutputPhase = 'live' | 'restore'

/** Payload format a renderer adapter consumes from terminal output chunks. */
export type TerminalOutputInputMode = 'text' | 'bytes'

/** PTY output chunk delivered to a renderer-owned parser/writer. */
export interface TerminalOutputChunk {
  /** UTF-8 decoded text payload used by the current xterm-compatible path. */
  readonly text: string
  /** Optional raw byte payload for future byte-preserving renderer adapters. */
  readonly bytesBase64?: string
  /** Optional Rust-owned Ghostty VT render-state snapshot. */
  readonly ghosttySnapshot?: GhosttyVtRenderSnapshot
  /** Optional OSC 7 cwd URI reported by Rust-owned Ghostty VT state. */
  readonly ghosttyCwdUri?: string
  /** Producer byte offset for this chunk, if known. */
  readonly offsetStart: number | null
  /** Producer byte length for this chunk, if known. */
  readonly byteLen: number | null
  /** Whether this chunk is live output or historical restore replay. */
  readonly phase: TerminalOutputPhase
}

/** Output metadata attached to parser events when a renderer can provide it. */
export interface TerminalParserOutputContext {
  readonly offsetStart: number | null
  readonly byteLen: number | null
  readonly phase: TerminalOutputPhase
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

/** Adapter-owned writer for PTY output chunks. */
export interface TerminalOutputWriter {
  writeOutput: (chunk: TerminalOutputChunk, callback?: () => void) => void
}

interface TextPreferredTerminalRendererCapabilities {
  /** Preferred payload format when both text and bytes are available. */
  readonly preferredOutputInputMode: 'text'
  /** Text-preferring renderers must consume `TerminalOutputChunk.text`. */
  readonly acceptsText: true
  /** Whether the renderer can consume `TerminalOutputChunk.bytesBase64`. */
  readonly acceptsBytes: boolean
}

interface BytesPreferredTerminalRendererCapabilities {
  /** Preferred payload format when both text and bytes are available. */
  readonly preferredOutputInputMode: 'bytes'
  /** Whether the renderer can consume `TerminalOutputChunk.text`. */
  readonly acceptsText: boolean
  /** Byte-preferring renderers must consume `TerminalOutputChunk.bytesBase64`. */
  readonly acceptsBytes: true
}

/** Declares how a renderer adapter consumes terminal output chunks. */
export type TerminalRendererCapabilities =
  | TextPreferredTerminalRendererCapabilities
  | BytesPreferredTerminalRendererCapabilities

/** Renderer addon handle owned by the terminal adapter. */
export interface TerminalRendererHandle {
  dispose: () => void
}

/** Cwd event emitted from OSC 7 terminal control sequences. */
export interface TerminalCwdParserEvent {
  readonly type: 'cwd'
  readonly source: 'osc7'
  /**
   * Raw OSC 7 URI/path payload from the terminal stream.
   *
   * This is untrusted terminal output, not a normalized filesystem path.
   * Consumers that need a cwd must validate and normalize it with
   * `parseOsc7Cwd` or an equivalent filesystem-only parser before storing it
   * or passing it to any shell/open-external path.
   */
  readonly uri: string
  readonly output: TerminalParserOutputContext | null
}

/** Parser event emitted from terminal control sequences. */
export type TerminalParserEvent = TerminalCwdParserEvent

/** Handler for semantic parser events. */
export type TerminalParserEventHandler = (event: TerminalParserEvent) => void

/**
 * Parser hooks emitted from terminal control sequences.
 *
 * The current adapter contract emits cwd events derived from OSC 7. Adapters may
 * consume matched control sequences from rendered output while subscribers are
 * registered; callers should treat subscription as observing terminal semantics,
 * not as a passive raw stream tap.
 */
export interface TerminalParser {
  onEvent: (handler: TerminalParserEventHandler) => TerminalDisposable
}

/** Reads the currently visible terminal text for automation and diagnostics. */
export interface TerminalViewportReader {
  readVisibleText: () => string
}

/** Complete terminal renderer instance created for a pane. */
export interface TerminalInstance {
  terminal: TerminalSurface
  output: TerminalOutputWriter
  parser: TerminalParser
  viewportReader: TerminalViewportReader
  fitController: TerminalFitController
  attachRenderer: () => TerminalRendererHandle
}

/** Adapter that creates complete terminal renderer instances. */
export interface TerminalRendererAdapter {
  readonly id: string
  readonly capabilities: TerminalRendererCapabilities
  createInstance: () => TerminalInstance
}
