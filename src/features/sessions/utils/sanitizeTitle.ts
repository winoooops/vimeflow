const MAX_BYTES = 200

export type TitleValidation =
  | { kind: 'valid'; sanitized: string }
  | { kind: 'empty' }
  | {
      kind: 'invalid'
      reason: 'control-char' | 'too-long'
      offendingByte?: number
    }

export const validateTitle = (raw: string): TitleValidation => {
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index)
    if ((code >= 0 && code <= 0x1f) || code === 0x7f) {
      return {
        kind: 'invalid',
        reason: 'control-char',
        offendingByte: index,
      }
    }
  }

  const sanitized = raw.replace(/\s+/g, ' ').trim()
  if (sanitized.length === 0) {
    return { kind: 'empty' }
  }

  const bytes = new TextEncoder().encode(sanitized)
  if (bytes.length > MAX_BYTES) {
    return { kind: 'invalid', reason: 'too-long' }
  }

  return { kind: 'valid', sanitized }
}
