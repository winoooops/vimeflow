import { afterEach, describe, test, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityEvent } from './ActivityEvent'
import { formatShortcut } from '../../../lib/formatShortcut'
import type { ToolActivityEvent } from '../types/activityEvent'

const now = new Date('2026-04-22T12:00:00Z')

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  'clipboard'
)

afterEach(() => {
  if (originalClipboardDescriptor) {
    Object.defineProperty(
      window.navigator,
      'clipboard',
      originalClipboardDescriptor
    )

    return
  }

  Reflect.deleteProperty(window.navigator, 'clipboard')
})

const setClipboard = (
  clipboard:
    | {
        writeText: (text: string) => Promise<void>
      }
    | undefined
): void => {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  })
}

const toolEvent = (
  overrides: Partial<ToolActivityEvent> = {}
): ToolActivityEvent => ({
  id: 't-1',
  kind: 'edit',
  tool: 'Edit',
  body: 'src/foo.ts',
  timestamp: '2026-04-22T11:59:42Z', // 18s before now
  status: 'done',
  durationMs: 120,
  ...overrides,
})

describe('ActivityEvent — basic row', () => {
  test('renders type label in uppercase', () => {
    render(<ActivityEvent event={toolEvent({ kind: 'edit' })} now={now} />)

    expect(screen.getByText('EDIT')).toBeInTheDocument()
  })

  test('renders body text', () => {
    render(
      <ActivityEvent
        event={toolEvent({ body: 'src/utils/jwt.ts' })}
        now={now}
      />
    )

    expect(screen.getByText('src/utils/jwt.ts')).toBeInTheDocument()
  })

  test.each([
    { kind: 'edit' as const, tool: 'Edit', symbol: 'edit', label: 'EDIT' },
    {
      kind: 'write' as const,
      tool: 'Write',
      symbol: 'edit_note',
      label: 'WRITE',
    },
    {
      kind: 'read' as const,
      tool: 'Read',
      symbol: 'visibility',
      label: 'READ',
    },
    { kind: 'bash' as const, tool: 'Bash', symbol: 'terminal', label: 'BASH' },
    { kind: 'grep' as const, tool: 'Grep', symbol: 'search', label: 'GREP' },
    {
      kind: 'glob' as const,
      tool: 'Glob',
      symbol: 'find_in_page',
      label: 'GLOB',
    },
    {
      kind: 'meta' as const,
      tool: 'WebFetch',
      symbol: 'tune',
      label: 'WEBFETCH',
    },
  ])(
    'renders $label icon as material symbol $symbol',
    ({ kind, tool, symbol, label }) => {
      render(<ActivityEvent event={toolEvent({ kind, tool })} now={now} />)
      const article = screen.getByRole('article', { name: label })
      // eslint-disable-next-line testing-library/no-node-access -- Material Symbols icon verification per rules/typescript/testing/CLAUDE.md
      const icon = article.querySelector('.material-symbols-outlined')

      expect(icon).toHaveTextContent(symbol)
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }
  )

  test('renders relative timestamp for done events (minute granularity)', () => {
    // toolEvent default timestamp is 18s before `now` → shows 'now'.
    render(<ActivityEvent event={toolEvent({ status: 'done' })} now={now} />)

    expect(screen.getByText('now')).toBeInTheDocument()
  })

  test('renders relative timestamp for failed events (minute granularity)', () => {
    render(<ActivityEvent event={toolEvent({ status: 'failed' })} now={now} />)

    expect(screen.getByText('now')).toBeInTheDocument()
  })

  test('renders Nm ago once the event is at least a minute old', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          status: 'done',
          // 90s before `now` → 1m ago
          timestamp: '2026-04-22T11:58:30Z',
        })}
        now={now}
      />
    )

    expect(screen.getByText('1m ago')).toBeInTheDocument()
  })

  test('meta kind uses raw tool name as label', () => {
    render(
      <ActivityEvent
        event={toolEvent({ kind: 'meta', tool: 'WebFetch' })}
        now={now}
      />
    )

    expect(screen.getByText('WEBFETCH')).toBeInTheDocument()
  })

  test('think kind renders body as italic', () => {
    render(
      <ActivityEvent
        event={{
          id: 'th-1',
          kind: 'think',
          body: 'reconsidering the approach',
          timestamp: '2026-04-22T11:59:42Z',
          status: 'done',
        }}
        now={now}
      />
    )
    const body = screen.getByText('reconsidering the approach')

    expect(body).toHaveClass('italic')
  })

  test('user kind renders body without mono font', () => {
    render(
      <ActivityEvent
        event={{
          id: 'u-1',
          kind: 'user',
          body: 'refactor this',
          timestamp: '2026-04-22T11:59:42Z',
          status: 'done',
        }}
        now={now}
      />
    )
    const body = screen.getByText('refactor this')

    expect(body).not.toHaveClass('font-mono')
  })

  test('activity row uses a default cursor and is not text-selectable', () => {
    render(<ActivityEvent event={toolEvent()} now={now} />)
    const row = screen.getByRole('article', { name: 'EDIT' })

    expect(row).toHaveClass('cursor-default')
    expect(row).toHaveClass('select-none')
  })
})

