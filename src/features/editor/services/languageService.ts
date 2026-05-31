import { javascript } from '@codemirror/lang-javascript'
import { rust } from '@codemirror/lang-rust'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import type { Extension } from '@codemirror/state'

/**
 * Maps filename extensions to CodeMirror language extensions.
 * Returns null for unknown extensions.
 */
export function getLanguageExtension(filename: string): Extension | null {
  const ext = filename.split('.').pop()?.toLowerCase()

  switch (ext) {
    case 'js':
    case 'jsx':
      return javascript({ jsx: true })
    case 'ts':
    case 'tsx':
      return javascript({ jsx: true, typescript: true })
    case 'rs':
      return rust()
    case 'json':
      return json()
    case 'css':
      return css()
    case 'html':
    case 'htm':
      return html()
    case 'md':
    case 'markdown':
      // No-argument form: source-mode markdown highlighting, list/blockquote
      // auto-continue, smart backspace — inheriting the CM6 HighlightStyle.
      // We deliberately omit `codeLanguages` (in-fence highlighting) to avoid
      // pulling the heavy `@codemirror/language-data` grammar loader; the
      // reading view highlights fences via rehype-highlight instead.
      return markdown()
    default:
      return null
  }
}
