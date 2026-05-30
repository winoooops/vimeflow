const MAX_BYTES = 200

export type TitleValidation =
  | { kind: 'valid'; sanitized: string }
  | { kind: 'empty' }
  | {
      kind: 'invalid'
      reason: 'too-long'
    }

const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/g

export const validateTitle = (raw: string): TitleValidation => {
  // Match the backend sanitizer: control bytes are defensive paste cleanup,
  // not a user-facing validation error.
  const sanitized = raw
    .replace(CONTROL_CHAR_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (sanitized.length === 0) {
    return { kind: 'empty' }
  }

  const bytes = new TextEncoder().encode(sanitized)
  if (bytes.length > MAX_BYTES) {
    return { kind: 'invalid', reason: 'too-long' }
  }

  return { kind: 'valid', sanitized }
}