describe('ActivityEvent — diff chips (EDIT/WRITE)', () => {
  test('renders +N and −M chips when diff is present', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'edit',
          diff: { added: 12, removed: 2 },
        })}
        now={now}
      />
    )

    expect(screen.getByText('+12')).toBeInTheDocument()
    expect(screen.getByText('−2')).toBeInTheDocument()
  })

  test('does not render diff chips when diff is absent', () => {
    render(<ActivityEvent event={toolEvent({ kind: 'edit' })} now={now} />)

    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^−/)).not.toBeInTheDocument()
  })

  test('does not render diff chips for non-edit/write kinds even if diff is passed', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'read',
          tool: 'Read',
          diff: { added: 1, removed: 1 },
        })}
        now={now}
      />
    )

    expect(screen.queryByText('+1')).not.toBeInTheDocument()
  })
})

describe('ActivityEvent — bash status pill', () => {
  test('status=done + bashResult → "OK {passed}/{total}" in success palette', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'bash',
          tool: 'Bash',
          status: 'done',
          bashResult: { passed: 4, total: 4 },
        })}
        now={now}
      />
    )
    const pill = screen.getByText('OK 4/4')

    expect(pill).toHaveClass('text-success')
  })

  test('status=failed + bashResult → "FAILED {passed}/{total}" in error palette', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'bash',
          tool: 'Bash',
          status: 'failed',
          bashResult: { passed: 1, total: 4 },
        })}
        now={now}
      />
    )
    const pill = screen.getByText('FAILED 1/4')

    expect(pill).toHaveClass('text-error')
  })

  test('status=done, no bashResult → "OK" in success palette', () => {
    render(
      <ActivityEvent
        event={toolEvent({ kind: 'bash', tool: 'Bash', status: 'done' })}
        now={now}
      />
    )
    const pill = screen.getByText('OK')

    expect(pill).toHaveClass('text-success')
  })

  test('status=failed, no bashResult → "FAILED" in error palette', () => {
    render(
      <ActivityEvent
        event={toolEvent({ kind: 'bash', tool: 'Bash', status: 'failed' })}
        now={now}
      />
    )
    const pill = screen.getByText('FAILED')

    expect(pill).toHaveClass('text-error')
  })

  test('non-bash kinds render no status pill', () => {
    render(
      <ActivityEvent
        event={toolEvent({ kind: 'read', tool: 'Read', status: 'done' })}
        now={now}
      />
    )

    expect(screen.queryByText('OK')).not.toBeInTheDocument()
    expect(screen.queryByText('FAILED')).not.toBeInTheDocument()
  })
})

