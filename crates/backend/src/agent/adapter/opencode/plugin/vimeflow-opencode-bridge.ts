// vimeflow-bridge-version: 3
//
// Vimeflow opencode bridge plugin.
//
// Subscribes to opencode's plugin hooks and appends each whitelisted event as
// one compact JSON line to a per-session JSONL file under a Vimeflow-owned
// bridge directory. The Vimeflow Rust adapter then tails those files as a
// pure-filesystem locator + JSONL stream (no opencode DB coupling).
//
// This file is a build asset embedded into the Vimeflow backend via
// `include_str!` and auto-installed into `~/.config/opencode/plugins/`. It is
// intentionally dependency-free: hook params are typed `any` so it type-checks
// standalone (see `tsconfig.opencode-bridge.json`) without `@opencode-ai/*`.
//
// Data minimization (spec §6): tool args are previewed (never full payloads),
// tool output is excerpted, every other string is bounded, files are 0600, and
// no permission/credential/account payloads are emitted. All filesystem I/O is
// wrapped in try/catch so a write error never throws into the host opencode
// session.
//
// One deliberate exception (VIM-293): the assistant's own turn text is
// aggregated in memory and written as a single tail-clamped `assistant.text`
// record at session.idle so Vimeflow can capture VIMEFLOW_REPLY blocks — the
// same conversation text kimi/claude/codex already persist in their own
// transcripts. User text is never written.

import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SCHEMA_VERSION = 1

// Max bytes for a tool-output excerpt and max chars for any other string field.
const MAX_FIELD = 2048
const MAX_SESSION_ID = 128
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/

// Whitelisted bus event types. Everything else (esp. high-volume
// `message.part.delta`, `catalog.updated`, `plugin.added`) is dropped, and
// permission events are out of scope for v1.
const EVENT_WHITELIST = new Set([
  'session.created',
  'session.updated',
  'session.idle',
  'session.status',
  'session.error',
  'session.diff',
  'message.updated',
  'message.part.updated',
  'todo.updated',
])

// For `message.part.updated`, keep only these part types.
const PART_WHITELIST = new Set(['tool', 'step-finish', 'step-start'])

const bridgeDir = (): string => {
  const override = process.env.VIMEFLOW_OPENCODE_BRIDGE_DIR

  if (override) {
    return override
  }

  // Treat an unset OR empty XDG_DATA_HOME as "use the default" to match the
  // shell `${XDG_DATA_HOME:-$HOME/.local/share}` and the Rust `non_empty_env`
  // semantics, so the two sides derive a byte-identical path on every input.
  const xdg = process.env.XDG_DATA_HOME
  const dataHome = xdg ? xdg : join(homedir(), '.local', 'share')

  return join(dataHome, 'vimeflow', 'opencode-bridge')
}

const DIR = bridgeDir()

let dirReady = false

const ensureDir = (): boolean => {
  if (dirReady) {
    return true
  }

  try {
    mkdirSync(DIR, { recursive: true, mode: 0o700 })
    dirReady = true

    return true
  } catch {
    return false
  }
}

// Bound an arbitrary string to MAX_FIELD chars (used for non-output fields).
const clampString = (value: any): any => {
  if (typeof value !== 'string') {
    return value
  }

  return value.length > MAX_FIELD ? value.slice(0, MAX_FIELD) : value
}

// Excerpt a tool output to <= MAX_FIELD bytes as head + tail with an elision
// marker, so a large test-runner log stays useful but bounded.
const excerptOutput = (value: any): any => {
  if (typeof value !== 'string') {
    return value
  }

  if (value.length <= MAX_FIELD) {
    return value
  }

  const half = Math.floor((MAX_FIELD - 16) / 2)
  const head = value.slice(0, half)
  const tail = value.slice(value.length - half)

  return `${head}\n…[elided]…\n${tail}`
}

// Content-bearing arg fields to drop: these carry full file contents or large
// payloads (an `edit`'s before/after text, a `write`'s body, a `task` prompt
// body), which the data-minimization rule keeps out of the bridge.
const CONTENT_ARG_FIELDS = new Set([
  'content',
  'newString',
  'oldString',
  'old_string',
  'new_string',
  'body',
  'contents',
  'fileContent',
  'prompt',
])

