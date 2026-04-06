import { describe, test, expect, vi } from 'vitest'
import { detectLanguage, highlightCode, type LineTokens } from './shikiService'

// Mock shiki
vi.mock('shiki', () => ({
  codeToTokens: vi.fn((code: string) => {
    // Return mock token structure matching Shiki's output
    const lines = code.split('\n')

    return Promise.resolve({
      tokens: lines.map((line) => [
        {
          content: line || ' ',
          color: '#cdd6f4',
          fontStyle: 0,
          offset: 0,
        },
      ]),
    })
  }),
}))

describe('shikiService', () => {
  describe('detectLanguage', () => {
    test('detects TypeScript from .ts extension', () => {
      expect(detectLanguage('file.ts')).toBe('typescript')
    })

    test('detects TypeScript from .tsx extension', () => {
      expect(detectLanguage('Component.tsx')).toBe('typescript')
    })

    test('detects JavaScript from .js extension', () => {
      expect(detectLanguage('script.js')).toBe('javascript')
    })

    test('detects JavaScript from .jsx extension', () => {
      expect(detectLanguage('Component.jsx')).toBe('javascript')
    })

    test('detects JSON from .json extension', () => {
      expect(detectLanguage('package.json')).toBe('json')
    })

    test('detects Markdown from .md extension', () => {
      expect(detectLanguage('README.md')).toBe('markdown')
    })

    test('detects CSS from .css extension', () => {
      expect(detectLanguage('styles.css')).toBe('css')
    })

    test('detects Python from .py extension', () => {
      expect(detectLanguage('script.py')).toBe('python')
    })

    test('detects Rust from .rs extension', () => {
      expect(detectLanguage('main.rs')).toBe('rust')
    })

    test('detects Go from .go extension', () => {
      expect(detectLanguage('main.go')).toBe('go')
    })

    test('detects Bash from .sh extension', () => {
      expect(detectLanguage('script.sh')).toBe('bash')
    })

    test('detects YAML from .yml extension', () => {
      expect(detectLanguage('config.yml')).toBe('yaml')
    })

    test('detects YAML from .yaml extension', () => {
      expect(detectLanguage('config.yaml')).toBe('yaml')
    })

    test('returns plaintext for unknown extensions', () => {
      expect(detectLanguage('file.unknown')).toBe('plaintext')
    })

    test('returns plaintext for files without extension', () => {
      expect(detectLanguage('README')).toBe('plaintext')
    })

    test('handles case-insensitive extensions', () => {
      expect(detectLanguage('FILE.TS')).toBe('typescript')
    })
  })

  describe('highlightCode', () => {
    test('calls codeToTokens with correct arguments', async () => {
      const { codeToTokens } = await import('shiki')
      const code = 'const x = 1'
      const language = 'typescript'

      await highlightCode(code, language)

      expect(codeToTokens).toHaveBeenCalledWith(code, {
        lang: language,
        theme: 'catppuccin-mocha',
      })
    })

    test('returns line tokens array', async () => {
      const code = 'const x = 1\nconst y = 2'
      const language = 'typescript'

      const result = await highlightCode(code, language)

      expect(result).toHaveLength(2)
      expect(result[0]).toHaveProperty('tokens')
      expect(result[0].tokens[0]).toHaveProperty('content')
      expect(result[0].tokens[0]).toHaveProperty('color')
    })

    test('returns tokens with content and color', async () => {
      const code = 'const x = 1'
      const language = 'typescript'

      const result = await highlightCode(code, language)

      expect(result[0].tokens[0].content).toBe('const x = 1')
      expect(result[0].tokens[0].color).toBeDefined()
    })

    test('handles multi-line code', async () => {
      const code = 'line1\nline2\nline3'
      const language = 'javascript'

      const result = await highlightCode(code, language)

      expect(result).toHaveLength(3)
      expect(result[0].tokens[0].content).toBe('line1')
      expect(result[1].tokens[0].content).toBe('line2')
      expect(result[2].tokens[0].content).toBe('line3')
    })

    test('falls back to plaintext on error', async () => {
      const { codeToTokens } = await import('shiki')

      // Clear previous calls and set up new behavior
      vi.clearAllMocks()
      vi.mocked(codeToTokens)
        .mockRejectedValueOnce(new Error('Unsupported language'))
        .mockResolvedValueOnce({
          tokens: [
            [
              {
                content: 'fallback',
                color: '#cdd6f4',
                fontStyle: 0,
                offset: 0,
              },
            ],
          ],
        })

      const code = 'const x = 1'
      const language = 'unsupported'

      const result = await highlightCode(code, language)

      expect(result[0].tokens[0].content).toBe('fallback')
      expect(codeToTokens).toHaveBeenCalledTimes(2)
      expect(codeToTokens).toHaveBeenLastCalledWith(code, {
        lang: 'plaintext',
        theme: 'catppuccin-mocha',
      })
    })

    test('returns correct type structure matching LineTokens', async () => {
      const code = 'test'
      const language = 'typescript'

      const result: LineTokens[] = await highlightCode(code, language)

      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
      result.forEach((line) => {
        expect(line).toHaveProperty('tokens')
        expect(Array.isArray(line.tokens)).toBe(true)
        line.tokens.forEach((token) => {
          expect(token).toHaveProperty('content')
          expect(typeof token.content).toBe('string')
        })
      })
    })
  })
})
