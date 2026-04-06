import { codeToTokens } from 'shiki'

const THEME = 'catppuccin-mocha'

export interface Token {
  content: string
  color?: string
  fontStyle?: number
}

export interface LineTokens {
  tokens: Token[]
}

/**
 * Detects the programming language from a file name
 */
export const detectLanguage = (fileName: string): string => {
  const extension = fileName.split('.').pop()?.toLowerCase()

  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    py: 'python',
    rs: 'rust',
    go: 'go',
    sh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    sql: 'sql',
  }

  return languageMap[extension ?? ''] ?? 'plaintext'
}

/**
 * Highlights code using Shiki with the Catppuccin Mocha theme
 * Returns line-by-line tokens for custom rendering
 */
export const highlightCode = async (
  code: string,
  language: string
): Promise<LineTokens[]> => {
  try {
    const result = await codeToTokens(code, {
      lang: language as never, // Type assertion for flexibility with language strings
      theme: THEME,
    })

    return result.tokens.map((line) => ({
      tokens: line.map((token) => ({
        content: token.content,
        color: token.color,
        fontStyle: token.fontStyle,
      })),
    }))
  } catch {
    // Fallback to plaintext if language is not supported
    const result = await codeToTokens(code, {
      lang: 'plaintext',
      theme: THEME,
    })

    return result.tokens.map((line) => ({
      tokens: line.map((token) => ({
        content: token.content,
        color: token.color,
        fontStyle: token.fontStyle,
      })),
    }))
  }
}