describe('ActivityEvent — running state', () => {
  test('renders animated dot with role="status" for running events', () => {
    render(
      <ActivityEvent
        event={{
          id: 'active-Edit',
          kind: 'edit',
          tool: 'Edit',
          body: 'src/foo.ts',
          timestamp: '2026-04-22T11:59:52Z', // 8s before now
          status: 'running',
          durationMs: null,
        }}
        now={now}
      />
    )
    const dot = screen.getByRole('status', { name: 'running' })

    expect(dot).toHaveClass('animate-pulse')
    expect(dot).toHaveClass('bg-success')
  })

  test('running timestamp reads "running Xs" computed from startedAt', () => {
    render(
      <ActivityEvent
        event={{
          id: 'active-Bash',
          kind: 'bash',
          tool: 'Bash',
          body: 'pnpm test',
          timestamp: '2026-04-22T11:59:52Z', // 8s before now
          status: 'running',
          durationMs: null,
        }}
        now={now}
      />
    )

    expect(screen.getByText('running 8s')).toBeInTheDocument()
  })

  test('running events render no status pill', () => {
    render(
      <ActivityEvent
        event={{
          id: 'active-Bash',
          kind: 'bash',
          tool: 'Bash',
          body: 'pnpm test',
          timestamp: '2026-04-22T11:59:52Z',
          status: 'running',
          durationMs: null,
        }}
        now={now}
      />
    )

    expect(screen.queryByText('OK')).not.toBeInTheDocument()
    expect(screen.queryByText('FAILED')).not.toBeInTheDocument()
  })

  test('non-running events do not render the animated dot', () => {
    render(<ActivityEvent event={toolEvent({ status: 'done' })} now={now} />)

    expect(
      screen.queryByRole('status', { name: 'running' })
    ).not.toBeInTheDocument()
  })

  test('running timestamp clamps a negative delta to 0s (clock-skew guard)', () => {
    // Event timestamp is 500ms AFTER `now` — simulates the sub-ms clock
    // skew case where the Rust event stamp beats the JS Date.now() snapshot.
    render(
      <ActivityEvent
        event={{
          id: 'active-Bash',
          kind: 'bash',
          tool: 'Bash',
          body: 'pnpm test',
          timestamp: '2026-04-22T12:00:00.500Z',
          status: 'running',
          durationMs: null,
        }}
        now={now}
      />
    )

    expect(screen.getByText('running 0s')).toBeInTheDocument()
  })
})

