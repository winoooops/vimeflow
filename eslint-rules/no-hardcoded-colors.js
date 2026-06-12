// eslint-rules/no-hardcoded-colors.js
// Bans color literals outside src/theme/themes/. The themes dir is the one
// legitimate home; everywhere else uses semantic tokens (utilities or
// var(--color-*)). Escape hatch: eslint-disable-next-line with a reason.
const COLOR_PATTERNS = [
  /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/,
  /(?<![a-zA-Z0-9])(?:rgba?|hsla?|oklch)\(/,
  /(?:text|bg|border|ring|fill|stroke|from|via|to|divide|outline|decoration|shadow|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/,
  /(?:text|bg|border|ring|fill|stroke|divide|outline)-(?:white|black)(?:\/(?:\d{1,3}|\[[^\]]+\]))?\b/,
]

const findViolation = (text) => {
  for (const pattern of COLOR_PATTERNS) {
    const match = pattern.exec(text)
    if (match) {
      return match[0]
    }
  }

  return null
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow hardcoded colors; use theme tokens (utilities or var(--color-*))',
    },
    messages: {
      hardcoded:
        'Hardcoded color "{{value}}" — use a semantic token (Tailwind utility or var(--color-*)); themes live in src/theme/themes/.',
    },
    schema: [],
  },
  create(context) {
    const check = (node, text) => {
      if (typeof text !== 'string') {
        return
      }
      const hit = findViolation(text)
      if (hit) {
        context.report({ node, messageId: 'hardcoded', data: { value: hit } })
      }
    }

    return {
      Literal(node) {
        check(node, node.value)
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          check(quasi, quasi.value.raw)
        }
      },
    }
  },
}
