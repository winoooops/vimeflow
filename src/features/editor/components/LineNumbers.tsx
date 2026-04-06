import type { ReactElement } from 'react'

interface LineNumbersProps {
  lineCount: number
  currentLine: number | null
}

export const LineNumbers = ({
  lineCount,
  currentLine,
}: LineNumbersProps): ReactElement => {
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1)

  return (
    <div
      data-testid="line-numbers-gutter"
      className="w-14 bg-surface-container-low text-on-surface-variant/30 font-mono text-[0.75rem] text-right pr-3 pt-4 select-none leading-6"
    >
      {lineNumbers.map((lineNumber) => {
        const isCurrentLine = currentLine === lineNumber

        return (
          <div
            key={lineNumber}
            className={
              isCurrentLine
                ? 'text-primary-container/60 bg-primary-container/5'
                : ''
            }
          >
            {lineNumber}
          </div>
        )
      })}
    </div>
  )
}
