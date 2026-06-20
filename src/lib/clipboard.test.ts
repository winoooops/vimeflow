import { describe, test, expect, vi } from 'vitest'
import { writeClipboardText } from './clipboard'

describe('writeClipboardText', () => {
  test('returns false for empty text without touching the clipboard', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    const originalClipboard = window.navigator.clipboard

    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    })

    try {
      const result = await writeClipboardText('')

      expect(result).toBe(false)
      expect(writeTextMock).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      })
    }
  })

  test('writes text through navigator.clipboard.writeText when available', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    const originalClipboard = window.navigator.clipboard

    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    })

    try {
      const result = await writeClipboardText('hello world')

      expect(result).toBe(true)
      expect(writeTextMock).toHaveBeenCalledWith('hello world')
    } finally {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      })
    }
  })

  test('falls back to document.execCommand when the clipboard API is missing', async () => {
    const originalClipboard = window.navigator.clipboard
    const originalExecCommand = document.execCommand
    const execCommandMock = vi.fn().mockReturnValue(true)

    Object.defineProperty(window.navigator, 'clipboard', {
      value: {},
      configurable: true,
      writable: true,
    })

    Object.defineProperty(document, 'execCommand', {
      value: execCommandMock,
      configurable: true,
      writable: true,
    })

    try {
      const result = await writeClipboardText('fallback text')

      expect(result).toBe(true)
      expect(execCommandMock).toHaveBeenCalledWith('copy')
    } finally {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      })

      Object.defineProperty(document, 'execCommand', {
        value: originalExecCommand,
        configurable: true,
        writable: true,
      })
    }
  })

  test('falls back to document.execCommand when clipboard.writeText rejects', async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error('denied'))
    const originalClipboard = window.navigator.clipboard
    const originalExecCommand = document.execCommand
    const execCommandMock = vi.fn().mockReturnValue(true)

    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    })

    Object.defineProperty(document, 'execCommand', {
      value: execCommandMock,
      configurable: true,
      writable: true,
    })

    try {
      const result = await writeClipboardText('rejected text')

      expect(result).toBe(true)
      expect(writeTextMock).toHaveBeenCalledWith('rejected text')
      expect(execCommandMock).toHaveBeenCalledWith('copy')
    } finally {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      })

      Object.defineProperty(document, 'execCommand', {
        value: originalExecCommand,
        configurable: true,
        writable: true,
      })
    }
  })

  test('returns false when both the clipboard API and execCommand fallback fail', async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error('denied'))
    const originalClipboard = window.navigator.clipboard
    const originalExecCommand = document.execCommand

    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    })

    Object.defineProperty(document, 'execCommand', {
      value: undefined,
      configurable: true,
      writable: true,
    })

    try {
      const result = await writeClipboardText('unavailable')

      expect(result).toBe(false)
    } finally {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      })

      Object.defineProperty(document, 'execCommand', {
        value: originalExecCommand,
        configurable: true,
        writable: true,
      })
    }
  })
})
