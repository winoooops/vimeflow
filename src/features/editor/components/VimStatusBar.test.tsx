import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VimStatusBar } from './VimStatusBar'

describe('VimStatusBar', () => {
  test('displays vim mode correctly', () => {
    render(
      <VimStatusBar
        vimMode="NORMAL"
        fileName="App.tsx"
        lineNumber={42}
        columnNumber={12}
        encoding="UTF-8"
        language="TypeScript"
      />
    )

    expect(screen.getByText('-- NORMAL --')).toBeInTheDocument()
  })

  test('displays all vim modes correctly', () => {
    const { rerender } = render(
      <VimStatusBar
        vimMode="NORMAL"
        fileName="test.ts"
        lineNumber={1}
        columnNumber={1}
        encoding="UTF-8"
        language="TypeScript"
      />
    )

    expect(screen.getByText('-- NORMAL --')).toBeInTheDocument()

    rerender(
      <VimStatusBar
        vimMode="INSERT"
        fileName="test.ts"
        lineNumber={1}
        columnNumber={1}
        encoding="UTF-8"
        language="TypeScript"
      />
    )

    expect(screen.getByText('-- INSERT --')).toBeInTheDocument()

    rerender(
      <VimStatusBar
        vimMode="VISUAL"
        fileName="test.ts"
        lineNumber={1}
        columnNumber={1}
        encoding="UTF-8"
        language="TypeScript"
      />
    )

    expect(screen.getByText('-- VISUAL --')).toBeInTheDocument()
  })

  test('displays file name', () => {
    render(
      <VimStatusBar
        vimMode="NORMAL"
        fileName="App.tsx"
        lineNumber={42}
        columnNumber={12}
        encoding="UTF-8"
        language="TypeScript"
      />
    )

    expect(screen.getByText('App.tsx')).toBeInTheDocument()
  })

  test('displays cursor position', () => {
    render(
      <VimStatusBar
        vimMode="NORMAL"
        fileName="App.tsx"
        lineNumber={42}
        columnNumber={12}
        encoding="UTF-8"
        language="TypeScript"
      />
    )

    expect(screen.getByText('Ln 42, Col 12')).toBeInTheDocument()
  })

  test('displays file encoding', () => {
    render(
      <VimStatusBar
        vimMode="NORMAL"
        fileName="App.tsx"
        lineNumber={42}
        columnNumber={12}
        encoding="UTF-8"
        language="TypeScript"
      />
    )

    expect(screen.getByText('UTF-8')).toBeInTheDocument()
  })

  test('displays language', () => {
    render(
      <VimStatusBar
        vimMode="NORMAL"
        fileName="App.tsx"
        lineNumber={42}
        columnNumber={12}
        encoding="UTF-8"
        language="TypeScript"
      />
    )

    expect(screen.getByText('TypeScript')).toBeInTheDocument()
  })

  test('applies correct styling to container', () => {
    render(
      <VimStatusBar
        vimMode="NORMAL"
        fileName="App.tsx"
        lineNumber={42}
        columnNumber={12}
        encoding="UTF-8"
        language="TypeScript"
      />
    )

    const statusBar = screen.getByTestId('vim-status-bar')

    expect(statusBar).toHaveClass('h-7')
    expect(statusBar).toHaveClass('bg-surface-container-low')
    expect(statusBar).toHaveClass('font-mono')
  })

  test('vim mode indicator has distinct styling', () => {
    render(
      <VimStatusBar
        vimMode="NORMAL"
        fileName="App.tsx"
        lineNumber={42}
        columnNumber={12}
        encoding="UTF-8"
        language="TypeScript"
      />
    )

    const modeIndicator = screen.getByText('-- NORMAL --')

    expect(modeIndicator).toHaveClass('bg-primary-container')
    expect(modeIndicator).toHaveClass('text-surface')
  })
})
