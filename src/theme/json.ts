import { themeToScheme } from './derive'
import {
  AGENT_ACCENT_FIELDS,
  AGENT_IDS,
  EFFECT_COLOR_TOKENS,
  SHADOW_TOKENS,
  SYN_TOKENS,
  THEME_PALETTE_KEYS,
  UI_TOKENS,
  type ThemeDefinition,
  type ThemeScheme,
} from './types'

/**
 * Theme JSON is the stable boundary between user-authored color schemes and
 * Vimeflow's larger internal theme model. Public JSON accepts only identity
 * fields and base hex colors; runtime-only values are derived after parsing.
 * The legacy reader exists solely to migrate previously saved full-token
 * themes into the compact palette format.
 */

const TERMINAL_REQUIRED_KEYS = [
  'foreground',
  'background',
  'cursor',
  'cursorAccent',
  'selectionBackground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readText = (value: unknown, path: string, maxLength = 512): string => {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`${path} must be a non-empty string`)
  }

  return value
}

const readHex = (value: unknown, path: string): string => {
  const text = readText(value, path)
  if (!/^#[0-9a-f]{6}$/i.test(text)) {
    throw new Error(`${path} must be a six-digit hex color`)
  }

  return text.toLowerCase()
}

const readCssValue = (value: unknown, path: string): string => {
  const text = readText(value, path)
  if (/[;{}]/.test(text) || /(?:url|var)\s*\(/i.test(text)) {
    throw new Error(`${path} contains an unsafe CSS value`)
  }

  return text
}

const readCssRecord = (
  value: unknown,
  keys: readonly string[],
  path: string
): Record<string, string> => {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`)
  }

  return Object.fromEntries(
    keys.map((key) => [key, readCssValue(value[key], `${path}.${key}`)])
  )
}

const readIdentity = (
  value: Record<string, unknown>
): Pick<ThemeScheme, 'id' | 'label' | 'kind'> => {
  const id = readText(value.id, 'id', 64)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(
      'id must contain only lowercase letters, numbers, and dashes'
    )
  }

  const label = readText(value.label, 'label', 64)
  const kind = value.kind
  if (kind !== 'dark' && kind !== 'light') {
    throw new Error('kind must be dark or light')
  }

  return { id, label, kind }
}

export const parseThemeScheme = (value: unknown): ThemeScheme => {
  if (!isRecord(value)) {
    throw new Error('Color scheme must be a JSON object')
  }
  if (!isRecord(value.palette)) {
    throw new Error('palette must be an object')
  }
  const palette = value.palette

  return {
    ...readIdentity(value),
    palette: Object.fromEntries(
      THEME_PALETTE_KEYS.map((key) => [
        key,
        readHex(palette[key], `palette.${key}`),
      ])
    ) as ThemeScheme['palette'],
  }
}

const parseLegacyThemeDefinition = (value: unknown): ThemeDefinition => {
  if (!isRecord(value)) {
    throw new Error('Theme must be a JSON object')
  }

  const identity = readIdentity(value)

  const terminal = readCssRecord(
    value.terminal,
    TERMINAL_REQUIRED_KEYS,
    'terminal'
  )
  if (
    isRecord(value.terminal) &&
    value.terminal.selectionForeground !== undefined
  ) {
    terminal.selectionForeground = readCssValue(
      value.terminal.selectionForeground,
      'terminal.selectionForeground'
    )
  }

  if (!isRecord(value.agents)) {
    throw new Error('agents must be an object')
  }
  const agents = value.agents

  return {
    ...identity,
    ui: readCssRecord(value.ui, UI_TOKENS, 'ui') as ThemeDefinition['ui'],
    effects: readCssRecord(
      value.effects,
      EFFECT_COLOR_TOKENS,
      'effects'
    ) as ThemeDefinition['effects'],
    shadows: readCssRecord(
      value.shadows,
      SHADOW_TOKENS,
      'shadows'
    ) as ThemeDefinition['shadows'],
    syntax: readCssRecord(
      value.syntax,
      SYN_TOKENS,
      'syntax'
    ) as ThemeDefinition['syntax'],
    terminal: terminal as unknown as ThemeDefinition['terminal'],
    agents: Object.fromEntries(
      AGENT_IDS.map((agentId) => [
        agentId,
        readCssRecord(
          agents[agentId],
          AGENT_ACCENT_FIELDS,
          `agents.${agentId}`
        ),
      ])
    ) as ThemeDefinition['agents'],
  }
}

export const parseStoredThemeScheme = (value: unknown): ThemeScheme =>
  isRecord(value) && value.palette !== undefined
    ? parseThemeScheme(value)
    : parseThemeScheme(themeToScheme(parseLegacyThemeDefinition(value)))

export const parseThemeJson = (text: string): ThemeScheme => {
  try {
    return parseThemeScheme(JSON.parse(text) as unknown)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON')
    }

    throw error
  }
}

export const serializeTheme = (theme: ThemeDefinition | ThemeScheme): string =>
  JSON.stringify('palette' in theme ? theme : themeToScheme(theme), null, 2)