const SENSITIVE_ARG_FIELDS = new Set([
  'accesskey',
  'apikey',
  'authorization',
  'authkey',
  'authtoken',
  'bearertoken',
  'clientsecret',
  'credential',
  'credentials',
  'encryptionkey',
  'password',
  'passwd',
  'privatekey',
  'refreshtoken',
  'secret',
  'secretaccesskey',
  'secretkey',
  'signingkey',
  'token',
])

const SENSITIVE_ARG_FIELD_SUFFIXES = [
  'accesskey',
  'apikey',
  'authorization',
  'authtoken',
  'encryptionkey',
  'password',
  'secret',
  'secretaccesskey',
  'secretkey',
  'signingkey',
  'token',
]

const isSensitiveArgField = (key: string): boolean => {
  const normalized = key.replace(/[-_\s]/g, '').toLowerCase()

  return (
    SENSITIVE_ARG_FIELDS.has(normalized) ||
    SENSITIVE_ARG_FIELD_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  )
}

// Preview tool args: return a shallow copy of `args` with every string field
// clamped to the cap, dropping content fields and redacting credential-shaped
// field names before anything is written to the bridge JSONL.
const previewArgs = (tool: any, args: any): any => {
  void tool

  if (args == null || typeof args !== 'object' || Array.isArray(args)) {
    return {}
  }

  const preview: any = {}

  for (const key of Object.keys(args)) {
    if (CONTENT_ARG_FIELDS.has(key)) {
      continue
    }

    const value = args[key]

    if (isSensitiveArgField(key)) {
      preview[key] = '[redacted]'
      continue
    }

    if (typeof value === 'string') {
      preview[key] = clampString(value)
    } else if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      // Scalars (line numbers, limits, flags) are safe and small.
      preview[key] = value
    }
    // Nested objects / arrays are dropped: they may carry content payloads and
    // are not needed for the activity-feed preview.
  }

  return preview
}

const asObject = (value: any): any =>
  value != null && typeof value === 'object' ? value : {}

const clampNumber = (value: any): any =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const sanitizeModel = (model: any): any => {
  const record = asObject(model)

  return {
    providerID: clampString(record.providerID),
    modelID: clampString(record.modelID),
  }
}

const sanitizeTime = (time: any): any => {
  const record = asObject(time)

  return {
    created: clampNumber(record.created),
    completed: clampNumber(record.completed),
  }
}

const sanitizeTokens = (tokens: any): any => {
  const record = asObject(tokens)
  const cache = asObject(record.cache)

  return {
    input: clampNumber(record.input),
    output: clampNumber(record.output),
    reasoning: clampNumber(record.reasoning),
    cache: {
      read: clampNumber(cache.read),
      write: clampNumber(cache.write),
    },
  }
}

const sanitizeStatus = (status: any): any => {
  const record = asObject(status)

  return {
    type: clampString(record.type),
    message: clampString(record.message),
    attempt: clampNumber(record.attempt),
    next: clampNumber(record.next),
  }
}

const sanitizeMessageInfo = (info: any): any => {
  const record = asObject(info)

  return {
    id: clampString(record.id),
    sessionID: clampString(record.sessionID),
    role: clampString(record.role),
    agent: clampString(record.agent),
    version: clampString(record.version),
    model: sanitizeModel(record.model),
    tokens: sanitizeTokens(record.tokens),
    cost: clampNumber(record.cost),
    time: sanitizeTime(record.time),
  }
}

const sanitizeToolState = (tool: any, state: any): any => {
  const record = asObject(state)
  const metadata = asObject(record.metadata)

  return {
    status: clampString(record.status ?? record.type),
    title: clampString(record.title),
    args: previewArgs(tool, record.args ?? record.input),
    output: excerptOutput(record.output),
    metadata: {
      exit: metadata.exit,
      truncated: metadata.truncated,
    },
  }
}

const sanitizePart = (part: any): any => {
  const record = asObject(part)
  const type = record.type

  if (type === 'tool') {
    const tool = record.tool ?? record.name

    return {
      type,
      id: clampString(record.id),
      sessionID: clampString(record.sessionID),
      messageID: clampString(record.messageID),
      callID: clampString(record.callID),
      tool: clampString(tool),
      state: sanitizeToolState(tool, record.state ?? record),
      time: sanitizeTime(record.time),
    }
  }

  return {
    type: clampString(type),
    id: clampString(record.id),
    sessionID: clampString(record.sessionID),
    messageID: clampString(record.messageID),
    tokens: sanitizeTokens(record.tokens),
    cost: clampNumber(record.cost),
    time: sanitizeTime(record.time),
  }
}

