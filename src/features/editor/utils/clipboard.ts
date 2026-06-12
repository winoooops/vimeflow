// Clipboard write helper with a textarea fallback for environments where the
// modern Async Clipboard API is missing or denies access (jsdom, sandboxed
// iframes, older browsers, etc.). Keeps all DOM-touching clipboard logic in one
// place so CodeMirror-specific hooks don't have to own a general-purpose util.

export interface ClipboardLike {
  writeText?: (text: string) => Promise<void>
  readText?: () => Promise<string>
}

const writeViaTextarea = (text: string): boolean => {
  const execCommand = (
    document as unknown as {
      execCommand?: (command: string) => boolean
    }
  ).execCommand
  if (typeof execCommand !== 'function') {
    return false
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    return execCommand.call(document, 'copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

/**
 * Write text to the system clipboard.
 *
 * Returns `true` when the write succeeded (modern API or fallback), `false`
 * when there was nothing to copy or every mechanism failed. Empty strings are
 * intentionally ignored so callers can decide whether to clear the clipboard.
 */
export const writeClipboardText = async (text: string): Promise<boolean> => {
  if (text === '') {
    return false
  }

  const clipboard = window.navigator.clipboard as ClipboardLike | undefined

  try {
    if (clipboard?.writeText === undefined) {
      return writeViaTextarea(text)
    }

    await clipboard.writeText(text)

    return true
  } catch {
    return writeViaTextarea(text)
  }
}