describe('ActivityEvent — tooltip integration', () => {
  test('marks every activity row as focusable with tabIndex 0', () => {
    render(
      <ActivityEvent
        event={{
          id: 'e1',
          kind: 'edit',
          tool: 'Edit',
          body: 'src/components/Tooltip.tsx with a long trailing description',
          timestamp: '2026-04-23T03:00:00Z',
          status: 'done',
          durationMs: 8,
          diff: { added: 12, removed: 0 },
        }}
        now={new Date('2026-04-23T03:01:00Z')}
      />
    )

    expect(screen.getByRole('article', { name: 'EDIT' })).toHaveAttribute(
      'tabindex',
      '0'
    )
  })

  test('shows activity details even when the body fits in the row', async () => {
    render(
      <ActivityEvent
        event={{
          id: 'e2',
          kind: 'read',
          tool: 'Read',
          body: 'short.tsx',
          timestamp: '2026-04-23T03:00:00Z',
          status: 'done',
          durationMs: 2,
        }}
        now={new Date('2026-04-23T03:01:00Z')}
      />
    )

    const row = screen.getByRole('article', { name: 'READ' })
    fireEvent.focus(row)

    const details = await screen.findByRole('dialog', {
      name: 'READ activity details',
    })

    expect(details).toHaveTextContent('short.tsx')
  })

  test('shows full activity details on row hover and copies the body', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)

    const body =
      "pwd && echo '---' && git rev-parse --show-toplevel && npm run test -- --run src/features/agent-status/components/ActivityEvent.test.tsx"

    setClipboard({ writeText })

    render(
      <ActivityEvent
        event={{
          id: 'e3',
          kind: 'bash',
          tool: 'Bash',
          body,
          timestamp: '2026-04-23T03:00:00Z',
          status: 'done',
          durationMs: 42,
        }}
        now={new Date('2026-04-23T03:01:00Z')}
      />
    )

    const row = screen.getByRole('article', { name: 'BASH' })
    fireEvent.focus(row)

    const details = await screen.findByRole('dialog', {
      name: 'BASH activity details',
    })

    expect(details).toHaveTextContent(body)
    await user.click(
      within(details).getByRole('button', { name: 'Copy activity details' })
    )

    expect(writeText).toHaveBeenCalledWith(body)
    expect(within(details).getByText('Copied')).toBeInTheDocument()
  })

  test('shows copy failure when the Clipboard API is unavailable', async () => {
    const user = userEvent.setup()

    setClipboard(undefined)

    render(
      <ActivityEvent
        event={{
          id: 'e4',
          kind: 'bash',
          tool: 'Bash',
          body: 'pnpm test',
          timestamp: '2026-04-23T03:00:00Z',
          status: 'done',
          durationMs: 42,
        }}
        now={new Date('2026-04-23T03:01:00Z')}
      />
    )

    const row = screen.getByRole('article', { name: 'BASH' })
    fireEvent.focus(row)

    const details = await screen.findByRole('dialog', {
      name: 'BASH activity details',
    })

    await user.click(
      within(details).getByRole('button', { name: 'Copy activity details' })
    )

    expect(within(details).getByText('Failed')).toBeInTheDocument()
    expect(
      within(details).getByRole('button', { name: 'Copy failed, try again' })
    ).toBeInTheDocument()
  })
})

describe('ActivityEvent — test-file verb prefix', () => {
  test('renders CREATED TEST label for Write of a test file', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          id: 'e1',
          kind: 'write',
          tool: 'Write',
          body: 'src/foo.test.ts',
          isTestFile: true,
        })}
        now={now}
      />
    )

    expect(screen.getByText(/^CREATED TEST$/)).toBeInTheDocument()
    // No emoji per CLAUDE.md no-emoji policy; the verb-prefixed text
    // is the only differentiator.
    expect(screen.queryByText(/🧪/)).not.toBeInTheDocument()
  })

  test('renders UPDATED TEST label for Edit of a test file', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          id: 'e2',
          kind: 'edit',
          tool: 'Edit',
          body: 'src/foo.test.ts',
          isTestFile: true,
        })}
        now={now}
      />
    )

    expect(screen.getByText(/^UPDATED TEST$/)).toBeInTheDocument()
    expect(screen.queryByText(/🧪/)).not.toBeInTheDocument()
  })

  test('regular Write event uses the kind-based label', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          id: 'e3',
          kind: 'write',
          tool: 'Write',
          body: 'src/foo.ts',
          isTestFile: false,
        })}
        now={now}
      />
    )

    expect(screen.queryByText(/created test/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/🧪/)).not.toBeInTheDocument()
    expect(screen.getByText(/^WRITE$/)).toBeInTheDocument()
  })
})

describe('ActivityEvent — copy with resultPreview', () => {
  test('Copy copies body alone when there is no resultPreview', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })

    render(
      <ActivityEvent
        event={toolEvent({ kind: 'bash', tool: 'Bash', body: 'pnpm test' })}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))

    const details = await screen.findByRole('dialog', {
      name: 'BASH activity details',
    })
    await user.click(
      within(details).getByRole('button', { name: 'Copy activity details' })
    )

    expect(writeText).toHaveBeenCalledWith('pnpm test')
  })

  test('Copy joins body and resultPreview when present', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })

    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'bash',
          tool: 'Bash',
          body: 'pnpm test',
          resultPreview: '✓ 4 passed',
        })}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))

    const details = await screen.findByRole('dialog', {
      name: 'BASH activity details',
    })
    await user.click(
      within(details).getByRole('button', { name: 'Copy activity details' })
    )

    expect(writeText).toHaveBeenCalledWith('pnpm test\n\n✓ 4 passed')
  })
})

