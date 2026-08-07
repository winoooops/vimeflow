/**
 * Converts terminal-originated attention sequences into live, PTY-scoped
 * signals for the notification producers. This module recognizes a standalone
 * BEL and OSC 9/777 messages, but does not own notification history or UI.
 */

export interface TerminalAttentionSignal {
  readonly ptyId: string
  readonly body?: string
}

type TerminalAttentionListener = (signal: TerminalAttentionSignal) => void

const listeners = new Set<TerminalAttentionListener>()
const MAX_ATTENTION_BODY_LENGTH = 500

/** Remove terminal control characters and bound text before it reaches UI. */
const normalizeBody = (body: string | undefined): string | undefined => {
  const normalized = body
    ?.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
    .slice(0, MAX_ATTENTION_BODY_LENGTH)

  return normalized === '' ? undefined : normalized
}

/** Publish one normalized terminal-attention signal to current subscribers. */
export const emitTerminalAttention = (
  signal: TerminalAttentionSignal
): void => {
  const body = normalizeBody(signal.body)

  const normalized =
    body === undefined ? { ptyId: signal.ptyId } : { ...signal, body }

  listeners.forEach((listener) => listener(normalized))
}

/** Subscribe to terminal attention; the returned function unsubscribes. */
export const subscribeTerminalAttention = (
  listener: TerminalAttentionListener
): (() => void) => {
  listeners.add(listener)

  return (): void => {
    listeners.delete(listener)
  }
}

const MAX_PENDING_BYTES = 4096

/** OSC 9 payloads beginning with `4;` belong exclusively to progress. */
export const isProgressOsc9Payload = (payload: string): boolean =>
  payload.startsWith('4;')

/**
 * Stateful scanner for one PTY output stream. `push` keeps incomplete escape
 * sequences between chunks because a terminal may split an OSC message across
 * multiple reads.
 */
export class TerminalAttentionScanner {
  private pending = ''
  private discardingOsc = false
  private discardEscape = false

  /** Return each complete BEL or OSC 9/777 attention payload in input order. */
  push(data: string): readonly string[] {
    if (this.discardingOsc) {
      const remainder = this.discardThroughTerminator(data)
      if (remainder === undefined) {
        return []
      }
      data = remainder
    }

    this.pending += data
    const attention: string[] = []

    while (this.pending.length > 0) {
      const oscStart = this.pending.indexOf('\x1b]')
      const bell = this.pending.indexOf('\x07')

      if (bell !== -1 && (oscStart === -1 || bell < oscStart)) {
        attention.push('')
        this.pending = this.pending.slice(bell + 1)
        continue
      }

      if (oscStart === -1) {
        this.pending = this.pending.endsWith('\x1b') ? '\x1b' : ''
        break
      }

      this.pending = this.pending.slice(oscStart)
      const terminator = findOscTerminator(this.pending)
      if (terminator === undefined) {
        if (this.pending.length > MAX_PENDING_BYTES) {
          if (this.pending.startsWith('\x1b]9;4;')) {
            this.discardingOsc = true
            this.discardEscape = this.pending.endsWith('\x1b')
          }
          this.pending = ''
        }

        break
      }

      const payload = this.pending.slice(2, terminator.index)
      const separator = payload.indexOf(';')

      const identifier =
        separator === -1 ? payload : payload.slice(0, separator)

      const body = separator === -1 ? '' : payload.slice(separator + 1)
      if (
        identifier === '777' ||
        (identifier === '9' && !isProgressOsc9Payload(body))
      ) {
        attention.push(body)
      }

      this.pending = this.pending.slice(terminator.index + terminator.length)
    }

    return attention
  }

  private discardThroughTerminator(data: string): string | undefined {
    for (let index = 0; index < data.length; index += 1) {
      const character = data[index]
      if (this.discardEscape) {
        if (character === '\\') {
          this.discardingOsc = false
          this.discardEscape = false

          return data.slice(index + 1)
        }
        if (character === '\x07') {
          this.discardingOsc = false
          this.discardEscape = false

          return data.slice(index + 1)
        }
        this.discardEscape = character === '\x1b'
      } else if (character === '\x07') {
        this.discardingOsc = false

        return data.slice(index + 1)
      } else if (character === '\x1b') {
        this.discardEscape = true
      }
    }

    return undefined
  }
}

/** Locate either valid OSC terminator: BEL or the two-byte ST sequence. */
const findOscTerminator = (
  value: string
): { readonly index: number; readonly length: number } | undefined => {
  const bell = value.indexOf('\x07', 2)
  const stringTerminator = value.indexOf('\x1b\\', 2)
  if (bell === -1 && stringTerminator === -1) {
    return undefined
  }
  if (bell !== -1 && (stringTerminator === -1 || bell < stringTerminator)) {
    return { index: bell, length: 1 }
  }

  return { index: stringTerminator, length: 2 }
}
