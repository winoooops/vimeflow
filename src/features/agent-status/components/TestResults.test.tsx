import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TestResults } from './TestResults'
import type { TestRunSnapshot } from '../types'

const baseSnap = (overrides: Partial<TestRunSnapshot>): TestRunSnapshot => ({
  sessionId: 's',
  runner: 'vitest',
  commandPreview: 'vitest run',
  startedAt: '2026-04-28T12:00:00Z',
  finishedAt: '2026-04-28T12:00:01Z',
  durationMs: 1400,
  status: 'pass',
  summary: { passed: 47, failed: 0, skipped: 0, total: 47, groups: [] },
  outputExcerpt: null,
  ...overrides,
})

describe('TestResults — placeholder', () => {
  test('renders dim placeholder when snapshot is null', () => {
    render(<TestResults snapshot={null} />)
    expect(screen.getByRole('status')).toHaveTextContent(/no runs yet/i)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('TestResults — live header', () => {
  test('pass state shows count, runner pill, duration', () => {
    render(<TestResults snapshot={baseSnap({ status: 'pass' })} />)
    const button = screen.getByRole('button', { name: /tests/i })
    expect(button).toHaveTextContent('47/47')
    expect(button).toHaveTextContent('vitest')
    expect(button).toHaveTextContent('1.4s')
  })

  test('fail state shows fail count', () => {
    render(
      <TestResults
        snapshot={baseSnap({
          status: 'fail',
          summary: { passed: 45, failed: 2, skipped: 0, total: 47, groups: [] },
        })}
      />
    )

    expect(screen.getByRole('button', { name: /tests/i })).toHaveTextContent(
      '45/47'
    )
  })

  test('noTests state shows "no tests" status text (not 0/0)', () => {
    render(
      <TestResults
        snapshot={baseSnap({
          status: 'noTests',
          summary: { passed: 0, failed: 0, skipped: 0, total: 0, groups: [] },
        })}
      />
    )

    const button = screen.getByRole('button', { name: /no tests collected/i })
    expect(button).toHaveTextContent(/no tests/i)
    expect(button).not.toHaveTextContent('0/0')
  })

  test('error state header shows "errored" text (not 0/0) and the runner', () => {
    render(
      <TestResults
        snapshot={baseSnap({ status: 'error', outputExcerpt: 'TS error' })}
      />
    )
    const button = screen.getByRole('button', { name: /runner errored/i })
    expect(button).toHaveTextContent(/errored/i)
    expect(button).toHaveTextContent('vitest')
    expect(button).not.toHaveTextContent('0/0')
  })

  test('header aria-label encodes status without relying on dot color', () => {
    // pass: full count + runner + duration
    const { rerender } = render(
      <TestResults snapshot={baseSnap({ status: 'pass' })} />
    )
    expect(
      screen.getByRole('button', { name: /47 of 47 passed/i })
    ).toBeInTheDocument()

    // fail: passed + failed counts
    rerender(
      <TestResults
        snapshot={baseSnap({
          status: 'fail',
          summary: { passed: 45, failed: 2, skipped: 0, total: 47, groups: [] },
        })}
      />
    )

    expect(
      screen.getByRole('button', { name: /45 of 47 passed, 2 failed/i })
    ).toBeInTheDocument()
  })
})

describe('TestResults — keyboard activation', () => {
  test('Enter and Space toggle expand without custom handlers', async () => {
    const user = userEvent.setup()
    render(<TestResults snapshot={baseSnap({})} />)
    const button = screen.getByRole('button', { name: /tests/i })

    expect(button).toHaveAttribute('aria-expanded', 'false')

    button.focus()
    await user.keyboard('{Enter}')
    expect(button).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard(' ')
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('TestResults — expanded body', () => {
  test('fail state renders summary text and group rows', async () => {
    const user = userEvent.setup()
    render(
      <TestResults
        snapshot={baseSnap({
          status: 'fail',
          summary: {
            passed: 45,
            failed: 2,
            skipped: 1,
            total: 48,
            groups: [
              {
                label: 'src/foo.test.ts',
                path: '/abs/src/foo.test.ts',
                kind: 'file',
                passed: 12,
                failed: 0,
                skipped: 0,
                total: 12,
                status: 'pass',
              },
              {
                label: 'src/bar.test.ts',
                path: '/abs/src/bar.test.ts',
                kind: 'file',
                passed: 5,
                failed: 2,
                skipped: 0,
                total: 7,
                status: 'fail',
              },
            ],
          },
        })}
        onOpenFile={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: /tests/i }))

    expect(screen.getByText(/45 passed/)).toBeInTheDocument()
    expect(screen.getByText(/2 failed/)).toBeInTheDocument()
    expect(screen.getByText(/1 skipped/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /open src\/foo\.test\.ts/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /open src\/bar\.test\.ts/i })
    ).toBeInTheDocument()
  })

  test('error state renders outputExcerpt fallback when null', async () => {
    const user = userEvent.setup()
    render(
      <TestResults
        snapshot={baseSnap({ status: 'error', outputExcerpt: null })}
      />
    )
    await user.click(screen.getByRole('button', { name: /tests/i }))
    expect(screen.getByText(/runner errored/i)).toBeInTheDocument()
  })

  test('error state renders outputExcerpt when present', async () => {
    const user = userEvent.setup()
    render(
      <TestResults
        snapshot={baseSnap({
          status: 'error',
          outputExcerpt: 'compile error: TS2345',
        })}
      />
    )
    await user.click(screen.getByRole('button', { name: /tests/i }))
    expect(screen.getByText(/compile error: TS2345/)).toBeInTheDocument()
  })

  test('noTests state shows "no tests collected"', async () => {
    const user = userEvent.setup()
    render(
      <TestResults
        snapshot={baseSnap({
          status: 'noTests',
          summary: { passed: 0, failed: 0, skipped: 0, total: 0, groups: [] },
        })}
      />
    )
    await user.click(screen.getByRole('button', { name: /tests/i }))
    expect(screen.getByText(/no tests collected/i)).toBeInTheDocument()
  })
})

describe('TestResults — group row click', () => {
  test('file row with path and onOpenFile is a button that fires onOpenFile', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    render(
      <TestResults
        snapshot={baseSnap({
          summary: {
            passed: 12,
            failed: 0,
            skipped: 0,
            total: 12,
            groups: [
              {
                label: 'src/foo.test.ts',
                path: '/abs/src/foo.test.ts',
                kind: 'file',
                passed: 12,
                failed: 0,
                skipped: 0,
                total: 12,
                status: 'pass',
              },
            ],
          },
        })}
        onOpenFile={onOpenFile}
      />
    )
    await user.click(screen.getByRole('button', { name: /tests/i }))
    await user.click(
      screen.getByRole('button', { name: /open src\/foo\.test\.ts/i })
    )
    expect(onOpenFile).toHaveBeenCalledOnce()
    expect(onOpenFile).toHaveBeenCalledWith('/abs/src/foo.test.ts')
  })

  test('file row with null path is non-interactive (no button)', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    render(
      <TestResults
        snapshot={baseSnap({
          summary: {
            passed: 1,
            failed: 0,
            skipped: 0,
            total: 1,
            groups: [
              {
                label: 'src/missing.test.ts',
                path: null,
                kind: 'file',
                passed: 1,
                failed: 0,
                skipped: 0,
                total: 1,
                status: 'pass',
              },
            ],
          },
        })}
        onOpenFile={onOpenFile}
      />
    )
    await user.click(screen.getByRole('button', { name: /tests/i }))
    // No button for the missing file — only the header button remains.
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent(/tests/i)
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  test('module/suite row never interactive', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    render(
      <TestResults
        snapshot={baseSnap({
          summary: {
            passed: 5,
            failed: 0,
            skipped: 0,
            total: 5,
            groups: [
              {
                // cspell:disable-next-line
                label: 'mycrate::tests',
                path: null,
                kind: 'module',
                passed: 5,
                failed: 0,
                skipped: 0,
                total: 5,
                status: 'pass',
              },
            ],
          },
        })}
        onOpenFile={onOpenFile}
      />
    )
    await user.click(screen.getByRole('button', { name: /tests/i }))
    // cspell:disable-next-line
    expect(screen.queryByRole('button', { name: /open mycrate/i })).toBeNull()
  })
})

describe('TestResults — useId aria-controls uniqueness', () => {
  test('two TestResults in one render have distinct aria-controls', () => {
    render(
      <>
        <TestResults snapshot={baseSnap({ runner: 'vitest' })} />
        <TestResults snapshot={baseSnap({ runner: 'cargo' })} />
      </>
    )
    const buttons = screen.getAllByRole('button', { name: /tests/i })
    expect(buttons).toHaveLength(2)
    const a = buttons[0].getAttribute('aria-controls')
    const b = buttons[1].getAttribute('aria-controls')
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
  })
})