const sanitizeEventData = (type: string, properties: any): any => {
  if (type === 'message.updated') {
    return { info: sanitizeMessageInfo(properties.info) }
  }

  if (type === 'message.part.updated') {
    return {
      sessionID: clampString(properties.sessionID),
      part: sanitizePart(properties.part),
    }
  }

  if (type === 'session.created' || type === 'session.updated') {
    return { info: sanitizeMessageInfo(properties.info) }
  }

  return {
    sessionID: clampString(properties.sessionID),
    status: sanitizeStatus(properties.status),
    error: clampString(properties.error),
  }
}

// Append one already-serializable record to <bridge>/<file>, 0600, best effort.
const appendLine = (file: string, record: any): void => {
  if (!ensureDir()) {
    return
  }

  try {
    const line = `${JSON.stringify(record)}\n`

    appendFileSync(join(DIR, file), line, { mode: 0o600 })
  } catch {
    // A bridge write must never break the host opencode session.
  }
}

const sessionFilename = (sessionID: any): string | undefined => {
  if (
    typeof sessionID !== 'string' ||
    sessionID.length === 0 ||
    sessionID.length > MAX_SESSION_ID ||
    !SAFE_SESSION_ID.test(sessionID)
  ) {
    return undefined
  }

  return `${sessionID}.jsonl`
}

const appendSessionLine = (sessionID: any, record: any): void => {
  const file = sessionFilename(sessionID)

  if (file == null) {
    return
  }

  appendLine(file, record)
}

const now = (): number => Date.now()

// --- assistant reply capture (VIM-293) ---
//
// Buffer the LATEST snapshot of each assistant text part in memory (a
// `message.part.updated` carries the part's full text-so-far, so overwrite by
// part id — never append) and write ONE aggregated `assistant.text` record at
// `session.idle`, then reset. Raw text parts are never written per-update
// (that would re-serialize the growing text on every delta), and user parts
// are never buffered — the dispatched review/feedback prompt itself contains
// an example VIMEFLOW_REPLY block that must not round-trip as a reply.
const MAX_REPLY_TEXT = 8192
const assistantMessages = new Map<string, Set<string>>()
const assistantTextParts = new Map<string, Map<string, string>>()

const trackAssistantMessage = (info: any): void => {
  const record = asObject(info)
  const sessionID = record.sessionID
  const messageID = record.id

  if (
    record.role !== 'assistant' ||
    typeof sessionID !== 'string' ||
    typeof messageID !== 'string'
  ) {
    return
  }

  let ids = assistantMessages.get(sessionID)

  if (ids === undefined) {
    ids = new Set()
    assistantMessages.set(sessionID, ids)
  }

  ids.add(messageID)
}

const bufferAssistantTextPart = (part: any): void => {
  const record = asObject(part)
  const sessionID = record.sessionID
  const messageID = record.messageID
  const partID = record.id
  const text = record.text

  if (
    typeof sessionID !== 'string' ||
    typeof messageID !== 'string' ||
    typeof partID !== 'string' ||
    typeof text !== 'string' ||
    text.length === 0
  ) {
    return
  }

  if (assistantMessages.get(sessionID)?.has(messageID) !== true) {
    return
  }

  let parts = assistantTextParts.get(sessionID)

  if (parts === undefined) {
    parts = new Map()
    assistantTextParts.set(sessionID, parts)
  }

  parts.set(partID, text)
}

const flushAssistantText = (sessionID: any): void => {
  if (typeof sessionID !== 'string') {
    return
  }

  const parts = assistantTextParts.get(sessionID)
  assistantTextParts.delete(sessionID)
  assistantMessages.delete(sessionID)

  if (parts === undefined || parts.size === 0) {
    return
  }

  const joined = [...parts.values()].join('\n')
  // Keep the TAIL — the reply contract puts the sentinel block at the end.
  const text =
    joined.length > MAX_REPLY_TEXT ? joined.slice(-MAX_REPLY_TEXT) : joined

  appendSessionLine(sessionID, {
    v: SCHEMA_VERSION,
    ts: now(),
    kind: 'event',
    type: 'assistant.text',
    data: { sessionID, text },
  })
}

