import type { ReactElement } from 'react'

interface CodeEditorProps {
  content: string
  currentLine: number | null
}

// Simple mock syntax highlighter for demo purposes
const highlightSyntax = (line: string): ReactElement[] => {
  const tokens: ReactElement[] = []
  let key = 0

  // Keywords pattern
  const keywordPattern =
    /\b(import|export|const|let|var|function|return|if|else|for|while|class|interface|type|async|await|from|default)\b/g

  // String pattern (single and double quotes)
  const stringPattern = /(['"`])(?:(?=(\\?))\2.)*?\1/g

  // Function calls pattern (word followed by parenthesis)
  const functionPattern = /\b([a-zA-Z_$][\w$]*)\s*\(/g

  // JSX tags pattern
  const jsxPattern = /<\/?[A-Z][a-zA-Z0-9]*|<\/?[a-z]+/g

  // Comment pattern
  const commentPattern = /\/\/.*/g

  // Combine all patterns to process in order
  const allMatches: {
    index: number
    length: number
    text: string
    type: string
  }[] = []

  // Find all matches
  let match
  while ((match = keywordPattern.exec(line)) !== null) {
    allMatches.push({
      index: match.index,
      length: match[0].length,
      text: match[0],
      type: 'keyword',
    })
  }

  while ((match = stringPattern.exec(line)) !== null) {
    allMatches.push({
      index: match.index,
      length: match[0].length,
      text: match[0],
      type: 'string',
    })
  }

  while ((match = functionPattern.exec(line)) !== null) {
    allMatches.push({
      index: match.index,
      length: match[1].length,
      text: match[1],
      type: 'function',
    })
  }

  while ((match = jsxPattern.exec(line)) !== null) {
    allMatches.push({
      index: match.index,
      length: match[0].length,
      text: match[0],
      type: 'tag',
    })
  }

  while ((match = commentPattern.exec(line)) !== null) {
    allMatches.push({
      index: match.index,
      length: match[0].length,
      text: match[0],
      type: 'comment',
    })
  }

  // Sort by index to process in order
  allMatches.sort((a, b) => a.index - b.index)

  // Build highlighted output
  let currentIndex = 0

  for (const matchItem of allMatches) {
    // Skip overlapping matches
    if (matchItem.index < currentIndex) {
      continue
    }

    // Add plain text before this match
    if (matchItem.index > currentIndex) {
      tokens.push(
        <span key={key++}>{line.slice(currentIndex, matchItem.index)}</span>
      )
    }

    // Add highlighted match
    const colorClass = {
      keyword: 'text-[#cba6f7]', // Mauve
      string: 'text-[#a6e3a1]', // Green
      function: 'text-[#89b4fa]', // Blue
      tag: 'text-[#f38ba8]', // Red
      comment: 'text-[#6c7086] italic', // Overlay0
      type: 'text-[#fab387]', // Peach
    }[matchItem.type]

    tokens.push(
      <span key={key++} className={colorClass}>
        {matchItem.text}
      </span>
    )

    currentIndex = matchItem.index + matchItem.length
  }

  // Add remaining plain text
  if (currentIndex < line.length) {
    tokens.push(<span key={key++}>{line.slice(currentIndex)}</span>)
  }

  return tokens
}

export const CodeEditor = ({
  content,
  currentLine,
}: CodeEditorProps): ReactElement => {
  const lines = content.split('\n')

  return (
    <div
      data-testid="code-editor"
      className="flex-1 bg-surface font-mono text-[0.875rem] leading-6 pt-4 px-4 overflow-auto"
    >
      {lines.map((line, index) => {
        const lineNumber = index + 1
        const isCurrentLine = currentLine === lineNumber

        return (
          <div
            key={lineNumber}
            data-testid={`code-line-${lineNumber}`}
            className={`whitespace-pre ${
              isCurrentLine ? 'bg-surface-container-high' : ''
            }`}
          >
            {line === '' ? ' ' : highlightSyntax(line)}
          </div>
        )
      })}
    </div>
  )
}
