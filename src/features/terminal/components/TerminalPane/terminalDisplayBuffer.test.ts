// cspell:ignore xhigh,ghijkl,ghijk
import { describe, expect, test } from 'vitest'
import {
  getClearScreenSentinel,
  getCursorDownSentinel,
  getCursorLeftSentinel,
  getCursorPositionSentinel,
  getCursorRightSentinel,
  getCursorUpSentinel,
  getEraseDisplaySentinel,
  getEraseLineSentinel,
  getRestoreCursorSentinel,
  getSaveCursorSentinel,
  getSgrStyleSentinel,
} from './terminalControlParser'
import { TerminalDisplayBuffer } from './terminalDisplayBuffer'

const TRUE_COLOR_PINK = ['rgb', '(243, 139, 168)'].join('')
const INDEXED_COLOR_RED = ['rgb', '(255, 0, 0)'].join('')
const INDEXED_COLOR_GRAY = ['rgb', '(238, 238, 238)'].join('')
const NERD_FONT_ICON = String.fromCodePoint(0xf0954)

describe('TerminalDisplayBuffer', () => {
  test('appends visible text and trims trailing newlines from viewport reads', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('hello\nworld\n')

    expect(buffer.readText()).toBe('hello\nworld\n')
    expect(buffer.readVisibleText()).toBe('hello\nworld')
  })

  test('applies append and replace display delta operations', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.applyDelta({
      operations: [{ type: 'append', text: 'snapshot one' }],
    })

    buffer.applyDelta({
      operations: [{ type: 'replace', text: 'snapshot two' }],
    })

    expect(buffer.readVisibleText()).toBe('snapshot two')
  })

  test('applies replace display delta cursor offsets', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.applyDelta({
      operations: [
        {
          type: 'replace',
          text: 'prompt\noutput',
          cursorOffset: 'prompt\nou'.length,
        },
      ],
    })

    expect(buffer.readVisibleText()).toBe('prompt\noutput')
    expect(buffer.readCursorOffset()).toBe('prompt\nou'.length)
  })

  test('applies empty replace display deltas as a clear operation', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('old snapshot')
    buffer.applyDelta({
      operations: [{ type: 'replace', text: '' }],
    })

    expect(buffer.readVisibleText()).toBe('')
    expect(buffer.readCursorOffset()).toBe(0)
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

  test('soft-wraps printable output at the configured terminal column', () => {
    const buffer = new TerminalDisplayBuffer({ columns: 5 })

    buffer.write('abcdef')

    expect(buffer.readVisibleText()).toBe('abcde\nf')
  })

  test('counts supplementary private-use glyphs as one terminal column', () => {
    const buffer = new TerminalDisplayBuffer({ columns: 4 })

    buffer.write(`ab${NERD_FONT_ICON}c`)

    expect(buffer.readVisibleText()).toBe(`ab${NERD_FONT_ICON}c`)
    expect(buffer.readCursorOffset()).toBe(`ab${NERD_FONT_ICON}c`.length)

    buffer.write('d')

    expect(buffer.readVisibleText()).toBe(`ab${NERD_FONT_ICON}c\nd`)
  })

  test('keeps the previous soft-wrapped row when the wrapped tail redraws', () => {
    const buffer = new TerminalDisplayBuffer({ columns: 5 })

    buffer.write('abcdef')
    buffer.write(`\r${getEraseLineSentinel(0)}gh`)

    expect(buffer.readVisibleText()).toBe('abcde\ngh')
  })

  test('does not insert a second soft-wrap newline after a full-line erase', () => {
    const buffer = new TerminalDisplayBuffer({ columns: 5 })

    buffer.write('abcdef')
    buffer.write(getCursorUpSentinel())
    buffer.write(`\r${getEraseLineSentinel(2)}ghijkl`)

    expect(buffer.readVisibleText()).toBe('ghijk\nl')
  })

  test('deletes wrapped input back across soft-wrap boundaries', () => {
    const buffer = new TerminalDisplayBuffer({ columns: 12 })
    const prompt = '04:42 ❯ '
    const typedText = 'hello world '.repeat(2)

    buffer.write(prompt)
    buffer.write(typedText)

    expect(buffer.readVisibleText().split('\n')).toHaveLength(3)

    typedText.split('').forEach(() => {
      buffer.write('\b \b')
    })

    expect(buffer.readCursorOffset()).toBe(prompt.length)
    expect(buffer.readVisibleText()).not.toContain('hello')
    expect(buffer.readVisibleText()).not.toContain('world')
  })

  test('overwrites the existing next row when redrawing a full-width line', () => {
    const buffer = new TerminalDisplayBuffer({ columns: 5 })

    buffer.write('abcde\nrow2')
    buffer.write(getCursorPositionSentinel(1, 1))
    buffer.write('123456')

    expect(buffer.readVisibleText()).toBe('12345\n6ow2')
  })

  test('moves the cursor vertically across existing rows', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('top one\nmid two\nend row')
    buffer.write(getCursorUpSentinel().repeat(2))
    buffer.write('\r')
    buffer.write('new one')
    buffer.write(getCursorDownSentinel())
    buffer.write('\r')
    buffer.write('new two')

    expect(buffer.readVisibleText()).toBe('new one\nnew two\nend row')
  })

  test('moves the cursor to absolute screen positions', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write(getCursorPositionSentinel(2, 5))
    buffer.write('cell')
    buffer.write(getCursorPositionSentinel(1, 1))
    buffer.write('top')
    buffer.write(getCursorPositionSentinel(2, 7))
    buffer.write('XY')

    expect(buffer.readVisibleText()).toBe('top\n    ceXY')
  })

  test('moves absolute cursor positions by terminal cells, not utf-16 units', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write(`a${NERD_FONT_ICON}c`)
    buffer.write(getCursorPositionSentinel(1, 4))
    buffer.write('!')

    expect(buffer.readVisibleText()).toBe(`a${NERD_FONT_ICON}c!`)
  })

  test('positions absolute cursor at wide glyph boundary when targeting its second cell', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write(`a${'漢'}b`)
    buffer.write(getCursorPositionSentinel(1, 3))

    expect(buffer.readCursorOffset()).toBe(1)
  })

  test('rewrites Codex MCP progress rows without duplicating stale fragments', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('Starting MCP servers (1/3): codex_apps\nlinear pending')
    buffer.write(
      getCursorUpSentinel() +
        '\r' +
        getEraseLineSentinel(2) +
        'Starting MCP servers (2/3): codex_apps, linear\n' +
        getEraseLineSentinel(2) +
        'linear ready'
    )

    expect(buffer.readVisibleText()).toBe(
      'Starting MCP servers (2/3): codex_apps, linear\nlinear ready'
    )
    expect(buffer.readVisibleText()).not.toContain('(1/3)')
    expect(buffer.readVisibleText()).not.toContain('pending')
  })

  test('rewrites Codex startup TUI rows positioned by absolute cursor controls', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write(
      getClearScreenSentinel() +
        getCursorPositionSentinel(1, 1) +
        '>_ OpenAI Codex' +
        getCursorPositionSentinel(1, 42) +
        'model: loading' +
        getCursorPositionSentinel(2, 1) +
        '~/projects/aws' +
        getCursorPositionSentinel(3, 1) +
        'Starting MCP servers (1/3): codex_apps'
    )

    buffer.write(
      getCursorPositionSentinel(1, 42) +
        getEraseLineSentinel(0) +
        'model: gpt-5.5 default' +
        getCursorPositionSentinel(3, 1) +
        getEraseLineSentinel(2) +
        'Starting MCP servers (2/3): codex_apps, linear'
    )

    const visibleText = buffer.readVisibleText()

    expect(visibleText).toContain('>_ OpenAI Codex')
    expect(visibleText).toContain('model: gpt-5.5 default')
    expect(visibleText).toContain(
      'Starting MCP servers (2/3): codex_apps, linear'
    )
    expect(visibleText).not.toContain('loading')
    expect(visibleText).not.toContain('(1/3)')
    expect(visibleText.match(/Starting MCP servers/g)).toHaveLength(1)
  })

  test('erases stale TUI rows from cursor to end of display', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('› Summarize recent commits\n')
    buffer.write('› gpt-5.5 xhigh · ~/projects/aws\n')
    buffer.write('  gpt-5.5 xhigh · ~/projects/aws')
    buffer.write(getCursorPositionSentinel(2, 1))
    buffer.write(getEraseDisplaySentinel(0))
    buffer.write('› gpt-5.5 xhigh · ~/projects/aws')

    const visibleText = buffer.readVisibleText()

    expect(visibleText).toBe(
      '› Summarize recent commits\n› gpt-5.5 xhigh · ~/projects/aws'
    )
    expect(visibleText.match(/gpt-5.5 xhigh/g)).toHaveLength(1)
  })

  test('restores the editable prompt cursor before right-prompt text', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('❯ ')
    buffer.write(getSaveCursorSentinel())
    buffer.write(getCursorPositionSentinel(1, 12))
    buffer.write('03:52')
    buffer.write(getRestoreCursorSentinel())

    expect(buffer.readCursorOffset()).toBe('❯ '.length)

    buffer.write('a')
    buffer.write('\b \b')

    expect(buffer.readCursorOffset()).toBe('❯ '.length)
    expect(buffer.readText().startsWith('❯  ')).toBe(true)
    expect(buffer.readVisibleText()).toContain('03:52')
  })

  test('erases display content from the start through the cursor', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('hello\nworld')
    buffer.write(getCursorPositionSentinel(2, 4))
    buffer.write(getEraseDisplaySentinel(1))

    expect(buffer.readVisibleText()).toBe('d')
  })

  test('rebase saved cursor when erasing display from start through cursor', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('hello\nworld')
    buffer.write(getCursorPositionSentinel(2, 1))
    buffer.write(getSaveCursorSentinel())
    buffer.write(getCursorPositionSentinel(2, 4))
    buffer.write(getEraseDisplaySentinel(1))
    buffer.write(getRestoreCursorSentinel())
    buffer.write('X')

    expect(buffer.readVisibleText()).toBe('X')
  })

  test('exposes the current cursor offset for renderer caret placement', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('abc')

    expect(buffer.readCursorOffset()).toBe(3)

    buffer.write(getCursorLeftSentinel().repeat(2))

    expect(buffer.readCursorOffset()).toBe(1)
  })

  test('consumes SGR style controls into style runs without adding text', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write(
      `plain ${getSgrStyleSentinel([38, 2, 243, 139, 168])}` +
        `pink${getSgrStyleSentinel([1, 4])}!${getSgrStyleSentinel([0])} done`
    )

    expect(buffer.readText()).toBe('plain pink! done')
    expect(buffer.readStyledRuns()).toEqual([
      { text: 'plain ', style: {} },
      { text: 'pink', style: { foreground: TRUE_COLOR_PINK } },
      {
        text: '!',
        style: {
          bold: true,
          foreground: TRUE_COLOR_PINK,
          underline: true,
        },
      },
      { text: ' done', style: {} },
    ])
  })

  test('maps ANSI and indexed SGR colors to terminal theme variables', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write(
      `${getSgrStyleSentinel([31])}red` +
        `${getSgrStyleSentinel([38, 5, 12])}bright-blue` +
        `${getSgrStyleSentinel([0])}`
    )

    expect(buffer.readText()).toBe('redbright-blue')
    expect(buffer.readStyledRuns()).toEqual([
      { text: 'red', style: { foreground: 'var(--terminal-ansi-red)' } },
      {
        text: 'bright-blue',
        style: { foreground: 'var(--terminal-ansi-bright-blue)' },
      },
    ])
  })

  test('maps xterm 256-color indexed SGR colors to RGB values', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write(
      `${getSgrStyleSentinel([38, 5, 196])}cube-red ` +
        `${getSgrStyleSentinel([48, 5, 255])}gray-background` +
        `${getSgrStyleSentinel([0])}`
    )

    expect(buffer.readText()).toBe('cube-red gray-background')
    expect(buffer.readStyledRuns()).toEqual([
      { text: 'cube-red ', style: { foreground: INDEXED_COLOR_RED } },
      {
        text: 'gray-background',
        style: {
          background: INDEXED_COLOR_GRAY,
          foreground: INDEXED_COLOR_RED,
        },
      },
    ])
  })

  test('ignores malformed true-color and indexed SGR sub-params without misreading them as style codes', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write(
      `${getSgrStyleSentinel([38, 2, 256, 0, 0])}invalid-true-color ` +
        `${getSgrStyleSentinel([38, 5])}invalid-indexed` +
        `${getSgrStyleSentinel([0])}`
    )

    expect(buffer.readText()).toBe('invalid-true-color invalid-indexed')
    expect(buffer.readStyledRuns()).toEqual([
      {
        text: 'invalid-true-color invalid-indexed',
        style: {},
      },
    ])
  })

  test('preserves split CRLF pairing across SGR style controls', () => {
    const buffer = new TerminalDisplayBuffer()

    buffer.write('hello\r')
    buffer.write(getSgrStyleSentinel([0]))
    buffer.write('\nworld')

    expect(buffer.readVisibleText()).toBe('hello\nworld')
    expect(buffer.readStyledRuns()).toEqual([
      { text: 'hello\nworld', style: {} },
    ])
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
