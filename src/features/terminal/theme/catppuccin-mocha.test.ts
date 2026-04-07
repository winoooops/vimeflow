import { describe, test, expect } from 'vitest'
import { catppuccinMocha, toXtermTheme } from './catppuccin-mocha'

describe('catppuccinMocha theme', () => {
  test('defines all required colors', () => {
    expect(catppuccinMocha.foreground).toBe('#cdd6f4')
    expect(catppuccinMocha.background).toBe('#1e1e2e')
    expect(catppuccinMocha.cursor).toBe('#f5e0dc')
    expect(catppuccinMocha.cursorAccent).toBe('#1e1e2e')
    expect(catppuccinMocha.selectionBackground).toBe('#585b70')
  })

  test('defines all ANSI colors', () => {
    expect(catppuccinMocha.black).toBe('#45475a')
    expect(catppuccinMocha.red).toBe('#f38ba8')
    expect(catppuccinMocha.green).toBe('#a6e3a1')
    expect(catppuccinMocha.yellow).toBe('#f9e2af')
    expect(catppuccinMocha.blue).toBe('#89b4fa')
    expect(catppuccinMocha.magenta).toBe('#f5c2e7')
    expect(catppuccinMocha.cyan).toBe('#94e2d5')
    expect(catppuccinMocha.white).toBe('#bac2de')
  })

  test('defines all bright ANSI colors', () => {
    expect(catppuccinMocha.brightBlack).toBe('#585b70')
    expect(catppuccinMocha.brightRed).toBe('#f38ba8')
    expect(catppuccinMocha.brightGreen).toBe('#a6e3a1')
    expect(catppuccinMocha.brightYellow).toBe('#f9e2af')
    expect(catppuccinMocha.brightBlue).toBe('#89b4fa')
    expect(catppuccinMocha.brightMagenta).toBe('#f5c2e7')
    expect(catppuccinMocha.brightCyan).toBe('#94e2d5')
    expect(catppuccinMocha.brightWhite).toBe('#a6adc8')
  })
})

describe('toXtermTheme', () => {
  test('converts TerminalTheme to xterm.js ITheme format', () => {
    const xtermTheme = toXtermTheme(catppuccinMocha)

    expect(xtermTheme.foreground).toBe('#cdd6f4')
    expect(xtermTheme.background).toBe('#1e1e2e')
    expect(xtermTheme.cursor).toBe('#f5e0dc')
    expect(xtermTheme.black).toBe('#45475a')
  })

  test('includes selectionForeground if provided', () => {
    const themeWithForeground = {
      ...catppuccinMocha,
      selectionForeground: '#ffffff',
    }

    const xtermTheme = toXtermTheme(themeWithForeground)

    expect(xtermTheme.selectionForeground).toBe('#ffffff')
  })

  test('omits selectionForeground if not provided', () => {
    const xtermTheme = toXtermTheme(catppuccinMocha)

    expect(xtermTheme.selectionForeground).toBeUndefined()
  })

  test('includes all color properties', () => {
    const xtermTheme = toXtermTheme(catppuccinMocha)

    const expectedKeys = [
      'foreground',
      'background',
      'cursor',
      'cursorAccent',
      'selectionBackground',
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'brightBlack',
      'brightRed',
      'brightGreen',
      'brightYellow',
      'brightBlue',
      'brightMagenta',
      'brightCyan',
      'brightWhite',
    ]

    expectedKeys.forEach((key) => {
      expect(xtermTheme).toHaveProperty(key)
    })
  })
})
