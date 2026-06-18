import { describe, expect, test } from 'vitest'
import {
  getClearScreenSentinel,
  getCursorLeftSentinel,
  getCursorRightSentinel,
  getEraseLineSentinel,
} from './terminalControlParser'
import { TerminalDisplayBuffer } from './terminalDisplayBuffer'

describe('TerminalDisplayBuffer', () => {
  test('appends visible text and trims trailing newlines from viewport reads', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('hello\nworld\n')

    expect(buffer.readText()).toBe('hello\nworld\n')
    expect(buffer.readVisibleText()).toBe('hello\nworld')
  })

  test('rewrites the current line when carriage return output arrives', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('progress 10%')
    buffer.write('\rprogress 20%')

    expect(buffer.readVisibleText()).toBe('progress 20%')
  })

  test('treats carriage-return/newline pairs split across writes as a single newline', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('progress 10%')
    buffer.write('\r')
    buffer.write('\nprogress 20%')

    expect(buffer.readVisibleText()).toBe('progress 10%\nprogress 20%')
  })

  test('moves the cursor to the line end before inserting a same-chunk CRLF', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('hello world')
    buffer.write('\b\b\b\b\b')
    buffer.write('\r\nmore')

    expect(buffer.readVisibleText()).toBe('hello world\nmore')
  })

  test('moves the output cursor backward for backspace rewrites', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('ab\bcd')

    expect(buffer.readVisibleText()).toBe('acd')
  })

  test('moves the output cursor with parser display controls', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('S')
    buffer.write(getCursorLeftSentinel())
    buffer.write('St')
    buffer.write(getCursorLeftSentinel().repeat(2))
    buffer.write('Started')
    buffer.write(getCursorRightSentinel())
    buffer.write('!')

    expect(buffer.readVisibleText()).toBe('Started!')
  })

  test('exposes the current cursor offset for renderer caret placement', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('abc')

    expect(buffer.readCursorOffset()).toBe(3)

    buffer.write(getCursorLeftSentinel().repeat(2))

    expect(buffer.readCursorOffset()).toBe(1)
  })

  test('clears viewport text when a clear-screen display control arrives', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('old prompt\nold output')
    buffer.write(getClearScreenSentinel())
    buffer.write('new prompt')

    expect(buffer.readVisibleText()).toBe('new prompt')
  })

  test('clears the current line when an erase-line sentinel arrives', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('building 100%')
    buffer.write(`\r${getEraseLineSentinel(0)}done`)

    expect(buffer.readVisibleText()).toBe('done')
  })

  test('erases from line start to cursor inclusive in erase-line mode 1', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('abc')
    buffer.write('\ra')
    buffer.write(getEraseLineSentinel(1))

    expect(buffer.readVisibleText()).toBe('c')
  })

  test('erases the full current line in erase-line mode 2', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('before\nold line')
    buffer.write('\r')
    buffer.write(getEraseLineSentinel(2))
    buffer.write('new line')

    expect(buffer.readVisibleText()).toBe('before\nnew line')
  })

  test('retains recent output when scrollback exceeds the line limit', () => {
    const buffer = new TerminalDisplayBuffer({ maxScrollbackLines: 3 })

    buffer.write('line-0\nline-1\nline-2\nline-3\nline-4')

    expect(buffer.readVisibleText()).toBe('line-2\nline-3\nline-4')
  })

  test('clears text and cursor state', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('before\r')
    buffer.clear()
    buffer.write('after')

    expect(buffer.readVisibleText()).toBe('after')
  })
})
