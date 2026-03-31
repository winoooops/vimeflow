import type { ReactElement } from 'react'

interface CodeBlockProps {
  filename: string
  language: string
  code: string
}

/**
 * CodeBlock displays a code snippet with file header and language badge per design spec.
 *
 * Design reference: docs/design/chat_or_main/code.html lines 265-276
 * Container classes: bg-surface-container-highest, rounded-lg, p-4, font-label,
 *                    text-[13px], border-l-4, border-secondary, overflow-x-auto, shadow-inner
 */
export const CodeBlock = ({
  filename,
  language,
  code,
}: CodeBlockProps): ReactElement => (
  <div
    data-testid="code-block"
    className="bg-surface-container-highest rounded-lg p-4 font-label text-[13px] border-l-4 border-secondary overflow-x-auto shadow-inner"
  >
    {/* File header with icon + filename on left, language badge on right */}
    <div
      data-testid="code-block-header"
      className="flex items-center justify-between mb-3 border-b border-outline-variant/20 pb-2"
    >
      <span className="text-on-surface-variant flex items-center gap-2">
        <span className="material-symbols-outlined text-xs">description</span>
        {filename}
      </span>
      <span className="text-[10px] text-secondary">
        {language.toUpperCase()}
      </span>
    </div>

    {/* Code content with preserved whitespace */}
    <pre data-testid="code-block-code" className="text-[#f8f8f2]">
      {code}
    </pre>
  </div>
)
