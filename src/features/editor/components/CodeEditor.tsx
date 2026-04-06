import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import {
  highlightCode,
  detectLanguage,
  type LineTokens,
} from '../services/shikiService'
import { LineNumbers } from './LineNumbers'

interface CodeEditorProps {
  content: string
  currentLine: number | null
  fileName: string
}

export const CodeEditor = ({
  content,
  currentLine,
  fileName,
}: CodeEditorProps): ReactElement => {
  const [highlightedLines, setHighlightedLines] = useState<LineTokens[]>([])

  useEffect(() => {
    const highlight = async (): Promise<void> => {
      const language = detectLanguage(fileName)
      const lines = await highlightCode(content, language)
      setHighlightedLines(lines)
    }

    void highlight()
  }, [content, fileName])

  const plainLines = content.split('\n')

  const lineCount =
    highlightedLines.length > 0 ? highlightedLines.length : plainLines.length

  return (
    <div
      data-testid="code-editor"
      className="flex flex-1 overflow-auto thin-scrollbar"
    >
      <LineNumbers lineCount={lineCount} currentLine={currentLine} />
      <div className="flex-1 bg-surface font-mono text-[0.875rem] leading-6 pt-4 pl-6 pr-4">
        {highlightedLines.length > 0
          ? highlightedLines.map((line, index) => {
              const lineNumber = index + 1
              const isCurrentLine = currentLine === lineNumber

              return (
                <div
                  key={lineNumber}
                  data-testid={`code-line-${lineNumber}`}
                  className={`whitespace-pre ${
                    isCurrentLine
                      ? 'bg-primary/5 rounded border-l-2 border-primary'
                      : ''
                  }`}
                >
                  {line.tokens.map((token, tokenIndex) => (
                    <span
                      key={tokenIndex}
                      style={{
                        color: token.color,
                        fontStyle:
                          token.fontStyle === 1
                            ? 'italic'
                            : token.fontStyle === 2
                              ? 'bold'
                              : 'normal',
                      }}
                    >
                      {token.content}
                    </span>
                  ))}
                </div>
              )
            })
          : plainLines.map((line, index) => {
              const lineNumber = index + 1
              const isCurrentLine = currentLine === lineNumber

              return (
                <div
                  key={lineNumber}
                  data-testid={`code-line-${lineNumber}`}
                  className={`whitespace-pre ${
                    isCurrentLine
                      ? 'bg-primary/5 rounded border-l-2 border-primary'
                      : ''
                  }`}
                >
                  {line || ' '}
                </div>
              )
            })}
      </div>
    </div>
  )
}