describe('ActivityEvent — structured tooltip', () => {
  test('tooltip header shows the lowercase kind chip for a done tool call', async () => {
    render(
      <ActivityEvent
        event={toolEvent({ kind: 'bash', tool: 'Bash', status: 'done' })}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))

    const details = await screen.findByRole('dialog', {
      name: 'BASH activity details',
    })

    expect(within(details).getByText('bash')).toBeInTheDocument()
    expect(within(details).queryByText('OK')).not.toBeInTheDocument()
    expect(within(details).queryByText('exit')).not.toBeInTheDocument()
  })

  test('failed and running tool calls show no status chip in the tooltip', async () => {
    const { rerender } = render(
      <ActivityEvent
        event={toolEvent({ kind: 'bash', tool: 'Bash', status: 'failed' })}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))

    const failed = await screen.findByRole('dialog', {
      name: 'BASH activity details',
    })
    expect(within(failed).queryByText('FAILED')).not.toBeInTheDocument()
    expect(within(failed).queryByText('RUNNING')).not.toBeInTheDocument()

    rerender(
      <ActivityEvent
        event={{
          id: 'r',
          kind: 'bash',
          tool: 'Bash',
          body: 'pnpm test',
          timestamp: '2026-04-22T11:59:52Z',
          status: 'running',
          durationMs: null,
        }}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))

    const running = await screen.findByRole('dialog', {
      name: 'BASH activity details',
    })
    expect(within(running).queryByText('RUNNING')).not.toBeInTheDocument()
  })

  test('bash card shows no passed/total status chip even when bashResult is present', async () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'bash',
          tool: 'Bash',
          status: 'done',
          bashResult: { passed: 4, total: 4 },
        })}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))

    const details = await screen.findByRole('dialog', {
      name: 'BASH activity details',
    })
    expect(within(details).queryByText('OK 4/4')).not.toBeInTheDocument()
    expect(within(details).getByText('bash')).toBeInTheDocument()
  })

  test('think card renders no status chip and body in italic', async () => {
    render(
      <ActivityEvent
        event={{
          id: 'th',
          kind: 'think',
          body: 'considering options',
          timestamp: '2026-04-22T11:59:42Z',
          status: 'done',
        }}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'THINK' }))

    const details = await screen.findByRole('dialog', {
      name: 'THINK activity details',
    })
    expect(within(details).queryByText('OK')).not.toBeInTheDocument()
    const body = within(details).getByText('considering options')
    expect(body).toHaveClass('italic')
  })

  test('no resultPreview → no output pre block', async () => {
    render(
      <ActivityEvent
        event={toolEvent({ kind: 'read', tool: 'Read', body: 'src/x.ts' })}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'READ' }))

    const details = await screen.findByRole('dialog', {
      name: 'READ activity details',
    })
    // eslint-disable-next-line testing-library/no-node-access -- assert the <pre> output block is absent
    expect(details.querySelector('pre')).toBeNull()
  })

  test('renders 0s for a 0 ms completed tool call', async () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'bash',
          tool: 'Bash',
          status: 'done',
          durationMs: 0,
        })}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))
    expect(await screen.findByText('0s')).toBeInTheDocument()
  })

  test('bash card shows its command in a $ block', async () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'bash',
          tool: 'Bash',
          body: 'pnpm test',
          status: 'done',
        })}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))

    const details = await screen.findByRole('dialog', {
      name: 'BASH activity details',
    })
    expect(within(details).getByText('pnpm test')).toBeInTheDocument()
    expect(within(details).getByText('$')).toBeInTheDocument()
  })

  test('edit card shows the FilePathChip filename', async () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'edit',
          tool: 'Edit',
          body: 'src/components/Button.tsx',
          status: 'done',
        })}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'EDIT' }))

    const details = await screen.findByRole('dialog', {
      name: 'EDIT activity details',
    })
    expect(within(details).getByText('Button.tsx')).toBeInTheDocument()
  })

  test('footer hints render for bash and are static', async () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'bash',
          tool: 'Bash',
          body: 'pnpm test',
          status: 'done',
        })}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))

    const details = await screen.findByRole('dialog', {
      name: 'BASH activity details',
    })
    expect(within(details).getByText(/rerun/)).toBeInTheDocument()
    expect(within(details).getByText(/open in terminal/)).toBeInTheDocument()
    // Footer super key is platform-aware (⌘ on macOS, Ctrl elsewhere), not a
    // hardcoded ⌘ — assert it matches the resolved platform key.
    expect(within(details).getByText(formatShortcut('Mod'))).toBeInTheDocument()
  })

  test('user card renders body as plain text', async () => {
    render(
      <ActivityEvent
        event={{
          id: 'u-1',
          kind: 'user',
          body: 'refactor this',
          timestamp: '2026-04-22T11:59:42Z',
          status: 'done',
        }}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'USER' }))

    const details = await screen.findByRole('dialog', {
      name: 'USER activity details',
    })
    const body = within(details).getByText('refactor this')
    expect(body).not.toHaveClass('italic')
  })

  test('FilePathChip path wraps with break-all and renders dir + filename', async () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'edit',
          tool: 'Edit',
          body: 'src/components/Button.tsx',
          status: 'done',
        })}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'EDIT' }))

    const details = await screen.findByRole('dialog', {
      name: 'EDIT activity details',
    })
    const dir = within(details).getByText('src/components/')
    expect(dir).toHaveClass('text-[#6c7086]')
    const file = within(details).getByText('Button.tsx')
    expect(file).toHaveClass('font-semibold')
    // eslint-disable-next-line testing-library/no-node-access
    const pathSpan = dir.parentElement
    expect(pathSpan).toHaveClass('min-w-0')
    expect(pathSpan).toHaveClass('break-all')
  })

  test('FilePathChip splits a native Windows path on the last backslash', async () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'edit',
          tool: 'Edit',
          body: 'C:\\repo\\src\\Button.tsx',
          status: 'done',
        })}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'EDIT' }))

    const details = await screen.findByRole('dialog', {
      name: 'EDIT activity details',
    })
    const dir = within(details).getByText('C:\\repo\\src\\')
    expect(dir).toHaveClass('text-[#6c7086]')
    const file = within(details).getByText('Button.tsx')
    expect(file).toHaveClass('font-semibold')
  })

  test('FilePathChip icon stays aligned to first line while path wraps', async () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'read',
          tool: 'Read',
          body: 'src/components/Button.tsx',
          status: 'done',
        })}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'READ' }))

    const details = await screen.findByRole('dialog', {
      name: 'READ activity details',
    })
    const filename = within(details).getByText('Button.tsx')
    expect(filename).toHaveClass('font-semibold')
    // eslint-disable-next-line testing-library/no-node-access
    const pathSpan = filename.parentElement
    expect(pathSpan).toHaveClass('min-w-0')
    expect(pathSpan).toHaveClass('break-all')
  })

  test('CommandBlock command span wraps with whitespace-pre-wrap and break-all', async () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'bash',
          tool: 'Bash',
          body: 'npm run test -- --run src/features/agent-status/components/ActivityEvent.test.tsx',
          status: 'done',
        })}
        now={now}
      />
    )
    fireEvent.focus(screen.getByRole('article', { name: 'BASH' }))

    const details = await screen.findByRole('dialog', {
      name: 'BASH activity details',
    })

    const cmd = within(details).getByText(
      'npm run test -- --run src/features/agent-status/components/ActivityEvent.test.tsx'
    )
    expect(cmd).toHaveClass('whitespace-pre-wrap')
    expect(cmd).toHaveClass('break-all')
  })
})