// Last-seen directory per session, so we only append an index row on
// session.created and on a session.updated where the directory changed.
const lastDirectory = new Map<string, string>()

const writeIndexRow = (
  sessionID: any,
  pid: number,
  directory: any,
  slug: any
): void => {
  if (sessionFilename(sessionID) == null) {
    return
  }

  appendLine('index.jsonl', {
    sessionID,
    pid,
    directory: clampString(directory),
    slug: clampString(slug),
    time: now(),
  })
}

const handleSessionInfo = (type: string, info: any): void => {
  if (info == null || typeof info !== 'object') {
    return
  }

  const sessionID = info.id

  if (typeof sessionID !== 'string') {
    return
  }

  const directory = typeof info.directory === 'string' ? info.directory : ''
  const previous = lastDirectory.get(sessionID)

  if (type === 'session.created' || previous !== directory) {
    lastDirectory.set(sessionID, directory)
    writeIndexRow(sessionID, process.pid, directory, info.slug)
  }
}

const handleEvent = (event: any): void => {
  if (event == null || typeof event !== 'object') {
    return
  }

  const type = event.type

  if (typeof type !== 'string' || !EVENT_WHITELIST.has(type)) {
    return
  }

  const properties =
    event.properties != null && typeof event.properties === 'object'
      ? event.properties
      : {}

  // Drop noisy non-whitelisted message parts before any disk write.
  if (type === 'message.part.updated') {
    const part = properties.part
    const partType =
      part != null && typeof part === 'object' ? part.type : undefined

    // Assistant text parts are buffered in memory (VIM-293) — aggregated
    // into one `assistant.text` record at session.idle, never written raw.
    if (partType === 'text') {
      bufferAssistantTextPart(part)

      return
    }

    if (typeof partType !== 'string' || !PART_WHITELIST.has(partType)) {
      return
    }
  }

  if (type === 'message.updated') {
    trackAssistantMessage(properties.info)
  }

  if (type === 'session.idle') {
    flushAssistantText(properties.sessionID)
  }

  if (type === 'session.created' || type === 'session.updated') {
    handleSessionInfo(type, properties.info)
  }

  const sessionID =
    typeof properties.sessionID === 'string'
      ? properties.sessionID
      : typeof properties.info === 'object' && properties.info != null
        ? typeof properties.info.sessionID === 'string'
          ? properties.info.sessionID
          : properties.info.id
        : undefined

  if (typeof sessionID !== 'string') {
    return
  }

  appendSessionLine(sessionID, {
    v: SCHEMA_VERSION,
    ts: now(),
    kind: 'event',
    type,
    data: sanitizeEventData(type, properties),
  })
}

export const VimeflowOpencodeBridge = async (input: any) => {
  void input

  return {
    event: async (params: any) => {
      try {
        handleEvent(params?.event)
      } catch {
        // Never throw into the opencode event bus.
      }
    },

    'tool.execute.before': async (input: any, output: any) => {
      try {
        const sessionID = input?.sessionID

        if (typeof sessionID !== 'string') {
          return
        }

        appendSessionLine(sessionID, {
          v: SCHEMA_VERSION,
          ts: now(),
          kind: 'tool.before',
          tool: input?.tool,
          sessionID,
          callID: input?.callID,
          args: previewArgs(input?.tool, output?.args),
        })
      } catch {
        // Never throw into the host opencode session.
      }
    },

    'tool.execute.after': async (input: any, output: any) => {
      try {
        const sessionID = input?.sessionID

        if (typeof sessionID !== 'string') {
          return
        }

        const metadata =
          output?.metadata != null && typeof output.metadata === 'object'
            ? output.metadata
            : {}

        appendSessionLine(sessionID, {
          v: SCHEMA_VERSION,
          ts: now(),
          kind: 'tool.after',
          tool: input?.tool,
          sessionID,
          callID: input?.callID,
          result: {
            title: clampString(output?.title),
            output: excerptOutput(output?.output),
            metadata: {
              exit: metadata.exit,
              truncated: metadata.truncated,
            },
          },
        })
      } catch {
        // Never throw into the host opencode session.
      }
    },
  }
}
