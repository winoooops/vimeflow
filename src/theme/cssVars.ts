import {
  AGENT_ACCENT_FIELDS,
  AGENT_IDS,
  EFFECT_COLOR_TOKENS,
  SHADOW_TOKENS,
  SYN_TOKENS,
  UI_TOKENS,
  type ThemeDefinition,
} from './types'

const kebab = (field: string): string =>
  field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

export const toCssVars = (theme: ThemeDefinition): Record<string, string> => {
  const vars: Record<string, string> = {}

  for (const token of UI_TOKENS) {
    vars[`--color-${token}`] = theme.ui[token]
  }

  for (const token of EFFECT_COLOR_TOKENS) {
    vars[`--color-${token}`] = theme.effects[token]
  }

  for (const token of SYN_TOKENS) {
    vars[`--color-syn-${token}`] = theme.syntax[token]
  }

  for (const id of AGENT_IDS) {
    for (const field of AGENT_ACCENT_FIELDS) {
      vars[`--color-agent-${id}-${kebab(field)}`] = theme.agents[id][field]
    }
  }

  for (const token of SHADOW_TOKENS) {
    vars[`--shadow-${token}`] = theme.shadows[token]
  }

  return vars
}
